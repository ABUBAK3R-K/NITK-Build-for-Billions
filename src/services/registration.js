/**
 * Nirman Mitra — Registration Service
 * Core business logic for worker onboarding via WhatsApp.
 * Voice-first registration with Aadhaar OCR, selfie, bank passbook.
 */

import { v4 as uuidv4 } from 'uuid';
import {
  RekognitionClient,
  IndexFacesCommand,
  CreateCollectionCommand,
} from '@aws-sdk/client-rekognition';
import config, { isDemoMode } from '../utils/config.js';
import { putItem, getItem, updateItem, getWorkerByPhone, saveConversationState } from '../utils/dynamodb.js';
import { uploadWorkerMedia, uploadToS3 } from '../utils/s3.js';
import { getAadhaarLast4 } from '../utils/aadhaar.js';
import {
  detectLanguage,
  transcribeVoice,
  generateAndUploadVoice,
  getGreetingMessage,
  getStepPrompt,
} from './voiceProcessor.js';
import { withRetry } from '../utils/retryHelper.js';
import {
  extractAadhaarFields,
  extractBankFields,
  verhoeffChecksum,
  assessDocumentQuality,
  crossValidateNames,
} from './documentOcr.js';

const IS_DEMO = isDemoMode();
const rekognitionClient = IS_DEMO ? null : new RekognitionClient({ region: config.aws.region });
const COLLECTION_ID = config.rekognitionCollectionId;

// ─────────────────────────────────────────────────────────
// Collection Initialization (one-time)
// ─────────────────────────────────────────────────────────

let collectionReady = false;

async function ensureCollection() {
  if (collectionReady || IS_DEMO) { collectionReady = true; return; }
  try {
    await rekognitionClient.send(
      new CreateCollectionCommand({ CollectionId: COLLECTION_ID }),
    );
    console.log(`Created Rekognition collection: ${COLLECTION_ID}`);
  } catch (err) {
    if (err.name === 'ResourceAlreadyExistsException' || err.Code === 'ResourceAlreadyExistsException') {
      // Collection exists — OK
    } else {
      console.error('Failed to create Rekognition collection:', err.message);
      throw err;
    }
  }
  collectionReady = true;
}

// ─────────────────────────────────────────────────────────
// Step 1: Handle Greeting (New Worker)
// ─────────────────────────────────────────────────────────

/**
 * Handle a new worker's first message.
 * Detects language, checks for duplicates, creates worker record.
 * @param {string} phoneNumber - International phone number
 * @param {string} messageText - First message content (e.g., "Hi", "Namaste")
 * @returns {Promise<{workerId: string, language: string, isExisting: boolean, responseText: string, audioUrl: string|null}>}
 */
export async function handleGreeting(phoneNumber, messageText) {
  // Detect language from greeting
  const language = await detectLanguage(messageText || 'Hi');

  // Check for existing worker (duplicate detection via PhoneNumberIndex GSI)
  const existing = await getWorkerByPhone(phoneNumber);
  if (existing) {
    const responseText = language === 'en'
      ? `Hello ${existing.name || ''}! You are already registered. Send a selfie and voice note to log attendance.`
      : `Namaskar ${existing.name || ''}! Aap pehle se registered hain. Attendance log karne ke liye selfie aur voice note bhejiye.`;
    const audioUrl = await generateAndUploadVoice(existing.worker_id, responseText, language, 'already-registered');
    return {
      workerId: existing.worker_id,
      language,
      isExisting: true,
      responseText,
      audioUrl,
    };
  }

  // Create new worker record
  const workerId = uuidv4();
  const now = new Date().toISOString();

  await putItem(config.tables.workers, {
    worker_id: workerId,
    phone_number: phoneNumber,
    preferred_language: language,
    profile_status: 'onboarding',
    registration_started: now,
    total_days_logged: 0,
    created_at: now,
    updated_at: now,
  });

  // Create conversation state
  const sessionId = uuidv4();
  await saveConversationState(workerId, sessionId, {
    current_step: 'awaiting_name',
    preferred_language: language,
    retry_count: 0,
  });

  // Generate greeting voice response
  const responseText = getGreetingMessage(language);
  const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'greeting');

  return {
    workerId,
    language,
    isExisting: false,
    sessionId,
    responseText,
    audioUrl,
  };
}

// ─────────────────────────────────────────────────────────
// Step 2: Handle Name Capture
// ─────────────────────────────────────────────────────────

/**
 * Capture worker's name from voice note or text message.
 * @param {string} workerId
 * @param {Buffer|null} audioBuffer - Voice note buffer (if audio message)
 * @param {string|null} textMessage - Text message (if text)
 * @param {string} language
 * @returns {Promise<{name: string, responseText: string, audioUrl: string|null, nextStep: string}>}
 */
