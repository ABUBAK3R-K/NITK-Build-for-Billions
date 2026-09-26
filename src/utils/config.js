/**
 * Nirman Mitra — Configuration Manager
 * Reads all environment variables from SAM template globals.
 * Provides demo mode toggle and utility helpers.
 */

const config = Object.freeze({
  // Environment
  environment: process.env.ENVIRONMENT || 'dev',
  certificateThreshold: parseInt(process.env.CERTIFICATE_THRESHOLD || '3', 10),

  // JWT Auth
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
    accessTokenExpiry: '15m',
    refreshTokenExpiry: '7d',
  },

  // DynamoDB Tables
  tables: {
    workers: process.env.WORKERS_TABLE || 'NirmanMitra-Workers-dev',
    attendance: process.env.ATTENDANCE_TABLE || 'NirmanMitra-AttendanceLogs-dev',
    sites: process.env.SITES_TABLE || 'NirmanMitra-Sites-dev',
    certificates: process.env.CERTIFICATES_TABLE || 'NirmanMitra-Certificates-dev',
    documents: process.env.DOCUMENTS_TABLE || 'NirmanMitra-Documents-dev',
    conversation: process.env.CONVERSATION_TABLE || 'NirmanMitra-ConversationState-dev',
    bedrockCache: process.env.BEDROCK_CACHE_TABLE || 'NirmanMitra-BedrockCache-dev',
    adminUsers: process.env.ADMIN_USERS_TABLE || 'NirmanMitra-AdminUsers-dev',
    refreshTokens: process.env.REFRESH_TOKENS_TABLE || 'NirmanMitra-RefreshTokens-dev',
  },

  // S3 Buckets
  buckets: {
    mediaRaw: process.env.MEDIA_RAW_BUCKET || 'nirman-mitra-media-raw',
    mediaProcessed: process.env.MEDIA_PROCESSED_BUCKET || 'nirman-mitra-media-processed',
    certificates: process.env.CERTIFICATES_BUCKET || 'nirman-mitra-certificates',
  },

  // WhatsApp Business (Meta Cloud API)
  whatsapp: {
    apiToken: process.env.WHATSAPP_API_TOKEN || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    apiBaseUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v22.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  },

  // SQS
  queues: {
    processing: process.env.PROCESSING_QUEUE_URL || '',
    dlq: process.env.DLQ_URL || '',
  },

  // Step Functions
  stepFunctions: {
    onboardingFlow: process.env.ONBOARDING_FLOW_ARN || '',
    attendanceFlow: process.env.ATTENDANCE_FLOW_ARN || '',
    certificateFlow: process.env.CERTIFICATE_FLOW_ARN || '',
  },

  // Rekognition
  rekognitionCollectionId: process.env.REKOGNITION_COLLECTION_ID || 'nirman-mitra-workers',

  // Lex V2 (optional intent layer; disabled when botId is empty)
  lex: {
    botId: process.env.LEX_BOT_ID || '',
    botAliasId: process.env.LEX_BOT_ALIAS_ID || '',
    localeId: process.env.LEX_LOCALE_ID || 'en_US',
  },

  // AWS region used by every AWS SDK client
  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
  },

  // LLM provider (see src/providers/llm.js)
  llm: {
    provider: process.env.LLM_PROVIDER || 'groq',
    model: process.env.LLM_MODEL || 'openai/gpt-oss-120b',
    groqApiKey: process.env.GROQ_API_KEY || '',
  },

  // Polly language → voice mapping (Neural voices for Indian languages)
  pollyVoices: {
    hi: { voiceId: 'Kajal', engine: 'neural', languageCode: 'hi-IN' },
    en: { voiceId: 'Kajal', engine: 'neural', languageCode: 'en-IN' },
    ta: { voiceId: 'Kajal', engine: 'neural', languageCode: 'hi-IN' }, // fallback
    te: { voiceId: 'Kajal', engine: 'neural', languageCode: 'hi-IN' }, // fallback
    kn: { voiceId: 'Kajal', engine: 'neural', languageCode: 'hi-IN' }, // fallback
    bn: { voiceId: 'Kajal', engine: 'neural', languageCode: 'hi-IN' }, // fallback
    mr: { voiceId: 'Kajal', engine: 'neural', languageCode: 'hi-IN' }, // fallback
    gu: { voiceId: 'Kajal', engine: 'neural', languageCode: 'hi-IN' }, // fallback
    ml: { voiceId: 'Kajal', engine: 'neural', languageCode: 'hi-IN' }, // fallback
  },
});

/** Check if running in demo/dev mode (only true when running locally, not on Lambda) */
export function isDemoMode() {
  return !process.env.AWS_LAMBDA_FUNCTION_NAME && config.environment === 'dev';
}

/** Get certificate threshold (3 for demo, 90 for prod) */
export function getCertificateThreshold() {
  return config.certificateThreshold;
}

/** Build standard CORS headers for API responses */
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Api-Key',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Content-Type': 'application/json',
  };
}

/** Build a standard API response */
export function apiResponse(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

export default config;
