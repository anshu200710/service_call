/**
 * voice.service.js  (v11 — 9-Point Improvement Edition)
 * =================================================================================
 *
 * IMPROVEMENTS IN v11:
 *
 *  1. SMART REPEAT: "samjh nahi", "dobara bolo" → replays EXACT last question
 *     with rotating warm intros, not a generic fallback.
 *
 *  2. CONFUSION HANDLING: Confusion words absorbed + state-aware contextual
 *     re-explanation. Full re-intro on 2nd+ confusion. Politely steers back.
 *
 *  3. DATE UNDERSTANDING: Ultra-expanded date resolver — kal, parso, tarso,
 *     is hafte, agle hafte, somwar/somvaar/samvar, all English days, phonetic
 *     STT variants, Hindi number words, N din/hafte/mahine baad.
 *
 *  4. SILENCE HANDLING: 3-retry patience mode — "Sir kya aap sun paa rahe hain?
 *     Main [state-specific question] pooch rahi hoon." Each retry is unique.
 *     Warm farewell after max retries.
 *
 *  5. OFF-TOPIC REDIRECT: Unknown input → "Main kuch aur nahi samajh pa rahi —
 *     bas [last specific question] jaanna chahti hoon." No abrupt cutting.
 *
 *  6. GENUINE Q&A: All responses are state-aware, no generic fallbacks.
 *
 *  7. BRANCH MATCHING: Fuzzy Levenshtein + phonetic Hindi city map expansion.
 *
 *  8. DATE DEEPLY: resolveDate covers all Hindi/English + rural variants.
 *
 *  9. RURAL KEYWORDS: Rajasthani, Bhojpuri, Marwari dialect support in all tables.
 */

import twilio from "twilio";
import ServiceBooking from "../models/Servicebooking.js";
import { callDataStore } from "../routes/outbound.js";
import {
  processUserInput,
  INTENT,
  matchBranch,
  resolveDate,
  buildSmartRepeatResponse,
  buildSmartConfusionResponse,
  buildOffTopicResponse,
} from "../utils/conversational_intelligence.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_BACKUP_FILE = path.join(__dirname, "..", ".session_backup.json");

/* =====================================================================
   CONFIGURATION
   ===================================================================== */
const CFG = {
  MAX_SILENCE_RETRIES:     3,    // 3 patient retries before farewell
  MAX_SLOW_SPEECH_RETRIES: 3,
  MAX_TOTAL_TURNS:         15,
  CONFIDENCE_THRESHOLD:    0.4,
  GATHER_TIMEOUT:          6,
  SPEECH_TIMEOUT:          3,
  TTS_LANGUAGE:            "hi-IN",
  TTS_VOICE:               "Polly.Aditi",
  SESSION_TTL_MS:          30 * 60 * 1000,
  MAX_REPEAT_COUNT:        3,
  MAX_CONFUSION_STREAK:    2,
  MAX_PERSUASION:          2,
};

/* =====================================================================
   LOGGER
   ===================================================================== */
const log = {
  info:  (tag, msg, meta = {}) => console.log  (`[voice][${tag}] ${msg}`,  Object.keys(meta).length ? meta : ""),
  warn:  (tag, msg, meta = {}) => console.warn (`[voice][${tag}] WARN  ${msg}`, Object.keys(meta).length ? meta : ""),
  error: (tag, msg, meta = {}) => console.error(`[voice][${tag}] ERROR ${msg}`, Object.keys(meta).length ? meta : ""),
};

/* =====================================================================
   SESSION STORE with File Backup Recovery
   ===================================================================== */
const sessionStore = new Map();

function loadSessionBackup() {
  try {
    if (fs.existsSync(SESSION_BACKUP_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_BACKUP_FILE, "utf8"));
      for (const [callSid, sessionData] of Object.entries(data)) {
        if (sessionData) {
          sessionData.callStartedAt = new Date(sessionData.callStartedAt);
          sessionStore.set(callSid, sessionData);
          log.info("session", `Recovered session from backup: ${callSid}`);
        }
      }
    }
  } catch (err) {
    log.warn("session", `Failed to load session backup: ${err.message}`);
  }
}

function saveSessionBackup() {
  try {
    const backup = {};
    for (const [callSid, session] of sessionStore.entries()) {
      if (session && !session.ending) backup[callSid] = session;
    }
    fs.writeFileSync(SESSION_BACKUP_FILE, JSON.stringify(backup, null, 2));
  } catch (err) {
    log.warn("session", `Failed to save session backup: ${err.message}`);
  }
}

