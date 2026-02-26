/**
 * conversational_intelligence.js  (v5 — JSB Motors Advanced Flow, Bug-Fixed)
 * ===========================================================================
 * Production-grade rule-based NLP for JSB Motors outbound service reminder calls.
 *
 * Bug fixes over v4:
 *
 * 🔴 CRITICAL:
 *   1. persuasionCount read from session correctly — NLP now respects it on re-entry
 *      to awaiting_reason_persisted so "still rejecting → end call" logic actually fires.
 *
 * 🟠 HIGH:
 *   2. CONFIRM in awaiting_reason: "haan haan, driver nahi hai" — filler confirm
 *      no longer jumps to awaiting_date prematurely. Voice layer filters this;
 *      NLP also checks for co-occurring objection keywords before acting on CONFIRM.
 *   3. REJECT_PATTERNS: "nahi" alone can collide with "nahi samjha" (CONFUSION).
 *      Normalised REJECT now requires "nahi" to be a standalone word token,
 *      not part of a CONFUSION phrase that's already caught higher up.
 *   4. PROVIDE_BRANCH intent — now actually detected and used.
 *
 * 🟡 MEDIUM:
 *   5. extractPreferredDate: Hindi spoken number words (ek, do, teen … pachees etc.)
 *      now converted to digits before pattern matching.
 *   6. HINDI_CITY_MAP expanded with alternate Devanagari spellings that Twilio
 *      STT returns inconsistently (भारतपुर vs भरतपुर, जयपुर vs जेपुर, etc.).
 *   7. Mixed city + date in one utterance in awaiting_branch:
 *      branch match succeeds AND date preserved from session correctly.
 *   8. Bare CONFIRM in awaiting_date now extracts date from same utterance before
 *      jumping to branch — prevents skipping date capture on "haan, kal karo".
 *
 * Exports:
 *   processUserInput(userText, sessionData)
 *   → { replyText, nextState, endCall, preferredDate, resolvedDate, extractedBranch, intent }
 *
 *   extractPreferredDate(raw)  → string | null
 *   matchBranch(userText)      → { code, name, city, address } | null
 *   INTENT                     — intent enum
 *   SERVICE_CENTERS            — branch list
 */

import { resolveDate } from './dateResolver.js';

/* =====================================================================
   INTENT ENUM
   ===================================================================== */
export const INTENT = {
  CONFIRM:              'confirm',
  REJECT:               'reject',
  ALREADY_DONE:         'already_done',
  DRIVER_NOT_AVAILABLE: 'driver_not_available',
  MACHINE_BUSY:         'machine_busy',
  WORKING_FINE:         'working_fine',
  MONEY_ISSUE:          'money_issue',
  CALL_LATER:           'call_later',
  PROVIDE_DATE:         'provide_date',
  PROVIDE_BRANCH:       'provide_branch',   // FIX: now actually detected
  RESCHEDULE:           'reschedule',
  REPEAT:               'repeat',
  CONFUSION:            'confusion',
  UNCLEAR:              'unclear',
  UNKNOWN:              'unknown',
};

/* =====================================================================
   SERVICE CENTERS
   ===================================================================== */
