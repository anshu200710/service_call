/**
 * voice.service.js
 * ================================
 * Production-grade service layer for JCB outbound service reminder calls.
 *
 * v3 changes:
 *   • Reads `resolvedDate` from NLP result — stores real calendar dates
 *     (e.g. "Monday, 3 March 2025") in MongoDB instead of Hindi tokens.
 *   • Session now carries both `preferredDate` (raw token) and
 *     `resolvedDate` ({ display, iso, raw }) for maximum flexibility.
 */

import twilio         from 'twilio';
import ServiceBooking from '../models/Servicebooking.js';
import { callDataStore } from '../routes/outbound.js';
import {
  processUserInput,
  INTENT,
} from '../utils/conversational_intelligence.js';

/* =====================================================================
   CONFIGURATION
   ===================================================================== */
const CFG = {
  MAX_SILENCE_RETRIES:  3,
  MAX_TOTAL_TURNS:      14,
  CONFIDENCE_THRESHOLD: 0.50,
  GATHER_TIMEOUT:       6,
  SPEECH_TIMEOUT:       3,
  TTS_LANGUAGE:         'hi-IN',
  TTS_VOICE:            'Polly.Aditi',
};

/* =====================================================================
   SESSION STORE
   ===================================================================== */
const sessionStore = new Map();

/* =====================================================================
   LOGGER
   ===================================================================== */
const log = {
  info:  (tag, msg, meta = {}) =>
    console.log(  `[voice.service][${tag}] ${msg}`, Object.keys(meta).length ? meta : ''),
  warn:  (tag, msg, meta = {}) =>
    console.warn( `[voice.service][${tag}] WARN  ${msg}`, Object.keys(meta).length ? meta : ''),
  error: (tag, msg, meta = {}) =>
    console.error(`[voice.service][${tag}] ERROR ${msg}`, Object.keys(meta).length ? meta : ''),
};

/* =====================================================================
   HELPER: buildVoiceResponse
   ===================================================================== */
function buildVoiceResponse({ twiml, message, actionUrl, hangup = false }) {
  const sayOpts = { language: CFG.TTS_LANGUAGE, voice: CFG.TTS_VOICE };

  if (hangup) {
    twiml.say(sayOpts, message);
    twiml.hangup();
    return;
  }

  const gather = twiml.gather({
    input:           'speech',
    action:          actionUrl,
    method:          'POST',
    language:        CFG.TTS_LANGUAGE,
    timeout:         CFG.GATHER_TIMEOUT,
    speechTimeout:   CFG.SPEECH_TIMEOUT,
    profanityFilter: false,
  });
  gather.say(sayOpts, message);
}

function processUrl() {
  return `${process.env.PUBLIC_URL}/voice/process`;
}

function sendTwiML(res, twiml) {
  return res.type('text/xml').send(twiml.toString());
}

function errorResponse(res, tag, logMsg, speakMsg) {
  log.error(tag, logMsg);
  const twiml = new twilio.twiml.VoiceResponse();
  buildVoiceResponse({ twiml, message: speakMsg, actionUrl: processUrl(), hangup: true });
  return sendTwiML(res, twiml);
}

/* =====================================================================
   HELPER: createSession
   ===================================================================== */
function createSession(callData, callSid) {
  return {
    callSid,
    customerName:  callData.customerName  || 'ग्राहक',
    customerPhone: callData.customerPhone || null,
    machineModel:  callData.machineModel  || '',
    machineNumber: callData.machineNumber || '',
    serviceType:   callData.serviceType   || '',
    dueDate:       callData.dueDate       || '',

    state:          'awaiting_confirmation',
    preferredDate:  null,    // raw token  e.g. "22 तारीख"
    resolvedDate:   null,    // { display: "Monday, 3 March 2025", iso: "2025-03-03", raw: "22 तारीख" }

    outcome:         null,
    rejectionReason: null,

    silenceRetries: 0,
    unknownStreak:  0,
    totalTurns:     0,
    lastMessage:    '',
    callStartedAt:  new Date(),
    turns:          [],
  };
}

/* =====================================================================
   HELPER: resolveOutcome
   ===================================================================== */
