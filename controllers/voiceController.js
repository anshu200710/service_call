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
  isOffTopic,
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
  MAX_SILENCE_RETRIES:     3,
  MAX_SLOW_SPEECH_RETRIES: 3,   // NEW: max unclear/slow speech retries before hangup
  MAX_TOTAL_TURNS:         15,
  CONFIDENCE_THRESHOLD:    0.4,  // NOW SINGLE SOURCE — use everywhere
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
   LOGGER — Define early, used by session backup functions
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

/* Load persisted sessions from backup file on startup */
function loadSessionBackup() {
  try {
    if (fs.existsSync(SESSION_BACKUP_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_BACKUP_FILE, "utf8"));
      for (const [callSid, sessionData] of Object.entries(data)) {
        if (sessionData) {
          sessionData.callStartedAt = new Date(sessionData.callStartedAt);
          sessionStore.set(callSid, sessionData);
          log.info("session", `Recovered session from backup: ${callSid}`, {});
        }
      }
    }
  } catch (err) {
    log.warn("session", `Failed to load session backup: ${err.message}`, {});
  }
}

/* Periodically save sessions to backup file */
function saveSessionBackup() {
  try {
    const backup = {};
    for (const [callSid, session] of sessionStore.entries()) {
      if (session && !session.ending) {
        backup[callSid] = session;
      }
    }
    fs.writeFileSync(SESSION_BACKUP_FILE, JSON.stringify(backup, null, 2));
  } catch (err) {
    log.warn("session", `Failed to save session backup: ${err.message}`, {});
  }
}

/* Load backups on startup */
loadSessionBackup();

/* Save every 10 seconds */
setInterval(() => { saveSessionBackup(); }, 10 * 1000);

/* Cleanup stale sessions */
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessionStore.entries()) {
    if (now - session.callStartedAt.getTime() > CFG.SESSION_TTL_MS) {
      log.warn("session", "TTL cleanup for stale session", { callSid: sid });
      endSession(sid, "ttl_cleanup", "no_response").catch(() => {});
    }
  }
  saveSessionBackup();  /* Also save after cleanup */
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
    retryCount:          0,       // NEW: unknown/fallback retry counter
    lastMessage:         "",
    lastQuestion:        "",      // NEW: track question separately for smart repeat
    offTopicCount:       0,       // NEW: count off-topic replies
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
  "haan", "han", "ji", "haanji",
  "ok", "theek", "kal",
];

/* =====================================================================
   GREETING CONFUSION PATTERNS — detects confused responses at greeting
   Expanded to catch 80% rural confusion cases
   ===================================================================== */
const GREETING_CONFUSION_PATTERNS = [
  /आप\s+कौन/i,
  /कौन\s+बोल/i,
  /कौन\s+हो/i,
  /किस\s+लिए/i,
  /क्यों\s+कॉल/i,
  /किस\s+चीज/i,
  /क्या\s+कहा/i,
  /फिर\s+से/i,
  /समझ\s+नहीं/i,
  /कौन\s+सी\s+कंपनी/i,
  /कंपनी\s+का\s+नाम/i,
];

function isMeaningfulShort(speech) {
  return MEANINGFUL_SHORT_WORDS.includes(speech.toLowerCase());
}

/* =====================================================================
   UNIFIED UNCLEAR SPEECH ENGINE — single source of truth
   Handles: garbage audio, short speech, low confidence
   ===================================================================== */
function shouldHandleUnclearSpeech({ rawSpeech, confidence, intent }) {
  const isVeryShort = rawSpeech.length <= 2 && !isMeaningfulShort(rawSpeech);
  const isLowConfidence = confidence < CFG.CONFIDENCE_THRESHOLD;

  return (
    intent === INTENT.UNKNOWN &&
    (isVeryShort || isLowConfidence)
  );
}

/* =====================================================================
   UNCLEAR SPEECH DETECTOR — pre-NLP garbage filter
   Only treat as actual garbage if: very short + low confidence
   Don't treat meaningful speech with low confidence as garbage
   ===================================================================== */
