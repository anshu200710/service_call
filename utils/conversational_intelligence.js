/**
 * conversational_intelligence.js
 * ================================
 * Production-grade rule-based NLP for JCB outbound service reminder calls.
 *
 * Exports:
 *   processUserInput(userText, sessionData)
 *   → { replyText, nextState, endCall, preferredDate, resolvedDate, intent }
 *
 *   extractPreferredDate(raw) → string | null
 *   INTENT                   — intent enum
 *
 * CHANGE LOG (v3):
 *   • extractPreferredDate now matches "22 तारीख" (number BEFORE the word)
 *     in addition to "तारीख 22" — fixes the bug seen in turn logs.
 *   • processUserInput now returns `resolvedDate` — a fully resolved
 *     calendar object { display, iso, raw } from dateResolver.js
 *     so voice.service.js can store "Monday, 3 March 2025" in MongoDB.
 */

import { resolveDate } from './dateResolver.js';

/* =====================================================================
   INTENT ENUM
   ===================================================================== */
export const INTENT = {
  CONFIRM:    'confirm',
  REJECT:     'reject',
  BUSY:       'busy',
  RESCHEDULE: 'reschedule',
  CONFUSION:  'confusion',
  REPEAT:     'repeat',
  UNCLEAR:    'unclear',
  UNKNOWN:    'unknown',
};

/* =====================================================================
   TEXT NORMALISER
   ===================================================================== */
