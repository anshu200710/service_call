/**
 * voice.service.js  (v5 — Human Indian Agent Voice)
 * ================================
 * Production-grade service layer for JSB Motors outbound service reminder calls.
 *
 * v5 changes:
 *   • All voice text rewritten to sound like a natural Indian human agent (Hinglish)
 *   • Fixed: branch match not happening for Hindi (Devanagari) speech — now handled in matchBranch()
 *   • Fixed: intent 'undefined' bug — nlpResult.intent always falls back to 'unknown'
 *   • Fixed: resolveOutcome returning 'confirmed' when branch never matched (unknownStreak end)
 *   • Date confirmation now clearly re-states the full human-readable resolved date
 *   • Branch confirmation includes the city name and address snippet
 *   • Better unknownStreak scope — branch misses no longer pollute other state counts
 */

import twilio from 'twilio';
import ServiceBooking from '../models/Servicebooking.js';
import { callDataStore } from '../routes/outbound.js';
import {
  processUserInput,
  INTENT,
  matchBranch,
} from '../utils/conversational_intelligence.js';

/* =====================================================================
   CONFIGURATION
   ===================================================================== */
const CFG = {
  MAX_SILENCE_RETRIES:  3,
  MAX_TOTAL_TURNS:      15,
  CONFIDENCE_THRESHOLD: 0.5,
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
  info:  (tag, msg, meta = {}) => console.log( `[voice.service][${tag}] ${msg}`,  Object.keys(meta).length ? meta : ''),
  warn:  (tag, msg, meta = {}) => console.warn( `[voice.service][${tag}] WARN  ${msg}`, Object.keys(meta).length ? meta : ''),
  error: (tag, msg, meta = {}) => console.error(`[voice.service][${tag}] ERROR ${msg}`, Object.keys(meta).length ? meta : ''),
};

/* =====================================================================
   TWIML HELPERS
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
   SESSION FACTORY
   ===================================================================== */
function createSession(callData, callSid) {
  return {
    callSid,
    customerName:  callData.customerName  || 'sir',
    customerPhone: callData.customerPhone || null,
    machineModel:  callData.machineModel  || '',
    machineNumber: callData.machineNumber || '',
    serviceType:   callData.serviceType   || '500 Hour',
    dueDate:       callData.dueDate       || '',

    state: 'awaiting_initial_decision',

    preferredDate:  null,  // raw token e.g. "सोमवार"
    resolvedDate:   null,  // { display: "Monday, 2 March 2026", iso: "2026-03-02" }

    assignedBranchName: null,
    assignedBranchCode: null,
    assignedBranchCity: null,
    assignedBranchAddr: null,

    rejectionReason:    null,
    alreadyDoneDetails: null,
    persuasionCount:    0,
    lowConfRetries:     0,  // consecutive low-confidence turns

    outcome:       null,
    silenceRetries: 0,
    unknownStreak:  0,
    totalTurns:     0,
    lastMessage:    '',
    callStartedAt:  new Date(),
    turns:          [],
  };
}

/* =====================================================================
   OUTCOME RESOLVER
   ─────────────────────────────────────────────────────────────────────
   FIX v5: Only return 'confirmed' when branch was actually matched.
           unknownStreak exhaustion from awaiting_branch must be 'no_response'.
   ===================================================================== */
function resolveOutcome(nextState, intent, session) {
  if (nextState !== 'ended') return 'no_response';

  // already_done path
  if (session.state === 'awaiting_service_details') return 'already_done';

  // confirmed: need BOTH a date AND a matched branch
  if (session.assignedBranchCode && session.preferredDate) return 'confirmed';

  // explicit reject
  if (intent === INTENT.REJECT) return 'rejected';

  // reached here via unknownStreak, silence, or turn cap — no clean confirmation
  return 'no_response';
}

/* =====================================================================
   DB WRITER
   ===================================================================== */