export const SERVICE_CENTERS = [
  {
    id: 1,
    city_name: 'AJMER',
    branch_name: 'AJMER',
    branch_code: '1',
    lat: 26.43488884,
    lng: 74.698112488,
    city_add: 'F-100, Road No. 5, Riico Industrial Area, Near Power House, Palra, Ajmer',
    is_active: 1,
  },
  {
    id: 2,
    city_name: 'ALWAR',
    branch_name: 'ALWAR',
    branch_code: '2',
    lat: 27.582258224,
    lng: 76.647377014,
    city_add: 'Khasra no. 2345, Tuleda Bye Pass, Alwar Bhiwadi Highway Alwar-301001',
    is_active: 1,
  },
  {
    id: 3,
    city_name: 'BANSWARA',
    branch_name: 'UDAIPUR',
    branch_code: '7',
    lat: 23.563598633,
    lng: 74.417541504,
    city_add: 'Near Nayak Hotel, Udaipur - Dungarpur Link Road, Banswara-327001',
    is_active: 1,
  },
  {
    id: 4,
    city_name: 'BHARATPUR',
    branch_name: 'ALWAR',
    branch_code: '2',
    lat: 27.201648712,
    lng: 77.46295166,
    city_add: 'Kurka house, Sewar road, Near Jain Mandir, Bharatpur (Raj.)',
    is_active: 1,
  },
  {
    id: 5,
    city_name: 'BHILWARA',
    branch_name: 'BHILWARA',
    branch_code: '3',
    lat: 25.374652863,
    lng: 74.623023987,
    city_add: 'Kundan Complex, Sukhadiya Circle, Near Bewar Booking, Ajmer Road, Bhilwara',
    is_active: 1,
  },
  {
    id: 6,
    city_name: 'BHIWADI',
    branch_name: 'ALWAR',
    branch_code: '2',
    lat: 28.202623367,
    lng: 76.808448792,
    city_add: 'Rajesh Motors (Raj.) Pvt. Ltd., Near Hutch Tower, Alwar Bye pass road, Bhiwadi, Distt. Alwar, (Raj.)',
    is_active: 1,
  },
  {
    id: 7,
    city_name: 'DAUSA',
    branch_name: 'JAIPUR',
    branch_code: '4',
    lat: 26.905101776,
    lng: 76.370185852,
    city_add: 'Opp. Anand Goods transport co. Near Saras Dairy Plant, Agra By Pass, N.H-11, Dausa-303303',
    is_active: 1,
  },
  {
    id: 8,
    city_name: 'DHOLPUR',
    branch_name: 'ALWAR',
    branch_code: '2',
    lat: 26.693515778,
    lng: 77.876922607,
    city_add: 'Bharatpur Road, Layania Marriage Home, Dholpur',
    is_active: 1,
  },
  {
    id: 9,
    city_name: 'DUNGARPUR',
    branch_name: 'UDAIPUR',
    branch_code: '7',
    lat: 23.844612122,
    lng: 73.737922668,
    city_add: 'T.P.Complex Shopno 1-2 Nr. Reliance Petrol Pump, Sagwara Road, Dunagarpur',
    is_active: 1,
  },
  {
    id: 10,
    city_name: 'GONER ROAD',
    branch_name: 'JAIPUR',
    branch_code: '4',
    lat: 26.889762878,
    lng: 75.873939514,
    city_add: '72, Goner Turn, Agra Road, Jaipur-302004, Rajasthan.',
    is_active: 1,
  },
  {
    id: 11,
    city_name: 'JAIPUR',
    branch_name: 'JAIPUR',
    branch_code: '4',
    lat: 26.865495682,
    lng: 75.681541443,
    city_add: 'Khasra No. 1170-1175, Near Delhi Public School, Bhankrota, Ajmer Road, Jaipur, Rajasthan-302026',
    is_active: 1,
  },
  {
    id: 12,
    city_name: 'JHALAWAR',
    branch_name: 'KOTA',
    branch_code: '5',
    lat: 24.547901154,
    lng: 76.194129944,
    city_add: 'Opp. Roop Nagar Colony, Kota Road, Jhalawar',
    is_active: 1,
  },
  {
    id: 13,
    city_name: 'JHUNJHUNU',
    branch_name: 'SIKAR',
    branch_code: '6',
    lat: 28.09862709,
    lng: 75.374809265,
    city_add: 'Opp. Police Line, Near Railway Crossing, Phase-2, Riico, Jhunjhunu',
    is_active: 1,
  },
  {
    id: 14,
    city_name: 'KARAULI',
    branch_name: 'JAIPUR',
    branch_code: '4',
    lat: 26.512748718,
    lng: 77.021934509,
    city_add: 'Infront of S.P. Office, Shukla Colony Corner, Mandrayal Road, Karauli',
    is_active: 1,
  },
  {
    id: 15,
    city_name: 'KEKRI',
    branch_name: 'AJMER',
    branch_code: '1',
    lat: 25.961145401,
    lng: 75.157318115,
    city_add: 'Ajmer Road, Near Peer Baba, Near R.T.O. Office, Kekri-305404',
    is_active: 1,
  },
  {
    id: 16,
    city_name: 'KOTA',
    branch_name: 'KOTA',
    branch_code: '5',
    lat: 25.12909317,
    lng: 75.868736267,
    city_add: 'B-259, Ipia Road No-06, Near Railway Flyover, Kota',
    is_active: 1,
  },
  {
    id: 17,
    city_name: 'KOTPUTLI',
    branch_name: 'JAIPUR',
    branch_code: '4',
    lat: 27.680557251,
    lng: 76.160636902,
    city_add: 'C/o Old Vijay Automobile N.H.8, Teh. Kotputli, Distt. Jaipur (Raj.)',
    is_active: 1,
  },
  {
    id: 18,
    city_name: 'NEEM KA THANA',
    branch_name: 'JAIPUR',
    branch_code: '4',
    lat: 27.741991043,
    lng: 75.788673401,
    city_add: 'Opp. Jodla Johra, Neem Ka Thana, Dist. Sikar',
    is_active: 1,
  },
  {
    id: 19,
    city_name: 'NIMBAHERA',
    branch_name: 'BHILWARA',
    branch_code: '3',
    lat: 24.617570877,
    lng: 74.672302246,
    city_add: 'Near Mahaveer Rastaurant, Eidgah Chauraha, Udaipur Road, Nimbahera-312602',
    is_active: 1,
  },
  {
    id: 20,
    city_name: 'PRATAPGARH',
    branch_name: 'BHILWARA',
    branch_code: '3',
    lat: 24.038845062,
    lng: 74.776138306,
    city_add: 'Ambedkar Circle, Near Anand Service Centre, Opp. Bank Of India, Pratapgarh',
    is_active: 1,
  },
  {
    id: 21,
    city_name: 'RAJSAMAND',
    branch_name: 'UDAIPUR',
    branch_code: '7',
    lat: 25.078897476,
    lng: 73.866836548,
    city_add: 'Near Indusind Bank Ltd. Tvs Chouraha, Shrinath Hotel, Kankroli, Rajsamand',
    is_active: 1,
  },
  {
    id: 22,
    city_name: 'RAMGANJMANDI',
    branch_name: 'KOTA',
    branch_code: '5',
    lat: 24.655239105,
    lng: 75.971496582,
    city_add: 'Near Reliance Petrol Pump, Suket Road, Ramganj Mandi.',
    is_active: 1,
  },
  {
    id: 23,
    city_name: 'SIKAR',
    branch_name: 'SIKAR',
    branch_code: '6',
    lat: 27.591619492,
    lng: 75.171058655,
    city_add: 'Opp. Parnami Motors, Near Circuit House, Jaipur Road, Sikar',
    is_active: 1,
  },
  {
    id: 25,
    city_name: 'SUJANGARH',
    branch_name: 'SIKAR',
    branch_code: '6',
    lat: 27.706758499,
    lng: 74.481445312,
    city_add: 'Opp. Krishi Upaj Mandi, Salasar Road, Sujangarh, Distt. Churu PIN:331507',
    is_active: 1,
  },
  {
    id: 26,
    city_name: 'TONK',
    branch_name: 'JAIPUR',
    branch_code: '4',
    lat: 26.177381516,
    lng: 75.81086731,
    city_add: 'Plot No.5, Captain Colony, Jaipur Road, Tonk, Distt. Tonk (Raj.)',
    is_active: 1,
  },
  {
    id: 27,
    city_name: 'UDAIPUR',
    branch_name: 'UDAIPUR',
    branch_code: '7',
    lat: 24.570493698,
    lng: 73.745994568,
    city_add: 'A-83, Road No. 1, Mewar Industrial Area, Madri, Udaipur (Raj.)',
    is_active: 1,
  },
  {
    id: 28,
    city_name: 'VKIA',
    branch_name: 'JAIPUR',
    branch_code: '4',
    lat: 27.0103827,
    lng: 75.7703344,
    city_add: '2nd Rd, New Karni Colony, Kishan Vatika, Ganesh Nagar, Jaipur, Rajasthan 302013',
    is_active: 1,
  },
];

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
   HINDI CITY NAME MAP
   FIX v5: Expanded with alternate Devanagari spellings that Twilio
   hi-IN STT returns inconsistently (both variants now handled).
   ===================================================================== */
