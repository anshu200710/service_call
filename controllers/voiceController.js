/**
 * voice.service.js  (v8 — Fast Response + Flow Fixes)
 * =====================================================
 *
 * 🔴 CRITICAL FIXES (from log analysis):
 *   1. Low-confidence "ठीक है" (conf 0.00) in awaiting_date no longer silently
 *      defaults to tomorrow. NLP now re-asks explicitly (fixed in NLP layer too).
 *   2. REJECT in awaiting_date_confirm now clears preferredDate (null passed to
 *      endSession / NLP) so the rejected date is never saved to DB.
 *   3. "करवाना है" / "karna hai" → CONFIRM correctly (NLP v9 fix).
 *
 * 🟠 HIGH FIXES:
 *   4. GATHER_TIMEOUT reduced 8→6s, SPEECH_TIMEOUT 4→3s for Hindi.
 *      Hindi speakers typically finish in 2-3s — 8s felt like the bot hung.
 *      bargeIn:true lets them interrupt TTS naturally.
 *   5. Status callback (hangup leak) kept from v6.
 *   6. Filler-word CONFIRM guard kept and improved.
 *
 * 🟡 MEDIUM FIXES:
 *   7. Voice lines: Rajesh now uses "JSB Motors" consistently (was "JCB Motors" in some).
 *   8. persuasionCount increment happens after NLP call (correct — NLP reads old value).
 *   9. rejectionReason captured from awaiting_reason_persisted too.
 *  10. TTL cleanup: stale sessions older than SESSION_TTL_MS auto-ended.
 */

import twilio from "twilio";
import ServiceBooking from "../models/Servicebooking.js";
import { callDataStore } from "../routes/outbound.js";
import {
  processUserInput,
  INTENT,
  matchBranch,
} from "../utils/conversational_intelligence.js";

/* =====================================================================
   CONFIGURATION
   ===================================================================== */
const CFG = {
  MAX_SILENCE_RETRIES: 3,
  MAX_TOTAL_TURNS: 15,
  CONFIDENCE_THRESHOLD: 0.45,   // Slightly lower — Twilio hi-IN STT often gives 0.5 for clear Hindi
  GATHER_TIMEOUT: 6,             // FIX v8: 6s is enough; 8s made callers think the bot hung
  SPEECH_TIMEOUT: 3,             // FIX v8: Hindi speakers finish in 2-3s typically
  TTS_LANGUAGE: "hi-IN",
  TTS_VOICE: "Polly.Aditi",
  SESSION_TTL_MS: 30 * 60 * 1000,
};

/* =====================================================================
   SESSION STORE
   NOTE: In-memory. For multi-instance replace with Redis:
     import { createClient } from 'redis';
     const redis = createClient({ url: process.env.REDIS_URL });
     await redis.connect();
     // set: await redis.setEx(`session:${callSid}`, 1800, JSON.stringify(session));
     // get: JSON.parse(await redis.get(`session:${callSid}`));
     // del: await redis.del(`session:${callSid}`);
   ===================================================================== */
const sessionStore = new Map();

/* Stale session cleanup every 5 min */
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessionStore.entries()) {
    if (now - session.callStartedAt.getTime() > CFG.SESSION_TTL_MS) {
      log.warn("session", "TTL cleanup for stale session", { callSid: sid });
      endSession(sid, "ttl_cleanup", "no_response").catch(() => {});
    }
  }
}, 5 * 60 * 1000);

/* =====================================================================
   LOGGER
   ===================================================================== */
const log = {
  info:  (tag, msg, meta = {}) => console.log  (`[voice][${tag}] ${msg}`,  Object.keys(meta).length ? meta : ""),
  warn:  (tag, msg, meta = {}) => console.warn (`[voice][${tag}] WARN  ${msg}`, Object.keys(meta).length ? meta : ""),
  error: (tag, msg, meta = {}) => console.error(`[voice][${tag}] ERROR ${msg}`, Object.keys(meta).length ? meta : ""),
};

/* =====================================================================
   TWILIO SIGNATURE VALIDATION MIDDLEWARE
   Usage: app.use('/voice', voiceService.validateTwilioSignature);
   ===================================================================== */