function normalise(raw) {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* =====================================================================
   KEYWORD PATTERN TABLES
   ===================================================================== */
const REPEAT_PATTERNS = [
  'dobara boliye', 'dobara bolo', 'phir se boliye', 'phir se bolo',
  'fir se bolo', 'ek baar aur', 'kya kaha', 'kya kaha aapne',
  'kya bola', 'kya bol raha', 'suna nahi', 'sunai nahi',
  'awaz nahi', 'awaaz nahi', 'samjha nahi suna',
  'clear nahi tha', 'clear nahi suna', 'repeat karo',
  'repeat karein', 'repeat please', 'say again',
  'thoda dheere', 'dheere boliye', 'jaldi mat boliye',
  'nahi suna', 'kuch nahi suna',
  'दोबारा बोलो', 'दोबारा बोलिए', 'फिर से बोलो', 'फिर बोलो',
  'एक बार और', 'क्या कहा', 'क्या बोले', 'नहीं सुना',
  'आवाज़ नहीं', 'समझ नहीं सुना', 'धीरे बोलिए', 'साफ बोलिए',
];

const CONFUSION_PATTERNS = [
  'kaunsi machine', 'konsi machine', 'kaun si machine',
  'kaunsa service', 'konsa service', 'meri machine nahi',
  'galat machine', 'galat number', 'yeh meri nahi',
  'samjha nahi', 'samjhi nahi', 'samajh nahi aaya',
  'samajh nahi', 'nahi samjha', 'nahi samjhi',
  'kya matlab', 'kya bol rahe', 'kya pooch rahe',
  'kya hai yeh', 'kon hai', 'kaun bol raha',
  'kaun baat kar raha', 'kya yeh sahi hai', 'galat call',
  'wrong number', 'yeh kya hai', 'mujhe nahi pata',
  'pata nahi', 'explain karo', 'samjhao',
  'कौन सी मशीन', 'कौन सा सर्विस', 'मेरी मशीन नहीं',
  'गलत मशीन', 'गलत नंबर', 'यह मेरी नहीं',
  'समझ नहीं', 'नहीं समझा', 'क्या मतलब',
  'क्या बोल रहे', 'क्या यह सही है', 'गलत कॉल',
  'यह क्या है', 'मुझे नहीं पता',
];

const CONFIRM_PATTERNS = [
  'haan ji bilkul', 'ji haan zaroor', 'bilkul theek hai',
  'haan book karo', 'book kar do', 'book kardo', 'book kar',
  'book karo', 'confirm karo', 'confirm kar do',
  'karwa do', 'karvao', 'karwa lo',
  'zaroor karo', 'haan zaroor', 'please book',
  'haan ji', 'ji haan', 'ji ha',
  'theek hai', 'theek h', 'thik hai',
  'bilkul', 'zaroor', 'sahi hai',
  'acha', 'accha', 'achha', 'achcha',
  'haan', 'haa', 'han',
  'ok', 'okay', 'yes', 'yep', 'done', 'perfect', 'hmm',
  'confirm',
  'हाँ बुक करो', 'बुक कर दो', 'बुक करो', 'कन्फर्म करो',
  'करवा दो', 'करवाओ', 'ज़रूर करो',
  'हाँ जी', 'जी हाँ', 'बिल्कुल', 'ज़रूर',
  'ठीक है', 'सही है', 'अच्छा', 'हाँ', 'हां',
  'ओके',
];

const REJECT_PATTERNS = [
  'nahi chahiye abhi', 'abhi nahi karna', 'nahi karna hai',
  'nahi book karna', 'book nahi karna', 'cancel kar do',
  'nahi chahiye', 'nahi karna',
  'mat karo', 'mat kar', 'rehne do', 'rehne de',
  'chhod do', 'band karo', 'zaroorat nahi',
  'need nahi', 'mat karna', 'abhi nahi',
  'nahi', 'nahin', "don't", 'dont',
  'no', 'nope', 'cancel',
  'नहीं चाहिए', 'नहीं करना', 'मत करो', 'मत कर',
  'छोड़ दो', 'बंद करो', 'ज़रूरत नहीं',
  'अभी नहीं', 'कैंसल कर दो', 'नहीं', 'ना',
];

const BUSY_PATTERNS = [
  'abhi nahi baad mein call karo', 'baad mein call karo',
  'baad mein baat karo', 'phir se call karo',
  'busy hoon abhi', 'busy hun abhi',
  'drive kar raha hoon', 'gaadi chala raha hoon',
  'meeting mein hoon', 'kaam chal raha hai',
  'site par hoon', 'bahar hoon',
  'thodi der baad', 'kuch time baad',
  'later karo', 'call back karo',
  'dobaara call', 'phir call', 'phir karo',
  'free nahi', 'waqt nahi', 'busy hoon', 'busy hun',
  'busy hai', 'baad mein', 'baad me',
  'बाद में कॉल करो', 'बाद में बात करो',
  'बिज़ी हूँ अभी', 'गाड़ी चला रहा हूँ',
  'मीटिंग में हूँ', 'काम चल रहा है',
  'साइट पर हूँ', 'थोड़ी देर बाद',
  'बाद में', 'खाली नहीं', 'वक्त नहीं',
];

const RESCHEDULE_PATTERNS = [
  'date change kar do', 'date badal do', 'date badlo',
  'schedule badal do', 'schedule badlo', 'reschedule karo',
  'koi aur din', 'dusra din', 'aur koi din',
  'baad ki date', 'agle mahine', 'next month',
  'agle hafte', 'agle week', 'next week',
  'ek hafte baad', 'do din baad', 'teen din baad',
  'kal karo', 'parso karo',
  'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday',
  'somwar', 'mangalwar', 'budhwar', 'guruwar',
  'shukrawar', 'shaniwar', 'raviwar',
  'tarikh', 'reschedule', 'time change', 'kal', 'parso',
  'तारीख बदल दो', 'तारीख बदलो', 'शेड्यूल बदलो',
  'रीशेड्यूल करो', 'कोई और दिन', 'दूसरा दिन',
  'अगले महीने', 'अगले हफ्ते', 'दो दिन बाद',
  'तीन दिन बाद', 'एक हफ्ते बाद',
  'कल करो', 'परसों करो', 'कल', 'परसों',
  'सोमवार', 'मंगलवार', 'बुधवार', 'गुरुवार',
  'शुक्रवार', 'शनिवार', 'रविवार',
  // ✅ FIX: also detect bare date numbers as reschedule signals
  'तारीख', 'tarikh',
];

/* =====================================================================
   DATE EXTRACTION
   Extracts a raw date token from speech.
   resolveDate() in dateResolver.js converts it to a real calendar date.
   ─────────────────────────────────────────────────────────────────────
   FIX v3: Added pattern for "22 तारीख" (number BEFORE the Hindi word).
   Previously only "तारीख 22" was matched — this caused the bug where
   "22 तारीख के लिए बुक कर दो" returned null.
   ===================================================================== */

const HINDI_MONTH_MAP = {
  'january':'जनवरी', 'february':'फरवरी', 'march':'मार्च',
  'april':'अप्रैल', 'may':'मई',           'june':'जून',
  'july':'जुलाई',   'august':'अगस्त',     'september':'सितंबर',
  'october':'अक्टूबर','november':'नवंबर', 'december':'दिसंबर',
};

const DAY_LABEL_MAP = {
  'kal':          'कल',          'parso':         'परसों',
  'agle hafte':   'अगले हफ्ते', 'agle week':     'अगले हफ्ते',
  'next week':    'अगले हफ्ते', 'agle mahine':   'अगले महीने',
  'next month':   'अगले महीने', 'do din baad':   '2 दिन बाद',
  'teen din baad':'3 दिन बाद',  'ek hafte baad': '1 हफ्ते बाद',
  'monday':       'सोमवार',     'tuesday':       'मंगलवार',
  'wednesday':    'बुधवार',     'thursday':      'गुरुवार',
  'friday':       'शुक्रवार',   'saturday':      'शनिवार',
  'sunday':       'रविवार',
  'somwar':       'सोमवार',     'mangalwar':     'मंगलवार',
  'budhwar':      'बुधवार',     'guruwar':       'गुरुवार',
  'shukrawar':    'शुक्रवार',   'shaniwar':      'शनिवार',
  'raviwar':      'रविवार',
  // Devanagari pass-through
  'कल':           'कल',         'परसों':         'परसों',
  'सोमवार':       'सोमवार',    'मंगलवार':       'मंगलवार',
  'बुधवार':       'बुधवार',    'गुरुवार':        'गुरुवार',
  'शुक्रवार':     'शुक्रवार',  'शनिवार':        'शनिवार',
  'रविवार':       'रविवार',    'अगले हफ्ते':    'अगले हफ्ते',
  'अगले महीने':   'अगले महीने',
};

export function extractPreferredDate(raw) {
  if (!raw) return null;
  const t = normalise(raw);

  // 1. Numeric "15/06", "15-06", "15/06/2025"
  const numSlash = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?\b/);
  if (numSlash) return `${numSlash[1]}/${numSlash[2]}`;

  // 2. "15 march", "15 अप्रैल"
  const dayMonth = t.match(
    /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/
  );
  if (dayMonth) {
    const hindiMonth = HINDI_MONTH_MAP[dayMonth[2]] || dayMonth[2];
    return `${dayMonth[1]} ${hindiMonth}`;
  }

  // 3a. ✅ FIX: "22 तारीख" — number BEFORE the Hindi word (was missing before)
  const numBefore = t.match(/\b(\d{1,2})\s+(?:तारीख|tarikh|date)\b/);
  if (numBefore) return `${numBefore[1]} तारीख`;

  // 3b. "तारीख 22" — number AFTER (original pattern kept for completeness)
  const numAfter = t.match(/(?:तारीख|tarikh|date)\s+(\d{1,2})\b/);
  if (numAfter) return `${numAfter[1]} तारीख`;

  // 3c. "15 ko" — "15 को"
  const numKo = t.match(/\b(\d{1,2})\s+(?:ko|को)\b/);
  if (numKo) return `${numKo[1]} तारीख`;

  // 3d. Standalone number with booking context words
  // e.g. "22 तारीख के लिए बुक कर दो" — after stripping, number is still there
  const bookingCtx = t.match(/\b(\d{1,2})\s+(?:ke\s+liye|को\s+बुक|तक|से\s+पहले)/);
  if (bookingCtx) return `${bookingCtx[1]} तारीख`;

  // 4. Day / relative keyword lookup (longest match first)
  const sortedKeys = Object.keys(DAY_LABEL_MAP).sort((a, b) => b.length - a.length);
  for (const kw of sortedKeys) {
    if (t.includes(kw)) return DAY_LABEL_MAP[kw];
  }

  return null;
}