export async function handleNameCapture(workerId, audioBuffer, textMessage, language = 'hi') {
  let name;

  if (audioBuffer && audioBuffer.length > 100) {
    // Transcribe voice note
    name = await transcribeVoice(audioBuffer, language);
  } else if (textMessage) {
    name = textMessage.trim();
  } else {
    // No valid input — ask again
    const responseText = getStepPrompt('awaiting_name', language);
    const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'name-retry');
    return { name: null, responseText, audioUrl, nextStep: 'awaiting_name' };
  }

  // Clean up the name
  // Allow Unicode letters (Hindi, Tamil, etc.) + spaces + dots
  name = name.replace(/[^\p{L}\p{M}\s.]/gu, '').trim();
  if (!name || name.length < 2) {
    const responseText = getStepPrompt('awaiting_name', language);
    const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'name-retry');
    return { name: null, responseText, audioUrl, nextStep: 'awaiting_name' };
  }

  // Update worker record with name
  await updateItem(
    config.tables.workers,
    { worker_id: workerId },
    'SET #n = :name, updated_at = :ts',
    { ':name': name, ':ts': new Date().toISOString() },
    { '#n': 'name' },
  );

  // Move to next step
  const responseText = language === 'en'
    ? `Thank you, ${name}! Now please send a photo of your Aadhaar card.`
    : `Dhanyavaad, ${name}! Ab kripya apne Aadhaar card ka photo bhejiye.`;
  const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'name-confirmed');

  return { name, responseText, audioUrl, nextStep: 'awaiting_aadhaar' };
}

// ─────────────────────────────────────────────────────────
// Step 3: Handle Aadhaar Upload
// ─────────────────────────────────────────────────────────

/**
 * Process Aadhaar card photo: OCR → validate → encrypt → store.
 * Textract extracts → Verhoeff validates → only last 4 digits stored (full number discarded).
 * @param {string} workerId
 * @param {Buffer} imageBuffer
 * @param {string} language
 * @param {number} retryCount - Current retry count (max 3)
 * @returns {Promise<{success: boolean, extractedFields: object|null, responseText: string, audioUrl: string|null, nextStep: string}>}
 */
export async function handleAadhaarUpload(workerId, imageBuffer, language = 'hi', retryCount = 0) {
  // Check image quality
  const quality = await assessDocumentQuality(imageBuffer);
  if (quality < 50) {
    if (retryCount >= 3) {
      // Max retries reached — flag for admin review
      await updateItem(
        config.tables.workers,
        { worker_id: workerId },
        'SET admin_flag = :flag, admin_flag_reason = :reason, updated_at = :ts',
        {
          ':flag': true,
          ':reason': 'Aadhaar image quality too low after 3 retries',
          ':ts': new Date().toISOString(),
        },
      );
      const responseText = language === 'en'
        ? 'We could not read your Aadhaar card. An admin will review your case. Please try again later.'
        : 'Aapka Aadhaar card padha nahi ja saka. Admin aapki madad karenge. Kripya baad mein koshish karein.';
      const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'aadhaar-admin-flag');
      return { success: false, extractedFields: null, responseText, audioUrl, nextStep: 'admin_flagged' };
    }

    const responseText = getStepPrompt('retry_image', language);
    const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'aadhaar-retry');
    return { success: false, extractedFields: null, responseText, audioUrl, nextStep: 'awaiting_aadhaar' };
  }

  // Upload raw image to S3
  const uploadResult = await uploadWorkerMedia(workerId, 'aadhaar', imageBuffer, 'image/jpeg');

  // Extract fields with Textract
  const fields = await extractAadhaarFields(imageBuffer);

  // Validate Aadhaar number with Verhoeff checksum
  let aadhaarValid = false;
  if (fields.aadhaar_number) {
    aadhaarValid = verhoeffChecksum(fields.aadhaar_number);
  }

  if (!aadhaarValid && fields.aadhaar_number) {
    console.warn(`Verhoeff checksum failed for Aadhaar: ${fields.aadhaar_number.slice(-4)}`);
    // Still proceed but flag it
  }

  // Keep only the last 4 digits; the full number is never stored
  let aadhaarLast4 = '';
  if (fields.aadhaar_number) {
    aadhaarLast4 = getAadhaarLast4(fields.aadhaar_number);
  }

  // Store in Documents table
  const docId = uuidv4();
  await putItem(config.tables.documents, {
    worker_id: workerId,
    document_id: docId,
    document_type: 'aadhaar',
    extracted_data: {
      name: fields.name,
      dob: fields.dob,
      address: fields.address,
      gender: fields.gender,
      aadhaar_last4: aadhaarLast4,
    },
    ocr_confidence: fields.confidence,
    verhoeff_valid: aadhaarValid,
    s3_key: uploadResult.key,
    created_at: new Date().toISOString(),
  });

  // Update Workers table with Aadhaar info (only last 4)
  await updateItem(
    config.tables.workers,
    { worker_id: workerId },
    'SET aadhaar_last4 = :last4, aadhaar_name = :name, updated_at = :ts',
    {
      ':last4': aadhaarLast4,
      ':name': fields.name,
      ':ts': new Date().toISOString(),
    },
  );

  // Success response — move to selfie step
  const responseText = language === 'en'
    ? `Aadhaar verified (****${aadhaarLast4})! Now please send a clear selfie photo.`
    : `Aadhaar verified (****${aadhaarLast4})! Ab kripya apna ek selfie photo bhejiye.`;
  const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'aadhaar-verified');

  return {
    success: true,
    extractedFields: { ...fields, aadhaar_number: undefined }, // never return full Aadhaar
    responseText,
    audioUrl,
    nextStep: 'awaiting_selfie',
  };
}