async function saveCallOutcome(session, outcome) {
  try {
    const resolvedDisplay = session.resolvedDate?.display || session.preferredDate || null;
    const resolvedISO     = session.resolvedDate?.iso     || null;

    const doc = await ServiceBooking.create({
      callSid:         session.callSid,
      customerName:    session.customerName,
      customerPhone:   session.customerPhone,
      machineModel:    session.machineModel,
      machineNumber:   session.machineNumber,
      serviceType:     session.serviceType,
      dueDateOriginal: session.dueDate,

      outcome,

      confirmedServiceDate:    outcome === 'confirmed' ? resolvedDisplay : null,
      confirmedServiceDateISO: outcome === 'confirmed' ? resolvedISO     : null,

      assignedBranchName: session.assignedBranchName || null,
      assignedBranchCode: session.assignedBranchCode || null,
      assignedBranchCity: session.assignedBranchCity || null,

      rejectionReason:    outcome === 'rejected'     ? session.rejectionReason    : null,
      alreadyDoneDetails: outcome === 'already_done' ? session.alreadyDoneDetails : null,

      totalTurns:    session.totalTurns,
      callStartedAt: session.callStartedAt,
      callEndedAt:   new Date(),
      turns:         session.turns,
    });

    log.info('db', `Saved — outcome: ${outcome} | date: ${resolvedDisplay || 'N/A'}`, {
      docId:   doc._id.toString(),
      callSid: session.callSid,
      branch:  session.assignedBranchCode || 'N/A',
      iso:     resolvedISO,
    });
  } catch (err) {
    log.error('db', `Save failed: ${err.message}`, { callSid: session.callSid });
  }
}

/* =====================================================================
   SESSION CLEANUP
   ===================================================================== */
async function endSession(callSid, reason, outcome = 'no_response') {
  const session = sessionStore.get(callSid);
  sessionStore.delete(callSid);
  log.info('session', `Ended — ${reason} | outcome: ${outcome}`, { callSid });
  if (session) await saveCallOutcome(session, outcome);
}

/* =====================================================================
   TURN LOGGER
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
   HUMAN-SOUNDING VOICE LINES
   ─────────────────────────────────────────────────────────────────────
   Written as a warm, natural Indian service center agent would speak.
   Mix of Hindi and English (Hinglish) — conversational, not robotic.
   ===================================================================== */