/* =====================================================================
   INTENT DETECTOR
   Priority: REPEAT > CONFUSION > RESCHEDULE > BUSY > CONFIRM > REJECT > UNKNOWN
   ===================================================================== */
function detectIntent(normText) {
  if (!normText || normText.length === 0) return INTENT.UNCLEAR;

  if (REPEAT_PATTERNS.some(p    => normText.includes(p))) return INTENT.REPEAT;
  if (CONFUSION_PATTERNS.some(p => normText.includes(p))) return INTENT.CONFUSION;
  if (RESCHEDULE_PATTERNS.some(p=> normText.includes(p))) return INTENT.RESCHEDULE;
  if (BUSY_PATTERNS.some(p      => normText.includes(p))) return INTENT.BUSY;
  if (CONFIRM_PATTERNS.some(p   => normText.includes(p))) return INTENT.CONFIRM;
  if (REJECT_PATTERNS.some(p    => normText.includes(p))) return INTENT.REJECT;

  return INTENT.UNKNOWN;
}

/* =====================================================================
   UTILITIES
   ===================================================================== */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function machineContext(s) {
  return (
    `आपकी ${s.machineModel} मशीन नंबर ${s.machineNumber} की ` +
    `${s.serviceType} सर्विस ${s.dueDate} को ड्यू है।`
  );
}