// ─────────────────────────────────────────────────────────
// Step 4: Handle Selfie Capture
// ─────────────────────────────────────────────────────────

/**
 * Process worker selfie: Rekognition IndexFaces → store face vector (NOT raw image).
 * Store the face index ID; the enrollment selfie is kept for 1:1 comparison.
 * @param {string} workerId
 * @param {Buffer} imageBuffer
 * @param {string} language
 * @returns {Promise<{success: boolean, faceId: string|null, responseText: string, audioUrl: string|null, nextStep: string}>}
 */
export async function handleSelfieCapture(workerId, imageBuffer, language = 'hi') {
  await ensureCollection();

  // Upload to S3 (raw — will be deleted by 90d lifecycle)
  await uploadWorkerMedia(workerId, 'selfie', imageBuffer, 'image/jpeg');
  // Also save as selfie-latest.jpg for face comparison during attendance
  await uploadToS3(
    config.buckets.mediaRaw,
    `workers/${workerId}/selfie-latest.jpg`,
    imageBuffer,
    'image/jpeg',
    { worker_id: workerId, media_type: 'selfie-latest' },
  );

  try {
    let faceId;

    if (IS_DEMO) {
      // Demo: simulate successful face indexing
      faceId = `demo-face-${workerId}-${Date.now()}`;
      console.log(`[Registration DEMO] Simulated face index: ${faceId}`);
    } else {
      // Index face in Rekognition collection
      const indexResult = await withRetry(
        () => rekognitionClient.send(
          new IndexFacesCommand({
            CollectionId: COLLECTION_ID,
            Image: { Bytes: imageBuffer },
            ExternalImageId: workerId,
            MaxFaces: 1,
            DetectionAttributes: ['ALL'],
            QualityFilter: 'AUTO',
          }),
        ),
        { label: 'Rekognition:IndexFaces' },
      );

      const faceRecords = indexResult.FaceRecords || [];
      if (faceRecords.length === 0) {
        const responseText = language === 'en'
          ? 'No face detected. Please send a clear selfie showing your face.'
          : 'Chehra dikhai nahi diya. Kripya apna chehra dikhate hue ek clear selfie bhejiye.';
        const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'selfie-retry');
        return { success: false, faceId: null, responseText, audioUrl, nextStep: 'awaiting_selfie' };
      }

      faceId = faceRecords[0].Face.FaceId;
      const quality = faceRecords[0].FaceDetail?.Quality;

      // Check quality
      if (quality && (quality.Brightness < 30 || quality.Sharpness < 30)) {
        const responseText = language === 'en'
          ? 'The selfie quality is low. Please take another photo in good lighting.'
          : 'Selfie ki quality kam hai. Kripya achchi roshni mein dobara photo lein.';
        const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'selfie-quality');
        return { success: false, faceId: null, responseText, audioUrl, nextStep: 'awaiting_selfie' };
      }
    }

    // Store face ID in Workers table
    await updateItem(
      config.tables.workers,
      { worker_id: workerId },
      'SET face_vector = :faceId, updated_at = :ts',
      { ':faceId': faceId, ':ts': new Date().toISOString() },
    );

    // Move to location step
    const responseText = language === 'en'
      ? 'Selfie saved! Now share your work site location.'
      : 'Selfie save ho gaya! Ab apne kaam ki jagah ka location share karein.';
    const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'selfie-saved');

    return { success: true, faceId, responseText, audioUrl, nextStep: 'awaiting_registration_location' };
  } catch (err) {
    console.error('Selfie processing failed:', err.message);
    const responseText = getStepPrompt('error', language);
    const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'selfie-error');
    return { success: false, faceId: null, responseText, audioUrl, nextStep: 'awaiting_selfie' };
  }
}