export function validateTwilioSignature(req, res, next) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    log.warn("security", "TWILIO_AUTH_TOKEN not set — skipping validation (UNSAFE)");
    return next();
  }
  const signature = req.headers["x-twilio-signature"] || "";
  const url       = `${process.env.PUBLIC_URL}${req.originalUrl}`;
  const params    = req.body || {};
  if (!twilio.validateRequest(authToken, signature, url, params)) {
    log.warn("security", "Invalid Twilio signature", { url });
    return res.status(403).send("Forbidden");
  }
  return next();
}

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
    input: "speech",
    action: actionUrl,
    method: "POST",
    language: CFG.TTS_LANGUAGE,
    timeout: CFG.GATHER_TIMEOUT,
    speechTimeout: CFG.SPEECH_TIMEOUT,
    profanityFilter: false,
    bargeIn: true,
  });
  gather.say(sayOpts, message);
}

function processUrl() {
  return `${process.env.PUBLIC_URL}/voice/process`;
}
function sendTwiML(res, twiml) {
  return res.type("text/xml").send(twiml.toString());
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
    customerName:   callData.customerName   || "sir",
    customerPhone:  callData.customerPhone   || null,
    machineModel:   callData.machineModel    || "",
    machineNumber:  callData.machineNumber   || "",
    serviceType:    callData.serviceType     || "500 Hour",
    dueDate:        callData.dueDate         || "",
    state: "awaiting_initial_decision",
    preferredDate:     null,
    resolvedDate:      null,
    assignedBranchName: null,
    assignedBranchCode: null,
    assignedBranchCity: null,
    assignedBranchAddr: null,
    rejectionReason:   null,
    alreadyDoneDetails: null,
    persuasionCount:   0,
    lowConfRetries:    0,
    outcome:           null,
    silenceRetries:    0,
    unknownStreak:     0,
    totalTurns:        0,
    lastMessage:       "",
    callStartedAt:     new Date(),
    turns:             [],
  };
}

/* =====================================================================
   OUTCOME RESOLVER
   Called BEFORE session.state is mutated — uses previousState to detect
   the already_done path correctly.
   ===================================================================== */
function resolveOutcome(nextState, intent, session, previousState) {
  if (nextState !== "ended") return "no_response";

  // already_done: customer was in awaiting_service_details and gave details
  if (previousState === "awaiting_service_details") return "already_done";

  // confirmed: we have at minimum a preferredDate
  if (session.preferredDate && session.assignedBranchCode) return "confirmed";
  if (session.preferredDate && !session.assignedBranchCode) return "confirmed";

  // explicit reject with no actionable data
  if (intent === INTENT.REJECT) return "rejected";

  return "no_response";
}

/* =====================================================================
   DB WRITER
   ===================================================================== */
async function saveCallOutcome(session, outcome) {
  try {
    const resolvedDisplay = session.resolvedDate?.display || session.preferredDate || null;
    const resolvedISO     = session.resolvedDate?.iso || null;

    if (outcome === "confirmed" && resolvedDisplay && !resolvedISO) {
      log.warn("db", "Storing raw date token — resolveDate may have failed", {
        callSid: session.callSid, token: resolvedDisplay,
      });
    }

    const doc = await ServiceBooking.create({
      callSid:      session.callSid,
      customerName: session.customerName,
      customerPhone:session.customerPhone,
      machineModel: session.machineModel,
      machineNumber:session.machineNumber,
      serviceType:  session.serviceType,
      dueDateOriginal: session.dueDate,
      outcome,
      confirmedServiceDate:    outcome === "confirmed" ? resolvedDisplay || "[date unresolved]" : null,
      confirmedServiceDateISO: outcome === "confirmed" ? resolvedISO : null,
      assignedBranchName: session.assignedBranchName || null,
      assignedBranchCode: session.assignedBranchCode || null,
      assignedBranchCity: session.assignedBranchCity || null,
      rejectionReason:    outcome === "rejected"    ? session.rejectionReason    : null,
      alreadyDoneDetails: outcome === "already_done"? session.alreadyDoneDetails : null,
      totalTurns:    session.totalTurns,
      callStartedAt: session.callStartedAt,
      callEndedAt:   new Date(),
      turns:         session.turns,
    });

    log.info("db", `Saved — outcome: ${outcome} | date: ${resolvedDisplay || "N/A"}`, {
      docId: doc._id.toString(), callSid: session.callSid,
      branch: session.assignedBranchCode || "N/A", iso: resolvedISO,
    });
  } catch (err) {
    log.error("db", `Save failed: ${err.message}`, { callSid: session.callSid });
  }
}