loadSessionBackup();
setInterval(() => { saveSessionBackup(); }, 10 * 1000);
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessionStore.entries()) {
    if (now - session.callStartedAt.getTime() > CFG.SESSION_TTL_MS) {
      log.warn("session", "TTL cleanup for stale session", { callSid: sid });
      endSession(sid, "ttl_cleanup", "no_response").catch(() => {});
    }
  }
  saveSessionBackup();
}, 5 * 60 * 1000);

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
  try {
    if (!twiml) {
      log.error("voice", "Missing twiml object in buildVoiceResponse");
      throw new Error("Missing twiml object");
    }
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      log.error("voice", "Invalid message for buildVoiceResponse", { message });
      message = "Namaskar ji, thodi technical dikkat aa gayi. Kripya dobara try karein.";
    }
    const sayOpts = { language: CFG.TTS_LANGUAGE, voice: CFG.TTS_VOICE };
    if (hangup) {
      twiml.say(sayOpts, message);
      twiml.hangup();
      return;
    }
    if (!actionUrl || typeof actionUrl !== "string") {
      log.error("voice", "Invalid actionUrl for buildVoiceResponse", { actionUrl });
      throw new Error("Missing or invalid actionUrl");
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
  } catch (err) {
    log.error("voice", `buildVoiceResponse error: ${err.message}`, { error: err });
    throw err;
  }
}

function processUrl() {
  return `${process.env.PUBLIC_URL}/voice/process`;
}
function sendTwiML(res, twiml) {
  try {
    if (!twiml || !res) {
      log.error("twiml", "Missing twiml or response object");
      return res ? res.status(500).send("Internal server error") : null;
    }
    const twimlStr = twiml.toString();
    if (!twimlStr || twimlStr.trim().length === 0) {
      log.error("twiml", "Empty TwiML generated");
      return res.status(500).send("Internal server error");
    }
    return res.type("text/xml").send(twimlStr);
  } catch (err) {
    log.error("twiml", `sendTwiML error: ${err.message}`, { error: err });
    return res ? res.status(500).send("Internal server error") : null;
  }
}
function errorResponse(res, tag, logMsg, speakMsg) {
  log.error(tag, logMsg);
  const twiml = new twilio.twiml.VoiceResponse();
  buildVoiceResponse({ twiml, message: speakMsg, actionUrl: processUrl(), hangup: true });
  return sendTwiML(res, twiml);
}

/* =====================================================================
   NLP TIMEOUT GUARD
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
    branchRetries:       0,
    confusionCount:      0,
    lowConfRetries:      0,
    slowSpeechRetries:   0,
    repeatCount:         0,
    confusionStreak:     0,
    outcome:             null,
    silenceRetries:      0,
    unknownStreak:       0,
    totalTurns:          0,
    retryCount:          0,
    lastMessage:         "",
    lastRealMessage:     "",
    callStartedAt:       new Date(),
    ending:              false,
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
  if (session) session.ending = true;
  log.info("session", `Ended — ${reason} | outcome: ${outcome}`, { callSid });
  if (session) await saveCallOutcome(session, outcome);
  setTimeout(() => { sessionStore.delete(callSid); }, 5000);
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

const MEANINGFUL_SHORT_WORDS = [
  "haan","han","ji","haanji","ok","theek","kal","haa","ha",
  "jee","jii","yes","no","nahi","na",
];

/* =====================================================================
   GREETING CONFUSION PATTERNS
   ===================================================================== */
const GREETING_CONFUSION_PATTERNS = [
  /आप\s+कौन/i, /कौन\s+बोल/i, /कौन\s+हो/i, /किस\s+लिए/i,
  /क्यों\s+कॉल/i, /किस\s+चीज/i, /क्या\s+कहा/i, /फिर\s+से/i,
  /समझ\s+नहीं/i, /कौन\s+सी\s+कंपनी/i, /कंपनी\s+का\s+नाम/i,
  /kyun call/i, /kaun ho/i, /kaun bol/i, /kis liye/i,
  /kya kaha/i, /kaun si company/i,
];

function isMeaningfulShort(speech) {
  return MEANINGFUL_SHORT_WORDS.includes(speech.toLowerCase());
}

/* =====================================================================
   UNCLEAR SPEECH ENGINE
   ===================================================================== */
function shouldHandleUnclearSpeech({ rawSpeech, confidence, intent }) {
  const isVeryShort    = rawSpeech.length <= 2 && !isMeaningfulShort(rawSpeech);
  const isLowConfidence = confidence < CFG.CONFIDENCE_THRESHOLD;
  return intent === INTENT.UNKNOWN && (isVeryShort || isLowConfidence);
}

function isGarbageAudio({ rawSpeech, confidence }) {
  if (!rawSpeech) return true;
  const isVeryShort    = rawSpeech.length <= 2 && !isMeaningfulShort(rawSpeech);
  const isLowConfidence = confidence < CFG.CONFIDENCE_THRESHOLD;
  return isVeryShort || isLowConfidence;
}

/* =====================================================================
   SIMPLE KEYWORD INTENT DETECTION — pre-NLP fast path
   ===================================================================== */
