/**
 * dateResolver.js
 * ================================
 * Resolves fuzzy Hindi / Romanised date expressions into real calendar dates.
 *
 * Input  : raw string from customer speech  e.g. "22 तारीख", "Monday", "kal"
 * Output : { display, iso, raw }
 *
 *   display  — human-readable string  e.g. "Monday, 3 March 2025"
 *   iso      — ISO-8601 date string   e.g. "2025-03-03"
 *   raw      — original extracted token as-is
 *
 * All resolution is relative to `referenceDate` (defaults to today).
 * Every resolved date is always in the FUTURE (never today or the past).
 *
 * Exported functions:
 *   resolveDate(rawToken, referenceDate?)
 *     → { display, iso, raw } | null
 *
 *   formatForDB(rawToken, referenceDate?)
 *     → "Monday, 3 March 2025" string (ready to store) | null
 */

/* =====================================================================
   CONSTANTS
   ===================================================================== */

/** English weekday names indexed 0 (Sun) → 6 (Sat) */
const WEEKDAY_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

/** Months for display */
const MONTH_EN = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

/**
 * Maps every token that extractPreferredDate() can return
 * to a resolver function: (referenceDate: Date) → Date
 *
 * Tokens are the values from DAY_LABEL_MAP in conversational_intelligence.js
 * PLUS raw numeric tokens like "22/03", "15 तारीख", "22 तारीख" etc.
 */
const TOKEN_RESOLVERS = {

  /* ─── Relative day tokens ─── */
  'कल':            (ref) => addDays(ref, 1),
  'परसों':          (ref) => addDays(ref, 2),

  /* ─── Day-name tokens → next occurrence of that weekday ─── */
  'सोमवार':        (ref) => nextWeekday(ref, 1),
  'मंगलवार':       (ref) => nextWeekday(ref, 2),
  'बुधवार':        (ref) => nextWeekday(ref, 3),
  'गुरुवार':        (ref) => nextWeekday(ref, 4),
  'शुक्रवार':       (ref) => nextWeekday(ref, 5),
  'शनिवार':        (ref) => nextWeekday(ref, 6),
  'रविवार':        (ref) => nextWeekday(ref, 0),

  /* ─── Relative week / month tokens ─── */
  'अगले हफ्ते':   (ref) => addDays(ref, 7),
  '1 हफ्ते बाद':  (ref) => addDays(ref, 7),
  '2 दिन बाद':    (ref) => addDays(ref, 2),
  '3 दिन बाद':    (ref) => addDays(ref, 3),
  'अगले महीने':   (ref) => addMonths(ref, 1),
};

/* =====================================================================
   DATE ARITHMETIC HELPERS
   ===================================================================== */

/** Returns a new Date that is `n` days after `base` */
function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/** Returns a new Date that is `n` calendar months after `base` */
function addMonths(base, n) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + n);
  return d;
}

/**
 * Returns the next occurrence of `targetDay` (0=Sun … 6=Sat)
 * that is STRICTLY after `base` (never same day).
 */
function nextWeekday(base, targetDay) {
  const d = new Date(base);
  const current = d.getDay();
  let diff = targetDay - current;
  if (diff <= 0) diff += 7;   // always move forward
  d.setDate(d.getDate() + diff);
  return d;
}

/**
 * Resolves "22 तारीख" / "22/03" / "22 March" type tokens.
 * Finds the next future occurrence of day `dd` in month `mm` (1-based).
 * If `mm` is omitted, uses current month unless `dd` has already passed.
 *
 * @param {number} dd   day of month (1-31)
 * @param {number|null} mm  month (1-12) or null
 * @param {Date} ref    reference date
 */
function resolveNumericDate(dd, mm, ref) {
  const today = new Date(ref);
  today.setHours(0, 0, 0, 0);

  if (mm !== null) {
    // Explicit month given — find the date in that month this year or next
    const candidate = new Date(today.getFullYear(), mm - 1, dd);
    if (candidate <= today) candidate.setFullYear(candidate.getFullYear() + 1);
    return candidate;
  }

  // No month — try current month first
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), dd);
  if (thisMonth > today) return thisMonth;

  // Already passed → use next month
  return new Date(today.getFullYear(), today.getMonth() + 1, dd);
}