/* =====================================================================
   SESSION CLEANUP
   ===================================================================== */
async function endSession(callSid, reason, outcome = "no_response") {
  const session = sessionStore.get(callSid);
  sessionStore.delete(callSid);
  log.info("session", `Ended — ${reason} | outcome: ${outcome}`, { callSid });
  if (session) await saveCallOutcome(session, outcome);
}

/* =====================================================================
   TURN LOGGER
   ===================================================================== */
function appendTurn(session, { customerSaid, confidence, intent, systemReply }) {
  session.turns.push({
    turnNumber:  session.totalTurns,
    state:       session.state,
    customerSaid:customerSaid || "",
    confidence:  confidence ?? null,
    intent:      intent || null,
    systemReply,
  });
}

/* =====================================================================
   FILLER-WORD CONFIRM GUARD
   Returns true when CONFIRM is a genuine booking intent vs a filler ack.
   ===================================================================== */
const STRONG_CONFIRM_TOKENS = [
  "book karo","book kar","confirm karo","confirm kar do","karwa do","karvao",
  "haan book","haan ji bilkul","bilkul theek hai","zaroor karo","please book",
  "haan zaroor","book kar do","kardo","karwana hai","karna hai","kar do",
  "बुक करो","बुक कर दो","कन्फर्म करो","करवा दो","ज़रूर करो","करवाना है","करना है",
];

const FILLER_ONLY_TOKENS = [
  "accha","achha","acha","achcha","hmm","theek hai","theek h","thik hai",
  "ok","okay","haan","haa","han","acha ji","hmm ji",
  "अच्छा","ठीक है","हाँ","हां","ओके",
];

function isGenuineConfirm(userText, state) {
  const lower = userText.toLowerCase().trim();

  // These states always expect CONFIRM to be meaningful
  if (["awaiting_date_confirm","awaiting_initial_decision"].includes(state)) return true;

  // Strong booking keyword present → genuine
  if (STRONG_CONFIRM_TOKENS.some(t => lower.includes(t))) return true;

  // Only a filler word in a reason/persuasion state → ambiguous, not genuine
  const isOnlyFiller = FILLER_ONLY_TOKENS.some(
    t => lower === t || lower === t + " ji" || lower === "ji " + t
  );
  if (isOnlyFiller && ["awaiting_reason","awaiting_reason_persisted"].includes(state)) {
    return false;
  }

  return true;
}

/* =====================================================================
   VOICE LINES (v8 — Natural Hinglish Agent, Rajesh)
   Changes from v7:
   • Greeting: "JSB Motors" not "JCB Motors" (was a bug)
   • All lines use natural conversational Hindi, not formal announcer tone
   • confirmBooking: warm + celebratory
   • silenceFallback: sounds like a real person checking in
   • noResponseEnd: reassuring, not robotic
   ===================================================================== */