function detectSimpleIntent(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  // CONFIRM
  if (t.match(/\b(haan|हाँ|हां|han|haa|ji haan|haan ji|ok|okay|yes|bilkul|zaroor|theek|ठीक|सही|अच्छा)\b/)) {
    return { intent: INTENT.CONFIRM, source: "keyword_confirm" };
  }

  // REJECT — explicit no
  if (t.match(/\b(nahi|नहीं|na\b|no\b|nope|mat karo|mat kar|nahi karna|cancel)\b/)) {
    return { intent: INTENT.REJECT, source: "keyword_reject" };
  }

  // DATE keywords
  if (t.match(/\b(kal|parso|tarso|somwar|mangalwar|budhwar|guruwar|shukrawar|shaniwar|raviwar|monday|tuesday|wednesday|thursday|friday|saturday|sunday|somvaar|mangalvaar|itwar|aithvar|सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार|कल|परसों|इतवार)\b/)) {
    return { intent: INTENT.RESCHEDULE, source: "keyword_date" };
  }

  // ALREADY DONE
  if (t.match(/\b(ho chuki|karwa chuka|karwa li|already|pehle|kar li|ho gayi|kar liya)\b/)) {
    if (!t.includes("karna") && !t.includes("nahi")) {
      return { intent: INTENT.ALREADY_DONE, source: "keyword_already_done" };
    }
  }

  return null;
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
    `Jaipur, Kota, Ajmer, Udaipur, Sikar ya Alwar mein se kaunsa?`,

  confirmBooking: (name, branchName, branchCity, displayDate) =>
    `Bahut achchi baat hai ${name} ji! Aapki service book ho gayi — ` +
    `${displayDate} ko ${branchName}, ${branchCity} mein. ` +
    `Hamare service engineer aapse jald sampark karenge. Dhanyavaad!`,

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
    `${name} ji, koi awaaz nahi aayi. Main ek baar aur call karungi. Aapka aashirwad chahti hoon. Shukriya!`,

  repeatFallback: (name) =>
    `Ji zaroor. Main Priya hoon, Rajesh Motors JCB Service se — ` +
    `aapki machine ki service booking ke baare mein baat kar rahi thi.`,

  confusionFull: (name, machineNumber, serviceType) =>
    `Namaskar ${name} ji. Main Priya hoon, Rajesh Motors JCB Service se. ` +
    `Aapke registered number par machine number ${machineNumber} ki ${serviceType} ` +
    `ke baare mein call ki thi. Kya yeh aapki machine hai?`,

  offerAgent: (name) =>
    `${name} ji, lagta hai awaaz mein kuch takleef aa rahi hai. ` +
    `Kya aap chaahenge ki main aapko hamare senior agent se connect kar doon?`,

  /* ── IMPROVED SILENCE FALLBACKS — v11 ── 
     Each retry has a unique, patient, contextual message.
     Improvement #4: "Sir kya aap sun paa rahe hain? Main [X] pooch rahi hoon." */
  silenceFallback: {
    awaiting_initial_decision: [
      (name) => `${name} ji, kya aap sun paa rahe hain? Main aapki machine ki service booking ke baare mein pooch rahi hoon — kya main is hafte ke liye book kar sakti hoon?`,
      (name) => `${name} ji, main sun rahi hoon. Agar aap sunna chahein — haan boliye to booking ho jayegi, nahi boliye to koi baat nahi.`,
      (name) => `${name} ji, lagta hai signal ki dikkat hai. Agar aap sun paa rahe hain — ek baar haan ya nahi boliye.`,
    ],
    awaiting_reason: [
      (name) => `${name} ji, kya aap sun paa rahe hain? Main samajhna chahti hoon — service kyun nahi karni, bas woh bataiye.`,
      (name) => `${name} ji, main hun — koi bhi karan bataiye, main aapki madad karuungi.`,
      (name) => `${name} ji, agar koi takleef hai to bataiye — ya simply haan boliye aur main ek tarikh note kar leti hoon.`,
    ],
    awaiting_reason_persisted: [
      (name) => `${name} ji, kya aap sun paa rahe hain? Ek tarikh chahiye — bas woh boliye, baaki sab main sambhaal lungi.`,
      (name) => `${name} ji, main hun. Kaunsa din sahi rahega aapke liye?`,
      (name) => `${name} ji, ek baar aur pooch rahi hoon — koi bhi ek din boliye service ke liye.`,
    ],
    awaiting_date: [
      (name) => `${name} ji, kya aap sun paa rahe hain? Main pooch rahi hoon — service ke liye kaunsa din theek rahega?`,
      (name) => `${name} ji, main hun. Kal, parso, somwar — koi bhi din boliye.`,
      (name) => `${name} ji, ek tarikh chahiye bas — jab bhi suvidhajanak ho, woh boliye.`,
    ],
    awaiting_date_confirm: [
      (name) => `${name} ji, kya aap sun paa rahe hain? Humne ek din select kiya tha — kya woh theek hai? Haan ya nahi boliye.`,
      (name) => `${name} ji, main hun. Jo din hamne rakha hai — kya woh pakka karun?`,
      (name) => `${name} ji, bas ek word chahiye — haan ya nahi.`,
    ],
    awaiting_branch: [
      (name) => `${name} ji, kya aap sun paa rahe hain? Machine abhi kis shehar mein hai — woh bataiye.`,
      (name) => `${name} ji, main hun. Jaipur, Kota, Ajmer, ya koi aur shehar — bas naam boliye.`,
      (name) => `${name} ji, shehar ka naam chahiye — jahan machine hai abhi.`,
    ],
    awaiting_service_details: [
      (name) => `${name} ji, kya aap sun paa rahe hain? Service ki details chahiye — kab aur kahan se karwai thi?`,
      (name) => `${name} ji, main hun. Kab karwai thi aur kahan se — woh bataiye.`,
      (name) => `${name} ji, bas service ki date aur jagah chahiye.`,
    ],
  },

  lowConfidence: (name) =>
    `${name} ji, awaaz thodi saaf nahi aayi. Kripya thoda tez awaaz se boliye.`,

  politeAskAgain: (name) =>
    `${name} ji, samajh nahi aaya. Kripya haan ya nahi boliye.`,

  technicalError: (name) =>
    `${name} ji, thodi technical dikkat aa gayi. Hum jald dobara sampark karenge. Kshama kijiye!`,

  noCallData:    () => `Namaskar ji! Data load karne mein thodi dikkat aa gayi. Kripya thodi der baad call karein. Shukriya!`,
  noSession:     () => `Namaskar ji! Session samaapt ho gaya. Kripya dobara call karein. Shukriya!`,
  missingCallSid:() => `Technical samasya aa gayi. Thodi der baad sampark karein. Shukriya!`,

  shortGreeting: (name) =>
    `${name} ji, main Priya hoon Rajesh Motors se. ` +
    `Aapki JCB machine ki service ke liye call kiya hai. ` +
    `Kya aap sun pa rahe hain?`,

  greetingConfusionLimit: (name) =>
    `${name} ji, lagta hai abhi baat karna suvidhajanak nahi hai. ` +
    `Main baad mein call karungi. Dhanyavaad!`,

  unknownFallback: (name) =>
    `${name} ji, maafi chahti hoon — samajh nahi paayi. Kripya dobaara boliye.`,

  unknownFallbackMax: (name) =>
    `${name} ji, awaaz mein kuch takleef aa rahi hai. Main baad mein aapko call karungi. Shukriya!`,
};

