/**
 * voice.service.js  (v10 — Slow/Unclear Speech Handling)
 * =================================================================================
 *
 * NEW IN v10:
 *
 *  🔴 SLOW / UNCLEAR SPEECH DETECTION:
 *   1. New `slowSpeechRetries` counter per session — separate from silenceRetries.
 *   2. New CFG.MAX_SLOW_SPEECH_RETRIES = 3 — customer gets 3 chances before hang up.
 *   3. New V.slowSpeech lines rotate through 3 natural prompts:
 *      - "Kripya thoda tez awaaz se boliye"
 *      - "Awaaz thodi kam aayi, thoda zyada tez boliye"
 *      - "Shayad awaaz dhimi aa rahi hai, kripya paas aake tez boliye"
 *   4. On MAX_SLOW_SPEECH_RETRIES exceeded → polite farewell + hangup (not abrupt cut).
 *   5. Very short utterances (≤2 chars) are also treated as slow speech, not silence.
 *   6. slowSpeechRetries resets to 0 on any clear, normal speech.
 *
 * All v9 features retained (Priya persona, confusionStreak, repeatCount, etc.)
 */

import twilio from "twilio";
import ServiceBooking from "../models/Servicebooking.js";
import { callDataStore } from "../routes/outbound.js";
import {
  processUserInput,
  INTENT,
  matchBranch,
  resolveDate,
} from "../utils/conversational_intelligence.js";

/* =====================================================================
   CONFIGURATION
   ===================================================================== */
const CFG = {
  MAX_SILENCE_RETRIES:     3,
  MAX_SLOW_SPEECH_RETRIES: 3,   // NEW: max unclear/slow speech retries before hangup
  MAX_TOTAL_TURNS:         15,
  CONFIDENCE_THRESHOLD:    0.45,
  GATHER_TIMEOUT:          6,
  SPEECH_TIMEOUT:          3,
  TTS_LANGUAGE:            "hi-IN",
  TTS_VOICE:               "Polly.Aditi",
  SESSION_TTL_MS:          30 * 60 * 1000,
  MAX_REPEAT_COUNT:        3,
  MAX_CONFUSION_STREAK:    2,
  MAX_PERSUASION:          2,     // NEW: max persuasion attempts before rejecting
};

/* =====================================================================
   SESSION STORE
   ===================================================================== */
const sessionStore = new Map();

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
   TWILIO SIGNATURE VALIDATION
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
    input:           "speech",
    action:          actionUrl,
    method:          "POST",
    language:        CFG.TTS_LANGUAGE,
    timeout:         CFG.GATHER_TIMEOUT,
    speechTimeout:   CFG.SPEECH_TIMEOUT,
    profanityFilter: false,
    bargeIn:         true,
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
   NLP TIMEOUT GUARD  — prevents NLP hangs
   ===================================================================== */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("NLP timeout")), ms)
    ),
  ]);
}

/* =====================================================================
   SESSION FACTORY
   ===================================================================== */
function createSession(callData, callSid) {
  return {
    callSid,
    customerName:    callData.customerName   || "ji",
    customerPhone:   callData.customerPhone  || null,
    machineModel:    callData.machineModel   || "",
    machineNumber:   callData.machineNumber  || "",
    serviceType:     callData.serviceType    || "500 Hour",
    dueDate:         callData.dueDate        || "",
    state:               "awaiting_initial_decision",
    preferredDate:       null,
    resolvedDate:        null,
    assignedBranchName:  null,
    assignedBranchCode:  null,
    assignedBranchCity:  null,
    assignedBranchAddr:  null,
    rejectionReason:     null,
    alreadyDoneDetails:  null,
    persuasionCount:     0,
    branchRetries:       0,       // NEW: tracks branch asking retries
    confusionCount:      0,       // NEW: tracks greeting confusion attempts
    lowConfRetries:      0,
    slowSpeechRetries:   0,    // NEW: tracks consecutive slow/unclear speech turns
    repeatCount:         0,
    confusionStreak:     0,
    outcome:             null,
    silenceRetries:      0,
    unknownStreak:       0,
    totalTurns:          0,
    lastMessage:         "",
    callStartedAt:       new Date(),
    ending:              false,   // NEW: hangup protection flag
    turns:               [],
  };
}

