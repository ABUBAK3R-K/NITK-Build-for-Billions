/**
 * Nirman Mitra — Message Handler (WhatsApp Webhook)
 * Central router: receives all WhatsApp messages and routes to appropriate flows.
 * GET  /webhook/whatsapp → Meta webhook verification (hub.challenge)
 * POST /webhook/whatsapp → incoming messages, authenticated via X-Hub-Signature-256
 *
 * Routing logic:
 * 1. New worker (no phone match) → Registration flow
 * 2. Onboarding worker → Route by conversation state step
 * 3. Active worker → Attendance check-in (Triple Verification) / progress queries
 */

import { LexRuntimeV2Client, RecognizeTextCommand } from '@aws-sdk/client-lex-runtime-v2';
import config, { apiResponse } from '../utils/config.js';
import { getWorkerByPhone, getConversationState, saveConversationState, getItem } from '../utils/dynamodb.js';
import {
  parseWebhookMessage,
  validateMetaSignature,
  downloadMedia,
  sendTextMessage,
  sendAudioMessage,
  sendLocationRequest,
} from '../utils/whatsapp.js';
import { uploadWorkerMedia } from '../utils/s3.js';
import {
  handleGreeting,
  handleNameCapture,
  handleAadhaarUpload,
  handleSelfieCapture,
  finalizeRegistration,
} from '../services/registration.js';
import { transcribeVoice, detectLanguage, generateAndUploadVoice } from '../services/voiceProcessor.js';
import { complete } from '../providers/llm.js';
import { withRetry } from '../utils/retryHelper.js';
import { handler as attendanceHandler } from './attendanceProcessor.js';
import { handler as certificateHandler } from './certificateGenerator.js';

// Optional Lex V2 intent layer (used only when LEX_BOT_ID is configured)
const lexClient = new LexRuntimeV2Client({ region: config.aws.region });
const LEX_BOT_ID = process.env.LEX_BOT_ID || '';
const LEX_BOT_ALIAS_ID = process.env.LEX_BOT_ALIAS_ID || '';
const LEX_LOCALE = process.env.LEX_LOCALE_ID || 'en_US';

export const handler = async (event) => {
  const method = event.httpMethod || event.requestContext?.http?.method;

  try {
    if (method === 'GET') {
      return handleWebhookVerification(event);
    }

    if (method === 'POST') {
      const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : event.body || '';

      if (!validateMetaSignature(rawBody, getHeader(event, 'x-hub-signature-256'))) {
        console.warn('Rejected webhook POST — invalid signature');
        return apiResponse(403, { error: 'Invalid signature' });
      }

      const result = await handleIncomingMessage(JSON.parse(rawBody));
      console.log('Webhook result:', result.body);
      return apiResponse(200, { status: 'received' });
    }

    return apiResponse(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('MessageHandler error:', err);
    // Acknowledge so Meta does not keep retrying the same delivery
    return apiResponse(200, { status: 'error_logged' });
  }
};

// ─────────────────────────────────────────────────────────
// GET — WhatsApp Webhook Verification
// ─────────────────────────────────────────────────────────

function handleWebhookVerification(event) {
  const params = event.queryStringParameters || {};
  const mode = params['hub.mode'];
  const token = params['hub.verify_token'];
  const challenge = params['hub.challenge'];

  if (mode === 'subscribe' && config.whatsapp.verifyToken && token === config.whatsapp.verifyToken) {
    console.log('Webhook verification successful');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: challenge,
    };
  }

  console.warn('Webhook verification failed — token mismatch');
  return apiResponse(403, { error: 'Verification failed' });
}

function getHeader(event, name) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : '';
}

// ─────────────────────────────────────────────────────────
// POST — Incoming WhatsApp Message
// ─────────────────────────────────────────────────────────

async function handleIncomingMessage(body) {
  // Parse the WhatsApp webhook payload
  const message = parseWebhookMessage(body);
  if (!message) {
    // Not a message event (could be status update) — acknowledge
    return apiResponse(200, { status: 'not_a_message' });
  }

  console.log(`Incoming ${message.type} from ${message.from}:`, JSON.stringify(message).substring(0, 200));

  const phoneNumber = message.from;

  // Look up worker by phone number
  const existingWorker = await getWorkerByPhone(phoneNumber);

  if (!existingWorker) {
    // New worker — start registration
    return await handleNewWorker(phoneNumber, message);
  }

  // Existing worker — route based on profile status
  const { profile_status, worker_id: workerId } = existingWorker;

  if (profile_status === 'onboarding') {
    return await handleOnboardingWorker(workerId, existingWorker, message);
  }

  if (profile_status === 'active') {
    return await handleActiveWorker(workerId, existingWorker, message);
  }

  // Unknown status
  return apiResponse(200, { status: 'unknown_profile_status' });
}

// ─────────────────────────────────────────────────────────
// Route: New Worker (Registration Start)
// ─────────────────────────────────────────────────────────

async function handleNewWorker(phoneNumber, message) {
  const textContent = message.text || message.caption || '';

  const result = await handleGreeting(phoneNumber, textContent);

  // Send response via WhatsApp
  await sendTextMessage(phoneNumber, result.responseText);
  if (result.audioUrl) {
    await sendAudioMessage(phoneNumber, result.audioUrl);
  }

  return apiResponse(200, {
    status: 'greeting_sent',
    workerId: result.workerId,
    isExisting: result.isExisting,
  });
}

