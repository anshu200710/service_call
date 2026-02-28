/* =====================================================================
   IST "NOW"
   FIX: Use IST offset (UTC+5:30) so that a call at 11pm UTC
   (= 4:30am IST next day) resolves "kal" correctly.
   ===================================================================== */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/** Midnight IST today as a UTC Date object */
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
   Finds the NEXT occurrence of targetDay (0=Sun … 6=Sat) after today.
   ===================================================================== */
function nextWeekday(targetDay) {
  const today = todayIST();
  let diff = targetDay - today.getUTCDay();
  if (diff <= 0) diff += 7;
  return addDays(today, diff);
}

/* =====================================================================
   NUMERIC DATE RESOLVER
   Finds the next future occurrence of day `dd` (optionally in month `mm`).
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

  // No month — try current month, then next
  let d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), dd));
  if (isNaN(d.getTime()) || d <= today) {
    d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, dd));
  }
  return isNaN(d.getTime()) ? null : d;
}

/* =====================================================================
   MONTH NAME MAP (Hindi + English → 1-based month number)
   ===================================================================== */
const MONTH_INDEX = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
  jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12,
  जनवरी:1, फरवरी:2, मार्च:3, अप्रैल:4, मई:5, जून:6,
  जुलाई:7, अगस्त:8, सितंबर:9, अक्टूबर:10, नवंबर:11, दिसंबर:12,
};

/* =====================================================================
   WEEKDAY MAP (Hindi + Rajasthani + Bhojpuri + English)
   ===================================================================== */
const WEEKDAY_INDEX = {
  // English
  sunday:0, sun:0, monday:1, mon:1, tuesday:2, tue:2,
  wednesday:3, wed:3, thursday:4, thu:4, friday:5, fri:5, saturday:6, sat:6,
  // Hinglish
  somwar:1, samvar:1, mangalwar:2, mangal:2, budhwar:3, budh:3,
  guruwar:4, guru:4, shukrawar:5, shukra:5, shaniwar:6, shani:6, raviwar:0, ravi:0,
  // Devanagari
  सोमवार:1, समवार:1, मंगलवार:2, मंगल:2, बुधवार:3, बुध:3,
  गुरुवार:4, गुरु:4, शुक्रवार:5, शुक्र:5, शनिवार:6, शनि:6, रविवार:0, रवि:0,
};

/* =====================================================================
   TOKEN NORMALISER
   ===================================================================== */
function normToken(t) {
  return (t || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/* =====================================================================
   MAIN EXPORT: resolveDate
   @param {string} rawToken  — from extractPreferredDate()
   @returns {{ display: string, iso: string } | null}
   ===================================================================== */
export function resolveDate(rawToken) {
  if (!rawToken) return null;

  const t     = normToken(rawToken);
  const today = todayIST();

  /* ── कल / kal (tomorrow) ── */
  if (t === "कल" || t === "kal")
    return makeResult(addDays(today, 1));

  /* ── परसों / parso (day after tomorrow) ── */
  if (t === "परसों" || t === "parso" || t === "parson")
    return makeResult(addDays(today, 2));

  /* ── अगले / agle / agla / next / asap → tomorrow ── */
  if (["अगले","अगले ही","अगला","agle","agle hi","agla","next","asap"].includes(t))
    return makeResult(addDays(today, 1));

  /* ── अगले हफ्ते / next week → next Monday ── */
  if (["अगले हफ्ते","agle hafte","agle week","next week"].includes(t))
    return makeResult(nextWeekday(1));

  /* ── अगले महीने / next month → 1st of next month ── */
  if (["अगले महीने","agle mahine","next month"].includes(t))
    return makeResult(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)));

  /* ── N दिन बाद / N din baad ── */
  const dinBaad = t.match(/^(\d+)\s*(?:दिन बाद|din baad|days? later|days? baad)$/u);
  if (dinBaad) return makeResult(addDays(today, parseInt(dinBaad[1], 10)));

  /* ── N हफ्ते बाद / N hafte baad ── */
  const hafteBaad = t.match(/^(\d+)\s*(?:हफ्ते बाद|hafte baad|week baad|weeks? later)$/u);
  if (hafteBaad) return makeResult(addDays(today, parseInt(hafteBaad[1], 10) * 7));

  /* ── Named weekday ── */
  if (WEEKDAY_INDEX[t] !== undefined)
    return makeResult(nextWeekday(WEEKDAY_INDEX[t]));

  /* ── DD तारीख / DD tarikh ── */
  const dayOnly = t.match(/^(\d{1,2})\s*(?:तारीख|tarikh|date)?$/u);
  if (dayOnly) {
    const dd = parseInt(dayOnly[1], 10);
    return makeResult(resolveNumericDate(dd));
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

  /* ── DD MonthName e.g. "25 march" / "25 मार्च" ── */
  const dayMonthMatch = t.match(/^(\d{1,2})\s+(.+)$/u);
  if (dayMonthMatch) {
    const dd        = parseInt(dayMonthMatch[1], 10);
    const monthName = dayMonthMatch[2].trim();
    const mm        = MONTH_INDEX[monthName] || MONTH_INDEX[monthName.toLowerCase()];
    if (mm !== undefined) return makeResult(resolveNumericDate(dd, mm));
  }

  // Unresolvable
  return null;
}

/** Convenience: returns only the display string for DB storage */
export function formatForDB(rawToken) {
  const r = resolveDate(rawToken);
  return r ? r.display : rawToken;
}

export default { resolveDate, formatForDB };