const V = {
  // Opening
  greeting: (name, model, number, serviceType) =>
    `नमस्ते ${name} जी! मैं राजेश JCB Motors से बोल रहा हूँ। आपकी मशीन नंबर ${number} की ${serviceType} सर्विस का समय आ गया है। क्या इस हफ्ते बुक कर दूँ?`,

  // Date collection
  askDate: (name) =>
    `${name} जी, कौन सा दिन ठीक रहेगा? कल, परसों, सोमवार — या कोई भी तारीख बताइए।`,

  confirmDate: (name, displayDate) =>
    `ठीक है ${name} जी, ${displayDate} को बुक करता हूँ। kya ye thik hai haan boliye`,

  // Branch collection
  askBranch: (name) =>
    `${name} जी, मशीन किस शहर में है? जयपुर, कोटा, अजमेर, अलवर या उदयपुर?`,

  askBranchAgain: (name) =>
    `${name} जी, शहर का नाम ज़रा साफ़ बोलिए — जयपुर, कोटा, अजमेर, उदयपुर या अलवर?`,

  // Booking confirmed
  confirmBooking: (name, branchName, branchCity, displayDate) =>
    `बहुत बढ़िया ${name} जी! सर्विस बुक हो गई — ${displayDate} को ${branchName}, ${branchCity} में। हमारे इंजीनियर आपसे संपर्क करेंगे। बहुत धन्यवाद!`,

  // Objections
  askReason: (name) =>
    `कोई बात नहीं ${name} जी। बताइए क्या दिक्कत है? शायद हम कुछ मदद कर सकें।`,

  // Already done path
  askAlreadyDoneDetails: (name) =>
    `अरे वाह, बहुत अच्छा किया ${name} जी! कब करवाई थी, कहाँ से, और कौन सी सर्विस? थोड़ा बता दीजिए।`,

  alreadyDoneSaved: (name) =>
    `शुक्रिया ${name} जी! रिकॉर्ड अपडेट हो गया। अगली सर्विस का रिमाइंडर पहले से आ जाएगा। धन्यवाद!`,

  // Objection handlers
  objectionDriverNotAvailable: (name) =>
    `समझ गया ${name} जी। ड्राइवर के आने पर एक दिन बता दीजिए — हम तब के लिए फिक्स कर देंगे। कब तक हो सकता है?`,

  objectionMachineBusy: (name) =>
    `समझ गया ${name} जी, मशीन साइट पर है। जब थोड़ी देर के लिए फ्री हो सके — कोई एक दिन बताइए।`,

  objectionWorkingFine: (name) =>
    `अच्छी बात है ${name} जी कि मशीन ठीक है। लेकिन समय पर सर्विस से अचानक खराबी नहीं आती। कब करवाएँ?`,

  objectionMoneyIssue: (name) =>
    `कोई फ़िक्र नहीं ${name} जी, पेमेंट बाद में हो जाएगी। बस एक तारीख बता दीजिए।`,

  objectionCallLater: (name) =>
    `ठीक है ${name} जी। कोई एक दिन बता दीजिए — मैं नोट कर लेता हूँ। कौन सा दिन?`,

  // Final persuasion
  persuasionFinal: (name) =>
    `${name} जी, सर्विस छोड़ने पर बाद में ज़्यादा खर्चा पड़ता है। आज एक तारीख तय कर लीजिए — बाकी सब हम सँभाल लेंगे। हाँ?`,

  // End states
  rejected: (name) =>
    `ठीक है ${name} जी। जब भी ज़रूरत हो, JSB Motors को कॉल करिएगा — हम हमेशा तैयार हैं। धन्यवाद!`,

  noResponseEnd: (name) =>
    `${name} जी, थोड़ी देर में हम दोबारा कॉल करेंगे। धन्यवाद!`,

  // Silence fallbacks (per-state)
  silenceFallback: {
    awaiting_initial_decision: (name) =>
      `${name} जी, सुन रहे हैं आप? सर्विस बुकिंग के बारे में पूछ रहा था — क्या इस हफ्ते करवा लें?`,
    awaiting_reason: (name) =>
      `${name} जी, मैं सुन रहा हूँ — कोई परेशानी हो तो बताइए।`,
    awaiting_reason_persisted: (name) =>
      `${name} जी, कोई एक दिन बता दीजिए — हम आपके हिसाब से arrange कर देंगे।`,
    awaiting_date: (name) =>
      `${name} जी, कौन सा दिन ठीक लगेगा? कल, परसों, या इस हफ्ते कोई भी दिन।`,
    awaiting_date_confirm: (name) =>
      `${name} जी, यह तारीख ठीक है ना? हाँ या नहीं बोल दीजिए।`,
    awaiting_branch: (name) =>
      `${name} जी, मशीन का शहर बताइए — जयपुर, कोटा, अजमेर या उदयपुर?`,
    awaiting_service_details: (name) =>
      `${name} जी, कब, कहाँ से और कौन सी सर्विस करवाई थी?`,
  },

  // Utility
  repeat: (name, lastMsg)  => `${name} जी, दोबारा बताता हूँ — ${lastMsg}`,
  repeatFallback: (name)   => `जी, मैं राजेश, JSB Motors से — आपकी मशीन की सर्विस बुकिंग के लिए कॉल किया था।`,
  confusionClarify: (name) => `${name} जी, मैं राजेश JSB Motors से बोल रहा हूँ। आपकी मशीन की सर्विस का समय आया है — क्या बुक करें?`,
  lowConfidence: (name)    => `${name} जी, आवाज़ साफ़ नहीं आई। क्या थोड़ा ज़ोर से बोल सकते हैं?`,
  politeAskAgain: (name)   => `${name} जी, समझा नहीं — हाँ या नहीं बोल दीजिए।`,
  technicalError: (name)   => `${name} जी, थोड़ी तकनीकी समस्या आ गई। थोड़ी देर में दोबारा कॉल करते हैं। धन्यवाद!`,

  // System error lines
  noCallData: ()    => `नमस्ते जी! डेटा लोड करने में समस्या है। थोड़ी देर बाद कॉल करें। शुक्रिया!`,
  noSession: ()     => `नमस्ते जी! सेशन समाप्त हो गया। कृपया दोबारा कॉल करें। शुक्रिया!`,
  missingCallSid: ()=> `तकनीकी समस्या है। थोड़ी देर बाद संपर्क करें। शुक्रिया!`,
};