/* =====================================================================
   DISPLAY FORMATTER
   ===================================================================== */

/**
 * Formats a Date into "Monday, 3 March 2025"
 */
function formatDisplay(date) {
  const day   = WEEKDAY_EN[date.getDay()];
  const dd    = date.getDate();
  const month = MONTH_EN[date.getMonth()];
  const yyyy  = date.getFullYear();
  return `${day}, ${dd} ${month} ${yyyy}`;
}

/**
 * Formats a Date into ISO-8601 "YYYY-MM-DD"
 */
function formatISO(date) {
  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const dd   = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/* =====================================================================
   MAIN EXPORT: resolveDate
   ─────────────────────────────────────────────────────────────────────
   @param {string} rawToken        — token from extractPreferredDate()
   @param {Date}   [referenceDate] — defaults to today
   @returns {{ display: string, iso: string, raw: string } | null}
   ===================================================================== */
export function resolveDate(rawToken, referenceDate = new Date()) {
  if (!rawToken) return null;

  const ref = new Date(referenceDate);
  ref.setHours(0, 0, 0, 0);

  /* ── 1. Check named token map first ─────────────────────────────── */
  const resolver = TOKEN_RESOLVERS[rawToken.trim()];
  if (resolver) {
    const resolved = resolver(ref);
    return { display: formatDisplay(resolved), iso: formatISO(resolved), raw: rawToken };
  }

  /* ── 2. Numeric "DD/MM" or "DD/MM/YYYY" ─────────────────────────── */
  const slashMatch = rawToken.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
  if (slashMatch) {
    const dd = parseInt(slashMatch[1], 10);
    const mm = parseInt(slashMatch[2], 10);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const resolved = resolveNumericDate(dd, mm, ref);
      return { display: formatDisplay(resolved), iso: formatISO(resolved), raw: rawToken };
    }
  }

  /* ── 3. "DD तारीख" or "DD March" patterns ────────────────────────── */
  const dayOnly   = rawToken.match(/^(\d{1,2})\s+तारीख$/);
  const dayMonth  = rawToken.match(/^(\d{1,2})\s+([A-Za-zА-Яа-я\u0900-\u097F]+)$/);

  if (dayOnly) {
    const dd = parseInt(dayOnly[1], 10);
    if (dd >= 1 && dd <= 31) {
      const resolved = resolveNumericDate(dd, null, ref);
      return { display: formatDisplay(resolved), iso: formatISO(resolved), raw: rawToken };
    }
  }

  if (dayMonth) {
    const dd        = parseInt(dayMonth[1], 10);
    const monthName = dayMonth[2].toLowerCase();
    const mm        = resolveMonthNumber(monthName);
    if (dd >= 1 && dd <= 31 && mm !== null) {
      const resolved = resolveNumericDate(dd, mm, ref);
      return { display: formatDisplay(resolved), iso: formatISO(resolved), raw: rawToken };
    }
  }

  // Could not resolve — return null (caller decides fallback)
  return null;
}

/* =====================================================================
   EXPORT: formatForDB
   Convenience wrapper — returns only the display string for DB storage.
   ===================================================================== */
export function formatForDB(rawToken, referenceDate = new Date()) {
  const result = resolveDate(rawToken, referenceDate);
  return result ? result.display : rawToken; // fallback to raw token if unresolvable
}

/* =====================================================================
   HELPER: resolveMonthNumber
   Maps month name (English or Hindi) → 1-based month number.
   ===================================================================== */
const MONTH_MAP = {
  // English
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  // Hindi (Devanagari)
  'जनवरी':1,  'फरवरी':2,  'मार्च':3,    'अप्रैल':4,
  'मई':5,     'जून':6,    'जुलाई':7,    'अगस्त':8,
  'सितंबर':9, 'अक्टूबर':10,'नवंबर':11,  'दिसंबर':12,
};

function resolveMonthNumber(name) {
  return MONTH_MAP[name] ?? null;
}

export default { resolveDate, formatForDB };