const V = {

  /* ── Greeting ── */
  greeting: (name, model, number, serviceType) =>
    `Namaste ${name} ji! Main Rajesh Jcb Motors bol rahi hun, JCB Motors Service Center se. ` +
    `Aapki ${model} machine, number ${number}, ki ${serviceType} service due ho gayi hai. ` +
    `Kya main aapke liye yeh service is hafte mein book kar sakta hun?`,

  /* ── Date ask ── */
  askDate: (name) =>
    `Zaroor ${name} ji! Aap batao — kaunsa din ya tarikh aapke liye theek rahega? ` +
    `Jaise kal, somwar, mangalwar, ya koi bhi tarikh bata sakte hain.`,

  /* ── Date confirmation — clearly states full resolved date ── */
  confirmDate: (name, displayDate) =>
    `Theek hai ${name} ji. To main ${displayDate} ke liye service book kar deta hun — ` +
    `sahi hai na? Haan ya nahi boliye.`,

  /* ── Branch ask ── */
  askBranch: (name) =>
    `Bilkul ${name} ji. Ab mujhe batao — aapki machine abhi kaun si city mein hai? ` +
    `Jaise Ajmer, Alwar, Jaipur, Kota, Udaipur, Sikar, Bhilwara, Bharatpur, Tonk — ` +
    `koi bhi city ka naam boliye.`,

  /* ── Branch not recognised ── */
  askBranchAgain: (name) =>
    `${name} ji, mujhe clearly samajh nahi aaya. Aap sirf city ka naam boliye — ` +
    `jaise Ajmer, Jaipur, Kota, Udaipur, ya Sikar.`,

  /* ── Full booking confirmation — date + branch + address ── */
  confirmBooking: (name, branchName, branchCity, displayDate, address) => {
    const shortAddr = address ? address.split(',').slice(0, 3).join(', ') : '';
    return (
      `Perfect ${name} ji! Aapki service book ho gayi. ` +
      `Date hai ${displayDate}, aur branch hai hamara ${branchName} center, ${branchCity} mein` +
      (shortAddr ? ` — ${shortAddr}.` : '.') +
      ` Hamare engineer us din subah aapse contact karenge. ` +
      `Koi bhi help chahiye to hume call kar sakte hain. Dhanyawad, take care!`
    );
  },

  /* ── Reason ask ── */
  askReason: (name) =>
    `Koi baat nahi ${name} ji, main samajh sakta hun. ` +
    `Kya aap bata sakte hain ki abhi kyun nahi ho sakti? ` +
    `Shayad hum koi solution nikal sakein.`,

  /* ── Already done details ── */
  askAlreadyDoneDetails: (name) =>
    `Achha ${name} ji! Yeh toh bahut acha hai. ` +
    `Kya aap bata sakte hain — kab karwai thi, kahan se, aur kaunsi service thi? ` +
    `Record update kar dete hain.`,

  alreadyDoneSaved: (name) =>
    `Shukriya ${name} ji, information de ne ke liye. ` +
    `Aapka record update kar diya hai. ` +
    `Agli service ke time pe hum pehle se contact kar lenge. ` +
    `Take care, Namaste!`,

  /* ── Objection responses ── */
  objectionDriverNotAvailable: (name) =>
    `Samajh gaya ${name} ji. Koi tension nahi — aap koi bhi aane wale din bata dijiye ` +
    `jab driver available hoga. Regular service se machine breakdown nahi hoti, ` +
    `isme aapka hi fayda hai. Kaunsa din theek rahega?`,

  objectionMachineBusy: (name) =>
    `Bilkul samajh aaya ${name} ji, machine site pe hai toh seedha rok nahi sakte. ` +
    `Aap koi aisi date batao jab thodi der ke liye machine available ho jaye — ` +
    `service mein zyada time nahi lagta. Kaunsa din sochte hain?`,

  objectionWorkingFine: (name) =>
    `Yeh sunta hain bahut acha laga ${name} ji ki machine sahi chal rahi hai. ` +
    `Lekin 500 hour service time pe karana zaroori hai — ` +
    `isse machine ki life badhti hai aur badi repair se bachte hain. ` +
    `Kab schedule karein aapke liye?`,

  objectionMoneyIssue: (name) =>
    `Arre ${name} ji, aap fikar mat karein — ` +
    `hum agle mahine ki date fix kar dete hain, abhi kuch payment nahi hoga. ` +
    `Sirf date confirm karo, baaki hum sambhal lenge. Kaunsa time theek rahega?`,

  objectionCallLater: (name) =>
    `No problem ${name} ji! Aap busy hain toh main disturb nahi karta. ` +
    `Bas ek kaam karo — koi ek din bata do, main us din ke liye service mark kar deta hun. ` +
    `Sirf date chahiye.`,

  /* ── Persuasion ── */
  persuasionFinal: (name) =>
    `${name} ji, main samajhta hun aap busy hain. ` +
    `Par 500 hour service skip karna machine ke liye thik nahi — ` +
    `baad mein badi repair mein zyada paisa lagta hai. ` +
    `Ek baar soch ke batao — kaunsa din suitable hai?`,

  /* ── Final rejection ── */
  rejected: (name) =>
    `Theek hai ${name} ji, koi baat nahi. ` +
    `Jab bhi zaroorat ho, JSB Motors mein call kar lena, hum ready hain. ` +
    `Dhanyawad, take care. Namaste!`,

  /* ── Too many unknowns / turn limit ── */
  noResponseEnd: (name) =>
    `${name} ji, lagta hai abhi baat nahi ho payi. ` +
    `Koi baat nahi, hum thodi der baad dobara try karenge. ` +
    `Dhanyawad, Namaste!`,

  /* ── Silence fallback prompts (state-specific) ── */
  silenceFallback: {
    awaiting_initial_decision: (name) =>
      `${name} ji, kya aap sun pa rahe hain? Kya main service book kar sakta hun? Haan ya nahi boliye.`,
    awaiting_reason: (name) =>
      `${name} ji, haan? Koi baat ho to batao, main yahan hun.`,
    awaiting_reason_persisted: (name) =>
      `${name} ji, koi ek din bata do — hum arrange kar lenge.`,
    awaiting_date: (name) =>
      `${name} ji, kaunsa din acha lagega? Kal, somwar, ya koi tarikh?`,
    awaiting_date_confirm: (name) =>
      `${name} ji, theek hai? Haan ya nahi boliye.`,
    awaiting_branch: (name) =>
      `${name} ji, machine kaun si city mein hai? City ka naam boliye.`,
    awaiting_service_details: (name) =>
      `${name} ji, kab aur kahan service karwai thi?`,
  },

  /* ── Repeat ── */
  repeat: (name, lastMsg) =>
    `${name} ji, main dobara bolta hun — ${lastMsg}`,
  repeatFallback: (name) =>
    `${name} ji, main JSB Motors se service booking ke liye call kar raha hun.`,

  /* ── Confusion ── */
  confusionClarify: (name) =>
    `${name} ji, actually main JSB Motors Service Center se Rajesh bol raha hun. ` +
    `Aapki machine ki 500 Hour Service due ho gayi hai — ` +
    `isliye call kiya tha. Kya main service book kar sakta hun?`,

  /* ── Low confidence ── */
  lowConfidence: (name) =>
    `${name} ji, maafi chahta hun — aawaz thodi clear nahi aayi. ` +
    `Kya aap thoda zyada aawaaz mein bol sakte hain?`,

  /* ── Unclear ── */
  politeAskAgain: (name) =>
    `${name} ji, samajh nahi aaya — kya aap please haan ya nahi mein batayenge?`,

  /* ── Errors ── */
  technicalError: (name) =>
    `${name} ji, ek choti si technical samasya aa gayi. ` +
    `Hum aapse thodi der mein dobara contact karenge. Dhanyawad, Namaste!`,

  noCallData: () =>
    `Namaste ji! Abhi service data load nahi ho paya. Kripya thodi der baad call karein. Shukriya!`,
  noSession: () =>
    `Namaste ji! Session expire ho gaya. Kripya dobara call karein. Shukriya!`,
  missingCallSid: () =>
    `Ek technical problem aayi. Kripya baad mein sampark karein.`,
};