/* =====================================================================
   OUTCOME RESOLVER
   ===================================================================== */
function resolveOutcome(nextState, intent, session, previousState) {
  if (nextState !== "ended") return "no_response";
  if (previousState === "awaiting_service_details") return "already_done";
  if (session.preferredDate && session.assignedBranchCode) return "confirmed";
  if (session.preferredDate && !session.assignedBranchCode) return "confirmed";
  if (intent === INTENT.REJECT) return "rejected";
  return "no_response";
}

/* =====================================================================
   DB WRITER
   ===================================================================== */
async function saveCallOutcome(session, outcome) {
  try {
    const resolvedDisplay = session.resolvedDate?.display || session.preferredDate || null;
    const resolvedISO     = session.resolvedDate?.iso     || null;

    await ServiceBooking.create({
      callSid:       session.callSid,
      customerName:  session.customerName,
      customerPhone: session.customerPhone,
      machineModel:  session.machineModel,
      machineNumber: session.machineNumber,
      serviceType:   session.serviceType,
      dueDateOriginal: session.dueDate,
      outcome,
      confirmedServiceDate:    outcome === "confirmed" ? resolvedDisplay || "[date unresolved]" : null,
      confirmedServiceDateISO: outcome === "confirmed" ? resolvedISO : null,
      assignedBranchName: session.assignedBranchName || null,
      assignedBranchCode: session.assignedBranchCode || null,
      assignedBranchCity: session.assignedBranchCity || null,
      rejectionReason:    outcome === "rejected"     ? session.rejectionReason    : null,
      alreadyDoneDetails: outcome === "already_done" ? session.alreadyDoneDetails : null,
      totalTurns:    session.totalTurns,
      callStartedAt: session.callStartedAt,
      callEndedAt:   new Date(),
      turns:         session.turns,
    });

    log.info("db", `Saved — outcome: ${outcome} | date: ${resolvedDisplay || "N/A"}`, {
      callSid: session.callSid,
      branch:  session.assignedBranchCode || "N/A",
      iso:     resolvedISO,
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
  if (session) {
    session.ending = true;
  }
  log.info("session", `Ended — ${reason} | outcome: ${outcome}`, { callSid });
  if (session) await saveCallOutcome(session, outcome);
  
  // Delayed deletion to prevent double-webhook issue
  setTimeout(() => {
    sessionStore.delete(callSid);
  }, 5000);
}

/* =====================================================================
   TURN LOGGER
   ===================================================================== */
function appendTurn(session, { customerSaid, confidence, intent, systemReply }) {
  session.turns.push({
    turnNumber:   session.totalTurns,
    state:        session.state,
    customerSaid: customerSaid || "",
    confidence:   confidence ?? null,
    intent:       intent || null,
    systemReply,
  });
}

/* =====================================================================
   FILLER-WORD CONFIRM GUARD
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

/* =====================================================================
   MEANINGFUL SHORT WORDS GUARD — for slow speech detection
   ===================================================================== */
const MEANINGFUL_SHORT_WORDS = [
  "haan","haan ji","ji","ok","okay",
  "theek","theek hai","thik hai",
  "kal","parso","haanji","hmm",
];

/* =====================================================================
   GREETING CONFUSION PATTERNS — detects confused responses at greeting
   ===================================================================== */
const GREETING_CONFUSION_PATTERNS = [
  /कौन\s+बोल\s+रहे/iu,
  /आप\s+कौन/iu,
  /किस\s+लिए\s+कॉल/iu,
  /क्या\s+कहा/iu,
  /फिर\s+से\s+बोल/iu,
  /समझ\s+नहीं\s+आया/iu,
  /कौन\s+है/iu,
  /किस\s+चीज/iu,
];

function isMeaningfulShort(text) {
  const lower = text.toLowerCase().trim();
  return MEANINGFUL_SHORT_WORDS.includes(lower);
}

/* =====================================================================
   UNCLEAR SPEECH DETECTOR — blocks unclear/noisy input at greeting
   ===================================================================== */
function isUnclearSpeech({ text, confidence }) {
  if (!text) return true;
  const wordCount = text.trim().split(/\s+/).length;
  return (
    confidence < 0.3 ||
    wordCount <= 1 ||
    text.trim().length <= 3
  );
}

/* =====================================================================
   GREETING CONFUSION DETECTOR
   ===================================================================== */
function detectGreetingConfusion(text) {
  if (!text) return false;
  for (const pattern of GREETING_CONFUSION_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

function isGenuineConfirm(userText, state) {
  const lower = userText.toLowerCase().trim();
  if (["awaiting_date_confirm","awaiting_initial_decision"].includes(state)) return true;
  if (STRONG_CONFIRM_TOKENS.some(t => lower.includes(t))) return true;
  const isOnlyFiller = FILLER_ONLY_TOKENS.some(
    t => lower === t || lower === t + " ji" || lower === "ji " + t
  );
  if (isOnlyFiller && ["awaiting_reason","awaiting_reason_persisted"].includes(state)) {
    return false;
  }
  return true;
}

/* =====================================================================
   REPEAT RESPONSE ROTATOR
   ===================================================================== */
const REPEAT_INTROS = [
  "Zaroor, phir se bata rahi hoon —",
  "Bilkul ji, dobara keh rahi hoon —",
  "Haan ji, suniye —",
  "Koi baat nahi, phir se —",
  "Zaroor, ek baar aur —",
];

function getRepeatResponse(session) {
  const idx     = session.repeatCount % REPEAT_INTROS.length;
  const intro   = REPEAT_INTROS[idx];
  const lastMsg = session.lastMessage || "";
  return lastMsg
    ? `${intro} ${lastMsg}`
    : V.repeatFallback(session.customerName);
}

/* =====================================================================
   CONFUSION RESPONSE BUILDER
   ===================================================================== */
function getConfusionResponse(session) {
  const name    = session.customerName || "ji";
  const number  = session.machineNumber || "aapki machine";
  const svcType = session.serviceType   || "scheduled service";

  if (session.confusionStreak >= CFG.MAX_CONFUSION_STREAK) {
    return (
      `Namaskar phir se ${name} ji. Main Priya hoon, Rajesh Motors JCB Service se. ` +
      `Aapke registered number par machine number ${number} ki ${svcType} ke baare mein ` +
      `call kar rahi hoon. Kya yeh aapki machine hai? Haan ya nahi boliye.`
    );
  }

  return (
    `Maafi chahti hoon ${name} ji, shayad main spasht nahi bol payi. ` +
    `Main Priya hoon, Rajesh Motors JCB Service se — machine number ${number} ki ` +
    `${svcType} service book karwana chahti thi. Kya aap interested hain?`
  );
}

/* =====================================================================
   SLOW SPEECH RESPONSE ROTATOR   ← NEW
   Rotates through 3 polite prompts asking customer to speak louder/clearer.
   On final attempt, gives a warm farewell before hanging up.
   ===================================================================== */
const SLOW_SPEECH_PROMPTS = [
  (name) => `${name} ji, kripya thoda tez awaaz se boliye — awaaz dhimi aa rahi hai.`,
  (name) => `${name} ji, awaaz thodi kam aayi. Kripya thoda zyada tez aur spasht boliye.`,
  (name) => `${name} ji, shayad awaaz ki samasya aa rahi hai. Kripya paas aake thoda tez boliye.`,
];

function getSlowSpeechPrompt(session) {
  const idx = Math.min(session.slowSpeechRetries - 1, SLOW_SPEECH_PROMPTS.length - 1);
  return SLOW_SPEECH_PROMPTS[idx](session.customerName || "ji");
}

function getSlowSpeechFarewell(name) {
  return (
    `${name} ji, awaaz baar baar saaf nahi aayi. ` +
    `Hum thodi der baad dobara sampark karenge. Dhanyavaad!`
  );
}

/* =====================================================================
   VOICE LINES (Priya — Formal, Polite, Feminine)
   ===================================================================== */
const V = {

  greeting: (name, model, number, serviceType) =>
    `Namaskar ${name} ji! ` +
    `Main Priya bol rahi hoon, Rajesh Motors JCB Service se. ` +
    `Aapki machine number ${number}, model ${model}, ki ${serviceType} service ka samay aa gaya hai. ` +
    `Kya main is hafte ke liye booking kar sakti hoon?`,

  askDate: (name) =>
    `${name} ji, kripya bataiye — kaunsa din aapke liye suvidhajanak rahega? ` +
    `Kal, parso, somwar, ya koi bhi tarikh boliye.`,

  confirmDate: (name, displayDate) =>
    `Bilkul ${name} ji. ${displayDate} ko booking kar rahi hoon — kya yeh theek rahega? Haan ya nahi boliye.`,

  askBranch: (name) =>
    `${name} ji, aapki machine abhi kis shehar mein hai? ` +
    `Jaipur, Kota, Ajmer, Alwar, Sikar ya Udaipur — kripya shehar ka naam bataiye.`,

  askBranchAgain: (name) =>
    `${name} ji, shehar ka naam thoda spasht bataiye please — ` +
    `Jaipur, Kota, Ajmer, Udaipur, ya Alwar mein se kaunsa?`,

  confirmBooking: (name, branchName, branchCity, displayDate) =>
    `Bahut achchi baat hai ${name} ji! Aapki service book ho gayi — ` +
    `${displayDate} ko ${branchName}, ${branchCity} mein. ` +
    `Hamare service engineer aapse jald smpark karenge. Dhanyavaad!`,

  askReason: (name) =>
    `Samajh gayi ${name} ji. Kripya bataiye kya karan hai — ` +
    `main dekhti hoon ki kya koi sahayata ho sakti hai.`,

  askAlreadyDoneDetails: (name) =>
    `Achha, bahut achchi baat hai ${name} ji! Kripya bataiye — ` +
    `kab karwaai thi, kahan se, aur kaunsi service thi?`,

  alreadyDoneSaved: (name) =>
    `Shukriya ${name} ji! Aapka record update kar diya gaya hai. ` +
    `Agli service ka reminder samay se pahle aayega. Dhanyavaad!`,

  objectionDriverNotAvailable: (name) =>
    `Bilkul samajh gayi ${name} ji. ` +
    `Driver ke uplabdh hone par ek suvidhajanaka din bata deejiye — main usi ke liye fix kar dungi.`,

  objectionMachineBusy: (name) =>
    `Samajh gayi ${name} ji, machine abhi kaam par hai. ` +
    `Jab thodi der ke liye free ho sake, tab ka ek din bata deejiye.`,

  objectionWorkingFine: (name) =>
    `Yeh sunkar achcha laga ${name} ji ki machine sahi chal rahi hai. ` +
    `Samay par service se future mein kharabi ka khatra bhi kam ho jata hai. Kab karein?`,

  objectionMoneyIssue: (name) =>
    `Koi chinta nahi ${name} ji. Pehle ek tarikh tay kar lein — ` +
    `payment baad mein bhi ho sakti hai.`,

  objectionCallLater: (name) =>
    `Bilkul ${name} ji. Koi ek suvidhajanaka din bata deejiye — ` +
    `main record mein note kar leti hoon.`,

  persuasionFinal: (name) =>
    `${name} ji, service aage karne se baad mein adhik kharcha pad sakta hai. ` +
    `Kripya ek tarikh bataiye — baaki sab main sambhal lungi.`,

  rejected: (name) =>
    `Theek hai ${name} ji. Jab bhi zaroorat ho, Rajesh Motors ko call kijiye — ` +
    `hum hamesha taiyaar hain. Dhanyavaad!`,

  noResponseEnd: (name) =>
    `${name} ji, koi awaaz nahi aayi. Main thodi der baad dobara call karungi. Dhanyavaad!`,

  repeatFallback: (name) =>
    `Ji zaroor. Main Priya hoon, Rajesh Motors JCB Service se — ` +
    `aapki machine ki service booking ke baare mein baat kar rahi thi.`,

  confusionClarify: (name, machineNumber, serviceType) =>
    `${name} ji, ek baar spasht kar doon — main Priya hoon, Rajesh Motors se. ` +
    `Machine number ${machineNumber} ki ${serviceType} ke liye call aa rahi hai. ` +
    `Kya aap service book karna chahte hain?`,

  confusionFull: (name, machineNumber, serviceType) =>
    `Namaskar ${name} ji. Main Priya hoon, Rajesh Motors JCB Service se. ` +
    `Aapke registered number par machine number ${machineNumber} ki ${serviceType} ` +
    `ke baare mein call ki thi. Kya yeh aapki machine hai?`,

  offerAgent: (name) =>
    `${name} ji, lagta hai awaaz mein kuch takleef aa rahi hai. ` +
    `Kya aap chaahenge ki main aapko hamare senior agent se connect kar doon?`,

  silenceFallback: {
    awaiting_initial_decision: (name) =>
      `${name} ji, kya aap mujhe sun pa rahe hain? Service booking ke baare mein baat kar rahi thi.`,
    awaiting_reason: (name) =>
      `${name} ji, main sun rahi hoon — koi baat ho to bataiye.`,
    awaiting_reason_persisted: (name) =>
      `${name} ji, koi bhi suvidhajanaka din bata deejiye — main arrange kar lungi.`,
    awaiting_date: (name) =>
      `${name} ji, kaunsa din theek rahega? Kal, parso, ya is hafte koi bhi din.`,
    awaiting_date_confirm: (name) =>
      `${name} ji, yeh tarikh theek hai? Kripya haan ya nahi boliye.`,
    awaiting_branch: (name) =>
      `${name} ji, machine ka shehar bataiye — Jaipur, Kota, Ajmer ya Udaipur?`,
    awaiting_service_details: (name) =>
      `${name} ji, kab, kahan se aur kaunsi service karwaai thi?`,
  },

  // Updated: now explicitly says "tez awaaz se boliye" for low confidence
  lowConfidence: (name) =>
    `${name} ji, awaaz thodi saaf nahi aayi. Kripya thoda tez awaaz se boliye.`,

  politeAskAgain: (name) =>
    `${name} ji, samajh nahi aaya. Kripya haan ya nahi boliye.`,

  technicalError: (name) =>
    `${name} ji, thodi technical dikkat aa gayi. Hum jald dobara sampark karenge. Kshama kijiye!`,

  noCallData: ()     => `Namaskar ji! Data load karne mein thodi dikkat aa gayi. Kripya thodi der baad call karein. Shukriya!`,
  noSession: ()      => `Namaskar ji! Session samaapt ho gaya. Kripya dobara call karein. Shukriya!`,
  missingCallSid: () => `Technical samasya aa gayi. Thodi der baad sampark karein. Shukriya!`,

  shortGreeting: (name) =>
    `${name} ji, main Priya hoon, Rajesh Motors se. ` +
    `Aapki JCB machine ki service ke liye call kiya hai. ` +
    `Kya aap abhi baat kar sakte hain?`,

  greetingConfusionLimit: (name) =>
    `${name} ji, lagta hai abhi baat karna suvidhajanak nahi hai. ` +
    `Main baad mein call karungi. Dhanyavaad!`,
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

  const greeting     = V.greeting(customerName, machineModel, machineNumber, serviceType);
  session.lastMessage = greeting;
  sessionStore.set(callSid, session);

  log.info("greeting", `→ ${customerName}`, { callSid, machineModel, machineNumber });

  buildVoiceResponse({ twiml, message: greeting, actionUrl: processUrl() });
  return sendTwiML(res, twiml);
}

/* =====================================================================
   handleStatusCallback
   ===================================================================== */
async function handleStatusCallback(req, res) {
  const callSid    = req.body?.CallSid;
  const callStatus = req.body?.CallStatus;

  res.sendStatus(204);

  if (!callSid) return;

  const terminalStatuses = ["completed","busy","failed","no-answer","canceled"];
  if (terminalStatuses.includes(callStatus) && sessionStore.has(callSid)) {
    log.info("status", `Hangup detected — status: ${callStatus}`, { callSid });
    await endSession(callSid, `hangup_${callStatus}`, "no_response");
  }
}

/* =====================================================================
   handleUserInput  — Main conversation handler
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

  /* ── Hangup protection: prevent post-hangup ghost requests ── */
  if (session.ending) {
    log.warn("input", "Session already ending — ignoring ghost request", { callSid });
    return sendTwiML(res, new twilio.twiml.VoiceResponse());
  }

  session.totalTurns += 1;
  const name = session.customerName;

  log.info("input", `Turn ${session.totalTurns} | state: ${session.state}`, {
    callSid, speech: rawSpeech.substring(0, 80), confidence: confidence.toFixed(2), confusionCount: session.confusionCount,
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

  /* ══════════════════════════════════════════════════════════════════
     STEP 1: Check for unclear speech at GREETING
     Block noisy/unclear input from being processed as intent
   ══════════════════════════════════════════════════════════════════ */
  if (session.state === "awaiting_initial_decision") {
    const unclear = isUnclearSpeech({ text: rawSpeech, confidence });
    
    if (unclear) {
      session.confusionCount = (session.confusionCount || 0) + 1;
      log.warn("input", `Greeting unclear speech #${session.confusionCount} | conf=${confidence.toFixed(2)}`, { callSid });
      
      if (session.confusionCount >= 3) {
        const farewell = V.greetingConfusionLimit(name);
        appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "greeting_confusion_max", systemReply: farewell });
        session.ending = true;
        sessionStore.set(callSid, session);
        setTimeout(() => sessionStore.delete(callSid), 5000);
        await endSession(callSid, "greeting_confusion_max", "no_response");
        buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
        return sendTwiML(res, twiml);
      }
      
      const shortGreet = V.shortGreeting(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "unclear_speech", systemReply: shortGreet });
      session.lastMessage = shortGreet;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: shortGreet, actionUrl: action });
      return sendTwiML(res, twiml);
    }
    session.confusionCount = 0; // Reset on clear speech
  }

  /* ══════════════════════════════════════════════════════════════════
     SLOW / UNCLEAR SPEECH DETECTION  ← MAIN BLOCK
     Triggered when:
       (a) confidence below threshold, AND
       (b) NLP also failed (intent is UNKNOWN), AND
       (c) it's not a meaningful short word
     Customer gets CFG.MAX_SLOW_SPEECH_RETRIES chances with escalating
     prompts asking them to speak louder/clearer. After max retries,
     a polite farewell is played and the call ends gracefully.
   ══════════════════════════════════════════════════════════════════ */
  const isVeryShortSpeech = rawSpeech.length <= 2;
  const isLowConfidence   = confidence < CFG.CONFIDENCE_THRESHOLD;

  /* Detect slow/unclear speech: low confidence + NLP also failed + not meaningful */
  let nlpResult;
  try {
    nlpResult = await withTimeout(
      Promise.resolve(processUserInput(rawSpeech, {
        ...session,
        retries:         session.silenceRetries,
        unknownStreak:   session.unknownStreak,
        persuasionCount: session.persuasionCount,
      })),
      3000
    );
  } catch (err) {
    log.error("input", `NLP timeout or error: ${err.message}`, { callSid });
    const errMsg = V.technicalError(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "nlp_error", systemReply: errMsg });
    session.ending = true;
    sessionStore.set(callSid, session);
    setTimeout(() => sessionStore.delete(callSid), 5000);
    buildVoiceResponse({ twiml, message: errMsg, actionUrl: action, hangup: true });
    return sendTwiML(res, twiml);
  }

  const intent = nlpResult.intent || "unknown";
  
  /* ══════════════════════════════════════════════════════════════════
     STEP 2: Check for greeting confusion intent at GREETING
   ══════════════════════════════════════════════════════════════════ */
  if (session.state === "awaiting_initial_decision" && detectGreetingConfusion(rawSpeech)) {
    session.confusionCount = (session.confusionCount || 0) + 1;
    log.warn("input", `Greeting confusion intent #${session.confusionCount}`, { callSid });
    
    if (session.confusionCount >= 3) {
      const farewell = V.greetingConfusionLimit(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "greeting_confusion", systemReply: farewell });
      session.ending = true;
      sessionStore.set(callSid, session);
      setTimeout(() => sessionStore.delete(callSid), 5000);
      await endSession(callSid, "greeting_confusion_repeat", "no_response");
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
      return sendTwiML(res, twiml);
    }
    
    const shortGreet = V.shortGreeting(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "greeting_confusion", systemReply: shortGreet });
    session.lastMessage = shortGreet;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: shortGreet, actionUrl: action });
    return sendTwiML(res, twiml);
  }
  
  const shouldTriggerSlowSpeech =
    (confidence < 0.3 && intent === INTENT.UNKNOWN) &&
    !isMeaningfulShort(rawSpeech);

  if (shouldTriggerSlowSpeech || isVeryShortSpeech) {
    session.slowSpeechRetries = (session.slowSpeechRetries || 0) + 1;
    session.lowConfRetries    = session.slowSpeechRetries; // keep legacy counter in sync

    log.warn("input",
      `Slow/unclear speech #${session.slowSpeechRetries} | conf=${confidence.toFixed(2)} | len=${rawSpeech.length}`,
      { callSid }
    );

    if (session.slowSpeechRetries >= CFG.MAX_SLOW_SPEECH_RETRIES) {
      // Max retries reached — polite farewell, do NOT abruptly cut
      const farewell = getSlowSpeechFarewell(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "slow_speech_max", systemReply: farewell });
      sessionStore.set(callSid, session);
      await endSession(callSid, "slow_speech_max", "no_response");
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
      return sendTwiML(res, twiml);
    }

    // Still within retries — prompt to speak louder/clearer
    const slowMsg = getSlowSpeechPrompt(session);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "slow_speech", systemReply: slowMsg });
    session.lastMessage = slowMsg;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: slowMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  // Clear speech received — reset both counters
  session.slowSpeechRetries = 0;
  session.lowConfRetries    = 0;

  const {
    replyText, nextState, endCall,
    preferredDate, resolvedDate, extractedBranch,
  } = nlpResult;

  /* ── REPEAT ── */
  if (intent === INTENT.REPEAT) {
    session.repeatCount = (session.repeatCount || 0) + 1;
    log.info("input", `Repeat request #${session.repeatCount}`, { callSid });

    let repeatMsg;
    if (session.repeatCount > CFG.MAX_REPEAT_COUNT) {
      repeatMsg = V.offerAgent(name);
      log.warn("input", `Repeat loop detected — offering agent`, { callSid });
    } else {
      repeatMsg = getRepeatResponse(session);
    }

    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: repeatMsg });
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: repeatMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  session.repeatCount = 0;

  /* ── CONFUSION ── */
  if (intent === INTENT.UNCLEAR || intent === INTENT.CONFUSION) {
    session.confusionStreak = (session.confusionStreak || 0) + 1;
    log.info("input", `Confusion streak #${session.confusionStreak}`, { callSid });

    const confusionMsg = getConfusionResponse(session);

    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: confusionMsg });
    session.lastMessage = confusionMsg;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: confusionMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  session.confusionStreak = 0;

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
  if (
    (session.state === "awaiting_reason" || session.state === "awaiting_reason_persisted") &&
    rawSpeech
  ) {
    session.rejectionReason = rawSpeech;
  }

  /* ── Capture already-done details ── */
  if (session.state === "awaiting_service_details" && rawSpeech) {
    session.alreadyDoneDetails = rawSpeech;
  }

  /* ── Persist date ── */
  if (preferredDate !== undefined) session.preferredDate = preferredDate;
  if (resolvedDate  !== undefined) session.resolvedDate  = resolvedDate;

  /* ── Persist branch ── */
  if (extractedBranch) {
    session.assignedBranchName = extractedBranch.name;
    session.assignedBranchCode = extractedBranch.code;
    session.assignedBranchCity = extractedBranch.city;
    session.assignedBranchAddr = extractedBranch.address || null;
    session.branchRetries = 0;  // Reset on success
    log.info("branch", `Matched → ${extractedBranch.name} (code: ${extractedBranch.code})`, { callSid });
  }
  
  /* ── Branch retry guard: max 3 attempts ── */
  if (nextState === "awaiting_branch") {
    session.branchRetries = (session.branchRetries || 0) + 1;
    if (session.branchRetries >= 3) {
      log.warn("input", "Branch retry limit reached — offering agent", { callSid });
      const msg = V.offerAgent(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: msg });
      session.ending = true;
      sessionStore.set(callSid, session);
      setTimeout(() => sessionStore.delete(callSid), 5000);
      await endSession(callSid, "branch_max_retries", "no_response");
      buildVoiceResponse({ twiml, message: msg, actionUrl: action, hangup: true });
      return sendTwiML(res, twiml);
    }
  }

  /* ── Persuasion counter with cap ── */
  if (
    (session.state === "awaiting_reason" || session.state === "awaiting_reason_persisted") &&
    nextState === "awaiting_reason_persisted"
  ) {
    session.persuasionCount = (session.persuasionCount || 0) + 1;
    log.info("input", `persuasionCount now ${session.persuasionCount}`, { callSid });
    
    /* ── NEW: Persuasion cap — if exceeded, end call with rejection ── */
    if (session.persuasionCount >= CFG.MAX_PERSUASION) {
      log.info("input", "Max persuasion cap reached — ending with rejection", { callSid });
      nextState = "ended";
      endCall = true;
    }
  }

  /* ── Unknown streak ── */
  const stateStuck =
    nextState === session.state &&
    ["awaiting_initial_decision","awaiting_reason","awaiting_branch"].includes(nextState);
  session.unknownStreak = stateStuck ? session.unknownStreak + 1 : 0;

  /* ── Voice line overrides ── */
  let finalReplyText = replyText;

  if (nextState === "awaiting_date_confirm" && (preferredDate || session.preferredDate)) {
    const dateTok = preferredDate || session.preferredDate;
    const display = resolvedDate?.display || (dateTok ? resolveDisplayDate(dateTok) : null) || dateTok;
    finalReplyText = V.confirmDate(name, display);
  }

  if (nextState === "ended" && session.state === "awaiting_branch" && session.assignedBranchName) {
    const display = session.resolvedDate?.display || session.preferredDate || "nirdharit tarikh";
    finalReplyText = V.confirmBooking(name, session.assignedBranchName, session.assignedBranchCity, display);
  }

  if (nextState === "ended" && session.state === "awaiting_service_details") {
    finalReplyText = V.alreadyDoneSaved(name);
  }

  if (nextState === "awaiting_reason" && session.state === "awaiting_initial_decision") {
    finalReplyText = V.askReason(name);
  }

  if (nextState === "awaiting_date" &&
    ["awaiting_initial_decision","awaiting_reason","awaiting_reason_persisted","awaiting_date_confirm"].includes(session.state)
  ) {
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

  if (nextState === "awaiting_date") {
    if      (intent === INTENT.DRIVER_NOT_AVAILABLE) finalReplyText = V.objectionDriverNotAvailable(name);
    else if (intent === INTENT.MACHINE_BUSY)         finalReplyText = V.objectionMachineBusy(name);
    else if (intent === INTENT.WORKING_FINE)         finalReplyText = V.objectionWorkingFine(name);
    else if (intent === INTENT.MONEY_ISSUE)          finalReplyText = V.objectionMoneyIssue(name);
    else if (intent === INTENT.CALL_LATER)           finalReplyText = V.objectionCallLater(name);
  }

  /* ── Log turn ── */
  appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: finalReplyText });

  /* ── Resolve outcome BEFORE mutating session.state ── */
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
    date:         session.preferredDate  || "N/A",
    resolvedDate: session.resolvedDate?.display || "N/A",
    iso:          session.resolvedDate?.iso     || "N/A",
    branch:       session.assignedBranchCode    || "N/A",
  });

  /* ── End or continue ── */
  if (endCall || nextState === "ended") {
    await endSession(callSid, `end_${nextState}`, callOutcome);
    buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action, hangup: true });
  } else {
    // Always save session before responding
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action });
  }

  return sendTwiML(res, twiml);
}

/* =====================================================================
   HELPER: Safe display date resolver
   ===================================================================== */
function resolveDisplayDate(token) {
  try {
    return resolveDate(token)?.display || null;
  } catch {
    return null;
  }
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