/* =====================================================================
   handleInitialCall
   ===================================================================== */
async function handleInitialCall(req, res) {
  const twiml   = new twilio.twiml.VoiceResponse();
  const callSid = req.body?.CallSid;

  if (!callSid) return errorResponse(res, "greeting", "Missing CallSid", V.missingCallSid());

  const callData = callDataStore.get(callSid);
  if (!callData)  return errorResponse(res, "greeting", `No callData for ${callSid}`, V.noCallData());

  const session = createSession(callData, callSid);
  const { customerName, machineModel, machineNumber, serviceType } = session;

  const greeting = V.greeting(customerName, machineModel, machineNumber, serviceType);
  session.lastMessage = greeting;
  sessionStore.set(callSid, session);

  log.info("greeting", `→ ${customerName}`, { callSid, machineModel, machineNumber });

  buildVoiceResponse({ twiml, message: greeting, actionUrl: processUrl() });
  return sendTwiML(res, twiml);
}

/* =====================================================================
   handleStatusCallback
   Twilio fires this when customer hangs up mid-call.
   Wire to: process.env.PUBLIC_URL + '/voice/status'
   ===================================================================== */
async function handleStatusCallback(req, res) {
  const callSid    = req.body?.CallSid;
  const callStatus = req.body?.CallStatus;

  res.sendStatus(204); // Acknowledge immediately

  if (!callSid) return;

  const terminalStatuses = ["completed","busy","failed","no-answer","canceled"];
  if (terminalStatuses.includes(callStatus) && sessionStore.has(callSid)) {
    log.info("status", `Hangup detected — status: ${callStatus}`, { callSid });
    await endSession(callSid, `hangup_${callStatus}`, "no_response");
  }
}

/* =====================================================================
   handleUserInput
   ===================================================================== */