/* =====================================================================
   SLOW SPEECH RESPONSE ROTATOR
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
    `${name} ji, awaaz mein thodi takleef aa rahi hai. ` +
    `Main ek baar aur call karungi — aapka aashirwad chahti hoon. Shukriya!`
  );
}

/* =====================================================================
   SILENCE FALLBACK SELECTOR — Improvement #4 (v12) - FIXED BUG
   Repeats the EXACT last REAL question with rotating warm intros
   Uses lastRealMessage to avoid repeating silence prompts
   ===================================================================== */
function getSilenceFallback(session) {
  const name = session.customerName || "ji";
  const retry = session.silenceRetries || 1;

  // Get the REAL last question — never the silence prompt itself
  const lastQuestion = session.lastRealMessage || session.lastMessage || "";

  const intros = [
    `${name} ji, kya aap sun paa rahe hain? `,
    `${name} ji, main aapka intezaar kar rahi hoon — `,
    `${name} ji, ek baar aur poochh rahi hoon — `,
  ];

  const intro = intros[Math.min(retry - 1, intros.length - 1)];

  if (!lastQuestion) {
    return `${intro}Kripya haan ya nahi boliye.`;
  }

  return `${intro}Maine pucha tha — ${lastQuestion}`;
}

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
  session.lastRealMessage = greeting;
  sessionStore.set(callSid, session);

  log.info("greeting", `→ ${customerName}`, { callSid, machineModel, machineNumber });

  try {
    buildVoiceResponse({ twiml, message: greeting, actionUrl: processUrl() });
    return sendTwiML(res, twiml);
  } catch (err) {
    log.error("greeting", `Failed to build greeting response: ${err.message}`, { callSid });
    return errorResponse(res, "greeting", "Response build failed", V.shortGreeting(customerName));
  }
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

  /* Session recovery from backup */
  if (!session && fs.existsSync(SESSION_BACKUP_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SESSION_BACKUP_FILE, "utf8"));
      if (data[callSid]) {
        data[callSid].callStartedAt = new Date(data[callSid].callStartedAt);
        if (!data[callSid].lastRealMessage) {
          data[callSid].lastRealMessage = data[callSid].lastMessage || "";
        }
        sessionStore.set(callSid, data[callSid]);
        session = data[callSid];
        log.info("session", `Recovered missing session from backup: ${callSid}`);
      }
    } catch (err) {
      log.warn("session", `Failed to recover session from backup: ${err.message}`);
    }
  }

  if (!session) return errorResponse(res, "input", `No session for ${callSid}`, V.noSession());

  /* Hangup protection */
  if (session.ending) {
    log.warn("input", "Session already ending — ignoring ghost request", { callSid });
    return sendTwiML(res, new twilio.twiml.VoiceResponse());
  }

  session.totalTurns += 1;
  const name = session.customerName;

  log.info("input", `Turn ${session.totalTurns} | state: ${session.state}`, {
    callSid,
    speech:       rawSpeech.substring(0, 80),
    confidence:   confidence.toFixed(2),
    silenceRetries: session.silenceRetries,
  });

  /* Turn cap */
  if (session.totalTurns > CFG.MAX_TOTAL_TURNS) {
    const msg = V.noResponseEnd(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence: null, intent: "max_turns", systemReply: msg });
    await endSession(callSid, "max_turns", "no_response");
    buildVoiceResponse({ twiml, message: msg, actionUrl: action, hangup: true });
    return sendTwiML(res, twiml);
  }

  /* ══════════════════════════════════════════
     SILENCE HANDLING — Improvement #4
     3 patient, unique, state-aware retries
     ══════════════════════════════════════════ */
  if (!rawSpeech || rawSpeech.trim() === "") {
    session.silenceRetries += 1;
    log.warn("input", `Silence #${session.silenceRetries}/${CFG.MAX_SILENCE_RETRIES}`, { callSid });

    if (session.silenceRetries > CFG.MAX_SILENCE_RETRIES) {
      const farewell = V.noResponseEnd(name);
      appendTurn(session, { customerSaid: "", confidence: null, intent: "silence_max", systemReply: farewell });
      sessionStore.set(callSid, session);
      await endSession(callSid, "max_silence", "no_response");
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
      saveSessionBackup();
      return sendTwiML(res, twiml);
    }

    const fallback = getSilenceFallback(session);
    appendTurn(session, { customerSaid: "", confidence: null, intent: "silence", systemReply: fallback });
    session.lastMessage = fallback;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: fallback, actionUrl: action });
    saveSessionBackup();
    log.info("input", `Silence retry ${session.silenceRetries}/${CFG.MAX_SILENCE_RETRIES}`, { callSid });
    return sendTwiML(res, twiml);
  }

  session.silenceRetries = 0;

  /* ══════════════════════════════════════════
     STEP 1: GREETING CONFUSION — before NLP
     ══════════════════════════════════════════ */
  if (session.state === "awaiting_initial_decision") {
    let isGreetingConfusion = false;
    for (const pattern of GREETING_CONFUSION_PATTERNS) {
      if (pattern.test(rawSpeech)) { isGreetingConfusion = true; break; }
    }
    if (isGreetingConfusion) {
      session.confusionCount = (session.confusionCount || 0) + 1;
      log.warn("input", `Greeting confusion #${session.confusionCount}`, { callSid });

      if (session.confusionCount >= 3) {
        const farewell = V.greetingConfusionLimit(name);
        appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "greeting_confusion_max", systemReply: farewell });
        session.ending = true;
        sessionStore.set(callSid, session);
        await endSession(callSid, "greeting_confusion_max", "no_response");
        buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
        return sendTwiML(res, twiml);
      }

      // Use smart confusion response
      session.confusionStreak = (session.confusionStreak || 0) + 1;
      const confMsg = buildSmartConfusionResponse(session);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "greeting_confusion", systemReply: confMsg });
      session.lastMessage = confMsg;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: confMsg, actionUrl: action });
      return sendTwiML(res, twiml);
    }
  }

  /* ══════════════════════════════════════════
     STEP 2: PRE-NLP GARBAGE FILTER
     ══════════════════════════════════════════ */
  if (isGarbageAudio({ rawSpeech, confidence })) {
    session.confusionCount = (session.confusionCount || 0) + 1;
    log.warn("input", `Garbage audio #${session.confusionCount} | conf=${confidence.toFixed(2)} | len=${rawSpeech.length}`, { callSid });

    if (session.confusionCount >= 3) {
      const farewell = V.greetingConfusionLimit(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "garbage_audio_max", systemReply: farewell });
      session.ending = true;
      sessionStore.set(callSid, session);
      await endSession(callSid, "garbage_audio_max", "no_response");
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
      return sendTwiML(res, twiml);
    }

    const shortGreet = V.shortGreeting(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "garbage_audio", systemReply: shortGreet });
    session.lastMessage = shortGreet;
    session.lastRealMessage = shortGreet;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: shortGreet, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  session.confusionCount = 0;

  /* ══════════════════════════════════════════
     STEP 3: SIMPLE KEYWORD DETECTION
     ══════════════════════════════════════════ */
  const simpleIntent = detectSimpleIntent(rawSpeech);
  if (simpleIntent) {
    log.info("input", `Simple keyword: ${simpleIntent.source}`, { callSid });
    session.retryCount = 0;
  }

  /* ══════════════════════════════════════════
     STEP 4: NLP PROCESSING
     ══════════════════════════════════════════ */
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
    await endSession(callSid, "nlp_error", "no_response");
    buildVoiceResponse({ twiml, message: errMsg, actionUrl: action, hangup: true });
    return sendTwiML(res, twiml);
  }

  let intent = simpleIntent?.intent || nlpResult.intent || "unknown";

  /* ══════════════════════════════════════════
     STEP 5: POST-NLP UNCLEAR SPEECH
     ══════════════════════════════════════════ */
  if (shouldHandleUnclearSpeech({ rawSpeech, confidence, intent })) {
    session.slowSpeechRetries = (session.slowSpeechRetries || 0) + 1;
    log.warn("input", `Unclear speech #${session.slowSpeechRetries} | conf=${confidence.toFixed(2)}`, { callSid });

    if (session.slowSpeechRetries >= CFG.MAX_SLOW_SPEECH_RETRIES) {
      const farewell = getSlowSpeechFarewell(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "slow_speech_max", systemReply: farewell });
      session.ending = true;
      sessionStore.set(callSid, session);
      await endSession(callSid, "slow_speech_max", "no_response");
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
      return sendTwiML(res, twiml);
    }

    const slowMsg = getSlowSpeechPrompt(session);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "slow_speech", systemReply: slowMsg });
    session.lastMessage = slowMsg;
    session.lastRealMessage = slowMsg;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: slowMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  session.slowSpeechRetries = 0;

  /* ══════════════════════════════════════════
     STEP 6: RESET CONFUSION ON VALID INTENT
     ══════════════════════════════════════════ */
  if (intent !== INTENT.UNKNOWN) {
    session.confusionCount  = 0;
    session.retryCount      = 0;
    session.confusionStreak = 0;
  }

  /* ══════════════════════════════════════════
     STEP 7: STATE-AWARE INTENT OVERRIDES
     ══════════════════════════════════════════ */
  if (session.state === "awaiting_date_confirm" && intent === INTENT.RESCHEDULE) {
    log.info("input", `Converting RESCHEDULE→CONFIRM in date_confirm`, { callSid });
    intent = INTENT.CONFIRM;
  }

  if (session.state === "awaiting_date_confirm" && intent === INTENT.UNKNOWN) {
    const confirmMsg = V.confirmDate(name, session.resolvedDate?.display || session.preferredDate);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "confirm_ask", systemReply: confirmMsg });
    session.lastMessage = confirmMsg;
    session.lastRealMessage = confirmMsg;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: confirmMsg, actionUrl: action });
    saveSessionBackup();
    return sendTwiML(res, twiml);
  }

  if (session.state === "awaiting_branch" && session.assignedBranchCode &&
      (intent === INTENT.PROVIDE_BRANCH || intent === INTENT.RESCHEDULE)) {
    intent = INTENT.CONFIRM;
  }

  /* ══════════════════════════════════════════
     STEP 8: REPEAT HANDLING — Improvement #1
     ══════════════════════════════════════════ */
  if (intent === INTENT.REPEAT) {
    session.repeatCount = (session.repeatCount || 0) + 1;
    log.info("input", `Repeat request #${session.repeatCount}`, { callSid });

    let repeatMsg;
    if (session.repeatCount > CFG.MAX_REPEAT_COUNT) {
      repeatMsg = V.offerAgent(name);
      log.warn("input", `Repeat loop — offering agent`, { callSid });
    } else {
      // Smart repeat: exact last question with warm intro
      repeatMsg = buildSmartRepeatResponse(session, name);
    }

    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: repeatMsg });
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: repeatMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  session.repeatCount = 0;

  /* ══════════════════════════════════════════
     STEP 9: CONFUSION HANDLING — Improvement #2
     ══════════════════════════════════════════ */
  if (intent === INTENT.UNCLEAR || intent === INTENT.CONFUSION) {
    session.confusionStreak = (session.confusionStreak || 0) + 1;
    log.info("input", `Confusion streak #${session.confusionStreak}`, { callSid });

    const confusionMsg = buildSmartConfusionResponse(session);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: confusionMsg });
    session.lastMessage = confusionMsg;
    session.lastRealMessage = confusionMsg;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: confusionMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  session.confusionStreak = 0;

  /* Filler-word CONFIRM guard */
  if (intent === INTENT.CONFIRM && !isGenuineConfirm(rawSpeech, session.state)) {
    log.info("input", `Suppressed filler CONFIRM in state ${session.state}`, { callSid });
    const rephrase = V.politeAskAgain(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "filler_confirm", systemReply: rephrase });
    session.lastMessage = rephrase;
    session.lastRealMessage = rephrase;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: rephrase, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* Capture rejection reason */
  if ((session.state === "awaiting_reason" || session.state === "awaiting_reason_persisted") && rawSpeech) {
    session.rejectionReason = rawSpeech;
  }

  /* Capture already-done details */
  if (session.state === "awaiting_service_details" && rawSpeech) {
    session.alreadyDoneDetails = rawSpeech;
    log.info("input", `Captured already-done details: ${rawSpeech.substring(0, 80)}`, { callSid });

    if (rawSpeech.length > 3) {
      const thankYouMsg = V.alreadyDoneSaved(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "already_done_completed", systemReply: thankYouMsg });
      session.state   = "ended";
      session.ending  = true;
      sessionStore.set(callSid, session);
      await endSession(callSid, "end_already_done", "already_done");
      buildVoiceResponse({ twiml, message: thankYouMsg, actionUrl: action, hangup: true });
      saveSessionBackup();
      return sendTwiML(res, twiml);
    } else {
      const retryMsg = V.askAlreadyDoneDetails(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "already_done_retry", systemReply: retryMsg });
      session.lastMessage = retryMsg;
      session.lastRealMessage = retryMsg;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: retryMsg, actionUrl: action });
      saveSessionBackup();
      return sendTwiML(res, twiml);
    }
  }

  /* ── ALREADY DONE ── */
  if (intent === INTENT.ALREADY_DONE) {
    const detailsMsg = V.askAlreadyDoneDetails(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "already_done", systemReply: detailsMsg });
    session.state       = "awaiting_service_details";
    session.lastMessage = detailsMsg;
    session.lastRealMessage = detailsMsg;
    sessionStore.set(callSid, session);
    saveSessionBackup();
    buildVoiceResponse({ twiml, message: detailsMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* Persist date */
  let { replyText, nextState, endCall } = nlpResult;
  let { preferredDate, resolvedDate, extractedBranch } = nlpResult;

  if (preferredDate !== undefined) session.preferredDate = preferredDate;
  if (resolvedDate  !== undefined) session.resolvedDate  = resolvedDate;

  /* Persist branch */
  if (extractedBranch) {
    session.assignedBranchName = extractedBranch.name;
    session.assignedBranchCode = extractedBranch.code;
    session.assignedBranchCity = extractedBranch.city;
    session.assignedBranchAddr = extractedBranch.address || null;
    session.branchRetries = 0;
    log.info("branch", `Matched → ${extractedBranch.name} (${extractedBranch.code})`, { callSid });
  }

  /* ══════════════════════════════════════════
     STEP 10: UNKNOWN INTENT — Improvement #5
     Off-topic redirect: politely steer back to last question
     ══════════════════════════════════════════ */
  if (intent === INTENT.UNKNOWN) {
    log.warn("input", `UNKNOWN intent in state: ${session.state}`, { callSid });

    // Use off-topic redirect: re-ask last specific question
    const offTopicMsg = buildOffTopicResponse(session);
    replyText = offTopicMsg;
    nextState = session.state; // Stay in current state
    endCall   = false;
  }

  /* Branch retry guard */
  if (nextState === "awaiting_branch") {
    session.branchRetries = (session.branchRetries || 0) + 1;
    if (session.branchRetries >= 3) {
      log.warn("input", "Branch retry limit — offering agent", { callSid });
      const msg = V.offerAgent(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: msg });
      session.ending = true;
      sessionStore.set(callSid, session);
      await endSession(callSid, "branch_max_retries", "no_response");
      buildVoiceResponse({ twiml, message: msg, actionUrl: action, hangup: true });
      return sendTwiML(res, twiml);
    }
  }

  /* Persuasion counter with cap */
  if (
    (session.state === "awaiting_reason" || session.state === "awaiting_reason_persisted") &&
    nextState === "awaiting_reason_persisted"
  ) {
    session.persuasionCount = (session.persuasionCount || 0) + 1;
    log.info("input", `persuasionCount now ${session.persuasionCount}`, { callSid });

    if (session.persuasionCount >= CFG.MAX_PERSUASION) {
      log.info("input", "Max persuasion cap — ending with rejection", { callSid });
      nextState = "ended";
      endCall   = true;
    }
  }

  /* Unknown streak */
  const stateStuck = nextState === session.state &&
    ["awaiting_initial_decision","awaiting_reason","awaiting_branch"].includes(nextState);
  session.unknownStreak = stateStuck ? session.unknownStreak + 1 : 0;

  /* Voice line overrides */
  let finalReplyText = replyText || "";

  if (!finalReplyText) {
    log.warn("input", `Empty replyText from NLP for state: ${session.state}, intent: ${intent}`, { callSid });
  }

  if (nextState === "awaiting_date_confirm" && (preferredDate || session.preferredDate)) {
    const dateTok = preferredDate || session.preferredDate;
    const display = resolvedDate?.display || resolveDisplayDate(dateTok) || dateTok;
    finalReplyText = V.confirmDate(name, display);
  }

  if (nextState === "ended" && session.state === "awaiting_branch" && session.assignedBranchName) {
    const display = session.resolvedDate?.display || session.preferredDate || "nirdharit tarikh";
    finalReplyText = V.confirmBooking(name, session.assignedBranchName, session.assignedBranchCity, display);
  }

  if (nextState === "ended" && session.state === "awaiting_service_details")
    finalReplyText = V.alreadyDoneSaved(name);

  if (nextState === "awaiting_reason" && session.state === "awaiting_initial_decision")
    finalReplyText = V.askReason(name);

  if (nextState === "awaiting_date" &&
    ["awaiting_initial_decision","awaiting_reason","awaiting_reason_persisted","awaiting_date_confirm"].includes(session.state))
    finalReplyText = V.askDate(name);

  if (nextState === "awaiting_branch")
    finalReplyText = V.askBranch(name);

  if (nextState === "ended" && session.state === "awaiting_reason_persisted")
    finalReplyText = V.rejected(name);

  if (nextState === "awaiting_reason_persisted")
    finalReplyText = V.persuasionFinal(name);

  if (nextState === "awaiting_date") {
    if      (intent === INTENT.DRIVER_NOT_AVAILABLE) finalReplyText = V.objectionDriverNotAvailable(name);
    else if (intent === INTENT.MACHINE_BUSY)         finalReplyText = V.objectionMachineBusy(name);
    else if (intent === INTENT.WORKING_FINE)         finalReplyText = V.objectionWorkingFine(name);
    else if (intent === INTENT.MONEY_ISSUE)          finalReplyText = V.objectionMoneyIssue(name);
    else if (intent === INTENT.CALL_LATER)           finalReplyText = V.objectionCallLater(name);
  }

  /* Log turn */
  appendTurn(session, { customerSaid: rawSpeech, confidence, intent, systemReply: finalReplyText });

  /* Resolve outcome BEFORE mutating session.state */
  const previousState = session.state;
  let callOutcome = null;
  if (endCall || nextState === "ended") {
    callOutcome = resolveOutcome(nextState, intent, session, previousState);
    log.info("input", `Outcome: ${callOutcome} (prevState: ${previousState})`, { callSid });
  }

  /* STEP 11: GLOBAL FALLBACK — Improvement #5 continued */
  if (intent === INTENT.UNKNOWN && !(endCall || nextState === "ended")) {
    session.retryCount = (session.retryCount || 0) + 1;
    log.warn("input", `Unknown retry #${session.retryCount}`, { callSid });

    if (session.retryCount >= 3) {
      const farewell = V.unknownFallbackMax(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "unknown_max", systemReply: farewell });
      sessionStore.set(callSid, session);
      await endSession(callSid, "unknown_max", "no_response");
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
      return sendTwiML(res, twiml);
    }

    // Off-topic redirect to last question
    finalReplyText = buildOffTopicResponse(session);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "unknown_redirect", systemReply: finalReplyText });
    session.lastMessage = finalReplyText;
    session.lastRealMessage = finalReplyText;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  session.retryCount = 0;

  /* VALIDATION: Ensure finalReplyText is not empty before proceeding */
  if (!finalReplyText || typeof finalReplyText !== "string" || finalReplyText.trim().length === 0) {
    log.error("input", `finalReplyText is empty/invalid after overrides - falling back | state: ${session.state}, intent: ${intent}`, { callSid });
    finalReplyText = V.unknownFallback(name);
  }

  /* Update session state */
  session.lastMessage = finalReplyText;
  session.lastRealMessage = finalReplyText;
  session.state       = nextState;
  sessionStore.set(callSid, session);

  log.info("input", `→ ${nextState} | intent: ${intent}`, {
    callSid,
    date:         session.preferredDate           || "N/A",
    resolvedDate: session.resolvedDate?.display   || "N/A",
    iso:          session.resolvedDate?.iso        || "N/A",
    branch:       session.assignedBranchCode      || "N/A",
  });

  try {
    /* End or continue */
    if (endCall || nextState === "ended") {
      await endSession(callSid, `end_${nextState}`, callOutcome);
      buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action, hangup: true });
    } else {
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action });
    }
    return sendTwiML(res, twiml);
  } catch (err) {
    log.error("input", `Response send error: ${err.message}`, { callSid, error: err });
    const fallbackMsg = `${session.customerName} ji, thodi technical takleef aa gayi. Main dobara call karungi.`;
    await endSession(callSid, "response_error", "no_response").catch(() => {});
    return errorResponse(res, "input", `Response error: ${err.message}`, fallbackMsg);
  }
}

/* =====================================================================
   FILLER-WORD CONFIRM GUARD — copied from v10 logic
   ===================================================================== */
function isGenuineConfirm(userText, state) {
  const lower = userText.toLowerCase().trim();
  if (["awaiting_date_confirm","awaiting_initial_decision"].includes(state)) return true;
  if (STRONG_CONFIRM_TOKENS.some(t => lower.includes(t))) return true;
  const isOnlyFiller = FILLER_ONLY_TOKENS.some(
    t => lower === t || lower === t + " ji" || lower === "ji " + t
  );
  if (isOnlyFiller && ["awaiting_reason","awaiting_reason_persisted"].includes(state)) return false;
  return true;
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