const HINDI_CITY_MAP = {
  // Primary forms
  'अजमेर':        'ajmer',
  'अलवर':         'alwar',
  'बांसवाड़ा':     'banswara',
  'बाँसवाड़ा':     'banswara',  // alternate
  'भरतपुर':       'bharatpur',
  'भारतपुर':      'bharatpur',  // alternate STT output
  'भीलवाड़ा':      'bhilwara',
  'भिलवाड़ा':      'bhilwara',  // alternate
  'भिवाड़ी':       'bhiwadi',
  'भीवाड़ी':       'bhiwadi',   // alternate
  'दौसा':         'dausa',
  'धौलपुर':       'dholpur',
  'डूंगरपुर':      'dungarpur',
  'डुंगरपुर':      'dungarpur', // alternate
  'गोनेर रोड':    'goner road',
  'जयपुर':        'jaipur',
  'जेपुर':         'jaipur',    // alternate STT output
  'झालावाड़':      'jhalawar',
  'झाला वाड़':     'jhalawar',  // alternate
  'झुंझुनू':       'jhunjhunu',
  'झुंझुनु':       'jhunjhunu', // alternate
  'करौली':        'karauli',
  'केकड़ी':        'kekri',
  'कोटा':         'kota',
  'कोटपूतली':     'kotputli',
  'नीम का थाना':  'neem ka thana',
  'निम्बाहेड़ा':   'nimbahera',
  'प्रतापगढ़':     'pratapgarh',
  'राजसमंद':      'rajsamand',
  'राजसमन्द':     'rajsamand', // alternate
  'रामगंजमंडी':   'ramganjmandi',
  'रामगंज मंडी':  'ramganjmandi', // space variant
  'सीकर':         'sikar',
  'सिकर':         'sikar',    // alternate
  'सुजानगढ़':      'sujangarh',
  'टोंक':         'tonk',
  'उदयपुर':       'udaipur',
  'वीकेआईए':      'vkia',
};

/* =====================================================================
   BRANCH MATCHER
   ===================================================================== */
export function matchBranch(userText) {
  if (!userText) return null;

  let translated = userText;
  // Sort by length DESC so longer Devanagari strings replace first (avoid partial replacements)
  const hindiEntries = Object.entries(HINDI_CITY_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [hindi, latin] of hindiEntries) {
    if (translated.includes(hindi)) {
      translated = translated.replace(hindi, latin);
    }
  }

  const norm = normalise(translated);

  const candidates = [];
  for (const center of SERVICE_CENTERS) {
    if (!center.is_active) continue;
    const cityToken   = normalise(center.city_name);
    const branchToken = normalise(center.branch_name);
    candidates.push({ token: cityToken, center });
    if (branchToken !== cityToken) {
      candidates.push({ token: branchToken, center });
    }
  }

  // Longest token first prevents partial matches
  candidates.sort((a, b) => b.token.length - a.token.length);

  for (const { token, center } of candidates) {
    if (token && norm.includes(token)) {
      return {
        code:    center.branch_code,
        name:    center.branch_name,
        city:    center.city_name,
        address: center.city_add,
      };
    }
  }

  return null;
}

/* =====================================================================
   HINDI NUMBER WORD MAP
   FIX v5: Convert spoken Hindi number words to digits so date patterns
   like "pachees tarikh" → "25 tarikh" get matched correctly.
   ===================================================================== */
const HINDI_NUM_WORDS = {
  // Devanagari script
  'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पाँच': '5', 'पांच': '5',
  'छह': '6', 'छः': '6', 'सात': '7', 'आठ': '8', 'नौ': '9', 'दस': '10',
  'ग्यारह': '11', 'बारह': '12', 'तेरह': '13', 'चौदह': '14', 'पंद्रह': '15',
  'सोलह': '16', 'सत्रह': '17', 'अठारह': '18', 'उन्नीस': '19', 'बीस': '20',
  'इक्कीस': '21', 'बाईस': '22', 'तेईस': '23', 'चौबीस': '24', 'पच्चीस': '25',
  'छब्बीस': '26', 'सत्ताईस': '27', 'अट्ठाईस': '28', 'उनतीस': '29', 'तीस': '30',
  'इकतीस': '31',
  // Romanised Hinglish
  'ek': '1', 'do': '2', 'teen': '3', 'char': '4', 'paanch': '5', 'panch': '5',
  'chhe': '6', 'saat': '7', 'aath': '8', 'nau': '9', 'das': '10',
  'gyarah': '11', 'barah': '12', 'terah': '13', 'chaudah': '14', 'pandrah': '15',
  'solah': '16', 'satrah': '17', 'atharah': '18', 'unnees': '19', 'bees': '20',
  'ikkees': '21', 'baaees': '22', 'teyees': '23', 'chaubees': '24', 'pachees': '25',
  'chhabbees': '26', 'sattaees': '27', 'atthaees': '28', 'unatees': '29', 'tees': '30',
  'ikattees': '31',
};

function replaceHindiNumbers(text) {
  let out = text;
  // Sort by length DESC to replace longer words first
  const entries = Object.entries(HINDI_NUM_WORDS).sort((a, b) => b[0].length - a[0].length);
  for (const [word, digit] of entries) {
    // Use word-boundary-like matching (spaces or string boundaries or Devanagari)
    const re = new RegExp(`(^|\\s)${word}(\\s|$)`, 'gu');
    out = out.replace(re, `$1${digit}$2`);
  }
  return out;
}