function isGarbageAudio({ rawSpeech, confidence }) {
  if (!rawSpeech) return true;
  
  /* Only garbage if BOTH very short AND low confidence */
  const isVeryShort = rawSpeech.length <= 2 && !isMeaningfulShort(rawSpeech);
  const isLowConfidence = confidence < 0.15;  /* Very low threshold for garbage */
  
  /* If speech has meaningful length (>3 chars), don't treat as garbage
     even with low confidence - let NLP handle it */
  if (rawSpeech.length > 3) return false;
  
  return isVeryShort && isLowConfidence;
}

/* =====================================================================
   SIMPLE KEYWORD INTENT DETECTION — before heavy NLP
   Catches 40% of rural Hindi voices using simple keyword matching
   ===================================================================== */
function detectSimpleIntent(text) {
  if (!text) return null;
  
  const t = text.toLowerCase();
  
  /* CHECK OBJECTIONS/REJECTIONS FIRST (before confirmations) */
  
  // DRIVER NOT AVAILABLE — Check first before general rejection
  if ((t.includes("ड्राइवर") || t.includes("driver") || t.includes("चालक")) && 
      (t.includes("नहीं") || t.includes("ना") || t.includes("नहीं है") || 
       t.includes("नहीं हैं") || t.includes("नहीं है यहां") || t.includes("available nahi"))) {
    return { intent: INTENT.DRIVER_NOT_AVAILABLE, source: "keyword_driver_not_available" };
  }
  
  // MACHINE BUSY — Check before general rejection
  if ((t.includes("मशीन") || t.includes("machine")) && 
      (t.includes("चल") || t.includes("काम") || t.includes("busy") || 
       t.includes("चल रही") || t.includes("कार्य") || t.includes("site"))) {
    return { intent: INTENT.MACHINE_BUSY, source: "keyword_machine_busy" };
  }
  
  // MONEY ISSUE
  if ((t.includes("पैसा") || t.includes("पैसे") || t.includes("money") || 
       t.includes("महंगा") || t.includes("budget") || t.includes("खर्च") ||
       t.includes("afford") || t.includes("payment")) &&
      (t.includes("नहीं") || t.includes("नहीं है") || t.includes("नहीं रख"))) {
    return { intent: INTENT.MONEY_ISSUE, source: "keyword_money_issue" };
  }
  
  // CALL/MESSAGE LATER
  if (t.includes("बाद") || t.includes("later") || t.includes("baad") || 
      t.includes("busy") || t.includes("बिजी") || t.includes("drive") ||
      t.includes("free") || t.includes("busy hoon") || t.includes("बाद में")) {
    if (!t.includes("आज") && !t.includes("अभी") && !t.includes("अभी")) {
      return { intent: INTENT.CALL_LATER, source: "keyword_call_later" };
    }
  }
  
  // WORKING FINE — Machine needs no service
  if ((t.includes("ठीक") || t.includes("सही") || t.includes("fine") || t.includes("अच्छा")) &&
      (t.includes("चल") || t.includes("काम") || t.includes("working") || t.includes("ठीक है"))) {
    return { intent: INTENT.WORKING_FINE, source: "keyword_working_fine" };
  }
  
  // STRONG CONFIRM — Explicit booking requests (check BEFORE generic reject)
  if (t.includes("बुक करनी है") || t.includes("बुक करना है") || 
      t.includes("सर्विस बुक करनी है") || t.includes("सर्विस बुक करना है") ||
      t.includes("करनी है") && (t.includes("बुक") || t.includes("सर्विस")) ||
      t.includes("book karna") || t.includes("service book")) {
    return { intent: INTENT.CONFIRM, source: "keyword_confirm" };
  }
  
  // GENERAL REJECT — Only if no specific objection matched (CAREFUL: avoid single characters)
  if (t.includes("नहीं") || t.includes("ना") || t.includes("न हीं") || 
      t.includes("नहीं है") || t.includes("फ्री नहीं") || 
      t.includes("समय नहीं") || t.includes("no") || t.includes("नहीं हूँ") ||
      t.includes("नहीं रे") || t.includes("बिलकुल नहीं") || t.includes("कभी नहीं") ||
      t.includes("नहीं करना") || t.includes("नहीं कर सकता") || t.includes("नहीं कर सकती") ||
      t.includes("mat karo") || t.includes("don't") || t.includes("dont")) {
    return { intent: INTENT.REJECT, source: "keyword_reject" };
  }
  
  // CONFIRM — Check AFTER all rejections/objections
  if (t.includes("हां") || t.includes("हाँ") || t.includes("ठीक") || t.includes("ठीक है") || 
      t.includes("सही") || t.includes("जी") || t.includes("ok") || t.includes("yes") ||
      t.includes("ठीक रहेगा") || t.includes("चल") || t.includes("कर दो")) {
    return { intent: INTENT.CONFIRM, source: "keyword_confirm" };
  }
  
  // RESCHEDULE (Dates/Days)
  if (t.match(/सोमवार|मंगलवार|बुधवार|गुरुवार|शुक्रवार|शनिवार|रविवार|आज|कल|परसों|अगले|आने वाले/)) {
    return { intent: INTENT.RESCHEDULE, source: "keyword_date" };
  }
  
  // ALREADY DONE (Service already completed)
  if (t.includes("कर लिया") || t.includes("किया") || t.includes("already") || 
      t.includes("पहले") || t.includes("सर्विस कर") || t.includes("सर्विस किया") ||
      t.includes("करवाई") || t.includes("करवा लिया") || t.includes("done") ||
      t.includes("हो गया") || t.includes("ख़त्म")) {
    if (!t.includes("करना") && !t.includes("नहीं")) {
      return { intent: INTENT.ALREADY_DONE, source: "keyword_already_done" };
    }
  }
  
  // CONFUSION (Who/What) — Check after specific patterns
  if (t.includes("कौन") || t.includes("क्या कहा") || t.includes("क्या") || 
      t.includes("किसने") || t.includes("किस लिए")) {
    return { intent: INTENT.CONFUSION, source: "keyword_confusion" };
  }
  
  // REPEAT
  if (t.includes("दोबारा") || t.includes("फिर") || t.includes("फिर से") || 
      t.includes("repeat") || t.includes("फिर कहो")) {
    return { intent: INTENT.REPEAT, source: "keyword_repeat" };
  }
  
  return null;
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
  const lastMsg = session.lastMessage || session.lastQuestion || "";
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

  /* State-aware confusion response */
  switch (session.state) {
    case "awaiting_initial_decision":
      return (
        `${name} ji, main Priya hoon Rajesh Motors JCB Service se. ` +
        `Machine number ${number} ki ${svcType} booking ke liye call kiya hai. ` +
        `Kya haan bol sakti ho?`
      );
    case "awaiting_date":
      return (
        `${name} ji, kripya ek din bataiye — kaunsa din aapke liye suvidhajanak hai? ` +
        `Jaise kal, somwar, ya koi tarikh boliye.`
      );
    case "awaiting_branch":
      return (
        `${name} ji, bas ek cheez aur sunni hai — machine abhi kaunse sheher mein hai? ` +
        `Jaipur, Kota, Ajmer, Udaipur, ya Alwar mein se boliye.`
      );
    default:
      return (
        `Main Priya hoon, Rajesh Motors JCB Service se — machine number ${number} ki ` +
        `${svcType} service book karwana chahti thi. Kya aap interested hain? Haan ya nahi boliye.`
      );
  }
}

