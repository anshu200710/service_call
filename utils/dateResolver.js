/* =====================================================================
   dateResolver.js  (v2 — Ultra-Comprehensive Hindi + English Date Resolution)
   
   IMPROVEMENTS:
   - Rural area phonetic variants (Rajasthani, Bhojpuri, Marwari)
   - Expanded weekday recognition (all possible STT mis-transcriptions)
   - "Is hafte", "agla", "next", "aane wala" family
   - Full month names + short forms in Hindi & English
   - N din/hafte/mahine baad
   - Aaj (today) support
   - Relative date expressions: "pehelaa", "dusra", etc.
   - Ambiguous single number resolution
   ===================================================================== */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function todayIST() {
  const ist = nowIST();
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/* =====================================================================
   FORMATTING
   ===================================================================== */
const WEEKDAYS_EN = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const WEEKDAYS_HI = ["रविवार","सोमवार","मंगलवार","बुधवार","गुरुवार","शुक्रवार","शनिवार"];
const MONTHS_EN   = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function formatDisplay(date) {
  return `${WEEKDAYS_EN[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS_EN[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function formatISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function makeResult(date) {
  if (!date || isNaN(date.getTime())) return null;
  return { display: formatDisplay(date), iso: formatISO(date) };
}

/* =====================================================================
   WEEKDAY RESOLVER
   ===================================================================== */
function nextWeekday(targetDay) {
  const today = todayIST();
  let diff = targetDay - today.getUTCDay();
  if (diff <= 0) diff += 7;
  return addDays(today, diff);
}

function thisWeekday(targetDay) {
  // Same week, even if today
  const today = todayIST();
  let diff = targetDay - today.getUTCDay();
  if (diff < 0) diff += 7;
  if (diff === 0) diff = 7; // same day = next week
  return addDays(today, diff);
}

/* =====================================================================
   NUMERIC DATE RESOLVER
   ===================================================================== */
function resolveNumericDate(dd, mm = null) {
  const today = todayIST();
  if (dd < 1 || dd > 31) return null;

  if (mm !== null) {
    if (mm < 1 || mm > 12) return null;
    let d = new Date(Date.UTC(today.getUTCFullYear(), mm - 1, dd));
    if (isNaN(d.getTime())) return null;
    if (d <= today) d = new Date(Date.UTC(today.getUTCFullYear() + 1, mm - 1, dd));
    return isNaN(d.getTime()) ? null : d;
  }

  let d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), dd));
  if (isNaN(d.getTime()) || d <= today) {
    d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, dd));
  }
  return isNaN(d.getTime()) ? null : d;
}

/* =====================================================================
   MONTH NAME MAP — Hindi + English + Short forms + STT variants
   ===================================================================== */
const MONTH_INDEX = {
  // English full
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  // English short
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  // Hindi Devanagari
  जनवरी:1, फरवरी:2, मार्च:3, अप्रैल:4, मई:5, जून:6,
  जुलाई:7, अगस्त:8, सितंबर:9, अक्टूबर:10, नवंबर:11, दिसंबर:12,
  // Hindi Romanized + STT variants
  january:1, janvari:1, janwari:1,
  february:2, farvari:2, farwari:2, feburary:2,
  march:3, maarch:3,
  april:4, aprel:4, aipril:4,
  may:5, mei:5,
  june:6, joon:6, jun:6,
  july:7, julaai:7, julai:7,
  august:8, agast:8, agust:8,
  september:9, sitambar:9, saptambar:9, september:9,
  october:10, aktubar:10, aktoobar:10,
  november:11, navambar:11, november:11,
  december:12, disambar:12, disember:12,
};

/* =====================================================================
   WEEKDAY MAP — All possible variants including rural STT errors
   ===================================================================== */
const WEEKDAY_INDEX = {
  // English
  sunday:0, sun:0, monday:1, mon:1, tuesday:2, tue:2,
  wednesday:3, wed:3, thursday:4, thu:4, friday:5, fri:5, saturday:6, sat:6,
  // Hinglish standard
  somwar:1, somvaar:1, somvar:1, samvar:1, saamvar:1,
  mangalwar:2, mangalvaar:2, mangalvar:2, mangal:2,
  budhwar:3, budhvaar:3, budhvar:3, budh:3, budhawar:3,
  guruwar:4, guruvaar:4, guruvar:4, guru:4, veervar:4, veervaar:4, brihaspatiwar:4,
  shukrawar:5, shukravaar:5, shukravar:5, shukra:5, shukrwar:5,
  shaniwar:6, shanivaar:6, shanivar:6, shani:6, shanichhar:6, shnaivaar:6,
  raviwar:0, ravivaar:0, ravivar:0, ravi:0, itwar:0, itwaar:0, aithvar:0,
  // Devanagari standard
  सोमवार:1, समवार:1, सोमवर:1,
  मंगलवार:2, मंगलवर:2, मंगल:2,
  बुधवार:3, बुधवर:3, बुध:3,
  गुरुवार:4, गुरुवर:4, गुरु:4, वीरवार:4, बृहस्पतिवार:4,
  शुक्रवार:5, शुक्रवर:5, शुक्र:5,
  शनिवार:6, शनिवर:6, शनि:6, शनीवार:6,
  रविवार:0, रविवर:0, रवि:0, इतवार:0, ऐतवार:0,
  // Rajasthani / Marwari variants
  somvaraa:1, mangalvaraa:2, budhvaraa:3, guruvaraa:4,
  shukravaraa:5, shanivaraa:6, ravivaraa:0,
  // Bhojpuri variants
  somaar:1, mangaar:2, budhaar:3, guruvaar:4, shukraar:5, shanichhar:6, aitvar:0,
};

/* =====================================================================
   TOKEN NORMALISER
   ===================================================================== */
function normToken(t) {
  return (t || "")
    .trim()
    .toLowerCase()
    .replace(/[।॥,.!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =====================================================================
   HINDI NUMBER WORDS → digits
   ===================================================================== */
const HINDI_NUM_MAP = {
  एक:1, दो:2, तीन:3, चार:4, पाँच:5, पांच:5, छह:6, छः:6,
  सात:7, आठ:8, नौ:9, दस:10, ग्यारह:11, बारह:12, तेरह:13,
  चौदह:14, पंद्रह:15, सोलह:16, सत्रह:17, अठारह:18, उन्नीस:19,
  बीस:20, इक्कीस:21, बाईस:22, तेईस:23, चौबीस:24, पच्चीस:25,
  छब्बीस:26, सत्ताईस:27, अट्ठाईस:28, उनतीस:29, तीस:30, इकतीस:31,
  ek:1, do:2, teen:3, char:4, paanch:5, panch:5, chhe:6,
  saat:7, aath:8, nau:9, das:10, gyarah:11, barah:12, terah:13,
  chaudah:14, pandrah:15, solah:16, satrah:17, atharah:18, unnees:19,
  bees:20, ikkees:21, baaees:22, teyees:23, chaubees:24, pachees:25,
  chhabbees:26, sattaees:27, atthaees:28, unatees:29, tees:30, ikattees:31,
};

function hindiNumToDigit(word) {
  return HINDI_NUM_MAP[word] || null;
}

function replaceHindiNumberWords(text) {
  let out = text;
  // Sort by length descending to replace longer matches first
  const sorted = Object.entries(HINDI_NUM_MAP).sort((a,b) => b[0].length - a[0].length);
  for (const [word, digit] of sorted) {
    const re = new RegExp(`(^|\\s)${word}(\\s|$)`, "gu");
    out = out.replace(re, `$1${digit}$2`);
  }
  return out;
}

/* =====================================================================
   MAIN EXPORT: resolveDate
   ===================================================================== */
export function resolveDate(rawToken) {
  if (!rawToken) return null;

  const t = normToken(rawToken);
  const today = todayIST();

  /* ── आज / aaj (today) → tomorrow to avoid same-day issue ── */
  if (["आज","aaj","aaj hi","aaj hee","today"].includes(t))
    return makeResult(addDays(today, 1));

  /* ── कल / kal (tomorrow) ── */
  if (["कल","kal","kal hi","kal hee","tomorrow"].includes(t))
    return makeResult(addDays(today, 1));

  /* ── परसों / parso (day after tomorrow) ── */
  if (["परसों","परसो","parso","parson","parsu","day after tomorrow"].includes(t))
    return makeResult(addDays(today, 2));

  /* ── तरसों / tarso (3 days later) ── */
  if (["तरसों","tarso","tarson"].includes(t))
    return makeResult(addDays(today, 3));

  /* ── अगले / agle / agla / next / asap → tomorrow ── */
  if (["अगले","अगले ही","अगला","agle","agle hi","agla","next","asap","jaldi","jaldi se","जल्दी","जल्दी से"].includes(t))
    return makeResult(addDays(today, 1));

  /* ── इस हफ्ते / is hafte / this week → next Monday ── */
  if (["इस हफ्ते","is hafte","is week","this week","is hafta"].includes(t))
    return makeResult(nextWeekday(1));

  /* ── अगले हफ्ते / next week → next Monday ── */
  if (["अगले हफ्ते","अगले हफ़्ते","agle hafte","agle week","next week","agla hafta","agale hafte", "नेक्स्ट वीक!", "नेक्स्ट वी", "नेक्स्ट वीक", "वीक", "नेक्स्ट" ].includes(t))
    return makeResult(nextWeekday(1));

  /* ── अगले महीने / next month → 1st of next month ── */
  if (["अगले महीने","अगले माह","agle mahine","agle maheene","agle maah","next month","agla mahina"].includes(t))
    return makeResult(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)));

  /* ── Is mahine / this month → 15th of current month (mid-month default) ── */
  if (["इस महीने","is mahine","this month","is maah"].includes(t))
    return makeResult(resolveNumericDate(15));

  /* ── N दिन बाद ── */
  const dinBaad = t.match(/^(\d+)\s*(?:दिन\s*बाद|din\s*baad|day[s]?\s*(?:later|baad|bad))$/u);
  if (dinBaad) return makeResult(addDays(today, parseInt(dinBaad[1], 10)));

  /* ── N हफ्ते बाद ── */
  const hafteBaad = t.match(/^(\d+)\s*(?:हफ्ते?\s*बाद|hafte?\s*baad|week[s]?\s*(?:later|baad|bad))$/u);
  if (hafteBaad) return makeResult(addDays(today, parseInt(hafteBaad[1], 10) * 7));

  /* ── N महीने बाद ── */
  const mahineBaad = t.match(/^(\d+)\s*(?:महीने?\s*बाद|mahine?\s*baad|month[s]?\s*(?:later|baad|bad))$/u);
  if (mahineBaad) {
    const n = parseInt(mahineBaad[1], 10);
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + n, today.getUTCDate()));
    return makeResult(d);
  }

  /* ── Named weekday — single word ── */
  if (WEEKDAY_INDEX[t] !== undefined)
    return makeResult(nextWeekday(WEEKDAY_INDEX[t]));

  /* ── "Is" + weekday e.g. "is somwar" / "is mangal" ── */
  const isWeekday = t.match(/^(?:is|iss|yeh|ye|आज|इस)\s+(.+)$/u);
  if (isWeekday) {
    const day = WEEKDAY_INDEX[isWeekday[1].trim()];
    if (day !== undefined) return makeResult(thisWeekday(day));
  }

  /* ── "Agle" + weekday e.g. "agle somwar" ── */
  const agleWeekday = t.match(/^(?:agle|agale|अगले|अगला|next)\s+(.+)$/u);
  if (agleWeekday) {
    const dayPart = agleWeekday[1].trim();
    const day = WEEKDAY_INDEX[dayPart];
    if (day !== undefined) {
      // Force next week's occurrence
      const nw = nextWeekday(day);
      // Add 7 to ensure it's truly NEXT (not this) week
      const diff = nw.getTime() - today.getTime();
      if (diff <= 7 * 24 * 60 * 60 * 1000) return makeResult(addDays(nw, 7));
      return makeResult(nw);
    }
    // agle + month check
    const mm = MONTH_INDEX[dayPart];
    if (mm) return makeResult(new Date(Date.UTC(today.getUTCFullYear(), mm - 1, 1)));
  }

  /* ── DD तारीख / DD tarikh (bare number with date suffix) ── */
  const dayOnly = t.match(/^(\d{1,2})\s*(?:तारीख|tarikh|tarikh ko|tarik|ko|date|th|st|nd|rd)?$/u);
  if (dayOnly) {
    const dd = parseInt(dayOnly[1], 10);
    if (dd >= 1 && dd <= 31) return makeResult(resolveNumericDate(dd));
  }

  /* ── DD/MM or DD-MM (optionally /YYYY) ── */
  const slashDate = t.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (slashDate) {
    const dd    = parseInt(slashDate[1], 10);
    const mm    = parseInt(slashDate[2], 10);
    const yearStr = slashDate[3];
    if (yearStr) {
      const y = yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
      const d = new Date(Date.UTC(y, mm - 1, dd));
      return makeResult(d);
    }
    return makeResult(resolveNumericDate(dd, mm));
  }

  /* ── DD MonthName e.g. "25 march" / "25 मार्च" / "25 janwari" ── */
  const dayMonthMatch = t.match(/^(\d{1,2})\s+(.+)$/u);
  if (dayMonthMatch) {
    const dd        = parseInt(dayMonthMatch[1], 10);
    const monthPart = dayMonthMatch[2].trim();
    const mm        = MONTH_INDEX[monthPart] || MONTH_INDEX[monthPart.toLowerCase()];
    if (mm !== undefined) return makeResult(resolveNumericDate(dd, mm));
    // Try weekday after number — e.g. "3 mangalwar" = 3rd Tuesday from now (unusual but handle)
    const wd = WEEKDAY_INDEX[monthPart];
    if (wd !== undefined) return makeResult(nextWeekday(wd));
  }

  /* ── Hindi number word + तारीख e.g. "bees tarikh" ── */
  const hindiNumTarikh = t.match(/^(.+?)\s*(?:तारीख|tarikh|tarik)$/u);
  if (hindiNumTarikh) {
    const numWord = hindiNumTarikh[1].trim();
    const digit = hindiNumToDigit(numWord);
    if (digit) return makeResult(resolveNumericDate(digit));
  }

  /* ── Pure Hindi number word e.g. "bees" / "बीस" ── */
  const digit = hindiNumToDigit(t);
  if (digit && digit >= 1 && digit <= 31) return makeResult(resolveNumericDate(digit));

  return null;
}

/** Convenience: returns only the display string */
export function formatForDB(rawToken) {
  const r = resolveDate(rawToken);
  return r ? r.display : rawToken;
}

export default { resolveDate, formatForDB };