/* =====================================================================
   RESPONSE CATALOGUE
   ===================================================================== */
const REPLIES = {

  bookingConfirmed: (name) => pick([
    `बहुत बढ़िया ${name} जी। आपकी सर्विस बुक हो गई है। हमारा इंजीनियर निर्धारित तारीख पर संपर्क करेगा। धन्यवाद, नमस्कार।`,
    `${name} जी, सर्विस कन्फर्म हो गई। हमारी टीम जल्द संपर्क करेगी। शुक्रिया, नमस्कार।`,
  ]),

  rescheduleConfirmed: (name, date) =>
    `${name} जी, आपकी सर्विस ${date} के लिए शेड्यूल हो गई है। हमारा इंजीनियर उस दिन संपर्क करेगा। धन्यवाद, नमस्कार।`,

  askReason: (name) =>
    `ठीक है ${name} जी। क्या आप बता सकते हैं कि सर्विस अभी क्यों नहीं करानी? हम आपकी बात ज़रूर समझेंगे।`,

  afterReason: (name) =>
    `समझ गए ${name} जी। क्या हम आपके लिए कोई और तारीख पर सर्विस शेड्यूल कर सकते हैं, या बाद में कॉल करें?`,

  finalReject: (name) =>
    `ठीक है ${name} जी। अगर कभी सर्विस की ज़रूरत हो तो ज़रूर संपर्क करें। धन्यवाद, नमस्कार।`,

  busyAck: (name) =>
    `कोई बात नहीं ${name} जी। आप कोई बेहतर समय बताएँ, हम उस समय कॉल करेंगे।`,

  callbackOffered: (name) =>
    `${name} जी, क्या हम आपको कल या किसी और दिन कॉल करें? कोई तारीख बताएँ।`,

  callbackConfirmed: (name, date) =>
    `ठीक है ${name} जी। हम आपको ${date} को कॉल करेंगे। धन्यवाद, नमस्कार।`,

  callbackGeneric: (name) =>
    `ठीक है ${name} जी। हमारी टीम आपसे जल्द संपर्क करेगी। धन्यवाद, नमस्कार।`,

  askPreferredDate: (name) =>
    `ज़रूर ${name} जी। आप कौन सी तारीख या दिन सुविधाजनक पाएंगे? जैसे: कल, सोमवार, या कोई तारीख।`,

  confirmDate: (name, date) =>
    `${name} जी, क्या मैं आपकी सर्विस ${date} के लिए शेड्यूल कर दूँ? हाँ या नहीं बोलिए।`,

  dateNotClear: (name) =>
    `माफ़ कीजिए ${name} जी, तारीख स्पष्ट नहीं हुई। कृपया बोलिए — जैसे: कल, सोमवार, 15 तारीख, या अगला हफ्ता।`,

  noDateExit: (name) =>
    `${name} जी, हम आपको बाद में कॉल करके तारीख तय करेंगे। धन्यवाद, नमस्कार।`,

  repeatLast: (name, lastMsg) =>
    `${name} जी, मैं दोबारा बोल रहा हूँ — ${lastMsg}`,

  repeatNoHistory: (name) =>
    `${name} जी, मैं JCB सर्विस सेंटर से बोल रहा हूँ। आपकी मशीन की सर्विस बुक करने के लिए कॉल किया है।`,

  confusionClarify: (name, context) =>
    `${name} जी, मैं JCB सर्विस सेंटर से बोल रहा हूँ। ${context} क्या आप इसकी सर्विस बुक करवाना चाहते हैं? हाँ या नहीं बोलिए।`,

  politeAskAgain: (name) => pick([
    `माफ़ कीजिए ${name} जी, मैं समझ नहीं पाया। क्या आप सर्विस बुक करवाना चाहते हैं? हाँ या नहीं बोलिए।`,
    `${name} जी, थोड़ा स्पष्ट बोलिए। क्या सर्विस बुक कर दूँ?`,
  ]),

  tooManyUnknown: (name) =>
    `${name} जी, हम आपसे बाद में संपर्क करेंगे। धन्यवाद, नमस्कार।`,
};