function resolveOutcome(nextState, intent, session) {
  if (intent === INTENT.CONFIRM && nextState === 'ended') {
    if (session.state === 'awaiting_reschedule_confirm') return 'rescheduled';
    return 'confirmed';
  }
  if (nextState === 'ended' && session.preferredDate && session.state !== 'callback_offered') {
    return 'rescheduled';
  }
  if (nextState === 'ended' && session.state === 'callback_offered') {
    return 'callback';
  }
  if (intent === INTENT.REJECT && nextState === 'ended') return 'rejected';
  return 'no_response';
}

/* =====================================================================
   DB WRITER: saveCallOutcome
   ─────────────────────────────────────────────────────────────────────
   Stores the resolved calendar date (display string + ISO) in the DB
   instead of the raw Hindi token.

   DB fields by outcome:
     confirmed   → confirmedServiceDate  = original dueDate
     rescheduled → rescheduledDate       = "Monday, 3 March 2025"
                   rescheduledDateISO    = "2025-03-03"
     callback    → callbackDate          = "Monday, 3 March 2025"
                   callbackDateISO       = "2025-03-03"
     rejected    → rejectionReason       = customer's words
   ===================================================================== */
async function saveCallOutcome(session, outcome) {
  try {
    // Use resolved display date if available, fall back to raw token
    const resolvedDisplay = session.resolvedDate?.display || session.preferredDate || null;
    const resolvedISO     = session.resolvedDate?.iso     || null;

    const doc = await ServiceBooking.create({
      callSid:          session.callSid,
      customerName:     session.customerName,
      customerPhone:    session.customerPhone,
      machineModel:     session.machineModel,
      machineNumber:    session.machineNumber,
      serviceType:      session.serviceType,
      dueDateOriginal:  session.dueDate,

      outcome,

      confirmedServiceDate: outcome === 'confirmed'   ? session.dueDate   : null,

      rescheduledDate:    outcome === 'rescheduled'   ? resolvedDisplay   : null,
      rescheduledDateISO: outcome === 'rescheduled'   ? resolvedISO       : null,

      callbackDate:       outcome === 'callback'      ? resolvedDisplay   : null,
      callbackDateISO:    outcome === 'callback'      ? resolvedISO       : null,

      rejectionReason:    outcome === 'rejected'      ? session.rejectionReason : null,

      totalTurns:     session.totalTurns,
      callStartedAt:  session.callStartedAt,
      callEndedAt:    new Date(),
      turns:          session.turns,
    });

    log.info('db', `Saved — outcome: ${outcome} | date: ${resolvedDisplay || 'N/A'}`, {
      docId:   doc._id.toString(),
      callSid: session.callSid,
      iso:     resolvedISO,
    });

  } catch (err) {
    log.error('db', `Save failed: ${err.message}`, { callSid: session.callSid });
  }
}

/* =====================================================================
   HELPER: endSession
   ===================================================================== */
async function endSession(callSid, reason, outcome = 'no_response') {
  const session = sessionStore.get(callSid);
  sessionStore.delete(callSid);
  log.info('session', `Ended — ${reason} | outcome: ${outcome}`, { callSid });
  if (session) await saveCallOutcome(session, outcome);
}

/* =====================================================================
   HELPER: appendTurn
   ===================================================================== */
function appendTurn(session, { customerSaid, confidence, intent, systemReply }) {
  session.turns.push({
    turnNumber:   session.totalTurns,
    state:        session.state,
    customerSaid: customerSaid || '',
    confidence:   confidence   ?? null,
    intent:       intent       || null,
    systemReply,
  });
}

/* =====================================================================
   HELPER: silenceFallback
   ===================================================================== */
function silenceFallback(state, name) {
  const prompts = {
    awaiting_confirmation:      `${name} जी, क्या आप सर्विस बुक करवाना चाहते हैं? हाँ या नहीं बोलिए।`,
    awaiting_reason:            `${name} जी, कृपया बताएँ — सर्विस अभी क्यों नहीं करानी?`,
    awaiting_reschedule_date:   `${name} जी, कौन सी तारीख या दिन सुविधाजनक रहेगा?`,
    awaiting_reschedule_confirm:`${name} जी, हाँ या नहीं बोलिए।`,
    callback_offered:           `${name} जी, क्या हम आपको बाद में कॉल करें? कोई तारीख बताएँ।`,
    clarification:              `${name} जी, क्या आप सुन पा रहे हैं? हाँ या नहीं बोलिए।`,
  };
  return prompts[state] || `${name} जी, कृपया उत्तर दें।`;
}