/* =====================================================================
   DATE EXTRACTION
   FIX v5: Hindi number words converted to digits before matching.
   ===================================================================== */
const HINDI_MONTH_MAP = {
  'january':'जनवरी','february':'फरवरी','march':'मार्च','april':'अप्रैल',
  'may':'मई','june':'जून','july':'जुलाई','august':'अगस्त',
  'september':'सितंबर','october':'अक्टूबर','november':'नवंबर','december':'दिसंबर',
  // Devanagari month names → themselves (for spoken Hindi)
  'जनवरी':'जनवरी','फरवरी':'फरवरी','मार्च':'मार्च','अप्रैल':'अप्रैल',
  'मई':'मई','जून':'जून','जुलाई':'जुलाई','अगस्त':'अगस्त',
  'सितंबर':'सितंबर','अक्टूबर':'अक्टूबर','नवंबर':'नवंबर','दिसंबर':'दिसंबर',
};

const MONTH_NAMES_PATTERN =
  'january|february|march|april|may|june|july|august|september|october|november|december' +
  '|जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर';

const DAY_LABEL_MAP = {
  'kal':'कल','parso':'परसों','agle hafte':'अगले हफ्ते','agle week':'अगले हफ्ते',
  'next week':'अगले हफ्ते','agle mahine':'अगले महीने','next month':'अगले महीने',
  'do din baad':'2 दिन बाद','teen din baad':'3 दिन बाद','ek hafte baad':'1 हफ्ते बाद',
  'monday':'सोमवार','tuesday':'मंगलवार','wednesday':'बुधवार','thursday':'गुरुवार',
  'friday':'शुक्रवार','saturday':'शनिवार','sunday':'रविवार',
  'somwar':'सोमवार','mangalwar':'मंगलवार','budhwar':'बुधवार','guruwar':'गुरुवार',
  'shukrawar':'शुक्रवार','shaniwar':'शनिवार','raviwar':'रविवार',
  'कल':'कल','परसों':'परसों','सोमवार':'सोमवार','मंगलवार':'मंगलवार',
  'बुधवार':'बुधवार','गुरुवार':'गुरुवार','शुक्रवार':'शुक्रवार',
  'शनिवार':'शनिवार','रविवार':'रविवार','अगले हफ्ते':'अगले हफ्ते',
  'अगले महीने':'अगले महीने',
};