// ─────────────────────────────────────────────────────────
// Route: Onboarding Worker (In-Progress Registration)
// ─────────────────────────────────────────────────────────

async function handleOnboardingWorker(workerId, worker, message) {
  const phoneNumber = message.from;
  const language = worker.preferred_language || 'hi';

  // Get current conversation state
  const state = await getConversationState(workerId);
  const currentStep = state?.current_step || 'awaiting_name';
  const retryCount = state?.retry_count || 0;
  const sessionId = state?.session_id || worker.worker_id;

  console.log(`Onboarding step for ${workerId}: ${currentStep}, message type: ${message.type}`);

  let result;

  try {
    switch (currentStep) {
      case 'awaiting_name':
        result = await processNameStep(workerId, message, language);
        break;

      case 'awaiting_aadhaar':
        result = await processAadhaarStep(workerId, message, language, retryCount);
        break;

      case 'awaiting_selfie':
        result = await processSelfieStep(workerId, message, language);
        break;

      case 'awaiting_registration_location':
        result = await processRegistrationLocationStep(workerId, message, language);
        break;

      case 'finalizing':
        result = await finalizeRegistration(workerId, language);
        result.nextStep = 'completed';
        break;

      default:
        result = {
          responseText: language === 'en'
            ? 'Please send your name to continue registration.'
            : 'Kripya apna naam bhejiye registration jari rakhne ke liye.',
          nextStep: 'awaiting_name',
        };
    }

    // If next step is registration location, send the location request button
    if (result.nextStep === 'awaiting_registration_location') {
      await sendTextMessage(phoneNumber, result.responseText);
      if (result.audioUrl) {
        await sendAudioMessage(phoneNumber, result.audioUrl);
      }
      // Send location request button
      try {
        const locText = language === 'en'
          ? 'Tap the button below to share your work site location.'
          : 'Apne kaam ki jagah ka location share karne ke liye neeche button dabayein.';
        await sendLocationRequest(phoneNumber, locText);
      } catch (err) {
        console.warn('[Registration] Location request button failed:', err.message);
      }

      await saveConversationState(workerId, sessionId, {
        current_step: 'awaiting_registration_location',
        preferred_language: language,
        retry_count: 0,
      });

      return apiResponse(200, {
        status: 'onboarding_step_processed',
        step: currentStep,
        nextStep: 'awaiting_registration_location',
      });
    }

    // If next step is finalizing, auto-chain immediately (don't wait for another message)
    if (result.nextStep === 'finalizing') {
      await sendTextMessage(phoneNumber, result.responseText);
      if (result.audioUrl) {
        await sendAudioMessage(phoneNumber, result.audioUrl);
      }

      // Auto-finalize
      const finalResult = await finalizeRegistration(workerId, language);
      await sendTextMessage(phoneNumber, finalResult.responseText);
      if (finalResult.audioUrl) {
        await sendAudioMessage(phoneNumber, finalResult.audioUrl);
      }

      return apiResponse(200, {
        status: 'onboarding_complete',
        step: 'finalizing',
        nextStep: 'completed',
      });
    }

    // Update conversation state with next step
    if (result.nextStep && result.nextStep !== 'completed') {
      await saveConversationState(workerId, sessionId, {
        current_step: result.nextStep,
        preferred_language: language,
        retry_count: result.nextStep === currentStep ? retryCount + 1 : 0,
      });
    }

    // Send response
    await sendTextMessage(phoneNumber, result.responseText);
    if (result.audioUrl) {
      await sendAudioMessage(phoneNumber, result.audioUrl);
    }

    return apiResponse(200, {
      status: 'onboarding_step_processed',
      step: currentStep,
      nextStep: result.nextStep,
    });
  } catch (err) {
    console.error(`Error in onboarding step ${currentStep}:`, err);

    const errorText = language === 'en'
      ? 'Something went wrong. Please try again.'
      : 'Kuch problem ho gayi. Kripya dobara koshish karein.';
    await sendTextMessage(phoneNumber, errorText);

    return apiResponse(200, { status: 'error', step: currentStep, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────
// Step Processors
// ─────────────────────────────────────────────────────────

async function processNameStep(workerId, message, language) {
  let audioBuffer = null;
  let textMessage = null;

  if (message.type === 'audio') {
    const media = await downloadMedia(message.mediaId);
    audioBuffer = media.buffer;
  } else if (message.type === 'text') {
    textMessage = message.text;
  } else {
    // Unsupported type for this step
    return {
      responseText: language === 'en'
        ? 'Please say or type your name.'
        : 'Kripya apna naam boliye ya type kariye.',
      nextStep: 'awaiting_name',
    };
  }

  return handleNameCapture(workerId, audioBuffer, textMessage, language);
}

async function processAadhaarStep(workerId, message, language, retryCount) {
  if (message.type !== 'image') {
    return {
      responseText: language === 'en'
        ? 'Please send a photo of your Aadhaar card.'
        : 'Kripya apne Aadhaar card ka photo bhejiye.',
      nextStep: 'awaiting_aadhaar',
    };
  }

  const media = await downloadMedia(message.mediaId);
  return handleAadhaarUpload(workerId, media.buffer, language, retryCount);
}

async function processSelfieStep(workerId, message, language) {
  if (message.type !== 'image') {
    return {
      responseText: language === 'en'
        ? 'Please send a selfie photo.'
        : 'Kripya apna selfie photo bhejiye.',
      nextStep: 'awaiting_selfie',
    };
  }

  const media = await downloadMedia(message.mediaId);
  return handleSelfieCapture(workerId, media.buffer, language);
}

async function processRegistrationLocationStep(workerId, message, language) {
  if (message.type === 'location') {
    // Store the worker's site location
    const { updateItem } = await import('../utils/dynamodb.js');
    await updateItem(
      config.tables.workers,
      { worker_id: workerId },
      'SET registration_location = :loc, updated_at = :ts',
      {
        ':loc': {
          latitude: message.latitude,
          longitude: message.longitude,
        },
        ':ts': new Date().toISOString(),
      },
    );

    const responseText = language === 'en'
      ? 'Location saved! Finalizing your registration...'
      : 'Location save ho gaya! Aapka registration poora kar rahe hain...';
    const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'location-saved');
    return { responseText, audioUrl, nextStep: 'finalizing' };
  }

  // If they send text "skip" or "ok", skip location
  if (message.type === 'text') {
    const lower = (message.text || '').toLowerCase().trim();
    if (/\b(ok|skip|done|haan|bas)\b/.test(lower)) {
      const responseText = language === 'en'
        ? 'Location skipped. Finalizing your registration...'
        : 'Location skip kiya. Aapka registration poora kar rahe hain...';
      return { responseText, audioUrl: null, nextStep: 'finalizing' };
    }
  }

  // Not a location message — re-prompt
  const responseText = language === 'en'
    ? 'Please share your work site location using the button, or send "ok" to skip.'
    : 'Kripya apne kaam ki jagah ka location share karein, ya "ok" bhejiye skip karne ke liye.';
  return { responseText, audioUrl: null, nextStep: 'awaiting_registration_location' };
}

// ─────────────────────────────────────────────────────────
// Route: Active Worker — Attendance Check-In & Queries
// ─────────────────────────────────────────────────────────

async function handleActiveWorker(workerId, worker, message) {
  const phoneNumber = message.from;
  const language = worker.preferred_language || 'hi';

  // Check attendance flow state first
  const state = await getConversationState(workerId);
  const attendanceStep = state?.current_step;

  // Text messages — check if we're in attendance flow first
  if (message.type === 'text') {
    // If awaiting voice, "ok"/"done"/"skip"/any short text skips voice and processes attendance
    if (attendanceStep === 'awaiting_voice' && state?.pending_selfie_key) {
      const lower = (message.text || '').toLowerCase().trim();
      if (lower.length < 20 || /\b(ok|done|skip|haan|ha|theek|bas)\b/.test(lower)) {
        return await processFullAttendance(workerId, worker, language, state, null);
      }
      // Longer text — use as voice transcription directly
      return await processFullAttendance(workerId, worker, language, state, message.text);
    }
    // If awaiting location, "skip" skips GPS
    if (attendanceStep === 'awaiting_location' && state?.pending_selfie_key) {
      const lower = (message.text || '').toLowerCase().trim();
      if (/\b(ok|skip|done|haan|bas)\b/.test(lower)) {
        // Skip location, go to voice request
        await saveConversationState(workerId, workerId, {
          ...state,
          current_step: 'awaiting_voice',
          pending_latitude: null,
          pending_longitude: null,
        });
        const voiceText = language === 'en'
          ? 'Now hold the mic button and tell us:\n• What work did you do today?\n• Which floor or area?\n\nExample: "Today I did painting work on 3rd floor"\n\nOr send "ok" to skip.'
          : 'Ab mic button dabake bataiye:\n• Aaj kya kaam kiya?\n• Kaun si jagah pe?\n\nJaise: "Aaj maine 3rd floor pe painting ka kaam kiya"\n\nYa "ok" bhejiye skip karne ke liye.';
        await sendTextMessage(phoneNumber, voiceText);
        return apiResponse(200, { status: 'location_skipped_awaiting_voice', workerId });
      }
    }
    return await handleActiveWorkerText(workerId, worker, message);
  }

  // Image: selfie for attendance — store it and request location
  if (message.type === 'image') {
    if (attendanceStep === 'awaiting_location' || attendanceStep === 'awaiting_voice') {
      // Worker sent another selfie — restart attendance flow
    }
    return await handleSelfiePendingLocation(workerId, worker, message, language);
  }

  // Location message: store GPS, then ask for voice note
  if (message.type === 'location') {
    // Accept location if we have a pending selfie (in awaiting_location OR awaiting_voice state)
    if (state?.pending_selfie_key && (attendanceStep === 'awaiting_location' || attendanceStep === 'awaiting_voice')) {
      // Store location, move to voice step
      await saveConversationState(workerId, workerId, {
        ...state,
        current_step: 'awaiting_voice',
        pending_latitude: message.latitude,
        pending_longitude: message.longitude,
      });
      const voiceText = language === 'en'
        ? 'Location received! Now hold the mic button and tell us:\n• What work did you do today?\n• Which floor or area?\n\nExample: "Today I did painting work on 3rd floor"\n\nOr send "ok" to skip.'
        : 'Location mil gaya! Ab mic button dabake bataiye:\n• Aaj kya kaam kiya?\n• Kaun si jagah pe?\n\nJaise: "Aaj maine 3rd floor pe painting ka kaam kiya"\n\nYa "ok" bhejiye skip karne ke liye.';
      await sendTextMessage(phoneNumber, voiceText);
      return apiResponse(200, { status: 'location_stored_awaiting_voice', workerId });
    }
    // Location without prior selfie
    const responseText = language === 'en'
      ? 'Location received! Now send a selfie to start attendance.'
      : 'Location mil gaya! Ab selfie bhejiye attendance shuru karne ke liye.';
    await sendTextMessage(phoneNumber, responseText);
    return apiResponse(200, { status: 'location_received_no_selfie', workerId });
  }

  // Audio: if awaiting voice for attendance, use it. Otherwise voice AI conversation.
  if (message.type === 'audio') {
    if (attendanceStep === 'awaiting_voice' && state?.pending_selfie_key) {
      // Transcribe and process attendance
      try {
        const media = await downloadMedia(message.mediaId);
        const transcription = await transcribeVoice(media.buffer, language);
        console.log(`[Attendance Voice] Worker ${workerId}: "${transcription}"`);
        return await processFullAttendance(workerId, worker, language, state, transcription || null);
      } catch (err) {
        console.warn('[Attendance Voice] Transcription failed, processing without:', err.message);
        return await processFullAttendance(workerId, worker, language, state, null);
      }
    }
    return await handleVoiceConversation(workerId, worker, message, language);
  }

  const responseText = language === 'en'
    ? 'Send a selfie + voice note to log attendance, or type "progress" to check your status.'
    : 'Attendance ke liye selfie + voice note bhejiye, ya "progress" type karein apna status dekhne ke liye.';
  await sendTextMessage(phoneNumber, responseText);
  return apiResponse(200, { status: 'guidance_sent', workerId });
}

// ─────────────────────────────────────────────────────────
// Active Worker: Text Message Handler (Intent Detection)
// ─────────────────────────────────────────────────────────

async function handleActiveWorkerText(workerId, worker, message) {
  const phoneNumber = message.from;
  const language = worker.preferred_language || 'hi';
  const text = (message.text || '').trim();

  // Detect intent and execute
  const intent = await detectIntent(text, language);
  return await executeIntent(intent, workerId, worker, phoneNumber, language);
}

// ─────────────────────────────────────────────────────────
// Voice Conversational AI
// Step 1: Transcribe the voice note
// Step 2: Detect intent (keywords, optional Lex, then LLM)
// Layer 3: Polly TTS response in preferred language
// ─────────────────────────────────────────────────────────

async function handleVoiceConversation(workerId, worker, message, language) {
  const phoneNumber = message.from;

  try {
    // Step 1: Download and transcribe the voice note
    const media = await downloadMedia(message.mediaId);
    const transcription = await transcribeVoice(media.buffer, language);

    console.log(`[VoiceAI] Worker ${workerId} said: "${transcription}"`);

    if (!transcription || transcription === 'Unknown' || transcription.length < 2) {
      const responseText = language === 'en'
        ? 'I could not understand the voice note. Please try again in a quieter place, or type your question.'
        : 'Voice note samajh nahi aaya. Kripya shant jagah se dobara boliye, ya apna sawaal type kariye.';
      await sendTextAndVoice(phoneNumber, workerId, responseText, language, 'voice-retry');
      return apiResponse(200, { status: 'voice_unclear', workerId });
    }

    // Step 2: Detect intent from transcription
    const intent = await detectIntent(transcription, language);

    console.log(`[VoiceAI] Detected intent: ${intent.type} (confidence: ${intent.confidence})`);

    // Step 3: Execute intent and get response
    const result = await executeIntent(intent, workerId, worker, phoneNumber, language);

    return result;
  } catch (err) {
    console.error('[VoiceAI] Error:', err.message);
    const errorText = language === 'en'
      ? 'Something went wrong. Please try again or type your question.'
      : 'Kuch problem ho gayi. Dobara koshish kariye ya apna sawaal type kariye.';
    await sendTextMessage(phoneNumber, errorText);
    return apiResponse(200, { status: 'voice_error', workerId, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────
// Intent Detection
// Layer 1: Lex V2 (optional; structured intents, confidence ≥ 70%)
// Layer 2: LLM NLU (free-form, when Lex is absent or < 70%)
// Layer 0: Fast keyword matching (no API call needed)
// ─────────────────────────────────────────────────────────

// Lex intent → our internal intent mapping
const LEX_INTENT_MAP = {
  CheckProgress: 'check_progress',
  LogAttendance: 'log_attendance',
  RequestCertificate: 'request_certificate',
  GetHelp: 'help',
  Greeting: 'greeting',
  FallbackIntent: null, // Lex doesn't know → go to the LLM
};

async function detectIntent(text, language) {
  const lower = (text || '').toLowerCase();

  // Layer 0: Fast keyword matching (no API call needed for obvious intents)
  // Demo triggers for showcasing review queue and certificate flow
  if (/\b(test review|demo fail|demo review)\b/.test(lower)) {
    return { type: 'demo_fail', confidence: 99, source: 'keyword', transcript: text };
  }
  if (/\b(test certificate|demo certificate|demo cert)\b/.test(lower)) {
    return { type: 'demo_certificate', confidence: 99, source: 'keyword', transcript: text };
  }

  if (/\b(progress|status|kitne din|days|din|kaisa|update)\b/.test(lower)) {
    return { type: 'check_progress', confidence: 95, source: 'keyword', transcript: text };
  }
  if (/\b(certificate|praman|patra|download|sanad)\b/.test(lower)) {
    return { type: 'request_certificate', confidence: 95, source: 'keyword', transcript: text };
  }
  if (/\b(attendance|haziri|check.?in|selfie|log)\b/.test(lower)) {
    return { type: 'log_attendance', confidence: 90, source: 'keyword', transcript: text };
  }
  if (/\b(help|madad|sahayata|kya kar|how|kaise)\b/.test(lower)) {
    return { type: 'help', confidence: 90, source: 'keyword', transcript: text };
  }
  if (/\b(hello|hi|namaskar|namaste|good morning|suprabhat)\b/.test(lower)) {
    return { type: 'greeting', confidence: 95, source: 'keyword', transcript: text };
  }

  // Layer 1: Lex V2 — structured intent recognition (if bot is configured)
  if (LEX_BOT_ID && LEX_BOT_ALIAS_ID) {
    try {
      const lexResult = await withRetry(
        () => lexClient.send(
          new RecognizeTextCommand({
            botId: LEX_BOT_ID,
            botAliasId: LEX_BOT_ALIAS_ID,
            localeId: LEX_LOCALE,
            sessionId: `worker-${Date.now()}`,
            text,
          }),
        ),
        { label: 'LexV2:RecognizeText' },
      );

      const lexIntent = lexResult.interpretations?.[0];
      const lexConfidence = Math.round(
        (lexIntent?.nluConfidence?.score || 0) * 100,
      );
      const lexIntentName = lexIntent?.intent?.name;
      const mappedIntent = LEX_INTENT_MAP[lexIntentName];

      console.log(`[LexV2] Intent: ${lexIntentName}, Confidence: ${lexConfidence}%`);

      // Use Lex result if confidence >= 70% and we have a valid mapping
      if (mappedIntent && lexConfidence >= 70) {
        return {
          type: mappedIntent,
          confidence: lexConfidence,
          source: 'lex',
          transcript: text,
        };
      }

      // Lex < 70% or FallbackIntent → fall through to the LLM (Layer 2)
      console.log(`[LexV2] Low confidence (${lexConfidence}%), falling back to LLM NLU`);
    } catch (err) {
      console.warn('[LexV2] Failed, falling back to LLM NLU:', err.message);
    }
  }

  // Layer 2: LLM NLU for ambiguous or complex queries
  try {
    const prompt = `You are the voice assistant for Nirman Mitra, a construction worker welfare platform. A worker sent a voice message. Classify their intent.

Worker said: "${text}"
Language: ${language === 'hi' ? 'Hindi' : 'English'}

Possible intents:
- check_progress: Worker wants to know how many days logged, remaining days, or percentage
- request_certificate: Worker wants their certificate, download link, or asks about eligibility
- log_attendance: Worker wants to mark today's attendance
- help: Worker is confused, asking what they can do, or needs guidance
- greeting: Worker is just saying hello
- other: Anything else (describe briefly)

Respond in EXACTLY this JSON format (no markdown):
{"intent": "check_progress", "confidence": 85, "detail": "brief explanation"}`;

    const response = await complete({
      prompt,
      json: true,
      maxTokens: 100,
      cacheTtlSeconds: 3600,
    });

    const jsonStr = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(jsonStr);

    return {
      type: result.intent || 'help',
      confidence: Math.min(100, Math.max(0, Number(result.confidence) || 70)),
      detail: result.detail || '',
      source: 'llm',
      transcript: text,
    };
  } catch (err) {
    console.warn('[IntentDetection] LLM NLU failed, defaulting to help:', err.message);
    return { type: 'help', confidence: 50, source: 'fallback', transcript: text };
  }
}

// ─────────────────────────────────────────────────────────
// Intent Executor — routes detected intent to actions
// ─────────────────────────────────────────────────────────

async function executeIntent(intent, workerId, worker, phoneNumber, language) {
  const daysLogged = worker.total_days_logged || 0;
  const threshold = config.certificateThreshold;
  const daysRemaining = Math.max(0, threshold - daysLogged);
  const pct = Math.round((daysLogged / threshold) * 100);
  const name = worker.name || '';

  switch (intent.type) {
    case 'demo_fail': {
      // Create a low-confidence attendance entry for review queue demo
      const logDate = new Date().toISOString().split('T')[0];
      const timestamp = new Date().toISOString();
      const { putItem } = await import('../utils/dynamodb.js');
      await putItem(config.tables.attendance, {
        worker_id: workerId,
        log_date: logDate,
        timestamp,
        site_id: 'SITE-DEMO-001',
        site_name: 'Greenfield Metro Station',
        verification_status: 'pending_review',
        confidence: 52,
        face_confidence: 48,
        geo_confidence: 65,
        voice_confidence: 40,
        geo_location: { latitude: 'recorded', longitude: 'recorded', distance_meters: 380 },
        voice_details: { activity: 'unclear audio', location_mention: null, is_work_related: false },
        flagged_reason: 'Low face confidence: 48% | Voice note not work-related',
        is_off_hours: false,
        created_at: timestamp,
      });
      const responseText = language === 'en'
        ? 'Attendance submitted for admin review due to low confidence. Check the admin dashboard review queue.'
        : 'Attendance admin review ke liye bhej di gayi — confidence kam thi. Admin dashboard pe review queue dekhiye.';
      await sendTextMessage(phoneNumber, responseText);
      return apiResponse(200, { status: 'demo_fail_created', workerId });
    }

    case 'demo_certificate': {
      // Fast-track certificate for demo: set days to threshold and generate
      const { updateItem } = await import('../utils/dynamodb.js');
      await updateItem(
        config.tables.workers,
        { worker_id: workerId },
        'SET total_days_logged = :days',
        { ':days': config.certificateThreshold },
      );
      const certText = language === 'en'
        ? `Demo mode: Set your days to ${config.certificateThreshold}. Generating certificate now...`
        : `Demo mode: Aapke din ${config.certificateThreshold} set kiye. Certificate bana rahe hain...`;
      await sendTextMessage(phoneNumber, certText);
      await triggerCertificateGeneration(workerId, phoneNumber, language);
      return apiResponse(200, { status: 'demo_certificate_triggered', workerId });
    }

    case 'check_progress': {
      const responseText = language === 'en'
        ? `${name}, you have logged ${daysLogged} of ${threshold} days (${pct}%). ${daysRemaining > 0 ? `${daysRemaining} days remaining.` : 'You are eligible for your certificate!'}`
        : `${name}, aapne ${threshold} mein se ${daysLogged} din log kiye hain (${pct}%). ${daysRemaining > 0 ? `${daysRemaining} din aur baaki hain.` : 'Aap certificate ke liye eligible hain!'}`;
      await sendTextAndVoice(phoneNumber, workerId, responseText, language, 'progress');
      return apiResponse(200, { status: 'progress_sent', workerId, intent: intent.type, daysLogged, daysRemaining });
    }

    case 'request_certificate': {
      if (daysLogged < threshold) {
        const responseText = language === 'en'
          ? `${name}, you need ${daysRemaining} more days to be eligible for a certificate. Keep logging attendance daily!`
          : `${name}, certificate ke liye ${daysRemaining} din aur chahiye. Har din attendance log karte rahiye!`;
        await sendTextAndVoice(phoneNumber, workerId, responseText, language, 'cert-not-ready');
        return apiResponse(200, { status: 'certificate_not_eligible', workerId, intent: intent.type });
      }
      // Eligible — trigger certificate
      await triggerCertificateGeneration(workerId, phoneNumber, language);
      return apiResponse(200, { status: 'certificate_triggered', workerId, intent: intent.type });
    }

    case 'log_attendance': {
      const responseText = language === 'en'
        ? 'To log attendance:\n1. Send a selfie photo\n2. Share your location (tap the button)\n3. Send a voice note about your work\n\nStart by sending a selfie!'
        : 'Attendance ke liye:\n1. Selfie photo bhejiye\n2. Location share karein (button dabayein)\n3. Kaam ka voice note bhejiye\n\nPehle selfie bhejiye!';
      await sendTextAndVoice(phoneNumber, workerId, responseText, language, 'attendance-guide');
      return apiResponse(200, { status: 'attendance_guidance_sent', workerId, intent: intent.type });
    }

    case 'greeting': {
      const responseText = language === 'en'
        ? `Hello ${name}! I am Nirman Mitra, your digital work companion. You have ${daysLogged} days logged. Send a selfie to log attendance, or ask me about your progress.`
        : `Namaskar ${name}! Main Nirman Mitra hoon, aapka digital saathi. Aapke ${daysLogged} din log hain. Attendance ke liye selfie bhejiye, ya apna progress poochiye.`;
      await sendTextAndVoice(phoneNumber, workerId, responseText, language, 'greeting');
      return apiResponse(200, { status: 'greeting_sent', workerId, intent: intent.type });
    }

    case 'help':
    default: {
      const responseText = language === 'en'
        ? `${name}, here is what I can do:\n• Send a selfie + voice note → Log attendance\n• Say "progress" → Check your days\n• Say "certificate" → Request certificate\n\nYou have ${daysLogged} days logged, ${daysRemaining} remaining.`
        : `${name}, main yeh kar sakta hoon:\n• Selfie + voice note bhejiye → Attendance log\n• "Progress" boliye → Apne din dekhiye\n• "Certificate" boliye → Certificate maangiye\n\nAapke ${daysLogged} din log hain, ${daysRemaining} baaki.`;
      await sendTextAndVoice(phoneNumber, workerId, responseText, language, 'help');
      return apiResponse(200, { status: 'help_sent', workerId, intent: intent.type });
    }
  }
}

// ─────────────────────────────────────────────────────────
// Helper: Send text + Polly voice response
// ─────────────────────────────────────────────────────────

async function sendTextAndVoice(phoneNumber, workerId, text, language, label) {
  try {
    await sendTextMessage(phoneNumber, text);
  } catch (err) {
    console.error('[sendTextAndVoice] sendText failed:', err.response?.status, err.response?.data?.error?.message || err.message);
    return; // Don't attempt voice if text itself failed
  }
  try {
    const audioUrl = await generateAndUploadVoice(workerId, text, language, label);
    if (audioUrl) {
      await sendAudioMessage(phoneNumber, audioUrl);
    }
  } catch (err) {
    console.warn('[VoiceAI] Polly TTS failed, text already sent:', err.message);
  }
}

// ─────────────────────────────────────────────────────────
// Step 1: Worker sends selfie → store it, request location
// ─────────────────────────────────────────────────────────

async function handleSelfiePendingLocation(workerId, worker, message, language) {
  const phoneNumber = message.from;

  try {
    // Download and upload selfie to S3
    const media = await downloadMedia(message.mediaId);
    const uploadResult = await uploadWorkerMedia(workerId, 'checkin-selfie', media.buffer, 'image/jpeg');

    // Save selfie key in conversation state — wait for location
    await saveConversationState(workerId, workerId, {
      current_step: 'awaiting_location',
      pending_selfie_key: uploadResult.key,
      pending_voice: message.caption || '',
      preferred_language: language,
    });

    // Send location request button
    const locationText = language === 'en'
      ? 'Selfie received! Now share your location to complete attendance. Tap the button below.'
      : 'Selfie mil gaya! Ab apna location share karein attendance poora karne ke liye. Neeche button dabayein.';

    try {
      await sendLocationRequest(phoneNumber, locationText);
    } catch (err) {
      // If location_request_message not supported, skip to voice step
      console.warn('[Attendance] Location request failed, skipping to voice step:', err.message);
      await saveConversationState(workerId, workerId, {
        current_step: 'awaiting_voice',
        pending_selfie_key: uploadResult.key,
        pending_latitude: null,
        pending_longitude: null,
        preferred_language: language,
      });
      const voiceText = language === 'en'
        ? 'Selfie received! Hold the mic button and tell us:\n• What work did you do today?\n• Which floor or area?\n\nExample: "Today I did painting work on 3rd floor"\n\nOr send "ok" to skip.'
        : 'Selfie mil gaya! Mic button dabake bataiye:\n• Aaj kya kaam kiya?\n• Kaun si jagah pe?\n\nJaise: "Aaj maine 3rd floor pe painting ka kaam kiya"\n\nYa "ok" bhejiye skip karne ke liye.';
      await sendTextMessage(phoneNumber, voiceText);
    }

    return apiResponse(200, { status: 'selfie_stored_awaiting_location', workerId });
  } catch (err) {
    console.error('Selfie pending location error:', err);
    await sendTextMessage(phoneNumber, language === 'en'
      ? 'Something went wrong. Please try sending your selfie again.'
      : 'Kuch problem ho gayi. Kripya dobara selfie bhejiye.');
    return apiResponse(200, { status: 'error', workerId, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────
// Step 3: Process full attendance (selfie + location + voice)
// Called after all inputs collected (voice may be null/skipped)
// ─────────────────────────────────────────────────────────

async function processFullAttendance(workerId, worker, language, state, voiceTranscription) {
  const phoneNumber = worker.phone_number;

  try {
    const selfieKey = state.pending_selfie_key;
    const latitude = state.pending_latitude || (config.environment === 'dev' ? 28.6139 : null);
    const longitude = state.pending_longitude || (config.environment === 'dev' ? 77.2090 : null);
    const voice = voiceTranscription || 'construction work at site';

    // Clear the pending state
    await saveConversationState(workerId, workerId, {
      current_step: 'active',
      pending_selfie_key: null,
      pending_latitude: null,
      pending_longitude: null,
      preferred_language: language,
    });

    // Run Triple Verification — all three in parallel
    const [faceResult, geoResult, voiceResult] = await Promise.all([
      attendanceHandler({ task: 'face_verify', workerId, selfieKey, bucket: config.buckets.mediaRaw }),
      attendanceHandler({ task: 'geo_verify', workerId, latitude, longitude }),
      attendanceHandler({ task: 'voice_verify', workerId, voiceTranscription: voice, language }),
    ]);

    const decision = await attendanceHandler({
      task: 'merge_decision',
      workerId,
      faceResult,
      geoResult,
      voiceResult,
      language,
    });

    // Send response
    let responseText;
    if (decision.status === 'duplicate') {
      responseText = language === 'en'
        ? 'Your attendance is already logged for today.'
        : 'Aapki aaj ki attendance pehle se log ho chuki hai.';
    } else if (decision.status === 'auto_approved') {
      responseText = language === 'en'
        ? `Attendance verified! Day ${decision.totalDaysLogged} logged. ${decision.daysRemaining} days remaining.${decision.certificateEligible ? ' Certificate eligible!' : ''}`
        : `Attendance verified! Din ${decision.totalDaysLogged} log hua. ${decision.daysRemaining} din aur baaki.${decision.certificateEligible ? ' Certificate ke liye eligible!' : ''}`;
    } else if (decision.status === 'pending_review') {
      responseText = language === 'en'
        ? 'Attendance submitted for admin review. You will be notified once reviewed.'
        : 'Attendance admin review ke liye bhej di gayi hai. Review hone par aapko bataya jayega.';
    } else {
      responseText = language === 'en'
        ? 'Attendance could not be verified. Please try again.'
        : 'Attendance verify nahi ho saki. Kripya dobara koshish karein.';
    }

    await sendTextMessage(phoneNumber, responseText);

    if (decision.status === 'auto_approved') {
      const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'attendance-confirmed');
      if (audioUrl) await sendAudioMessage(phoneNumber, audioUrl);
      if (decision.certificateEligible) {
        await triggerCertificateGeneration(workerId, phoneNumber, language);
      }
    }

    return apiResponse(200, {
      status: 'attendance_processed',
      workerId,
      verificationStatus: decision.status,
      confidence: decision.confidence,
      gpsUsed: Boolean(state.pending_latitude),
      voiceUsed: Boolean(voiceTranscription),
    });
  } catch (err) {
    console.error('Full attendance processing error:', err);
    await sendTextMessage(phoneNumber, language === 'en'
      ? 'Something went wrong with attendance. Please try again.'
      : 'Attendance mein kuch problem ho gayi. Kripya dobara koshish karein.');
    return apiResponse(200, { status: 'error', workerId, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────
// Fallback: Attendance without location (dev mode / location request unsupported)
// ─────────────────────────────────────────────────────────

async function handleAttendanceCheckIn(workerId, worker, message, language) {
  const phoneNumber = message.from;

  try {
    // Step 1: Download and upload selfie to S3
    const media = await downloadMedia(message.mediaId);
    const uploadResult = await uploadWorkerMedia(workerId, 'checkin-selfie', media.buffer, 'image/jpeg');

    // Step 2: Extract voice transcription from caption (if present)
    // In real usage, worker sends image with voice note caption or separate audio
    const voiceTranscription = message.caption || '';

    // Step 3: Extract GPS (from message location or demo defaults)
    const latitude = message.latitude || (config.environment === 'dev' ? 28.6139 : null);
    const longitude = message.longitude || (config.environment === 'dev' ? 77.2090 : null);

    // Step 4: Run Triple Verification locally (in production, Step Functions orchestrates this)
    // Run face + geo in parallel, then voice, then merge
    const [faceResult, geoResult, voiceResult] = await Promise.all([
      attendanceHandler({ task: 'face_verify', workerId, selfieKey: uploadResult.key, bucket: config.buckets.mediaRaw }),
      attendanceHandler({ task: 'geo_verify', workerId, latitude, longitude }),
      attendanceHandler({ task: 'voice_verify', workerId, voiceTranscription: voiceTranscription || 'construction work at site', language }),
    ]);

    // Step 5: Merge and decide
    const decision = await attendanceHandler({
      task: 'merge_decision',
      workerId,
      faceResult,
      geoResult,
      voiceResult,
      language,
    });

    // Step 6: Send appropriate response
    let responseText;

    if (decision.status === 'duplicate') {
      responseText = language === 'en'
        ? 'Your attendance is already logged for today.'
        : 'Aapki aaj ki attendance pehle se log ho chuki hai.';
    } else if (decision.status === 'auto_approved') {
      responseText = language === 'en'
        ? `Attendance verified! Day ${decision.totalDaysLogged} logged. ${decision.daysRemaining} days remaining.${decision.certificateEligible ? ' Certificate eligible!' : ''}`
        : `Attendance verified! Din ${decision.totalDaysLogged} log hua. ${decision.daysRemaining} din aur baaki.${decision.certificateEligible ? ' Certificate ke liye eligible!' : ''}`;
    } else if (decision.status === 'pending_review') {
      responseText = language === 'en'
        ? 'Attendance submitted for admin review. You will be notified once reviewed.'
        : 'Attendance admin review ke liye bhej di gayi hai. Review hone par aapko bataya jayega.';
    } else {
      responseText = language === 'en'
        ? 'Attendance could not be verified. Please send a clearer selfie and voice note.'
        : 'Attendance verify nahi ho saki. Kripya clear selfie aur voice note dobara bhejiye.';
    }

    await sendTextMessage(phoneNumber, responseText);

    // Generate voice confirmation for approved
    if (decision.status === 'auto_approved') {
      const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'attendance-confirmed');
      if (audioUrl) {
        await sendAudioMessage(phoneNumber, audioUrl);
      }

      // Check if worker is now eligible for certificate
      if (decision.certificateEligible) {
        await triggerCertificateGeneration(workerId, phoneNumber, language);
      }
    }

    return apiResponse(200, {
      status: 'attendance_processed',
      workerId,
      verificationStatus: decision.status,
      confidence: decision.confidence,
      daysLogged: decision.totalDaysLogged,
      daysRemaining: decision.daysRemaining,
      certificateEligible: decision.certificateEligible || false,
    });
  } catch (err) {
    console.error('Attendance check-in error:', err);
    const errorText = language === 'en'
      ? 'Something went wrong with attendance. Please try again.'
      : 'Attendance mein kuch problem ho gayi. Kripya dobara koshish karein.';
    await sendTextMessage(phoneNumber, errorText);
    return apiResponse(200, { status: 'error', workerId, error: err.message });
  }
}

// ─────────────────────────────────────────────────────────
// Certificate Generation Trigger
// ─────────────────────────────────────────────────────────

async function triggerCertificateGeneration(workerId, phoneNumber, language) {
  try {
    console.log(`Triggering certificate generation for ${workerId}`);

    const result = await certificateHandler({ task: 'generate', workerId, language });

    if (result.success) {
      const certText = language === 'en'
        ? `Congratulations! Your Smart Certificate is ready! BOCW Ref: ${result.bocwReference}. Download: ${result.downloadUrl}`
        : `Badhai ho! Aapka Smart Certificate taiyar hai! BOCW Ref: ${result.bocwReference}. Download: ${result.downloadUrl}`;
      await sendTextMessage(phoneNumber, certText);

      const audioUrl = await generateAndUploadVoice(workerId, certText, language, 'certificate-ready');
      if (audioUrl) {
        await sendAudioMessage(phoneNumber, audioUrl);
      }
    }
  } catch (err) {
    console.error('Certificate generation failed:', err.message);
    // Non-blocking: attendance is already logged, certificate can be retried
  }
}
