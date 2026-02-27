// /**
//  * dateResolver.js
//  * ================================
//  * Resolves fuzzy Hindi / Romanised date expressions into real calendar dates.
//  *
//  * Input  : raw string from customer speech  e.g. "22 तारीख", "Monday", "kal"
//  * Output : { display, iso, raw }
//  *
//  *   display  — human-readable string  e.g. "Monday, 3 March 2025"
//  *   iso      — ISO-8601 date string   e.g. "2025-03-03"
//  *   raw      — original extracted token as-is
//  *
//  * All resolution is relative to `referenceDate` (defaults to today).
//  * Every resolved date is always in the FUTURE (never today or the past).
//  *
//  * Exported functions:
//  *   resolveDate(rawToken, referenceDate?)
//  *     → { display, iso, raw } | null
//  *
//  *   formatForDB(rawToken, referenceDate?)
//  *     → "Monday, 3 March 2025" string (ready to store) | null
//  */

// /* =====================================================================
//    CONSTANTS
//    ===================================================================== */

// /** English weekday names indexed 0 (Sun) → 6 (Sat) */
// const WEEKDAY_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// /** Months for display */
// const MONTH_EN = [
//   'January','February','March','April','May','June',
//   'July','August','September','October','November','December',
// ];

// /**
//  * Maps every token that extractPreferredDate() can return
//  * to a resolver function: (referenceDate: Date) → Date
//  *
//  * Tokens are the values from DAY_LABEL_MAP in conversational_intelligence.js
//  * PLUS raw numeric tokens like "22/03", "15 तारीख", "22 तारीख" etc.
//  */
// const TOKEN_RESOLVERS = {

//   /* ─── Relative day tokens ─── */
//   'कल':            (ref) => addDays(ref, 1),
//   'परसों':          (ref) => addDays(ref, 2),

//   /* ─── Day-name tokens → next occurrence of that weekday ─── */
//   'सोमवार':        (ref) => nextWeekday(ref, 1),
//   'मंगलवार':       (ref) => nextWeekday(ref, 2),
//   'बुधवार':        (ref) => nextWeekday(ref, 3),
//   'गुरुवार':        (ref) => nextWeekday(ref, 4),
//   'शुक्रवार':       (ref) => nextWeekday(ref, 5),
//   'शनिवार':        (ref) => nextWeekday(ref, 6),
//   'रविवार':        (ref) => nextWeekday(ref, 0),

//   /* ─── Relative week / month tokens ─── */
//   'अगले हफ्ते':   (ref) => addDays(ref, 7),
//   '1 हफ्ते बाद':  (ref) => addDays(ref, 7),
//   '2 दिन बाद':    (ref) => addDays(ref, 2),
//   '3 दिन बाद':    (ref) => addDays(ref, 3),
//   'अगले महीने':   (ref) => addMonths(ref, 1),
// };

// /* =====================================================================
//    DATE ARITHMETIC HELPERS
//    ===================================================================== */

// /** Returns a new Date that is `n` days after `base` */
// function addDays(base, n) {
//   const d = new Date(base);
//   d.setDate(d.getDate() + n);
//   return d;
// }

// /** Returns a new Date that is `n` calendar months after `base` */
// function addMonths(base, n) {
//   const d = new Date(base);
//   d.setMonth(d.getMonth() + n);
//   return d;
// }

// /**
//  * Returns the next occurrence of `targetDay` (0=Sun … 6=Sat)
//  * that is STRICTLY after `base` (never same day).
//  */
// function nextWeekday(base, targetDay) {
//   const d = new Date(base);
//   const current = d.getDay();
//   let diff = targetDay - current;
//   if (diff <= 0) diff += 7;   // always move forward
//   d.setDate(d.getDate() + diff);
//   return d;
// }

// /**
//  * Resolves "22 तारीख" / "22/03" / "22 March" type tokens.
//  * Finds the next future occurrence of day `dd` in month `mm` (1-based).
//  * If `mm` is omitted, uses current month unless `dd` has already passed.
//  *
//  * @param {number} dd   day of month (1-31)
//  * @param {number|null} mm  month (1-12) or null
//  * @param {Date} ref    reference date
//  */
// function resolveNumericDate(dd, mm, ref) {
//   const today = new Date(ref);
//   today.setHours(0, 0, 0, 0);

//   if (mm !== null) {
//     // Explicit month given — find the date in that month this year or next
//     const candidate = new Date(today.getFullYear(), mm - 1, dd);
//     if (candidate <= today) candidate.setFullYear(candidate.getFullYear() + 1);
//     return candidate;
//   }

