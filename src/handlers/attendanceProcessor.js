/**
 * Nirman Mitra — Attendance Processor Handler
 * Triple Verification(TM) — face + GPS + voice confidence routing.
 * Face, geo and voice checks run in parallel; results merge into confidence-based routing.
 *
 * Invoked by Step Functions with specific task types:
 *   - face_verify: Rekognition CompareFaces against enrolled face
 *   - geo_verify: GPS extraction from EXIF + geo-fence check against Sites table
 *   - voice_verify: LLM extracts work details from voice transcription
 *   - merge_decision: Combine all results + confidence routing + DynamoDB write
 */

import {
  RekognitionClient,
  CompareFacesCommand,
  DetectFacesCommand,
} from '@aws-sdk/client-rekognition';
import config, { isDemoMode } from '../utils/config.js';
import {
  getItem,
  putItem,
  updateItem,
  queryItems,
  incrementDaysLogged,
} from '../utils/dynamodb.js';
import { downloadFromS3 } from '../utils/s3.js';
import { complete } from '../providers/llm.js';
import { withRetry } from '../utils/retryHelper.js';

const rekognitionClient = new RekognitionClient({ region: config.aws.region });

export const handler = async (event) => {
  console.log('AttendanceProcessor event:', JSON.stringify(event).substring(0, 500));

  const { task } = event;

  try {
    switch (task) {
      case 'face_verify':
        return await processFaceVerification(event);
      case 'geo_verify':
        return await processGeoVerification(event);
      case 'voice_verify':
        return await processVoiceVerification(event);
      case 'merge_decision':
        return await processMergeDecision(event);
      default:
        return { statusCode: 400, error: `Unknown task: ${task}` };
    }
  } catch (err) {
    console.error(`AttendanceProcessor error (${task}):`, err);
    return { statusCode: 500, error: err.message, task };
  }
};

// ---------------------------------------------------------
// Task: Face Verification (Rekognition CompareFaces)
// ---------------------------------------------------------

async function processFaceVerification(event) {
  const { workerId, selfieKey, bucket } = event;

  const worker = await getItem(config.tables.workers, { worker_id: workerId });
  if (!worker || !worker.face_vector) {
    // In dev mode, auto-pass face verification if no enrolled face
    if (config.environment === 'dev') {
      console.log('[AttendanceProcessor DEV] No enrolled face, auto-passing face verify');
      return { success: true, confidence: 85, faceMatch: true, details: { similarity: 85, qualityBrightness: 75, qualitySharpness: 80 } };
    }
    return { success: false, confidence: 0, reason: 'no_enrolled_face' };
  }

  if (isDemoMode()) {
    console.log('[AttendanceProcessor DEMO] Simulating face verification');
    return {
      success: true,
      confidence: 88,
      faceMatch: true,
      details: { similarity: 88, qualityBrightness: 75, qualitySharpness: 80 },
    };
  }

  // Download the check-in selfie
  const selfieBuffer = await downloadFromS3(
    bucket || config.buckets.mediaRaw,
    selfieKey,
  );

  // Compare against enrolled face (stored during registration)
  // We use the worker's registration selfie from S3 as the source
  const enrolledKey = `workers/${workerId}/selfie-latest.jpg`;
  let enrolledBuffer;
  try {
    enrolledBuffer = await downloadFromS3(config.buckets.mediaRaw, enrolledKey);
  } catch {
    return { success: false, confidence: 0, reason: 'enrolled_selfie_not_found' };
  }

  const compareResult = await withRetry(
    () => rekognitionClient.send(
      new CompareFacesCommand({
        SourceImage: { Bytes: enrolledBuffer },
        TargetImage: { Bytes: selfieBuffer },
        SimilarityThreshold: 50,
        QualityFilter: 'AUTO',
      }),
    ),
    { label: 'Rekognition:CompareFaces' },
  );

  const match = compareResult.FaceMatches?.[0];
  if (!match) {
    return {
      success: false,
      confidence: 0,
      faceMatch: false,
      reason: 'no_face_match',
      unmatchedCount: compareResult.UnmatchedFaces?.length || 0,
    };
  }

  return {
    success: true,
    confidence: Math.round(match.Similarity),
    faceMatch: true,
    details: {
      similarity: Math.round(match.Similarity),
      qualityBrightness: Math.round(match.Face?.Quality?.Brightness || 0),
      qualitySharpness: Math.round(match.Face?.Quality?.Sharpness || 0),
    },
  };
}

// ---------------------------------------------------------
// Task: Geo-Fence Verification (GPS + Site matching)
// ---------------------------------------------------------