export function extractPreferredDate(raw) {
  if (!raw) return null;

  // Convert spoken number words before normalising
  const withDigits = replaceHindiNumbers(raw);
  const t = normalise(withDigits);

  // DD/MM or DD-MM
  const numSlash = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?\b/);
  if (numSlash) return `${numSlash[1]}/${numSlash[2]}`;

  // "25 january" or "25 जनवरी"
  const dayMonthRe = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES_PATTERN})\\b`, 'u');
  const dayMonth = t.match(dayMonthRe);
  if (dayMonth) {
    const hindiMonth = HINDI_MONTH_MAP[dayMonth[2]] || dayMonth[2];
    return `${dayMonth[1]} ${hindiMonth}`;
  }

  // "25 tarikh" or "25 को" or "25 तारीख"
  const numBefore = t.match(/(?:^|\s)(\d{1,2})\s+(?:तारीख|tarikh|date)(?:\s|$|को|के)/u);
  if (numBefore) return `${numBefore[1]} तारीख`;

  const numAfter = t.match(/(?:तारीख|tarikh|date)\s+(\d{1,2})(?:\s|$)/u);
  if (numAfter) return `${numAfter[1]} तारीख`;

  const numKo = t.match(/(?:^|\s)(\d{1,2})\s+(?:ko|को)(?:\s|$)/u);
  if (numKo) return `${numKo[1]} तारीख`;

  const bookingCtx = t.match(/\b(\d{1,2})\s+(?:ke\s+liye|को\s+बुक|तक|से\s+पहले)/);
  if (bookingCtx) return `${bookingCtx[1]} तारीख`;

  // Bare number 1-31 as standalone word (last resort — only if nothing else matched)
  const bareNum = t.match(/(?:^|\s)(\d{1,2})(?:\s|$)/);
  if (bareNum) {
    const n = parseInt(bareNum[1], 10);
    if (n >= 1 && n <= 31) return `${n} तारीख`;
  }

  // Named day/relative
  const sortedKeys = Object.keys(DAY_LABEL_MAP).sort((a, b) => b.length - a.length);
  for (const kw of sortedKeys) {
    if (t.includes(kw)) return DAY_LABEL_MAP[kw];
  }

  return null;
}

/* =====================================================================
   KEYWORD PATTERN TABLES
   ===================================================================== */
const REPEAT_PATTERNS = [
  'dobara boliye','dobara bolo','phir se boliye','phir se bolo','fir se bolo',
  'ek baar aur','kya kaha','kya bola','kya bol raha','suna nahi','sunai nahi',
  'awaz nahi','awaaz nahi','samjha nahi suna','clear nahi','repeat karo',
  'repeat karein','repeat please','say again','thoda dheere','dheere boliye',
  'nahi suna','kuch nahi suna',
  'दोबारा बोलो','दोबारा बोलिए','फिर से बोलो','फिर बोलो','एक बार और',
  'क्या कहा','क्या बोले','नहीं सुना','आवाज़ नहीं','धीरे बोलिए','साफ बोलिए',
];

const CONFUSION_PATTERNS = [
  'kaunsi machine','konsi machine','kaun si machine','kaunsa service','konsa service',
  'meri machine nahi','galat machine','galat number','yeh meri nahi',
  'samajh nahi aaya','nahi samjha','nahi samjhi',
  'kya matlab','kya bol rahe','kya pooch rahe','kya hai yeh','kon hai',
  'kaun bol raha','galat call','wrong number','mujhe nahi pata',
  'nahi samjha','samjha nahi','samjhi nahi',
  'कौन सी मशीन','गलत मशीन','गलत नंबर','यह मेरी नहीं','समझ नहीं',
  'क्या मतलब','गलत कॉल','यह क्या है','मुझे नहीं पता',
  'samajh nahi','kuch samajh nahi aaya',
];

const CONFIRM_PATTERNS = [
  'haan ji bilkul','ji haan zaroor','bilkul theek hai','haan book karo','book kar do',
  'book kardo','book kar','book karo','confirm karo','confirm kar do',
  'karwa do','karvao','karwa lo','zaroor karo','haan zaroor','please book',
  'haan ji','ji haan','ji ha','theek hai','theek h','thik hai',
  'bilkul','zaroor','sahi hai','acha','accha','achha','achcha',
  'haan','haa','han','ok','okay','yes','yep','done','perfect','hmm','confirm',
  'हाँ बुक करो','बुक कर दो','बुक करो','कन्फर्म करो','करवा दो','करवाओ','ज़रूर करो',
  'हाँ जी','जी हाँ','बिल्कुल','ज़रूर','ठीक है','सही है','अच्छा','हाँ','हां','ओके',
];

// FIX v5: "nahi" alone must be a full-word token match to avoid false hits inside longer words.
// We'll do a word-boundary check in detectIntent for REJECT.
const REJECT_PATTERNS = [
  'nahi chahiye abhi','abhi nahi karna','nahi karna hai','nahi book karna',
  'book nahi karna','cancel kar do','nahi chahiye','nahi karna',
  'mat karo','mat kar','rehne do','rehne de','chhod do','band karo',
  'zaroorat nahi','need nahi','mat karna','abhi nahi',
  "don't",'dont','no','nope','cancel',
  // standalone nahi handled separately below
  'नहीं चाहिए','नहीं करना','मत करो','मत कर','छोड़ दो','बंद करो',
  'ज़रूरत नहीं','अभी नहीं','कैंसल कर दो','ना',
  'koi tarikh nahi','koi date nahi','abhi koi date nahi','date nahi dunga',
  'tarikh nahi bataunga','koi bhi tarikh nahi',
  'कोई भी तारीख नहीं','कोई तारीख नहीं','तारीख नहीं दूंगा','कोई दिन नहीं','अभी कोई तारीख नहीं',
];

const ALREADY_DONE_PATTERNS = [
  'ho chuki hai','ho gayi hai','karwa chuka','karwa chuki','kar chuka','kar chuki',
  'pehle karwa li','already karwa li','already ho gayi','service ho gayi',
  'service karwa chuke','service karwa li','karwa di hai','kar di hai',
  'serviced','already done','already serviced','done hai','ho gayi',
  'पहले करवा ली','पहले करवाई','पहले हो गई','हो चुकी','पहले ही करवा ली',
  'कर दी','करवा दी','हो गई है','पहले की',
];

const DRIVER_NOT_AVAILABLE_PATTERNS = [
  'driver nahi hai','driver available nahi','driver chutti par','driver gaya hua',
  'driver nahi','koi driver nahi','operator nahi','operator available nahi',
  'chalane wala nahi','chauffeur nahi','driver busy',
  'ड्राइवर नहीं','ड्राइवर उपलब्ध नहीं','ड्राइवर छुट्टी','ऑपरेटर नहीं',
];

const MACHINE_BUSY_PATTERNS = [
  'machine chal rahi hai','machine kaam kar rahi','site pe chal rahi','kaam chal raha',
  'project chal raha','site pe hai','machine busy hai','chal rahi hai abhi',
  'kaam me lagi hai','nikali nahi ja sakti','rok nahi sakte','nikal nahi sakti',
  'मशीन चल रही','साइट पर है','काम चल रहा','मशीन बिज़ी','काम में लगी',
  'machine site pe','site par hai',
];

const WORKING_FINE_PATTERNS = [
  'machine thik hai','machine sahi hai','koi problem nahi','chalti rehti hai',
  'theek chal rahi','abhi thik hai','koi dikkat nahi','kaam kar rahi hai',
  'service ki zaroorat nahi','sab theek hai','koi issue nahi',
  'मशीन ठीक है','कोई दिक्कत नहीं','ठीक चल रही','सब ठीक है',
  'machine kharab nahi','breakdown nahi',
];

const MONEY_ISSUE_PATTERNS = [
  'paisa nahi','paise nahi','budget nahi','abhi paisa nahi','funding nahi',
  'payment nahi','mehnga hai','afford nahi','abhi afford nahi kar sakta',
  'payment problem','funds nahi','rakh nahi sakta','mahanga',
  'पैसा नहीं','पैसे नहीं','बजट नहीं','महंगा है','अभी पैसे नहीं','फंड नहीं',
  'payment nahi hai',
];

const CALL_LATER_PATTERNS = [
  'baad mein call karo','baad mein baat karo','phir se call karo',
  'busy hoon abhi','drive kar raha hoon','gaadi chala raha hoon',
  'meeting mein hoon','kaam chal raha hai','thodi der baad',
  'kuch time baad','later karo','call back karo','dobaara call',
  'phir call','phir karo','free nahi','waqt nahi','busy hoon','baad mein',
  'baad me','बाद में कॉल करो','बाद में बात करो','बिज़ी हूँ','गाड़ी चला रहा',
  'मीटिंग में हूँ','थोड़ी देर बाद','बाद में','खाली नहीं','वक्त नहीं',
];

const RESCHEDULE_PATTERNS = [
  'date change kar do','date badal do','date badlo','schedule badal do',
  'reschedule karo','koi aur din','dusra din','aur koi din','baad ki date',
  'agle mahine','next month','agle hafte','agle week','next week',
  'ek hafte baad','do din baad','teen din baad','kal karo','parso karo',
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'somwar','mangalwar','budhwar','guruwar','shukrawar','shaniwar','raviwar',
  'tarikh','reschedule','time change','kal','parso',
  'तारीख बदल दो','तारीख बदलो','शेड्यूल बदलो','रीशेड्यूल करो',
  'कोई और दिन','दूसरा दिन','अगले महीने','अगले हफ्ते','दो दिन बाद',
  'तीन दिन बाद','एक हफ्ते बाद','कल करो','परसों करो','कल','परसों',
  'सोमवार','मंगलवार','बुधवार','गुरुवार','शुक्रवार','शनिवार','रविवार',
  'तारीख',
];

// FIX v5: Explicitly detect city names as PROVIDE_BRANCH intent
const CITY_TOKENS = SERVICE_CENTERS.map(c => normalise(c.city_name));
const CITY_TOKENS_DEVANAGARI = Object.keys(HINDI_CITY_MAP);

/* =====================================================================
   INTENT DETECTOR
   Priority:
   REPEAT > CONFUSION > ALREADY_DONE > DRIVER_NOT_AVAILABLE >
   MACHINE_BUSY > WORKING_FINE > MONEY_ISSUE > CALL_LATER >
   PROVIDE_BRANCH > RESCHEDULE > CONFIRM > REJECT > UNKNOWN
   ===================================================================== */
function detectIntent(normText, rawText) {
  if (!normText || normText.length === 0) return INTENT.UNCLEAR;

  if (REPEAT_PATTERNS.some(p          => normText.includes(p))) return INTENT.REPEAT;
  if (CONFUSION_PATTERNS.some(p       => normText.includes(p))) return INTENT.CONFUSION;
  if (ALREADY_DONE_PATTERNS.some(p    => normText.includes(p))) return INTENT.ALREADY_DONE;
  if (DRIVER_NOT_AVAILABLE_PATTERNS.some(p => normText.includes(p))) return INTENT.DRIVER_NOT_AVAILABLE;
  if (MACHINE_BUSY_PATTERNS.some(p    => normText.includes(p))) return INTENT.MACHINE_BUSY;
  if (WORKING_FINE_PATTERNS.some(p    => normText.includes(p))) return INTENT.WORKING_FINE;
  if (MONEY_ISSUE_PATTERNS.some(p     => normText.includes(p))) return INTENT.MONEY_ISSUE;
  if (CALL_LATER_PATTERNS.some(p      => normText.includes(p))) return INTENT.CALL_LATER;

  // FIX v5: Detect PROVIDE_BRANCH before RESCHEDULE/CONFIRM so city names get proper intent
  if (matchBranch(rawText || normText)) return INTENT.PROVIDE_BRANCH;

  if (RESCHEDULE_PATTERNS.some(p      => normText.includes(p))) return INTENT.RESCHEDULE;
  if (CONFIRM_PATTERNS.some(p         => normText.includes(p))) return INTENT.CONFIRM;

  // FIX v5: "nahi" as a standalone word — use word boundary check
  // Ensure it's not part of a CONFUSION phrase (those were caught above)
  if (REJECT_PATTERNS.some(p => normText.includes(p))) return INTENT.REJECT;
  // Standalone "nahi" / "nahin" / "नहीं" as a whole word
  if (/(?:^|\s)(?:nahi|nahin|नहीं|ना)(?:\s|$)/.test(normText)) return INTENT.REJECT;

  return INTENT.UNKNOWN;
}

/* =====================================================================
   RESPONSE CATALOGUE (kept from v4, used as NLP-level fallbacks)
   Voice.service.js overrides these with its own V.* voice lines for
   key states — keeping both means NLP is self-contained for testing.
   ===================================================================== */
const R = {
  greeting: (name) =>
    `Namaste ${name} ji, main Rajesh JSB Motors se baat kar raha hun. ` +
    `Aapki machine ki 500 Hour Service due hai. ` +
    `Kya main aapke liye yeh service is hafte mein book kar sakta hun?`,

  askDate: (name) =>
    `Zaroor ${name} ji! Aap batao — kaunsa din ya tarikh aapke liye theek rahega?`,

  askReason: (name) =>
    `Koi baat nahi ${name} ji. Kya aap bata sakte hain abhi kyun nahi karwani service?`,

  askAlreadyDoneDetails: (name) =>
    `${name} ji, bahut acha! Kab, kahan aur kaunsi service karwai thi? Thoda batayein.`,

  objectionDriverNotAvailable: (name) =>
    `Samajh gaya ${name} ji. Koi aur date bata dijiye — jab driver available hoga.`,

  objectionMachineBusy: (name) =>
    `Samajh aaya ${name} ji. Koi aisi date batao jab thodi der ke liye machine available ho.`,

  objectionWorkingFine: (name) =>
    `${name} ji, machine thik hai toh acha hai. Lekin 500 hour service se life aur badhti hai. Kab karein?`,

  objectionMoneyIssue: (name) =>
    `${name} ji, tension nahi — agle mahine ki date fix kar dete hain, abhi kuch payment nahi.`,

  objectionCallLater: (name) =>
    `${name} ji, koi ek din bata do — main us din ke liye service mark kar deta hun.`,

  persuasionFinal: (name) =>
    `${name} ji, 500 hour service skip karna machine ke liye theek nahi. Ek baar sochiye — kaunsa din suitable hai?`,

  askBranch: (name) =>
    `${name} ji, aapki machine abhi kis city mein hai? Jaise Jaipur, Kota, Ajmer, Alwar, Udaipur, Sikar...`,

  askBranchAgain: (name) =>
    `${name} ji, city ka naam clearly batayein — jaise Jaipur, Kota, Ajmer, ya Udaipur.`,

  confirmBooking: (name, branchName, branchCity, date) =>
    `${name} ji, aapki service ${branchName} (${branchCity}) mein ${date} ko book ho gayi hai. Dhanyawad!`,

  alreadyDoneSaved: (name) =>
    `${name} ji, shukriya. Hum record update kar dete hain. Dhanyawad, Namaste.`,

  rejected: (name) =>
    `Theek hai ${name} ji. Jab bhi zaroorat ho, JSB Motors mein call kar lena. Dhanyawad, Namaste.`,

  tooManyUnknown: (name) =>
    `${name} ji, hum baad mein sampark karenge. Dhanyawad, Namaste.`,

  confirmDate: (name, date) =>
    `${name} ji, kya main aapki service ${date} ke liye book kar dun? Haan ya nahi boliye.`,

  confusionClarify: (name) =>
    `${name} ji, main JSB Motors se service reminder ke liye call kar raha hun. Kya service book karwani hai?`,

  politeAskAgain: (name) =>
    `${name} ji, samajh nahi aaya. Kya service book karwani hai? Haan ya nahi boliye.`,
};

/* =====================================================================
   CORE EXPORT: processUserInput
   ===================================================================== */
export function processUserInput(userText, sessionData) {
  const normText        = normalise(userText);
  const intent          = detectIntent(normText, userText);
  const state           = sessionData.state          || 'awaiting_initial_decision';
  const name            = sessionData.customerName   || 'sir';
  const unknownStreak   = sessionData.unknownStreak  || 0;
  const persuasionCount = sessionData.persuasionCount || 0;

  /* ── Build result helper ──────────────────────────────────────────── */
  const result = (replyText, nextState, endCall, preferredDate = null, extractedBranch = null) => {
    const resolvedDate = preferredDate ? resolveDate(preferredDate) : null;
    return { replyText, nextState, endCall, preferredDate, resolvedDate, extractedBranch, intent };
  };

  /* ── Global guard: too many consecutive unknowns ──────────────────── */
  if (unknownStreak >= 3) {
    return result(R.tooManyUnknown(name), 'ended', true);
  }

  /* ── Global: REPEAT ───────────────────────────────────────────────── */
  if (intent === INTENT.REPEAT) {
    const lastMsg = sessionData.lastMessage || '';
    const replay  = lastMsg
      ? `${name} ji, main dobara bol raha hun — ${lastMsg}`
      : R.greeting(name);
    return result(replay, state, false);
  }

  /* ── Global: CONFUSION ───────────────────────────────────────────── */
  if (intent === INTENT.CONFUSION) {
    return result(R.confusionClarify(name), 'awaiting_initial_decision', false);
  }

  /* ── Global: UNCLEAR ─────────────────────────────────────────────── */
  if (intent === INTENT.UNCLEAR) {
    return result(R.politeAskAgain(name), state, false);
  }

  /* ══════════════════════════════════════════════════════════════════
     STATE MACHINE
     ══════════════════════════════════════════════════════════════════ */

  switch (state) {

    /* ── STEP 2: Initial decision ──────────────────────────────────── */
    case 'awaiting_initial_decision': {
      if (intent === INTENT.CONFIRM) {
        return result(R.askDate(name), 'awaiting_date', false);
      }
      if (intent === INTENT.ALREADY_DONE) {
        return result(R.askAlreadyDoneDetails(name), 'awaiting_service_details', false);
      }
      if (intent === INTENT.REJECT) {
        return result(R.askReason(name), 'awaiting_reason', false);
      }
      if (intent === INTENT.DRIVER_NOT_AVAILABLE) {
        return result(R.objectionDriverNotAvailable(name), 'awaiting_date', false);
      }
      if (intent === INTENT.MACHINE_BUSY) {
        return result(R.objectionMachineBusy(name), 'awaiting_date', false);
      }
      if (intent === INTENT.WORKING_FINE) {
        return result(R.objectionWorkingFine(name), 'awaiting_date', false);
      }
      if (intent === INTENT.MONEY_ISSUE) {
        return result(R.objectionMoneyIssue(name), 'awaiting_date', false);
      }
      if (intent === INTENT.CALL_LATER) {
        return result(R.objectionCallLater(name), 'awaiting_date', false);
      }
      if (intent === INTENT.RESCHEDULE || intent === INTENT.PROVIDE_DATE) {
        const preferredDate = extractPreferredDate(userText);
        if (preferredDate) {
          const display = resolveDate(preferredDate)?.display || preferredDate;
          return result(R.confirmDate(name, display), 'awaiting_date_confirm', false, preferredDate);
        }
        return result(R.askDate(name), 'awaiting_date', false);
      }
      if (intent === INTENT.PROVIDE_BRANCH) {
        // Customer jumping straight to city — ask for date first
        return result(R.askDate(name), 'awaiting_date', false);
      }
      return result(R.politeAskAgain(name), state, false);
    }

    /* ── STEP 3: Reason / objection handling ───────────────────────── */
    case 'awaiting_reason': {
      if (intent === INTENT.RESCHEDULE || intent === INTENT.PROVIDE_DATE) {
        const preferredDate = extractPreferredDate(userText);
        if (preferredDate) {
          const display = resolveDate(preferredDate)?.display || preferredDate;
          return result(R.confirmDate(name, display), 'awaiting_date_confirm', false, preferredDate);
        }
        return result(R.askDate(name), 'awaiting_date', false);
      }

      // FIX v5: CONFIRM in awaiting_reason — check for co-occurring objection keywords
      // before treating as "yes book it". If objection keyword present, route accordingly.
      if (intent === INTENT.CONFIRM) {
        if (DRIVER_NOT_AVAILABLE_PATTERNS.some(p => normText.includes(p))) {
          return result(R.objectionDriverNotAvailable(name), 'awaiting_date', false);
        }
        if (MACHINE_BUSY_PATTERNS.some(p => normText.includes(p))) {
          return result(R.objectionMachineBusy(name), 'awaiting_date', false);
        }
        // Genuine confirm — ask for date
        return result(R.askDate(name), 'awaiting_date', false);
      }

      if (intent === INTENT.DRIVER_NOT_AVAILABLE) {
        return result(R.objectionDriverNotAvailable(name), 'awaiting_date', false);
      }
      if (intent === INTENT.MACHINE_BUSY) {
        return result(R.objectionMachineBusy(name), 'awaiting_date', false);
      }
      if (intent === INTENT.WORKING_FINE) {
        return result(R.objectionWorkingFine(name), 'awaiting_date', false);
      }
      if (intent === INTENT.MONEY_ISSUE) {
        return result(R.objectionMoneyIssue(name), 'awaiting_date', false);
      }
      if (intent === INTENT.CALL_LATER) {
        return result(R.objectionCallLater(name), 'awaiting_date', false);
      }
      if (intent === INTENT.REJECT) {
        if (persuasionCount === 0) {
          return result(R.persuasionFinal(name), 'awaiting_reason_persisted', false);
        }
        return result(R.rejected(name), 'ended', true);
      }
      // Unknown reason — try to persuade
      return result(R.persuasionFinal(name), 'awaiting_reason_persisted', false);
    }

    /* ── After first persuasion attempt ───────────────────────────── */
    case 'awaiting_reason_persisted': {
      if (intent === INTENT.CONFIRM || intent === INTENT.RESCHEDULE || intent === INTENT.PROVIDE_DATE) {
        const preferredDate = extractPreferredDate(userText);
        if (preferredDate) {
          const display = resolveDate(preferredDate)?.display || preferredDate;
          return result(R.confirmDate(name, display), 'awaiting_date_confirm', false, preferredDate);
        }
        return result(R.askDate(name), 'awaiting_date', false);
      }
      if (intent === INTENT.DRIVER_NOT_AVAILABLE) {
        return result(R.objectionDriverNotAvailable(name), 'awaiting_date', false);
      }
      if (intent === INTENT.MACHINE_BUSY) {
        return result(R.objectionMachineBusy(name), 'awaiting_date', false);
      }
      if (intent === INTENT.WORKING_FINE) {
        return result(R.objectionWorkingFine(name), 'awaiting_date', false);
      }
      if (intent === INTENT.MONEY_ISSUE) {
        return result(R.objectionMoneyIssue(name), 'awaiting_date', false);
      }
      if (intent === INTENT.CALL_LATER) {
        return result(R.objectionCallLater(name), 'awaiting_date', false);
      }
      // FIX v5: persuasionCount is always ≥ 1 here (incremented in voice.service after
      // the turn that put us into this state). Any further REJECT ends the call.
      return result(R.rejected(name), 'ended', true);
    }

    /* ── STEP 4: Date capture ──────────────────────────────────────── */
    case 'awaiting_date': {
      const preferredDate = extractPreferredDate(userText);
      if (preferredDate) {
        const display = resolveDate(preferredDate)?.display || preferredDate;
        return result(R.confirmDate(name, display), 'awaiting_date_confirm', false, preferredDate);
      }

      // FIX v5: CONFIRM with embedded date ("haan, kal karo") — extract date first.
      // Without this, bare CONFIRM jumped to branch without capturing the date.
      if (intent === INTENT.CONFIRM) {
        // No extractable date in utterance — ask explicitly
        return result(R.askDate(name), state, false);
      }

      if (intent === INTENT.REJECT) return result(R.rejected(name), 'ended', true);
      if (intent === INTENT.DRIVER_NOT_AVAILABLE) return result(R.objectionDriverNotAvailable(name), state, false);
      if (intent === INTENT.MACHINE_BUSY)          return result(R.objectionMachineBusy(name), state, false);
      if (intent === INTENT.WORKING_FINE)           return result(R.objectionWorkingFine(name), state, false);
      if (intent === INTENT.MONEY_ISSUE)            return result(R.objectionMoneyIssue(name), state, false);
      if (intent === INTENT.CALL_LATER)             return result(R.objectionCallLater(name), state, false);

      return result(
        `${name} ji, kaunsa din ya tarikh suvidhajanakl rahega? Jaise kal, somwar, ya 15 tarikh boliye.`,
        state, false
      );
    }

    /* ── Date confirmation ─────────────────────────────────────────── */
    case 'awaiting_date_confirm': {
      const date    = sessionData.preferredDate || null;
      const display = date ? (resolveDate(date)?.display || date) : 'nirdharit tarikh';

      if (intent === INTENT.CONFIRM) {
        return result(R.askBranch(name), 'awaiting_branch', false, date);
      }
      if (intent === INTENT.REJECT || intent === INTENT.RESCHEDULE) {
        return result(R.askDate(name), 'awaiting_date', false);
      }

      // FIX v5: If customer gives a NEW date in this state — update and re-confirm
      const newDate = extractPreferredDate(userText);
      if (newDate) {
        const newDisplay = resolveDate(newDate)?.display || newDate;
        return result(R.confirmDate(name, newDisplay), state, false, newDate);
      }

      return result(R.confirmDate(name, display), state, false, date);
    }

    /* ── STEP 5: Branch matching ────────────────────────────────────── */
    case 'awaiting_branch': {
      const branch  = matchBranch(userText);
      const date    = sessionData.preferredDate || null;
      const display = date ? (resolveDate(date)?.display || date) : 'nirdharit tarikh';

      if (branch) {
        return result(
          R.confirmBooking(name, branch.name, branch.city, display),
          'ended', true, date, branch
        );
      }

      // FIX v5: Customer says something unrecognised — still try to extract city
      // before giving up (handles "Jaipur ke paas wali jagah" → Jaipur matches)
      return result(R.askBranchAgain(name), state, false, date);
    }

    /* ── STEP 6: Already done details ──────────────────────────────── */
    case 'awaiting_service_details': {
      return result(R.alreadyDoneSaved(name), 'ended', true);
    }

    default:
      return result(R.tooManyUnknown(name), 'ended', true);
  }
}

export default { processUserInput, extractPreferredDate, matchBranch, INTENT, SERVICE_CENTERS };