/* =====================================================================
   handleInitialCall
   ===================================================================== */
async function handleInitialCall(req, res) {
  const twiml   = new twilio.twiml.VoiceResponse();
  const callSid = req.body?.CallSid;

  if (!callSid) {
    return errorResponse(res, 'greeting', 'Missing CallSid', V.missingCallSid());
  }

  const callData = callDataStore.get(callSid);
  if (!callData) {
    return errorResponse(res, 'greeting', `No callData for ${callSid}`, V.noCallData());
  }

  const session = createSession(callData, callSid);
  const { customerName, machineModel, machineNumber, serviceType } = session;

  const greeting = V.greeting(customerName, machineModel, machineNumber, serviceType);

  session.lastMessage = greeting;
  sessionStore.set(callSid, session);

  log.info('greeting', `→ ${customerName}`, { callSid, machineModel, machineNumber });

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
    return errorResponse(res, 'input', 'Missing CallSid', V.missingCallSid());
  }

  let session = sessionStore.get(callSid);
  if (!session) {
    return errorResponse(res, 'input', `No session for ${callSid}`, V.noSession());
  }

  session.totalTurns += 1;
  const name = session.customerName;

  log.info('input', `Turn ${session.totalTurns} | state: ${session.state}`, {
    callSid,
    speech:     rawSpeech.substring(0, 80),
    confidence: confidence.toFixed(2),
  });

  /* ── Turn cap ──────────────────────────────────────────────────────── */
  if (session.totalTurns > CFG.MAX_TOTAL_TURNS) {
    const msg = V.noResponseEnd(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence: null, intent: 'max_turns', systemReply: msg });
    await endSession(callSid, 'max_turns', 'no_response');
    buildVoiceResponse({ twiml, message: msg, actionUrl: action, hangup: true });
    return sendTwiML(res, twiml);
  }

  /* ── Silence ───────────────────────────────────────────────────────── */
  if (!rawSpeech) {
    session.silenceRetries += 1;
    log.warn('input', `Silence #${session.silenceRetries}`, { callSid });

    if (session.silenceRetries >= CFG.MAX_SILENCE_RETRIES) {
      const farewell = V.noResponseEnd(name);
      appendTurn(session, { customerSaid: '', confidence: null, intent: 'silence', systemReply: farewell });
      sessionStore.set(callSid, session);
      await endSession(callSid, 'max_silence', 'no_response');
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
    } else {
      const fallbackFn = V.silenceFallback[session.state] || (() => V.politeAskAgain(name));
      const fallback   = fallbackFn(name);
      appendTurn(session, { customerSaid: '', confidence: null, intent: 'silence', systemReply: fallback });
      session.lastMessage = fallback;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: fallback, actionUrl: action });
    }
    return sendTwiML(res, twiml);
  }

  session.silenceRetries = 0;
  session.lowConfRetries = 0; // voice detected — reset low-conf streak

  /* ── Low confidence ────────────────────────────────────────────────── */
  if (confidence < CFG.CONFIDENCE_THRESHOLD) {
    session.lowConfRetries = (session.lowConfRetries || 0) + 1;
    log.warn('input', `Low confidence (${confidence.toFixed(2)}) retry #${session.lowConfRetries}`, { callSid });

    // After 2 consecutive low-conf turns, Twilio Hindi STT is struggling.
    // Process the speech anyway rather than wasting more turns asking louder.
    // Twilio often returns 0.00 for clear Hindi speech — don't discard it.
    if (session.lowConfRetries >= 2 && rawSpeech.length > 1) {
      log.info('input', `Forcing NLP on low-conf speech after ${session.lowConfRetries} retries`, { callSid });
      // Fall through to NLP — do NOT return here
    } else {
      const repeatMsg = V.lowConfidence(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: 'low_confidence', systemReply: repeatMsg });
      session.lastMessage = repeatMsg;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: repeatMsg, actionUrl: action });
      return sendTwiML(res, twiml);
    }
  } else {
    session.lowConfRetries = 0; // reset on good confidence
  }

  /* ── NLP ───────────────────────────────────────────────────────────── */
  let nlpResult;
  try {
    nlpResult = processUserInput(rawSpeech, {
      ...session,
      retries:       session.silenceRetries,
      unknownStreak: session.unknownStreak,
    });
  } catch (err) {
    log.error('input', `NLP error: ${err.message}`, { callSid });
    const errMsg = V.technicalError(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: 'nlp_error', systemReply: errMsg });
    sessionStore.set(callSid, session);
    await endSession(callSid, 'nlp_error', 'no_response');
    buildVoiceResponse({ twiml, message: errMsg, actionUrl: action, hangup: true });
    return sendTwiML(res, twiml);
  }

  // FIX v5: intent from nlpResult may be undefined if NLP returns partial object — guard it
  const {
    replyText,
    nextState,
    endCall,
    preferredDate,
    resolvedDate,
    extractedBranch,
    intent = 'unknown',
  } = nlpResult;

  /* ── REPEAT ────────────────────────────────────────────────────────── */
  if (intent === INTENT.REPEAT) {
    const replay = session.lastMessage
      ? V.repeat(name, session.lastMessage)
      : V.repeatFallback(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: replay });
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: replay, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* ── UNCLEAR / CONFUSION ───────────────────────────────────────────── */
  if (intent === INTENT.UNCLEAR || intent === INTENT.CONFUSION) {
    const clarify = replyText || V.confusionClarify(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: clarify });
    session.lastMessage = clarify;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: clarify, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* ── Capture rejection reason ──────────────────────────────────────── */
  if (session.state === 'awaiting_reason' && rawSpeech) {
    session.rejectionReason = rawSpeech;
  }

  /* ── Capture already-done details ─────────────────────────────────── */
  if (session.state === 'awaiting_service_details' && rawSpeech) {
    session.alreadyDoneDetails = rawSpeech;
  }

  /* ── Persist date ──────────────────────────────────────────────────── */
  if (preferredDate) session.preferredDate = preferredDate;
  if (resolvedDate)  session.resolvedDate  = resolvedDate;

  /* ── Persist branch ────────────────────────────────────────────────── */
  if (extractedBranch) {
    session.assignedBranchName = extractedBranch.name;
    session.assignedBranchCode = extractedBranch.code;
    session.assignedBranchCity = extractedBranch.city;
    session.assignedBranchAddr = extractedBranch.address || null;
    log.info('branch', `Matched → ${extractedBranch.name} (code: ${extractedBranch.code})`, { callSid });
  }

  /* ── Persuasion counter ────────────────────────────────────────────── */
  if (session.state === 'awaiting_reason' && nextState === 'awaiting_reason_persisted') {
    session.persuasionCount = (session.persuasionCount || 0) + 1;
  }

  /* ── Unknown streak — scoped only to states where it makes sense ─── */
  // FIX v5: awaiting_branch stuck should NOT count toward a 'confirmed' outcome.
  // The streak correctly ends the call as 'no_response' via resolveOutcome fix.
  const stateStuck =
    nextState === session.state &&
    ['awaiting_initial_decision', 'awaiting_reason', 'awaiting_branch'].includes(nextState);
  session.unknownStreak = stateStuck ? session.unknownStreak + 1 : 0;

  /* ── Override NLP reply text for key states with human voice lines ── */
  let finalReplyText = replyText;

  // Date confirm state: always use our human-phrased version with full date
  if (nextState === 'awaiting_date_confirm' && (preferredDate || session.preferredDate)) {
    const dateTok  = preferredDate || session.preferredDate;
    const display  = resolvedDate?.display || dateTok;
    finalReplyText = V.confirmDate(name, display);
  }

  // Branch confirm: use human confirmation with address
  if (nextState === 'ended' && session.state === 'awaiting_branch' && session.assignedBranchName) {
    const display = session.resolvedDate?.display || session.preferredDate || 'nirdharit tarikh';
    finalReplyText = V.confirmBooking(
      name,
      session.assignedBranchName,
      session.assignedBranchCity,
      display,
      session.assignedBranchAddr
    );
  }

  /* ── Log turn ──────────────────────────────────────────────────────── */
  appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: finalReplyText });

  /* ── Update session ────────────────────────────────────────────────── */
  session.lastMessage = finalReplyText;
  session.state       = nextState;
  sessionStore.set(callSid, session);

  log.info('input', `→ ${nextState} | intent: ${intent}`, {
    callSid,
    resolvedDate: resolvedDate?.display || session.resolvedDate?.display || 'N/A',
    iso:          resolvedDate?.iso     || session.resolvedDate?.iso     || 'N/A',
    branch:       extractedBranch?.code || session.assignedBranchCode   || 'N/A',
  });

  /* ── End or continue ───────────────────────────────────────────────── */
  if (endCall || nextState === 'ended') {
    const outcome = resolveOutcome(nextState, intent, session);
    await endSession(callSid, `end_${nextState}`, outcome);
    buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action, hangup: true });
  } else {
    buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action });
  }

  return sendTwiML(res, twiml);
}

/* =====================================================================
   EXPORTS
   ===================================================================== */
export default { handleInitialCall, handleUserInput };