/* =====================================================================
   handleInitialCall
   ===================================================================== */
async function handleInitialCall(req, res) {
  const twiml   = new twilio.twiml.VoiceResponse();
  const callSid = req.body?.CallSid;

  if (!callSid) {
    return errorResponse(res, 'greeting', 'Missing CallSid',
      'एक तकनीकी समस्या आई। कृपया बाद में संपर्क करें।');
  }

  const callData = callDataStore.get(callSid);
  if (!callData) {
    return errorResponse(res, 'greeting', `No callData for ${callSid}`,
      'माफ़ कीजिए, सर्विस डाटा उपलब्ध नहीं है। कृपया बाद में संपर्क करें।');
  }

  const session = createSession(callData, callSid);
  const { customerName, machineModel, machineNumber, serviceType, dueDate } = session;

  const greeting =
    `नमस्कार ${customerName} जी। ` +
    `मैं JCB सर्विस सेंटर से बोल रहा हूँ। ` +
    `आपकी ${machineModel} मशीन नंबर ${machineNumber} की ` +
    `${serviceType} सर्विस ${dueDate} को ड्यू है। ` +
    `क्या मैं आपके लिए यह सर्विस अभी बुक कर दूँ?`;

  session.lastMessage = greeting;
  sessionStore.set(callSid, session);

  log.info('greeting', `→ ${customerName}`, { callSid });

  buildVoiceResponse({ twiml, message: greeting, actionUrl: processUrl() });
  return sendTwiML(res, twiml);
}

/* =====================================================================
   handleUserInput
   ===================================================================== */