/* =====================================================================
   CORE EXPORT: processUserInput
   ─────────────────────────────────────────────────────────────────────
   Returns:
   {
     replyText     : string,
     nextState     : string,
     endCall       : boolean,
     preferredDate : string | null,   — raw token e.g. "22 तारीख"
     resolvedDate  : { display, iso, raw } | null,  — ✅ NEW
     intent        : string,
   }
   ===================================================================== */
export function processUserInput(userText, sessionData) {
  const normText      = normalise(userText);
  const intent        = detectIntent(normText);
  const state         = sessionData.state         || 'awaiting_confirmation';
  const name          = sessionData.customerName  || 'ग्राहक';
  const context       = machineContext(sessionData);
  const retries       = sessionData.retries        || 0;
  const unknownStreak = sessionData.unknownStreak  || 0;

  /* ── Build result helper ──────────────────────────────────────────── */
  const result = (replyText, nextState, endCall, preferredDate = null) => {
    // Resolve raw date token → real calendar date
    const resolvedDate = preferredDate ? resolveDate(preferredDate) : null;
    return { replyText, nextState, endCall, preferredDate, resolvedDate, intent };
  };

  /* ── Global guard: too many consecutive unknowns ──────────────────── */
  if (unknownStreak >= 3) {
    return result(REPLIES.tooManyUnknown(name), 'ended', true);
  }

  /* ── REPEAT ───────────────────────────────────────────────────────── */
  if (intent === INTENT.REPEAT) {
    const lastMsg = sessionData.lastMessage || '';
    return result(
      lastMsg ? REPLIES.repeatLast(name, lastMsg) : REPLIES.repeatNoHistory(name),
      state, false,
    );
  }

  /* ── CONFUSION ────────────────────────────────────────────────────── */
  if (intent === INTENT.CONFUSION) {
    return result(REPLIES.confusionClarify(name, context), 'awaiting_confirmation', false);
  }

  /* ── UNCLEAR ──────────────────────────────────────────────────────── */
  if (intent === INTENT.UNCLEAR) {
    return result(REPLIES.politeAskAgain(name), state, false);
  }

  /* ══════════════════════════════════════════════════════════════════
     STATE MACHINE
     ══════════════════════════════════════════════════════════════════ */

  if (state === 'awaiting_confirmation') {

    if (intent === INTENT.CONFIRM) {
      return result(REPLIES.bookingConfirmed(name), 'ended', true);
    }
    if (intent === INTENT.REJECT) {
      return result(REPLIES.askReason(name), 'awaiting_reason', false);
    }
    if (intent === INTENT.BUSY) {
      return result(REPLIES.busyAck(name), 'callback_offered', false);
    }
    if (intent === INTENT.RESCHEDULE) {
      const preferredDate = extractPreferredDate(userText);
      if (preferredDate) {
        const display = resolveDate(preferredDate)?.display || preferredDate;
        return result(REPLIES.confirmDate(name, display), 'awaiting_reschedule_confirm', false, preferredDate);
      }
      return result(REPLIES.askPreferredDate(name), 'awaiting_reschedule_date', false);
    }
    if (retries >= 2) return result(REPLIES.tooManyUnknown(name), 'ended', true);
    return result(REPLIES.politeAskAgain(name), 'awaiting_confirmation', false);
  }

  if (state === 'awaiting_reason') {

    if (intent === INTENT.CONFIRM) {
      return result(REPLIES.bookingConfirmed(name), 'ended', true);
    }
    if (intent === INTENT.RESCHEDULE || intent === INTENT.BUSY) {
      const preferredDate = extractPreferredDate(userText);
      if (preferredDate) {
        const display = resolveDate(preferredDate)?.display || preferredDate;
        return result(REPLIES.confirmDate(name, display), 'awaiting_reschedule_confirm', false, preferredDate);
      }
      return result(REPLIES.askPreferredDate(name), 'awaiting_reschedule_date', false);
    }
    if (intent === INTENT.REJECT) {
      return result(REPLIES.afterReason(name), 'callback_offered', false);
    }
    return result(REPLIES.afterReason(name), 'callback_offered', false);
  }

  if (state === 'awaiting_reschedule_date') {
    const preferredDate = extractPreferredDate(userText);
    if (preferredDate) {
      const display = resolveDate(preferredDate)?.display || preferredDate;
      return result(REPLIES.confirmDate(name, display), 'awaiting_reschedule_confirm', false, preferredDate);
    }
    if (intent === INTENT.REJECT) return result(REPLIES.finalReject(name), 'ended', true);
    if (intent === INTENT.BUSY)   return result(REPLIES.callbackOffered(name), 'callback_offered', false);
    if (retries >= 2)             return result(REPLIES.noDateExit(name), 'ended', true);
    return result(REPLIES.dateNotClear(name), 'awaiting_reschedule_date', false);
  }

  if (state === 'awaiting_reschedule_confirm') {
    const date       = sessionData.preferredDate || null;
    const display    = date ? (resolveDate(date)?.display || date) : 'निर्धारित तारीख';

    if (intent === INTENT.CONFIRM) {
      return result(REPLIES.rescheduleConfirmed(name, display), 'ended', true, date);
    }
    if (intent === INTENT.REJECT || intent === INTENT.RESCHEDULE) {
      return result(REPLIES.askPreferredDate(name), 'awaiting_reschedule_date', false);
    }
    if (intent === INTENT.BUSY) {
      return result(REPLIES.callbackOffered(name), 'callback_offered', false);
    }
    return result(REPLIES.confirmDate(name, display), 'awaiting_reschedule_confirm', false, date);
  }

  if (state === 'callback_offered') {

    if (intent === INTENT.CONFIRM || intent === INTENT.RESCHEDULE) {
      const preferredDate = extractPreferredDate(userText);
      if (preferredDate) {
        const display = resolveDate(preferredDate)?.display || preferredDate;
        return result(REPLIES.callbackConfirmed(name, display), 'ended', true, preferredDate);
      }
      return result(REPLIES.callbackGeneric(name), 'ended', true);
    }
    if (intent === INTENT.REJECT) return result(REPLIES.finalReject(name), 'ended', true);
    if (retries >= 2)             return result(REPLIES.callbackGeneric(name), 'ended', true);
    return result(REPLIES.callbackOffered(name), 'callback_offered', false);
  }

  if (state === 'clarification') {
    if (intent === INTENT.CONFIRM) return result(REPLIES.bookingConfirmed(name), 'ended', true);
    if (intent === INTENT.REJECT)  return result(REPLIES.finalReject(name), 'ended', true);
    return result(REPLIES.confusionClarify(name, context), 'awaiting_confirmation', false);
  }

  /* ── Ultimate fallback ───────────────────────────────────────────── */
  return result(REPLIES.tooManyUnknown(name), 'ended', true);
}

export default { processUserInput, extractPreferredDate, INTENT };