async function processGeoVerification(event) {
  const { workerId, latitude, longitude } = event;

  if (!latitude || !longitude) {
    // In dev mode, auto-pass geo verification if no GPS data (WhatsApp strips EXIF)
    if (config.environment === 'dev') {
      console.log('[AttendanceProcessor DEV] No GPS data, auto-passing geo verify');
      return {
        success: true,
        confidence: 90,
        withinRadius: true,
        distance: 50,
        nearestSite: { site_id: 'DEV-SITE-001', name: 'Dev Construction Site', radius: 500 },
      };
    }
    return { success: false, confidence: 0, reason: 'no_gps_data', distance: null };
  }

  if (isDemoMode()) {
    // Demo: simulate GPS within range of a demo site
    console.log('[AttendanceProcessor DEMO] Simulating geo verification');
    return {
      success: true,
      confidence: 92,
      withinRadius: true,
      distance: 45,
      nearestSite: { site_id: 'DEMO-SITE-001', name: 'Demo Construction Site', radius: 500 },
    };
  }

  // Query active sites
  const sites = await queryItems(
    config.tables.sites,
    'is_active = :active',
    { ':active': 'true' },
    'ActiveSitesIndex',
  );

  if (sites.length === 0) {
    return { success: false, confidence: 0, reason: 'no_active_sites', distance: null };
  }

  // Find nearest site within radius
  let nearestSite = null;
  let minDistance = Infinity;

  for (const site of sites) {
    const siteLat = site.geo_location?.latitude;
    const siteLng = site.geo_location?.longitude;
    if (!siteLat || !siteLng) continue;

    const distance = haversineDistance(latitude, longitude, siteLat, siteLng);
    if (distance < minDistance) {
      minDistance = distance;
      nearestSite = site;
    }
  }

  if (!nearestSite) {
    return { success: false, confidence: 0, reason: 'no_sites_with_coordinates', distance: null };
  }

  const siteRadius = nearestSite.radius_meters || 500;
  const withinRadius = minDistance <= siteRadius;

  // Confidence based on distance: 100% at center, decreasing as you approach boundary
  let confidence;
  if (minDistance <= siteRadius * 0.5) {
    confidence = 95; // Well within
  } else if (minDistance <= siteRadius) {
    confidence = 80; // Within but near edge
  } else if (minDistance <= siteRadius * 1.2) {
    confidence = 65; // Slightly outside (review range)
  } else {
    confidence = 30; // Clearly outside
  }

  return {
    success: withinRadius,
    confidence,
    withinRadius,
    distance: Math.round(minDistance),
    nearestSite: {
      site_id: nearestSite.site_id,
      name: nearestSite.site_name || nearestSite.site_id,
      radius: siteRadius,
    },
  };
}

// ---------------------------------------------------------
// Task: Voice Intent Verification (LLM)
// ---------------------------------------------------------

async function processVoiceVerification(event) {
  const { workerId, voiceTranscription, language } = event;

  if (!voiceTranscription || voiceTranscription.length < 3) {
    return { success: false, confidence: 0, reason: 'no_voice_data', workDetails: null };
  }

  if (isDemoMode()) {
    console.log('[AttendanceProcessor DEMO] Simulating voice verification');
    return {
      success: true,
      confidence: 85,
      workDetails: {
        activity: 'brick laying',
        location_mention: 'construction site',
        is_work_related: true,
      },
    };
  }

  const prompt = `You are analyzing a voice note from an Indian construction worker who is logging their daily attendance. The worker described their work in ${language === 'en' ? 'English' : 'Hindi'}.

Worker's voice transcription: "${voiceTranscription}"

Analyze this and determine:
1. Is this a genuine work-related check-in (not a fake/scripted message)?
2. What specific work activity did they describe?
3. Did they mention any location or site details?
4. Confidence score (0-100) that this is a legitimate work attendance check-in

Respond in EXACTLY this JSON format (no markdown, no code blocks):
{"is_work_related": true/false, "activity": "brief description", "location_mention": "any location mentioned or null", "confidence": 0-100, "reasoning": "brief explanation"}`;

  try {
    const response = await complete({ prompt, json: true, maxTokens: 200, cacheTtlSeconds: 86400 });
    const jsonStr = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(jsonStr);

    return {
      success: Boolean(result.is_work_related),
      confidence: Math.min(100, Math.max(0, Number(result.confidence) || 0)),
      workDetails: {
        activity: String(result.activity || ''),
        location_mention: result.location_mention || null,
        is_work_related: Boolean(result.is_work_related),
      },
    };
  } catch (err) {
    console.error('Voice verification failed:', err.message);
    // In dev mode, auto-pass voice verification on failure
    if (config.environment === 'dev') {
      console.log('[AttendanceProcessor DEV] Voice analysis failed, auto-passing');
      return { success: true, confidence: 80, workDetails: { activity: 'construction work', location_mention: 'site', is_work_related: true } };
    }
    return { success: false, confidence: 50, reason: 'voice_analysis_failed', workDetails: null };
  }
}

// ---------------------------------------------------------
// Task: Merge + Decision (Confidence Routing)
// Confidence Routing Rules
// ---------------------------------------------------------