//   // No month — try current month first
//   const thisMonth = new Date(today.getFullYear(), today.getMonth(), dd);
//   if (thisMonth > today) return thisMonth;

//   // Already passed → use next month
//   return new Date(today.getFullYear(), today.getMonth() + 1, dd);
// }

// /* =====================================================================
//    DISPLAY FORMATTER
//    ===================================================================== */

// /**
//  * Formats a Date into "Monday, 3 March 2025"
//  */
// function formatDisplay(date) {
//   const day   = WEEKDAY_EN[date.getDay()];
//   const dd    = date.getDate();
//   const month = MONTH_EN[date.getMonth()];
//   const yyyy  = date.getFullYear();
//   return `${day}, ${dd} ${month} ${yyyy}`;
// }

// /**
//  * Formats a Date into ISO-8601 "YYYY-MM-DD"
//  */
// function formatISO(date) {
//   const yyyy = date.getFullYear();
//   const mm   = String(date.getMonth() + 1).padStart(2, '0');
//   const dd   = String(date.getDate()).padStart(2, '0');
//   return `${yyyy}-${mm}-${dd}`;
// }

// /* =====================================================================
//    MAIN EXPORT: resolveDate
//    ─────────────────────────────────────────────────────────────────────
//    @param {string} rawToken        — token from extractPreferredDate()
//    @param {Date}   [referenceDate] — defaults to today
//    @returns {{ display: string, iso: string, raw: string } | null}
//    ===================================================================== */
// export function resolveDate(rawToken, referenceDate = new Date()) {
//   if (!rawToken) return null;

//   const ref = new Date(referenceDate);
//   ref.setHours(0, 0, 0, 0);

//   /* ── 1. Check named token map first ─────────────────────────────── */
//   const resolver = TOKEN_RESOLVERS[rawToken.trim()];
//   if (resolver) {
//     const resolved = resolver(ref);
//     return { display: formatDisplay(resolved), iso: formatISO(resolved), raw: rawToken };
//   }

//   /* ── 2. Numeric "DD/MM" or "DD/MM/YYYY" ─────────────────────────── */
//   const slashMatch = rawToken.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
//   if (slashMatch) {
//     const dd = parseInt(slashMatch[1], 10);
//     const mm = parseInt(slashMatch[2], 10);
//     if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
//       const resolved = resolveNumericDate(dd, mm, ref);
//       return { display: formatDisplay(resolved), iso: formatISO(resolved), raw: rawToken };
//     }
//   }

//   /* ── 3. "DD तारीख" or "DD March" patterns ────────────────────────── */
//   const dayOnly   = rawToken.match(/^(\d{1,2})\s+तारीख$/);
//   const dayMonth  = rawToken.match(/^(\d{1,2})\s+([A-Za-zА-Яа-я\u0900-\u097F]+)$/);

//   if (dayOnly) {
//     const dd = parseInt(dayOnly[1], 10);
//     if (dd >= 1 && dd <= 31) {
//       const resolved = resolveNumericDate(dd, null, ref);
//       return { display: formatDisplay(resolved), iso: formatISO(resolved), raw: rawToken };
//     }
//   }

//   if (dayMonth) {
//     const dd        = parseInt(dayMonth[1], 10);
//     const monthName = dayMonth[2].toLowerCase();
//     const mm        = resolveMonthNumber(monthName);
//     if (dd >= 1 && dd <= 31 && mm !== null) {
//       const resolved = resolveNumericDate(dd, mm, ref);
//       return { display: formatDisplay(resolved), iso: formatISO(resolved), raw: rawToken };
//     }
//   }

//   // Could not resolve — return null (caller decides fallback)
//   return null;
// }

// /* =====================================================================
//    EXPORT: formatForDB
//    Convenience wrapper — returns only the display string for DB storage.
//    ===================================================================== */
// export function formatForDB(rawToken, referenceDate = new Date()) {
//   const result = resolveDate(rawToken, referenceDate);
//   return result ? result.display : rawToken; // fallback to raw token if unresolvable
// }

// /* =====================================================================
//    HELPER: resolveMonthNumber
//    Maps month name (English or Hindi) → 1-based month number.
//    ===================================================================== */
// const MONTH_MAP = {
//   // English
//   january:1, february:2, march:3, april:4, may:5, june:6,
//   july:7, august:8, september:9, october:10, november:11, december:12,
//   // Hindi (Devanagari)
//   'जनवरी':1,  'फरवरी':2,  'मार्च':3,    'अप्रैल':4,
//   'मई':5,     'जून':6,    'जुलाई':7,    'अगस्त':8,
//   'सितंबर':9, 'अक्टूबर':10,'नवंबर':11,  'दिसंबर':12,
// };