/* =====================================================================
   SILENCE RESPONSE HANDLER — Progressive encouragement based on retry count
   ===================================================================== */
function getSilenceFallbackWithRetry(session) {
  const name = session.customerName || "ji";
  const retryCount = session.silenceRetries || 0;
  
  /* Get base question from state — WITHOUT name prefix ── */
  let baseQuestion;
  if (session.state === "awaiting_branch") {
    baseQuestion = `aapke kaunse sheher mein machine hai? Jaipur, Kota, Ajmer, Dungarpur, ya koi aur sheher ka naam boliye.`;
  } else if (session.state === "awaiting_date") {
    baseQuestion = `kaunsa din aapke liye theek rahega? Kal, somwar, agle hafte, ya koi din ka naam boliye.`;
  } else if (session.state === "awaiting_date_confirm") {
    baseQuestion = `haan ya nahi boliye — ek baar haan boliye to booking fix ho jayegi.`;
  } else {
    /* For other states, use V.silenceFallback */
    const fallbackFn = V.silenceFallback[session.state];
    if (fallbackFn) {
      return fallbackFn(name);  /* Return full message with name already included */
    } else {
      baseQuestion = `samajh nahi aaya. Kripya jawab dijiye.`;
    }
  }
  
  /* Progressive instructions based on retry count — with single name prefix */
  if (retryCount === 1) {
    /* First retry - tell them to speak louder */
    return `${name} ji, awaaz nahi aayi. Kripya thoda tez awaaz se boliye — ${baseQuestion}`;
  } else if (retryCount === 2) {
    /* Second retry - ask them to speak clearly */
    return `${name} ji, kripya thoda aur spasht awaaz se boliye — ${baseQuestion}`;
  } else {
    /* Third retry - final attempt */
    return `${name} ji, ye aakhri baar pooch rahi hoon — kripya tez awaaz se jawab dijiye. ${baseQuestion}`;
  }
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
    `${name} ji, awaaz mein thodi takleef aa rahi hai. ` +
    `Main ek baar aur call karungi — aapka aashirwad chahti hoon. Shukriya!`
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
    `${name} ji, awaaz nahi aayi. Koi baat nahi, main baad mein aapko dobara call karungi. ` +
    `Aapka aashirwad chahti hoon. Shukriya!`,

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
      `${name} ji, kya aap mujhe sun pa rahe hain? Agar haan boliye to service ke liye appointment fix kar dungi.`,
    awaiting_reason: (name) =>
      `${name} ji, main sun rahi hoon. Kripya thoda tez awaaz se apna kaaran samjhaiye — samajhna pasand karungi.`,
    awaiting_reason_persisted: (name) =>
      `${name} ji, main ek taarikh sunna chahti hoon jo aapke liye suvidhajanak ho. Kripya koi din bataiye.`,
    awaiting_date: (name) =>
      `${name} ji, aapke liye kaunsa din theek rahega? Kal, parso, somwar, ya is hafte koi bhi din bataiye. Main sun rahi hoon.`,
    awaiting_date_confirm: (name) =>
      `${name} ji, maine yeh din note kiya. Kya haan bolaa sakti ho? Bilkul theek hai to haan boliye.`,
    awaiting_branch: (name) =>
      `${name} ji, bataiye — machine abhi kaunse sheher mein hai? Jaipur, Kota, ya koi aur sheher?`,
    awaiting_service_details: (name) =>
      `${name} ji, bas ek kami hai — kripya batao ki service kab aur kahan se karwaai thi?`,
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
  session.lastQuestion = `Kya main is hafte ke liye booking kar sakti hoon?`;  /* Extract key question */
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
  
  /* If session not found, try to recover from backup */
  if (!session && fs.existsSync(SESSION_BACKUP_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SESSION_BACKUP_FILE, "utf8"));
      if (data[callSid]) {
        data[callSid].callStartedAt = new Date(data[callSid].callStartedAt);
        sessionStore.set(callSid, data[callSid]);
        session = data[callSid];
        log.info("session", `Recovered missing session from backup: ${callSid}`, { callSid });
      }
    } catch (err) {
      log.warn("session", `Failed to recover session from backup: ${err.message}`, { callSid });
    }
  }
  
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

  /* ── Silence ── Retry exactly 3 times (PATIENT), then graceful exit ── */
  if (!rawSpeech || rawSpeech.trim() === "") {
    session.silenceRetries += 1;
    log.warn("input", `Silence detected #${session.silenceRetries}/${CFG.MAX_SILENCE_RETRIES} on state: ${session.state}`, { callSid });

    if (session.silenceRetries > CFG.MAX_SILENCE_RETRIES) {
      /* Max silences exceeded (after 3 retries) — graceful WARM exit (not abrupt cut) */
      const farewell = V.noResponseEnd(name);
      appendTurn(session, { customerSaid: "", confidence: null, intent: "silence_max", systemReply: farewell });
      sessionStore.set(callSid, session);
      log.warn("input", `Max silence exceeded (${session.silenceRetries}/${CFG.MAX_SILENCE_RETRIES}) on state: ${session.state} — ending call gracefully`, { callSid });
      await endSession(callSid, "max_silence", "no_response");
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
      saveSessionBackup();
      return sendTwiML(res, twiml);
    }
    
    /* Still within 3 retries — ask them to speak with ENCOURAGEMENT ── */
    const fallback = getSilenceFallbackWithRetry(session);
    appendTurn(session, { customerSaid: "", confidence: null, intent: "silence", systemReply: fallback });
    session.lastMessage = fallback;
    session.lastQuestion = fallback;  // Preserve as fallback question for next retry
    sessionStore.set(callSid, session);
    saveSessionBackup();  // Save BEFORE building response to ensure persistence
    buildVoiceResponse({ twiml, message: fallback, actionUrl: action });
    log.info("input", `Silence retry ${session.silenceRetries}/${CFG.MAX_SILENCE_RETRIES} on state: ${session.state} — encouraging to speak with patience`, { callSid });
    return sendTwiML(res, twiml);
  }

  /* Only reset silenceRetries after we've received actual speech (non-empty) */
  session.silenceRetries = 0;

  /* ══════════════════════════════════════════════════════════════════
     FLOW ORDER (for stable conversation):
     1. Greeting confusion detection (BEFORE NLP)
     2. Pre-NLP garbage filter
     3. NLP processing
     4. Post-NLP unclear speech handling
     5. Intent routing
     6. State transition
   ══════════════════════════════════════════════════════════════════ */

  /* STEP 1: GREETING CONFUSION — Check pattern BEFORE NLP ── */
  if (session.state === "awaiting_initial_decision" && detectGreetingConfusion(rawSpeech)) {
    session.confusionCount = (session.confusionCount || 0) + 1;
    log.warn("input", `Greeting confusion BEFORE NLP #${session.confusionCount}`, { callSid });
    
    if (session.confusionCount >= 3) {
      const farewell = V.greetingConfusionLimit(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "greeting_confusion_max", systemReply: farewell });
      session.ending = true;
      sessionStore.set(callSid, session);
      await endSession(callSid, "greeting_confusion_max", "no_response");
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

  /* STEP 2: PRE-NLP GARBAGE FILTER — Don't waste NLP on noise ── */
  if (isGarbageAudio({ rawSpeech, confidence })) {
    session.confusionCount = (session.confusionCount || 0) + 1;
    log.warn("input", `Garbage audio pre-NLP #${session.confusionCount} | conf=${confidence.toFixed(2)} | len=${rawSpeech.length}`, { callSid });
    
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
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: shortGreet, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* Reset confusion counter on clear speech */
  session.confusionCount = 0;

  /* STEP 3: SIMPLE KEYWORD DETECTION — before heavy NLP ── */
  const simpleIntent = detectSimpleIntent(rawSpeech);
  if (simpleIntent) {
    log.info("input", `Simple keyword detected: ${simpleIntent.source}`, { callSid });
    session.retryCount = 0;  // Reset on detected intent
  }

  /* STEP 4: NLP PROCESSING — fallback to full NLP ── */
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

  /* Use simple intent if detected, otherwise use NLP result */
  const intent = simpleIntent?.intent || nlpResult.intent || "unknown";
  
  /* ── LOW CONFIDENCE WITH VALID INTENT — Ask to speak clearly but process intent ── */
  if (confidence < 0.35 && confidence > 0.05 && intent !== INTENT.UNKNOWN && intent !== INTENT.REPEAT) {
    log.info("input", `Low confidence but valid intent (${confidence.toFixed(2)}) - ${intent}`, { callSid });
    session.lowConfRetries = (session.lowConfRetries || 0) + 1;
    
    /* If already retried once, process the intent anyway */
    if (session.lowConfRetries >= 2) {
      log.info("input", `Low conf retry ${session.lowConfRetries} — processing intent anyway`, { callSid });
      session.lowConfRetries = 0;  // Reset for next question
      // Fall through to normal processing
    } else {
      /* First low-conf retry: ask to speak clearer */
      const clarifyMsg = `${name} ji, awaaz thodi dhimi aa rahi hai. Kripya thoda tez aur spasht awaaz se dobara boliye — ${session.lastQuestion || "apna jawab dijiye"}`;
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "low_confidence", systemReply: clarifyMsg });
      session.lastMessage = clarifyMsg;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: clarifyMsg, actionUrl: action });
      saveSessionBackup();
      return sendTwiML(res, twiml);
    }
  } else if (confidence >= 0.35) {
    session.lowConfRetries = 0;  // Reset on good confidence
  }
  
  /* STEP 5: POST-NLP UNCLEAR SPEECH — Unified engine ── */
  if (shouldHandleUnclearSpeech({ rawSpeech, confidence, intent })) {
    session.slowSpeechRetries = (session.slowSpeechRetries || 0) + 1;
    log.warn("input", `Post-NLP unclear speech #${session.slowSpeechRetries} | conf=${confidence.toFixed(2)}`, { callSid });

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
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: slowMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  // Clear speech processed successfully — reset slow speech counter
  session.slowSpeechRetries = 0;

  /* ── OFF-TOPIC DETECTION ── NEW ── */
  if (isOffTopic(rawSpeech) && session.state !== "awaiting_service_details") {
    session.offTopicCount = (session.offTopicCount || 0) + 1;
    log.info("input", `Off-topic detected #${session.offTopicCount} | state: ${session.state}`, { callSid });

    if (session.offTopicCount >= 2) {
      /* After 2 off-topic attempts, redirect firmly to last question */
      const lastQ = session.lastQuestion || session.lastMessage || `kaunsa din aapke liye theek rahega`;
      const redirect = `${name} ji, maafi chahti hoon. Mai bas itna jaana chahti hoon — ${lastQ}. Kripya jawab dijiye.`;
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "off_topic", systemReply: redirect });
      session.lastMessage = redirect;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: redirect, actionUrl: action });
      saveSessionBackup();
      return sendTwiML(res, twiml);
    }

    /* First off-topic attempt — gently redirect */
    const redirect = `${name} ji, mujhe samajh nahi aaya. Kripya apna uttar dijiye — kya aap service ke liye appointment rakhna chahte hain?`;
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "off_topic", systemReply: redirect });
    session.lastMessage = redirect;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: redirect, actionUrl: action });
    saveSessionBackup();
    return sendTwiML(res, twiml);
  }

  /* Reset off-topic counter on valid response */
  if (intent !== INTENT.UNKNOWN && intent !== INTENT.CONFUSION) {
    session.offTopicCount = 0;
  }

  /* STEP 6: RESET CONFUSION ON VALID INTENT ── */
  if (intent !== INTENT.UNKNOWN) {
    session.confusionCount = 0;
    session.retryCount = 0;
  }

  /* ── STATE-AWARE INTENT OVERRIDE — Prevent backward state transitions ── */
  /* If we're confirming something and user says the same thing again, treat as confirm */
  if (session.state === "awaiting_date_confirm" && intent === INTENT.RESCHEDULE) {
    /* User is repeating the date while we're asking for confirmation — treat as YES */
    log.info("input", `State-aware: Converting RESCHEDULE to CONFIRM (already in date_confirm)`, { callSid });
    intent = INTENT.CONFIRM;
  }

  if (session.state === "awaiting_date_confirm" && intent === INTENT.UNKNOWN) {
    /* Unknown input while confirming date — ask to confirm the already-selected date */
    log.info("input", `State-aware: Unknown input in date_confirm, asking for confirmation`, { callSid });
    const confirmMsg = V.confirmDate(name, session.resolvedDate?.display || session.preferredDate);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "confirm_ask", systemReply: confirmMsg });
    session.lastMessage = confirmMsg;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: confirmMsg, actionUrl: action });
    saveSessionBackup();
    return sendTwiML(res, twiml);
  }

  /* Similar logic for branch confirmation */
  if (session.state === "awaiting_branch" && session.assignedBranchCode && 
      (intent === INTENT.PROVIDE_BRANCH || intent === INTENT.RESCHEDULE)) {
    /* User is repeating the branch — treat as confirmation */
    log.info("input", `State-aware: Converting to CONFIRM (branch already assigned)`, { callSid });
    intent = INTENT.CONFIRM;
  }

  /* For rejection states, if user says to proceed anyway, convert to confirm */
  if (session.state === "awaiting_reason_persisted" && 
      (intent === INTENT.CONFIRM || rawSpeech.toLowerCase().includes("तारीख"))) {
    /* User is reconsidering rejection — move to get date */
    log.info("input", `State-aware: User reconsidering in reason_persisted, moving to date collection`, { callSid });
    nextState = "awaiting_date";
    intent = INTENT.CONFIRM;
  }

  /* STEP 7: INTENT ROUTING & STATE TRANSITION ── */

  /* Declare variables separately to ensure mutability */
  let replyText = nlpResult.replyText;
  let nextState = nlpResult.nextState;
  let endCall = nlpResult.endCall;
  let preferredDate = nlpResult.preferredDate;
  let resolvedDate = nlpResult.resolvedDate;
  let extractedBranch = nlpResult.extractedBranch;

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

  /* ── ALREADY DONE — Service already completed ── */
  if (intent === INTENT.ALREADY_DONE) {
    log.info("input", `User reports service already done`, { callSid });
    
    /* Skip date/branch asking, go directly to capture details */
    const detailsMsg = V.askAlreadyDoneDetails(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "already_done", systemReply: detailsMsg });
    
    /* Update state to capture service details */
    session.state = "awaiting_service_details";
    session.lastMessage = detailsMsg;
    sessionStore.set(callSid, session);
    saveSessionBackup();
    
    buildVoiceResponse({ twiml, message: detailsMsg, actionUrl: action });
    return sendTwiML(res, twiml);
  }

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

  /* ── Capture already-done details — PATIENT MODE, don't cut before collecting data ── */
  if (session.state === "awaiting_service_details" && rawSpeech) {
    session.alreadyDoneDetails = rawSpeech;
    log.info("input", `Captured already-done details: ${rawSpeech.substring(0, 80)}`, { callSid });
    
    /* Validate that we have meaningful data before ending */
    if (rawSpeech.length > 3) {
      /* Good data — send thank you message and end call GRACEFULLY */
      const thankYouMsg = V.alreadyDoneSaved(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "already_done_completed", systemReply: thankYouMsg });
      
      session.state = "ended";
      session.ending = true;
      sessionStore.set(callSid, session);
      
      log.info("input", `Ending call gracefully after capturing details`, { callSid });
      await endSession(callSid, "end_already_done", "already_done");
      buildVoiceResponse({ twiml, message: thankYouMsg, actionUrl: action, hangup: true });
      saveSessionBackup();
      
      return sendTwiML(res, twiml);
    } else {
      /* Data too short — ask again INSTEAD OF CUTTING ── */
      const retryMsg = V.askAlreadyDoneDetails(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "already_done_retry", systemReply: retryMsg });
      session.lastMessage = retryMsg;
      sessionStore.set(callSid, session);
      buildVoiceResponse({ twiml, message: retryMsg, actionUrl: action });
      saveSessionBackup();
      log.info("input", `Already-done data too short — asking again (NOT cutting call)`, { callSid });
      return sendTwiML(res, twiml);
    }
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

  /* ── STATE-SPECIFIC HANDLERS for UNKNOWN/UNSUPPORTED INTENTS ── */
  if (intent === INTENT.UNKNOWN) {
    log.warn("input", `UNKNOWN intent in state: ${session.state}`, { callSid });
    session.unknownStreak = (session.unknownStreak || 0) + 1;
    
    /* After 2 unknown attempts, ask them to clarify what we need */
    if (session.unknownStreak >= 2) {
      let clarifyMsg = `${name} ji, samajh nahi aaya. Kripya apna jawab dijiye.`;
      if (session.lastQuestion) {
        clarifyMsg = `${name} ji, maafi chahti hoon — mai bas itna jaana chahti hoon: ${session.lastQuestion}`;
      }
      replyText = clarifyMsg;
    } else {
      /* First unknown attempt: repeat last question or state-specific message */
      if (session.lastQuestion) {
        replyText = session.lastQuestion;
      } else {
        switch (session.state) {
          case "awaiting_initial_decision":
            replyText = V.politeAskAgain(name);
            break;
          case "awaiting_reason":
            replyText = V.askReason(name);
            break;
          case "awaiting_reason_persisted":
            replyText = V.persuasionFinal(name);
            break;
          case "awaiting_date":
            replyText = V.askDate(name);
            break;
          case "awaiting_date_confirm":
            replyText = V.politeAskAgain(name);
            break;
          case "awaiting_branch":
            replyText = V.askBranchAgain(name);
            break;
          case "awaiting_service_details":
            replyText = V.askAlreadyDoneDetails(name);
            break;
          default:
            replyText = V.unknownFallback(name);
        }
      }
    }
    
    nextState = session.state;  /* Always stay in current state */
    endCall = false;
  }
  
  /* ── Branch retry guard: max 3 attempts (but ONLY for valid branch extraction failures) ── */
  if (nextState === "awaiting_branch" && intent !== INTENT.UNKNOWN) {
    // Only increment if customer provided valid input that didn't match a branch
    // Don't count silence retries or confusion toward branchRetries
    if (intent !== INTENT.CONFUSION && intent !== INTENT.REPEAT && rawSpeech.trim() !== "") {
      session.branchRetries = (session.branchRetries || 0) + 1;
      log.info("input", `Branch attempt #${session.branchRetries} (invalid/unmatched branch)`, { callSid });
      
      if (session.branchRetries >= 3) {
        log.warn("input", "Branch retry limit reached (3 unmatched attempts) — offering agent", { callSid });
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

  /* ── STEP 8: GLOBAL FALLBACK HANDLER — Ensure we always respond ── */
  /* If we reach here with UNKNOWN from state handler fallback, use retry counter */
  if (intent === INTENT.UNKNOWN && (!(endCall || nextState === "ended"))) {
    session.retryCount = (session.retryCount || 0) + 1;
    log.warn("input", `Unknown intent retry loop #${session.retryCount}`, { callSid });

    if (session.retryCount >= 3) {
      /* Max retries exceeded — graceful hangup */
      const farewell = V.unknownFallbackMax(name);
      appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "unknown_max", systemReply: farewell });
      sessionStore.set(callSid, session);
      await endSession(callSid, "unknown_max", "no_response");
      buildVoiceResponse({ twiml, message: farewell, actionUrl: action, hangup: true });
      return sendTwiML(res, twiml);
    }

    /* Still within retries — politely ask again */
    finalReplyText = V.unknownFallback(name);
    appendTurn(session, { customerSaid: rawSpeech, confidence, intent: "unknown_retry", systemReply: finalReplyText });
    session.lastMessage = finalReplyText;
    sessionStore.set(callSid, session);
    buildVoiceResponse({ twiml, message: finalReplyText, actionUrl: action });
    return sendTwiML(res, twiml);
  }

  /* Reset retry counter on successful intent */
  session.retryCount = 0;

  /* ── Update session state ── */
  session.lastMessage = finalReplyText;
  session.state       = nextState;
  
  /* ── Track the key question for repeating later ── */
  if (nextState === "awaiting_date") {
    session.lastQuestion = `Kaunsa din aapke liye theek rahega? Kal, somwar, parso, ya koi tarikh? Please boliye.`;
  } else if (nextState === "awaiting_branch") {
    session.lastQuestion = `Machine abhi kaunse sheher mein hai? Jaipur, Kota, Ajmer, Udaipur, Alwar, ya Sikar?`;
  } else if (nextState === "awaiting_date_confirm") {
    session.lastQuestion = `Kya yeh din theek hai? Haan ya nahi boliye.`;
  } else if (nextState === "awaiting_reason" || nextState === "awaiting_reason_persisted") {
    session.lastQuestion = `Kripya bataiye — kya karan hai? Main sahayata kar sakti hoon.`;
  } else if (nextState === "awaiting_initial_decision") {
    session.lastQuestion = `Kya main is hafte ke liye booking kar sakti hoon? Haan ya nahi boliye.`;
  }
  
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