async function processMergeDecision(event) {
  const { workerId, faceResult, geoResult, voiceResult, language } = event;

  const worker = await getItem(config.tables.workers, { worker_id: workerId });
  if (!worker) {
    return { statusCode: 404, error: 'Worker not found' };
  }

  const logDate = new Date().toISOString().split('T')[0];
  const timestamp = new Date().toISOString();
  // Use IST (UTC+5:30) for off-hours detection
  const currentHour = new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();

  // Check for duplicate (same worker + same date)
  const existingLog = await getItem(config.tables.attendance, {
    worker_id: workerId,
    log_date: logDate,
  });

  if (existingLog && existingLog.verification_status !== 'rejected') {
    return {
      status: 'duplicate',
      message: 'Attendance already logged for today',
      existingStatus: existingLog.verification_status,
    };
  }

  // Extract confidence scores
  const faceConfidence = faceResult?.confidence || 0;
  const geoConfidence = geoResult?.confidence || 0;
  const voiceConfidence = voiceResult?.confidence || 0;

  // Combined confidence: weighted average
  // Face: 40%, Geo: 35%, Voice: 25%
  const combinedConfidence = Math.round(
    faceConfidence * 0.4 + geoConfidence * 0.35 + voiceConfidence * 0.25,
  );

  // Determine verification status from the routing rules
  let verificationStatus;
  let flaggedReasons = [];

  // Face rules
  if (faceConfidence < 60) {
    flaggedReasons.push(`Low face confidence: ${faceConfidence}%`);
  } else if (faceConfidence < 80) {
    flaggedReasons.push(`Face confidence in review range: ${faceConfidence}%`);
  }

  // GPS rules
  const distance = geoResult?.distance;
  if (distance !== null && distance !== undefined) {
    const siteRadius = geoResult?.nearestSite?.radius || 500;
    if (distance > siteRadius) {
      flaggedReasons.push(`GPS outside radius: ${distance}m (limit: ${siteRadius}m)`);
    } else if (distance > siteRadius * 0.5) {
      flaggedReasons.push(`GPS near boundary: ${distance}m`);
    }
  } else if (!geoResult?.success) {
    flaggedReasons.push('No GPS data available');
  }

  // Voice rules
  if (!voiceResult?.workDetails?.is_work_related) {
    flaggedReasons.push('Voice note not work-related');
  }

  // Off-hours check
  const isOffHours = currentHour < 6 || currentHour >= 20;
  if (isOffHours) {
    flaggedReasons.push('Off-hours submission');
  }

  // Apply confidence routing
  // Off-hours is a flag only — it does not block auto-approval if scores are high
  const hasHardFail = faceConfidence < 30 || (distance !== null && distance > (geoResult?.nearestSite?.radius || 500) * 2);

  if (hasHardFail) {
    verificationStatus = 'rejected';
  } else if (faceConfidence >= 60 && geoConfidence >= 60) {
    verificationStatus = 'auto_approved';
  } else {
    verificationStatus = 'pending_review';
  }

  // Write attendance log
  const attendanceLog = {
    worker_id: workerId,
    log_date: logDate,
    timestamp,
    site_id: geoResult?.nearestSite?.site_id || 'unknown',
    site_name: geoResult?.nearestSite?.name || 'Unknown Site',
    verification_status: verificationStatus,
    confidence: combinedConfidence,
    face_confidence: faceConfidence,
    geo_confidence: geoConfidence,
    voice_confidence: voiceConfidence,
    geo_location: {
      latitude: geoResult?.distance !== null ? 'recorded' : null,
      longitude: geoResult?.distance !== null ? 'recorded' : null,
      distance_meters: distance,
    },
    voice_details: voiceResult?.workDetails || null,
    flagged_reason: flaggedReasons.join(' | ') || null,
    is_off_hours: isOffHours,
    created_at: timestamp,
  };

  await putItem(config.tables.attendance, attendanceLog);

  // If auto-approved, increment the worker's total days
  let totalDaysLogged = worker.total_days_logged || 0;
  if (verificationStatus === 'auto_approved') {
    const updated = await incrementDaysLogged(workerId);
    totalDaysLogged = updated?.total_days_logged || totalDaysLogged + 1;
  }

  const threshold = config.certificateThreshold;
  const daysRemaining = Math.max(0, threshold - totalDaysLogged);

  return {
    status: verificationStatus,
    confidence: combinedConfidence,
    faceConfidence,
    geoConfidence,
    voiceConfidence,
    flaggedReasons,
    logDate,
    totalDaysLogged,
    daysRemaining,
    threshold,
    isOffHours,
    certificateEligible: totalDaysLogged >= threshold,
  };
}

// ---------------------------------------------------------
// Haversine Distance (meters)
// ---------------------------------------------------------

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export default { handler };