async function handleUserInput(req, res) {
  const twiml      = new twilio.twiml.VoiceResponse();
  const callSid    = req.body?.CallSid;
  const rawSpeech  = (req.body?.SpeechResult || '').trim();
  const rawConf    = req.body?.Confidence;
  const confidence = rawConf !== undefined ? parseFloat(rawConf) : 1.0;
  const action     = processUrl();

  if (!callSid) {
    return errorResponse(res, 'input', 'Missing CallSid',
      'एक तकनीकी समस्या आई। कृपया बाद में संपर्क करें।');
  }

  let session = sessionStore.get(callSid);
  if (!session) {
    return errorResponse(res, 'input', `No session for ${callSid}`,
      'माफ़ कीजिए, सत्र समाप्त हो गया। कृपया फिर से संपर्क करें।');
  }

  session.totalTurns += 1;
  const name = session.customerName;

  log.info('input', `Turn ${session.totalTurns} | state: ${session.state}`, {
    callSid, speech: rawSpeech.substring(0, 60), confidence: confidence.toFixed(2),
  });

  /* ── Turn cap ───────────────────────────────────────────────────── */
  if (session.totalTurns > CFG.MAX_TOTAL_TURNS) {
    const msg = `${name} जी, काफी देर हो गई। हम आपसे बाद में संपर्क करेंगे। धन्यवाद, नमस्कार।`;
    await endSession(callSid, 'max_turns', 'no_response');
    buildVoiceResponse({ twiml, message: msg, actionUrl: action, hangup: true });
    return sendTwiML(res, twiml);
  }

  /* ── Silence ────────────────────────────────────────────────────── */
  if (!rawSpeech) {
    session.silenceRetries += 1;
    log.warn('input', `Silence #${session.silenceRetries}`, { callSid });

    if (session.silenceRetries >= CFG.MAX_SILENCE_RETRIES) {
      const farewell = `${name} जी, आपसे बात नहीं हो पाई। हम बाद में संपर्क करेंगे। धन्यवाद, नमस्कार।`;
      appendTurn(session, { customerSaid: '', confidence: null, intent: 'silence', systemReply: farewell });
      sessionStore.set(callSid, session);
      await endSession(callSid, 'max_silence', 'no_response');
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
    } else {
      const fallback = silenceFallback(session.state, name);
      appendTurn(session, { customerSaid: '', confidence: null, intent: 'silence', systemReply: fallback });
      session.lastMessage = fallback;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: fallback, actionUrl: action });
    }
    return sendTwiML(res, twiml);
  }

  session.silenceRetries = 0;

  /* ── Low confidence ─────────────────────────────────────────────── */
  if (confidence < CFG.CONFIDENCE_THRESHOLD) {
    log.warn('input', `Low confidence (${confidence.toFixed(2)})`, { callSid });
    const repeatMsg = `माफ़ कीजिए ${name} जी, स्पष्ट नहीं सुनाई दिया। कृपया थोड़ा ज़ोर से बोलिए।`;
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: 'low_confidence', systemReply: repeatMsg });
    session.lastMessage = repeatMsg;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: repeatMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* ── NLP ────────────────────────────────────────────────────────── */
  let nlpResult;
  try {
    nlpResult = processUserInput(rawSpeech, {
      ...session,
      retries:       session.silenceRetries,
      unknownStreak: session.unknownStreak,
    });
  } catch (err) {
    log.error('input', `NLP error: ${err.message}`, { callSid });
    const errMsg = `${name} जी, एक तकनीकी समस्या आई। हम बाद में संपर्क करेंगे। नमस्कार।`;
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: 'nlp_error', systemReply: errMsg });
    sessionStore.set(callSid, session);
    await endSession(callSid, 'nlp_error', 'no_response');
    buildVoiceResponse({ twiml, message: errMsg, actionUrl: action, hangup: true });
    return sendTwiML(res, twiml);
  }

  const { replyText, nextState, endCall, preferredDate, resolvedDate, intent } = nlpResult;

  /* ── REPEAT ─────────────────────────────────────────────────────── */
  if (intent === INTENT.REPEAT) {
    const replay = session.lastMessage
      ? `${name} जी, मैं दोबारा बोल रहा हूँ — ${session.lastMessage}`
      : `${name} जी, मैं JCB सर्विस सेंटर से बोल रहा हूँ।`;
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: replay });
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: replay, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* ── UNCLEAR / CONFUSION ────────────────────────────────────────── */
  if (intent === INTENT.UNCLEAR || intent === INTENT.CONFUSION) {
    const clarify = replyText ||
      `माफ़ कीजिए ${name} जी, मैं समझ नहीं पाया। क्या सर्विस बुक करवानी है? हाँ या नहीं बोलिए।`;
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: clarify });
    session.lastMessage = clarify;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: clarify, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* ── Capture rejection reason ───────────────────────────────────── */
  if (session.state === 'awaiting_reason' && rawSpeech) {
    session.rejectionReason = rawSpeech;
  }

  /* ── Persist date (both raw token AND resolved calendar date) ───── */
  if (preferredDate)  session.preferredDate = preferredDate;
  if (resolvedDate)   session.resolvedDate  = resolvedDate;

  /* ── Unknown streak ─────────────────────────────────────────────── */
  const stateStuck =
    nextState === session.state &&
    ['awaiting_confirmation', 'awaiting_reason', 'clarification'].includes(nextState);
  session.unknownStreak = stateStuck ? session.unknownStreak + 1 : 0;

  /* ── Log turn ───────────────────────────────────────────────────── */
  appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: replyText });

  /* ── Update session ─────────────────────────────────────────────── */
  session.lastMessage = replyText;
  session.state       = nextState;
  sessionStore.set(callSid, session);

  log.info('input', `→ ${nextState} | intent: ${intent}`, {
    callSid,
    resolvedDate: resolvedDate?.display || 'N/A',
    iso:          resolvedDate?.iso     || 'N/A',
  });

  /* ── End or continue ────────────────────────────────────────────── */
  if (endCall || nextState === 'ended') {
    const outcome = resolveOutcome(nextState, intent, session);
    await endSession(callSid, `end_${nextState}`, outcome);
    buildVoiceResponse({ twiml, message: replyText, actionUrl: action, hangup: true });
  } else {
    buildVoiceResponse({ twiml, message: replyText, actionUrl: action });
  }

  return sendTwiML(res, twiml);
}

/* =====================================================================
   EXPORTS
   ===================================================================== */
export default { handleInitialCall, handleUserInput };