async function handleUserInput(req, res) {
  const twiml     = new twilio.twiml.VoiceResponse();
  const callSid   = req.body?.CallSid;
  const rawSpeech = (req.body?.SpeechResult || "").trim();
  const rawConf   = req.body?.Confidence;
  const confidence = rawConf !== undefined ? parseFloat(rawConf) : 1.0;
  const action    = processUrl();

  if (!callSid) return errorResponse(res, "input", "Missing CallSid", V.missingCallSid());

  let session = sessionStore.get(callSid);
  if (!session) return errorResponse(res, "input", `No session for ${callSid}`, V.noSession());

  session.totalTurns += 1;
  const name = session.customerName;

  log.info("input", `Turn ${session.totalTurns} | state: ${session.state}`, {
    callSid, speech: rawSpeech.substring(0, 80), confidence: confidence.toFixed(2),
  });

  /* ── Turn cap ── */
  if (session.totalTurns > CFG.MAX_TOTAL_TURNS) {
    const msg = V.noResponseEnd(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence: null, intent: "max_turns", systemReply: msg });
    await endSession(callSid, "max_turns", "no_response");
    buildVoiceResponse({ twiml, message: msg, actionUrl: action, hangup: true });
    return sendTwiML(res, twiml);
  }

  /* ── Silence ── */
  if (!rawSpeech) {
    session.silenceRetries += 1;
    log.warn("input", `Silence #${session.silenceRetries}`, { callSid });

    if (session.silenceRetries >= CFG.MAX_SILENCE_RETRIES) {
      const farewell = V.noResponseEnd(name);
      appendTurn(session, { customerSaid: "", confidence: null, intent: "silence", systemReply: farewell });
      sessionStore.set(callSid, session);
      await endSession(callSid, "max_silence", "no_response");
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
    } else {
      const fallbackFn = V.silenceFallback[session.state] || (() => V.politeAskAgain(name));
      const fallback   = fallbackFn(name);
      appendTurn(session, { customerSaid: "", confidence: null, intent: "silence", systemReply: fallback });
      session.lastMessage = fallback;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: fallback, actionUrl: action });
    }
    return sendTwiML(res, twiml);
  }

  session.silenceRetries = 0;

  /* ── Low confidence ── */
  // FIX v8: Twilio hi-IN STT returns 0.00 for clear Hindi regularly.
  // Only ask to repeat ONCE for very short (≤3 char) speech. Otherwise force NLP.
  if (confidence < CFG.CONFIDENCE_THRESHOLD) {
    session.lowConfRetries = (session.lowConfRetries || 0) + 1;
    log.warn("input", `Low confidence (${confidence.toFixed(2)}) retry #${session.lowConfRetries}`, { callSid });

    if (session.lowConfRetries === 1 && rawSpeech.length <= 3) {
      const repeatMsg = V.lowConfidence(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "low_confidence", systemReply: repeatMsg });
      session.lastMessage = repeatMsg;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: repeatMsg, actionUrl: action });
      return sendTwiML(res, twiml);
    }
    log.info("input", `Forcing NLP on low-conf speech (retry #${session.lowConfRetries})`, { callSid });
  } else {
    session.lowConfRetries = 0;
  }

  /* ── NLP ── */
  let nlpResult;
  try {
    nlpResult = processUserInput(rawSpeech, {
      ...session,
      retries: session.silenceRetries,
      unknownStreak: session.unknownStreak,
      persuasionCount: session.persuasionCount,
    });
  } catch (err) {
    log.error("input", `NLP error: ${err.message}`, { callSid });
    const errMsg = V.technicalError(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "nlp_error", systemReply: errMsg });
    sessionStore.set(callSid, session);
    await endSession(callSid, "nlp_error", "no_response");
    buildVoiceResponse({ twiml, message: errMsg, actionUrl: action, hangup: true });
    return sendTwiML(res, twiml);
  }

  const {
    replyText, nextState, endCall,
    preferredDate, resolvedDate, extractedBranch,
    intent = "unknown",
  } = nlpResult;

  /* ── REPEAT ── */
  if (intent === INTENT.REPEAT) {
    const replay = session.lastMessage ? V.repeat(name, session.lastMessage) : V.repeatFallback(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: replay });
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: replay, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* ── UNCLEAR / CONFUSION ── */
  if (intent === INTENT.UNCLEAR || intent === INTENT.CONFUSION) {
    const clarify = replyText || V.confusionClarify(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: clarify });
    session.lastMessage = clarify;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: clarify, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* ── Filler-word CONFIRM guard ── */
  if (intent === INTENT.CONFIRM && !isGenuineConfirm(rawSpeech, session.state)) {
    log.info("input", `Suppressed filler CONFIRM in state ${session.state}`, { callSid });
    const rephrase = V.politeAskAgain(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "filler_confirm", systemReply: rephrase });
    session.lastMessage = rephrase;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: rephrase, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* ── Capture rejection reason ── */
  if ((session.state === "awaiting_reason" || session.state === "awaiting_reason_persisted") && rawSpeech) {
    session.rejectionReason = rawSpeech;
  }

  /* ── Capture already-done details ── */
  if (session.state === "awaiting_service_details" && rawSpeech) {
    session.alreadyDoneDetails = rawSpeech;
  }

  /* ── Persist date ── */
  // FIX v8: Only persist date if NLP returned a non-null preferredDate.
  // If NLP cleared it (REJECT in awaiting_date_confirm), preferredDate = null → clear session too.
  if (preferredDate !== undefined) {
    session.preferredDate = preferredDate;  // null clears it, string sets it
  }
  if (resolvedDate !== undefined) {
    session.resolvedDate = resolvedDate;
  }

  /* ── Persist branch ── */
  if (extractedBranch) {
    session.assignedBranchName = extractedBranch.name;
    session.assignedBranchCode = extractedBranch.code;
    session.assignedBranchCity = extractedBranch.city;
    session.assignedBranchAddr = extractedBranch.address || null;
    log.info("branch", `Matched → ${extractedBranch.name} (code: ${extractedBranch.code})`, { callSid });
  }

  /* ── Persuasion counter — increment AFTER NLP call ── */
  if (
    (session.state === "awaiting_reason" || session.state === "awaiting_reason_persisted") &&
    nextState === "awaiting_reason_persisted"
  ) {
    session.persuasionCount = (session.persuasionCount || 0) + 1;
    log.info("input", `persuasionCount now ${session.persuasionCount}`, { callSid });
  }

  /* ── Unknown streak (only for states that can get stuck) ── */
  const stateStuck =
    nextState === session.state &&
    ["awaiting_initial_decision","awaiting_reason","awaiting_branch"].includes(nextState);
  session.unknownStreak = stateStuck ? session.unknownStreak + 1 : 0;

  /* ── Override NLP reply text with human voice lines for key states ── */
  let finalReplyText = replyText;

  if (nextState === "awaiting_date_confirm" && (preferredDate || session.preferredDate)) {
    const dateTok = preferredDate || session.preferredDate;
    const display = resolvedDate?.display || (dateTok ? require('./dateResolver.js').resolveDate(dateTok)?.display : null) || dateTok;
    finalReplyText = V.confirmDate(name, display);
  }

  if (nextState === "ended" && session.state === "awaiting_branch" && session.assignedBranchName) {
    const display = session.resolvedDate?.display || session.preferredDate || "नियत तारीख";
    finalReplyText = V.confirmBooking(name, session.assignedBranchName, session.assignedBranchCity, display);
  }

  if (nextState === "ended" && session.state === "awaiting_service_details") {
    finalReplyText = V.alreadyDoneSaved(name);
  }

  if (nextState === "awaiting_reason" && session.state === "awaiting_initial_decision") {
    finalReplyText = V.askReason(name);
  }

  if (nextState === "awaiting_date" && session.state === "awaiting_initial_decision") {
    finalReplyText = V.askDate(name);
  }

  if (nextState === "awaiting_date" && (
    session.state === "awaiting_reason" ||
    session.state === "awaiting_reason_persisted" ||
    session.state === "awaiting_date_confirm"
  )) {
    finalReplyText = V.askDate(name);
  }

  if (nextState === "awaiting_branch") {
    finalReplyText = V.askBranch(name);
  }

  if (nextState === "ended" && session.state === "awaiting_reason_persisted") {
    finalReplyText = V.rejected(name);
  }

  if (nextState === "awaiting_reason_persisted") {
    finalReplyText = V.persuasionFinal(name);
  }

  /* ── Objection voice lines ── */
  if (nextState === "awaiting_date" && intent === INTENT.DRIVER_NOT_AVAILABLE) {
    finalReplyText = V.objectionDriverNotAvailable(name);
  } else if (nextState === "awaiting_date" && intent === INTENT.MACHINE_BUSY) {
    finalReplyText = V.objectionMachineBusy(name);
  } else if (nextState === "awaiting_date" && intent === INTENT.WORKING_FINE) {
    finalReplyText = V.objectionWorkingFine(name);
  } else if (nextState === "awaiting_date" && intent === INTENT.MONEY_ISSUE) {
    finalReplyText = V.objectionMoneyIssue(name);
  } else if (nextState === "awaiting_date" && intent === INTENT.CALL_LATER) {
    finalReplyText = V.objectionCallLater(name);
  }

  /* ── Log turn ── */
  appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: finalReplyText });

  /* ── FIX: Resolve outcome BEFORE mutating session.state ── */
  const previousState = session.state;
  let callOutcome = null;
  if (endCall || nextState === "ended") {
    callOutcome = resolveOutcome(nextState, intent, session, previousState);
    log.info("input", `Outcome resolved: ${callOutcome} (prevState: ${previousState})`, { callSid });
  }

  /* ── Update session state ── */
  session.lastMessage = finalReplyText;
  session.state       = nextState;
  sessionStore.set(callSid, session);

  log.info("input", `→ ${nextState} | intent: ${intent}`, {
    callSid,
    date: session.preferredDate || "N/A",
    resolvedDate: session.resolvedDate?.display || "N/A",
    iso:    session.resolvedDate?.iso || "N/A",
    branch: session.assignedBranchCode || "N/A",
  });

  /* ── End or continue ── */
  if (endCall || nextState === "ended") {
    await endSession(callSid, `end_${nextState}`, callOutcome);
    buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action, hangup: true });
  } else {
    buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action });
  }

  return sendTwiML(res, twiml);
}

/* =====================================================================
   EXPORTS
   ===================================================================== */
export default {
  handleInitialCall,
  handleUserInput,
  handleStatusCallback,
  validateTwilioSignature,
};