// function resolveMonthNumber(name) {
//   return MONTH_MAP[name] ?? null;
// }

// export default { resolveDate, formatForDB };



/**
 * dateResolver.js  (v2 — IST-aware, Hindi token support)
 * =========================================================
 * Resolves a raw date token (like "कल", "सोमवार", "25 तारीख", "25/3") into:
 *   { display: "Monday, 3 March 2026", iso: "2026-03-03" }
 *
 * FIX v2:
 *   • Twilio servers run on UTC; customers are IST (UTC+5:30).
 *     All relative date calculations now use IST "today" not UTC.
 *   • If resolveDate cannot interpret a token it returns null instead of
 *     throwing — callers should fall back to storing the raw token with a warning.
 *
 * Exported:
 *   resolveDate(token)  → { display: string, iso: string } | null
 */

/* =====================================================================
   IST "NOW"
   ─────────────────────────────────────────────────────────────────────
   FIX: Use IST offset (UTC+5:30) so that a call at 11pm UTC (which is
   4:30am IST next day) resolves "kal" to the right calendar date.
   ===================================================================== */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 5h 30m in ms

function nowIST() {
  const utcMs = Date.now();
  return new Date(utcMs + IST_OFFSET_MS);
}

/** Returns a Date object for midnight IST "today" (no time component) */
function todayIST() {
  const ist = nowIST();
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Add days to a Date, return new Date */
function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/* =====================================================================
   FORMATTING
   ===================================================================== */
const WEEKDAYS_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS_EN   = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function formatDisplay(date) {
  const day   = WEEKDAYS_EN[date.getUTCDay()];
  const d     = date.getUTCDate();
  const month = MONTHS_EN[date.getUTCMonth()];
  const year  = date.getUTCFullYear();
  return `${day}, ${d} ${month} ${year}`;
}

function formatISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* =====================================================================
   WEEKDAY RESOLVER
   Finds the next occurrence of a given weekday (0=Sun … 6=Sat)
   starting from tomorrow (never returns today).
   ===================================================================== */
function nextWeekday(targetDay) {
  const today = todayIST();
  const todayDay = today.getUTCDay();
  let diff = targetDay - todayDay;
  if (diff <= 0) diff += 7; // always go forward
  return addDays(today, diff);
}

/* =====================================================================
   MONTH NAME MAP (Hindi + English → month index 0-11)
   ===================================================================== */
const MONTH_INDEX = {
  'january': 0,  'february': 1, 'march': 2,     'april': 3,
  'may': 4,      'june': 5,     'july': 6,       'august': 7,
  'september': 8,'october': 9,  'november': 10,  'december': 11,
  // Devanagari
  'जनवरी': 0,  'फरवरी': 1,  'मार्च': 2,  'अप्रैल': 3,
  'मई': 4,     'जून': 5,    'जुलाई': 6,  'अगस्त': 7,
  'सितंबर': 8, 'अक्टूबर': 9,'नवंबर': 10, 'दिसंबर': 11,
};

/* =====================================================================
   TOKEN NORMALISER (lightweight — keep Devanagari)
   ===================================================================== */
function normToken(t) {
  return (t || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/* =====================================================================
   CORE RESOLVER
   ===================================================================== */
export function resolveDate(token) {
  if (!token) return null;

  const t = normToken(token);
  const today = todayIST();

  /* ── Relative: kal (tomorrow) ── */
  if (t === 'कल' || t === 'kal') {
    const d = addDays(today, 1);
    return { display: formatDisplay(d), iso: formatISO(d) };
  }

  /* ── Relative: parso (day after tomorrow) ── */
  if (t === 'परसों' || t === 'parso') {
    const d = addDays(today, 2);
    return { display: formatDisplay(d), iso: formatISO(d) };
  }

  /* ── Relative: N दिन बाद / N din baad ── */
  const dinBaad = t.match(/^(\d+)\s*(?:दिन बाद|din baad)$/u);
  if (dinBaad) {
    const d = addDays(today, parseInt(dinBaad[1], 10));
    return { display: formatDisplay(d), iso: formatISO(d) };
  }

  /* ── Relative: N हफ्ते बाद / N hafte baad ── */
  const hafteBaad = t.match(/^(\d+)\s*(?:हफ्ते बाद|hafte baad|week baad)$/u);
  if (hafteBaad) {
    const d = addDays(today, parseInt(hafteBaad[1], 10) * 7);
    return { display: formatDisplay(d), iso: formatISO(d) };
  }

  /* ── Relative: agle (just "next" / "immediately") — resolve to tomorrow ── */
  if (t === 'अगले' || t === 'agle' || t === 'next' || t === 'asap') {
    const d = addDays(today, 1);
    return { display: formatDisplay(d), iso: formatISO(d) };
  }

  /* ── Relative: agle hi (immediately) — resolve to tomorrow ── */
  if (t === 'अगले ही' || t === 'agle hi') {
    const d = addDays(today, 1);
    return { display: formatDisplay(d), iso: formatISO(d) };
  }

  /* ── Relative: agle hafte / next week — resolve to next Monday (start of next work week) ── */
  if (t === 'अगले हफ्ते' || t === 'agle hafte' || t === 'next week' || t === 'agle week') {
    const d = nextWeekday(1); // Monday = 1
    return { display: formatDisplay(d), iso: formatISO(d) };
  }

  /* ── Relative: agle mahine / next month ── */
  if (t === 'अगले महीने' || t === 'agle mahine' || t === 'next month') {
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    return { display: formatDisplay(nextMonth), iso: formatISO(nextMonth) };
  }

  /* ── Named weekday (Hindi or English) ── */
  const weekdayMap = {
    'सोमवार': 1, 'समवार': 1, 'somwar': 1, 'samvar': 1, 'mon': 1, 'monday': 1,
    'मंगलवार': 2, 'मंगल': 2, 'mangalwar': 2, 'mangal': 2, 'tue': 2, 'tuesday': 2,
    'बुधवार': 3, 'बुध': 3, 'budhwar': 3, 'budh': 3, 'wed': 3, 'wednesday': 3,
    'गुरुवार': 4, 'गुरु': 4, 'guruwar': 4, 'guru': 4, 'thu': 4, 'thursday': 4,
    'शुक्रवार': 5, 'शुक्र': 5, 'shukrawar': 5, 'shukra': 5, 'fri': 5, 'friday': 5,
    'शनिवार': 6, 'शनि': 6, 'shaniwar': 6, 'shani': 6, 'sat': 6, 'saturday': 6,
    'रविवार': 0, 'रवि': 0, 'raviwar': 0, 'ravi': 0, 'sun': 0, 'sunday': 0,
  };
  if (weekdayMap[t] !== undefined) {
    const d = nextWeekday(weekdayMap[t]);
    return { display: formatDisplay(d), iso: formatISO(d) };
  }

  /* ── DD तारीख / DD tarikh (day of current or next month) ── */
  const dayOnly = t.match(/^(\d{1,2})\s*(?:तारीख|tarikh|date)?$/u);
  if (dayOnly) {
    const day = parseInt(dayOnly[1], 10);
    if (day >= 1 && day <= 31) {
      // If the day has already passed this month, use next month
      const candidate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day));
      const resolved  = candidate <= today
        ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, day))
        : candidate;
      // Guard for invalid dates (e.g. 31 Feb)
      if (isNaN(resolved.getTime())) return null;
      return { display: formatDisplay(resolved), iso: formatISO(resolved) };
    }
  }

  /* ── DD/MM or DD-MM (current year or next year if past) ── */
  const slashDate = t.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (slashDate) {
    const day   = parseInt(slashDate[1], 10);
    const month = parseInt(slashDate[2], 10) - 1;
    const year  = slashDate[3]
      ? (slashDate[3].length === 2 ? 2000 + parseInt(slashDate[3], 10) : parseInt(slashDate[3], 10))
      : today.getUTCFullYear();
    let d = new Date(Date.UTC(year, month, day));
    if (d <= today && !slashDate[3]) {
      d = new Date(Date.UTC(year + 1, month, day));
    }
    if (isNaN(d.getTime())) return null;
    return { display: formatDisplay(d), iso: formatISO(d) };
  }

  /* ── DD MonthName (e.g. "25 मार्च" or "25 march") ── */
  const dayMonthRe = /^(\d{1,2})\s+(.+)$/u;
  const dayMonth   = t.match(dayMonthRe);
  if (dayMonth) {
    const day       = parseInt(dayMonth[1], 10);
    const monthName = dayMonth[2].trim();
    const monthIdx  = MONTH_INDEX[monthName];
    if (monthIdx !== undefined) {
      let d = new Date(Date.UTC(today.getUTCFullYear(), monthIdx, day));
      if (d <= today) {
        d = new Date(Date.UTC(today.getUTCFullYear() + 1, monthIdx, day));
      }
      if (isNaN(d.getTime())) return null;
      return { display: formatDisplay(d), iso: formatISO(d) };
    }
  }

  // Could not resolve — return null; caller logs warning
  return null;
}

export default { resolveDate };