// ─────────────────────────────────────────────────────────
// Step 5: Handle Bank Passbook
// ─────────────────────────────────────────────────────────

/**
 * Process bank passbook photo: OCR → cross-validate names → store.
 * Names are compared by exact match (not sent to any LLM — PII).
 * @param {string} workerId
 * @param {Buffer} imageBuffer
 * @param {string} language
 * @returns {Promise<{success: boolean, crossValidation: object|null, responseText: string, audioUrl: string|null, nextStep: string}>}
 */
export async function handleBankPassbook(workerId, imageBuffer, language = 'hi') {
  // Upload to S3
  await uploadWorkerMedia(workerId, 'passbook', imageBuffer, 'image/jpeg');

  // Extract fields with Textract
  const fields = await extractBankFields(imageBuffer);

  // Store in Documents table
  const docId = uuidv4();
  await putItem(config.tables.documents, {
    worker_id: workerId,
    document_id: docId,
    document_type: 'bank_passbook',
    extracted_data: {
      account_holder_name: fields.account_holder_name,
      account_number: fields.account_number ? `****${fields.account_number.slice(-4)}` : '',
      ifsc_code: fields.ifsc_code,
      bank_name: fields.bank_name,
    },
    ocr_confidence: fields.confidence,
    s3_key: `workers/${workerId}/passbook-${Date.now()}.jpg`,
    created_at: new Date().toISOString(),
  });

  // Cross-validate: Aadhaar name vs bank passbook name
  const worker = await getItem(config.tables.workers, { worker_id: workerId });
  const aadhaarName = worker?.aadhaar_name || '';
  const bankName = fields.account_holder_name || '';

  let crossValidation = null;
  if (aadhaarName && bankName) {
    crossValidation = await crossValidateNames(aadhaarName, bankName);

    // Update worker with cross-validation result
    await updateItem(
      config.tables.workers,
      { worker_id: workerId },
      'SET documents_cross_validated = :cv, cross_validation_result = :result, bank_name = :bn, updated_at = :ts',
      {
        ':cv': crossValidation.match,
        ':result': crossValidation,
        ':bn': bankName,
        ':ts': new Date().toISOString(),
      },
    );

    if (!crossValidation.match) {
      // Names don't match — inform worker but still proceed
      const responseText = language === 'en'
        ? `Note: The name on your Aadhaar ("${aadhaarName}") differs from your passbook ("${bankName}"). We will proceed, but an admin may verify this. Finalizing your registration...`
        : `Dhyan dein: Aapke Aadhaar ("${aadhaarName}") aur passbook ("${bankName}") mein naam alag hai. Hum aage badhenge, lekin admin verify kar sakte hain. Registration poora kar rahe hain...`;
      const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'name-mismatch');
      return { success: true, crossValidation, responseText, audioUrl, nextStep: 'finalizing' };
    }
  }

  // Names match or no names to compare — finalize
  const responseText = language === 'en'
    ? 'Bank passbook verified! Finalizing your registration...'
    : 'Bank passbook verified! Aapka registration poora kar rahe hain...';
  const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'passbook-verified');

  return { success: true, crossValidation, responseText, audioUrl, nextStep: 'finalizing' };
}

// ─────────────────────────────────────────────────────────
// Step 6: Finalize Registration
// ─────────────────────────────────────────────────────────

/**
 * Finalize worker registration: set profile_status to 'active'.
 * All verified → profile_status = 'active' → Polly confirmation
 * @param {string} workerId
 * @param {string} language
 * @returns {Promise<{success: boolean, responseText: string, audioUrl: string|null}>}
 */
export async function finalizeRegistration(workerId, language = 'hi') {
  const now = new Date().toISOString();

  // Get worker name for greeting
  const worker = await getItem(config.tables.workers, { worker_id: workerId });
  const workerName = worker?.name || '';

  // Update profile status
  await updateItem(
    config.tables.workers,
    { worker_id: workerId },
    'SET profile_status = :status, registration_completed = :ts, updated_at = :ts2',
    { ':status': 'active', ':ts': now, ':ts2': now },
  );

  // Generate completion message
  const responseText = language === 'en'
    ? `Congratulations ${workerName}! Your registration is complete. You can now log your daily attendance by sending a selfie and voice note.`
    : `Badhai ho ${workerName}! Aapka registration poora ho gaya. Ab aap har din selfie aur voice note bhejkar apni attendance log kar sakte hain.`;
  const audioUrl = await generateAndUploadVoice(workerId, responseText, language, 'registration-complete');

  return { success: true, responseText, audioUrl };
}

export default {
  handleGreeting,
  handleNameCapture,
  handleAadhaarUpload,
  handleSelfieCapture,
  handleBankPassbook,
  finalizeRegistration,
};
