/**
 * Nirman Mitra — Worker Consent (PRD FR-1)
 * Before any document, image or voice is collected, the worker gets a purpose notice in their
 * language with an "I agree" button. Agreeing stores a consent record on the worker (notice
 * version, language, timestamp, channel) and appends an audit entry.
 */

import config from '../utils/config.js';
import { updateItem } from '../utils/dynamodb.js';
import { sendReplyButtons } from '../utils/whatsapp.js';
import { t, KN } from '../utils/i18n.js';
import { writeAudit, workerSubject } from './audit.js';

export const CONSENT_BUTTON_ID = 'consent_agree';

// Typed or spoken forms of "I agree", in addition to tapping the button
const AGREE_TEXT = /^\s*(i\s*agree|agree|yes|haan|ha|han|main\s+sahmat\s+hoon|sahmat|मैं\s+सहमत\s+हूँ|सहमत|ನಾನು\s+ಒಪ್ಪುತ್ತೇನೆ|ಒಪ್ಪುತ್ತೇನೆ|ಹೌದು)\s*[.!]?\s*$/i;

/** True when the worker has agreed to the current notice version */
export function hasConsent(worker) {
  return worker?.consent_version === config.consentNoticeVersion;
}

/** True when a message is the worker agreeing (button tap or typed "I agree") */
export function isConsentReply(message) {
  if (message.buttonId === CONSENT_BUTTON_ID) return true;
  return message.type === 'text' && AGREE_TEXT.test(message.text || '');
}

/** Purpose notice text in the worker's language */
export function consentNoticeText(language) {
  return t(language, {
    en: 'Nirman Mitra helps you build proof of your construction work days, so you can get welfare benefits.\n\n'
      + 'To do this we collect: your name, the last 4 digits of your Aadhaar (we do not keep the card photo), '
      + 'a selfie to match your face, your location when you check in, and voice notes about your work.\n\n'
      + 'We use this only to verify your work days and issue your work certificate. Tap "I agree" to continue.',
    hi: 'Nirman Mitra aapke construction kaam ke dinon ka saboot banane mein madad karta hai, taaki aapko welfare labh mil sake.\n\n'
      + 'Iske liye hum lenge: aapka naam, Aadhaar ke aakhri 4 ank (card ki photo hum nahi rakhte), '
      + 'chehra milane ke liye selfie, check-in ke waqt aapka location, aur aapke kaam ke baare mein voice note.\n\n'
      + 'Iska upyog sirf aapke kaam ke din verify karne aur work certificate dene ke liye hoga. Aage badhne ke liye "Main sahmat hoon" dabaiye.',
    kn: KN.consentNotice,
  });
}

/** Send the purpose notice with the "I agree" button */
export async function sendConsentNotice(phoneNumber, language) {
  const title = t(language, { en: 'I agree', hi: 'Main sahmat hoon', kn: KN.consentButton });
  return sendReplyButtons(phoneNumber, consentNoticeText(language), [{ id: CONSENT_BUTTON_ID, title }]);
}

/** Reply when a worker sends something before agreeing */
export function consentRequiredText(language) {
  return t(language, {
    en: 'Please tap "I agree" first. We do not save anything until you agree.',
    hi: 'Kripya pehle "Main sahmat hoon" dabaiye. Aapki sahmati ke bina hum kuch bhi save nahi karte.',
    kn: KN.consentRequired,
  });
}

/** Confirmation after the worker agrees */
export function consentThanksText(language) {
  return t(language, {
    en: 'Thank you. Your consent is recorded.',
    hi: 'Dhanyavaad. Aapki sahmati darj ho gayi hai.',
    kn: KN.consentThanks,
  });
}

/**
 * Store the consent record on the worker and append an audit entry.
 * @returns {Promise<object>} The consent record
 */
export async function recordConsent(workerId, language) {
  const record = {
    consent_version: config.consentNoticeVersion,
    consent_language: language,
    consent_at: new Date().toISOString(),
    consent_channel: 'whatsapp',
  };
  await updateItem(
    config.tables.workers,
    { worker_id: workerId },
    'SET consent_version = :v, consent_language = :l, consent_at = :at, consent_channel = :c',
    { ':v': record.consent_version, ':l': record.consent_language, ':at': record.consent_at, ':c': record.consent_channel },
  );
  await writeAudit({
    actor: `worker:${workerId}`,
    action: 'consent.given',
    subject: workerSubject(workerId),
    details: { notice_version: record.consent_version, language, channel: record.consent_channel },
  });
  return record;
}

export default {
  CONSENT_BUTTON_ID,
  hasConsent,
  isConsentReply,
  consentNoticeText,
  sendConsentNotice,
  consentRequiredText,
  consentThanksText,
  recordConsent,
};
