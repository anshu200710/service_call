/**
 * conversational_intelligence.js  (v4 — JSB Motors Advanced Flow)
 * ================================================================
 * Production-grade rule-based NLP for JSB Motors outbound service reminder calls.
 *
 * Exports:
 *   processUserInput(userText, sessionData)
 *   → { replyText, nextState, endCall, preferredDate, resolvedDate, extractedBranch, intent }
 *
 *   extractPreferredDate(raw)  → string | null
 *   INTENT                     — intent enum
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
  PROVIDE_BRANCH:       'provide_branch',
  REPEAT:               'repeat',
  CONFUSION:            'confusion',
  UNCLEAR:              'unclear',
  UNKNOWN:              'unknown',
};

/* =====================================================================
   SERVICE CENTERS — used by branch matching
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
   Maps Devanagari city speech -> normalised Latin city_name token.
   Twilio STT returns Hindi in Devanagari — we must match both scripts.
   ===================================================================== */
const HINDI_CITY_MAP = {
  'अजमेर':        'ajmer',
  'अलवर':         'alwar',
  'बांसवाड़ा':     'banswara',
  'भरतपुर':       'bharatpur',
  'भीलवाड़ा':      'bhilwara',
  'भिवाड़ी':       'bhiwadi',
  'दौसा':         'dausa',
  'धौलपुर':       'dholpur',
  'डूंगरपुर':      'dungarpur',
  'गोनेर रोड':    'goner road',
  'जयपुर':        'jaipur',
  'झालावाड़':      'jhalawar',
  'झुंझुनू':       'jhunjhunu',
  'करौली':        'karauli',
  'केकड़ी':        'kekri',
  'कोटा':         'kota',
  'कोटपूतली':     'kotputli',
  'नीम का थाना':  'neem ka thana',
  'निम्बाहेड़ा':   'nimbahera',
  'प्रतापगढ़':     'pratapgarh',
  'राजसमंद':      'rajsamand',
  'रामगंजमंडी':   'ramganjmandi',
  'सीकर':         'sikar',
  'सुजानगढ़':      'sujangarh',
  'टोंक':         'tonk',
  'उदयपुर':       'udaipur',
  'वीकेआईए':      'vkia',
};

/* =====================================================================
   BRANCH MATCHER
   Handles both Latin (romanised) and Devanagari (Hindi) speech input.
   Tries longest tokens first to avoid false short-string matches.
   Returns { code, name, city, address } for voice.service.js
   ===================================================================== */
export function matchBranch(userText) {
  if (!userText) return null;

  // Translate any Devanagari city tokens to Latin before normalising
  let translated = userText;
  for (const [hindi, latin] of Object.entries(HINDI_CITY_MAP)) {
    if (translated.includes(hindi)) {
      translated = translated.replace(hindi, latin);
    }
  }

  const norm = normalise(translated);

  const candidates = [];
  for (const center of SERVICE_CENTERS) {
    if (!center.is_active) continue;
    candidates.push({ token: normalise(center.city_name), center });
    const normBranch = normalise(center.branch_name);
    if (normBranch !== normalise(center.city_name)) {
      candidates.push({ token: normBranch, center });
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
  'samjha nahi','samjhi nahi','samajh nahi aaya','nahi samjha','nahi samjhi',
  'kya matlab','kya bol rahe','kya pooch rahe','kya hai yeh','kon hai',
  'kaun bol raha','galat call','wrong number','mujhe nahi pata','pata nahi',
  'kौन सी मशीन','गलत मशीन','गलत नंबर','यह मेरी नहीं','समझ नहीं',
  'क्या मतलब','गलत कॉल','यह क्या है','मुझे नहीं पता',
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

const REJECT_PATTERNS = [
  'nahi chahiye abhi','abhi nahi karna','nahi karna hai','nahi book karna',
  'book nahi karna','cancel kar do','nahi chahiye','nahi karna',
  'mat karo','mat kar','rehne do','rehne de','chhod do','band karo',
  'zaroorat nahi','need nahi','mat karna','abhi nahi',
  'nahi','nahin',"don't",'dont','no','nope','cancel',
  'नहीं चाहिए','नहीं करना','मत करो','मत कर','छोड़ दो','बंद करो',
  'ज़रूरत नहीं','अभी नहीं','कैंसल कर दो','नहीं','ना',
  // no-date rejections
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
  'कर दी','करवा दी','हो गई है','पहले की','service ho gayi',
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
  'तारीख','tarikh',
];

/* =====================================================================
   DATE EXTRACTION
   ===================================================================== */
const HINDI_MONTH_MAP = {
  'january':'जनवरी','february':'फरवरी','march':'मार्च','april':'अप्रैल',
  'may':'मई','june':'जून','july':'जुलाई','august':'अगस्त',
  'september':'सितंबर','october':'अक्टूबर','november':'नवंबर','december':'दिसंबर',
};

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
  const t = normalise(raw);

  const numSlash = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?\b/);
  if (numSlash) return `${numSlash[1]}/${numSlash[2]}`;

  const dayMonth = t.match(
    /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/
  );
  if (dayMonth) {
    const hindiMonth = HINDI_MONTH_MAP[dayMonth[2]] || dayMonth[2];
    return `${dayMonth[1]} ${hindiMonth}`;
  }

  const numBefore = t.match(/(?:^|\s)(\d{1,2})\s+(?:तारीख|tarikh|date)(?:\s|$|को|के)/u);
  if (numBefore) return `${numBefore[1]} तारीख`;

  const numAfter = t.match(/(?:तारीख|tarikh|date)\s+(\d{1,2})(?:\s|$)/u);
  if (numAfter) return `${numAfter[1]} तारीख`;

  const numKo = t.match(/(?:^|\s)(\d{1,2})\s+(?:ko|को)(?:\s|$)/u);
  if (numKo) return `${numKo[1]} तारीख`;

  const bookingCtx = t.match(/\b(\d{1,2})\s+(?:ke\s+liye|को\s+बुक|तक|से\s+पहले)/);
  if (bookingCtx) return `${bookingCtx[1]} तारीख`;

  const sortedKeys = Object.keys(DAY_LABEL_MAP).sort((a, b) => b.length - a.length);
  for (const kw of sortedKeys) {
    if (t.includes(kw)) return DAY_LABEL_MAP[kw];
  }

  return null;
}

/* =====================================================================
   INTENT DETECTOR
   Priority order: REPEAT > CONFUSION > ALREADY_DONE > DRIVER_NOT_AVAILABLE >
   MACHINE_BUSY > WORKING_FINE > MONEY_ISSUE > CALL_LATER > RESCHEDULE >
   CONFIRM > REJECT > UNKNOWN
   ===================================================================== */
function detectIntent(normText) {
  if (!normText || normText.length === 0) return INTENT.UNCLEAR;

  if (REPEAT_PATTERNS.some(p          => normText.includes(p))) return INTENT.REPEAT;
  if (CONFUSION_PATTERNS.some(p       => normText.includes(p))) return INTENT.CONFUSION;
  if (ALREADY_DONE_PATTERNS.some(p    => normText.includes(p))) return INTENT.ALREADY_DONE;
  if (DRIVER_NOT_AVAILABLE_PATTERNS.some(p => normText.includes(p))) return INTENT.DRIVER_NOT_AVAILABLE;
  if (MACHINE_BUSY_PATTERNS.some(p    => normText.includes(p))) return INTENT.MACHINE_BUSY;
  if (WORKING_FINE_PATTERNS.some(p    => normText.includes(p))) return INTENT.WORKING_FINE;
  if (MONEY_ISSUE_PATTERNS.some(p     => normText.includes(p))) return INTENT.MONEY_ISSUE;
  if (CALL_LATER_PATTERNS.some(p      => normText.includes(p))) return INTENT.CALL_LATER;
  if (RESCHEDULE_PATTERNS.some(p      => normText.includes(p))) return INTENT.RESCHEDULE;
  if (CONFIRM_PATTERNS.some(p         => normText.includes(p))) return INTENT.CONFIRM;
  if (REJECT_PATTERNS.some(p          => normText.includes(p))) return INTENT.REJECT;

  return INTENT.UNKNOWN;
}

/* =====================================================================
   UTILITIES
   ===================================================================== */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* =====================================================================
   RESPONSE CATALOGUE
   ===================================================================== */
const R = {
  greeting: (name) =>
    `Namashkar ${name} ji, main Rajesh JSB Motors se baat kar raha hun. ` +
    `Aapki gadi ki 500 Hour Service due hai. ` +
    `Kya main aapke liye yeh service agle ek week mein assign kar dun?`,

  askDate: (name) =>
    `Bahut acha ${name} ji. Aap kaunsi date ya din zyada suvidhajanakl paayenge? ` +
    `Jaise: kal, somwar, 25 tarikh, ya agle hafte.`,

  askReason: (name) =>
    `Thik hai ${name} ji, koi baat nahi. Kya aap bata sakte hain abhi kyun nahi karwani service?`,

  askAlreadyDoneDetails: (name) =>
    `${name} ji, acha! Kab, kahan aur kaunsi service karwai thi? Thoda batayein.`,

  // Objection persuasion
  objectionDriverNotAvailable: (name) =>
    `Thik hai ${name} ji, koi aur date bata dijiye — jaise agle hafte ya mahine mein. ` +
    `Regular maintenance se breakdown nahi hoga, isme aapka hi fayda hai.`,

  objectionMachineBusy: (name) =>
    `Samajh aaya ${name} ji. Maintenance zaruri hai taki site par breakdown na ho. ` +
    `Koi aisi date batayein jab thodi der ke liye machine available ho.`,

  objectionWorkingFine: (name) =>
    `${name} ji, machine abhi thik chal rahi hai, yeh acha hai. ` +
    `Lekin regular 500 hour maintenance se performance better rehti hai aur badi repair bachti hai. ` +
    `Kab convenient rahega?`,

  objectionMoneyIssue: (name) =>
    `Bilkul samajh aaya ${name} ji. Koi tension nahi — agle mahine ki ek date fix kar dete hain. ` +
    `Aapko abhi kuch nahi dena. Kaunsa time acha lagega?`,

  objectionCallLater: (name) =>
    `${name} ji, aapka time valuable hai. Aap ek date bata dijiye — hum usi din service assign kar denge.`,

  persuasionFinal: (name) =>
    `${name} ji, main samajh sakta hun. Lekin 500 hour service skip karne se machine life kam hoti hai. ` +
    `Ek baar zaroor sochiye — kaunsa din suitable rahega?`,

  askBranch: (name) =>
    `${name} ji, aapki machine abhi kis city mein hai? ` +
    `Jaise: Jaipur, Kota, Ajmer, Alwar, Udaipur, Sikar, Bhilwara, Tonk, Dausa, Sikar, etc.`,

  askBranchAgain: (name) =>
    `${name} ji, city ka naam clearly batayein — jaise Jaipur, Kota, Ajmer, Alwar, Udaipur, Sikar, Bhilwara, Bharatpur, ya Dungarpur.`,

  confirmBooking: (name, branchName, branchCity, date) =>
    `${name} ji, aapki service ${branchName} branch (${branchCity}) mein ${date} ko assign kar di gayi hai. ` +
    `Hamare engineer us din aapse sampark karenge. Dhanyawad, Namashkar.`,

  alreadyDoneSaved: (name) =>
    `${name} ji, shukriya information ke liye. Hum record update kar dete hain. ` +
    `Agle service ke waqt zaroor sampark karein. Dhanyawad, Namashkar.`,

  rejected: (name) =>
    `Thik hai ${name} ji. Jab bhi zaroorat ho, JSB Motors mein zaroor sampark karein. Dhanyawad, Namashkar.`,

  tooManyUnknown: (name) =>
    `${name} ji, hum aapse baad mein sampark karenge. Dhanyawad, Namashkar.`,

  confirmDate: (name, date) =>
    `${name} ji, kya main aapki service ${date} ke liye schedule kar dun? Haan ya nahi boliye.`,

  confusionClarify: (name) =>
    `${name} ji, main JSB Motors se service reminder ke liye call kar raha hun. ` +
    `Kya aap service book karwana chahte hain? Haan ya nahi boliye.`,

  politeAskAgain: (name) => pick([
    `Maafi chahta hun ${name} ji, samajh nahi aaya. Kya service book karwani hai? Haan ya nahi.`,
    `${name} ji, thoda clearly boliye — service assign kar dun kya?`,
  ]),
};

/* =====================================================================
   CORE EXPORT: processUserInput
   ===================================================================== */
export function processUserInput(userText, sessionData) {
  const normText      = normalise(userText);
  const intent        = detectIntent(normText);
  const state         = sessionData.state        || 'awaiting_initial_decision';
  const name          = sessionData.customerName || 'sir';
  const unknownStreak = sessionData.unknownStreak || 0;
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
      if (intent === INTENT.RESCHEDULE) {
        const preferredDate = extractPreferredDate(userText);
        if (preferredDate) {
          const display = resolveDate(preferredDate)?.display || preferredDate;
          return result(R.confirmDate(name, display), 'awaiting_date_confirm', false, preferredDate);
        }
        return result(R.askDate(name), 'awaiting_date', false);
      }
      return result(R.politeAskAgain(name), state, false);
    }

    /* ── STEP 3: Reason / objection handling ───────────────────────── */
    case 'awaiting_reason': {
      // RESCHEDULE with an explicit date → fast-track to date confirm
      if (intent === INTENT.RESCHEDULE) {
        const preferredDate = extractPreferredDate(userText);
        if (preferredDate) {
          const display = resolveDate(preferredDate)?.display || preferredDate;
          return result(R.confirmDate(name, display), 'awaiting_date_confirm', false, preferredDate);
        }
        return result(R.askDate(name), 'awaiting_date', false);
      }
      // FIX: bare CONFIRM in awaiting_reason ("हाँ हाँ मैंने बताया ना") means
      // customer is acknowledging/frustrated — NOT confirming a booking.
      // Move to persuasion first; let them say a date or agree properly.
      if (intent === INTENT.CONFIRM) {
        return result(R.persuasionFinal(name), 'awaiting_reason_persisted', false);
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
          // First persuasion attempt
          return result(R.persuasionFinal(name), 'awaiting_reason_persisted', false);
        }
        // Still rejecting after persuasion → end
        return result(R.rejected(name), 'ended', true);
      }
      // Unknown reason captured → try to persuade
      return result(R.persuasionFinal(name), 'awaiting_reason_persisted', false);
    }

    /* ── After first persuasion attempt ───────────────────────────── */
    case 'awaiting_reason_persisted': {
      if (intent === INTENT.CONFIRM || intent === INTENT.RESCHEDULE) {
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
      // Final rejection
      return result(R.rejected(name), 'ended', true);
    }

    /* ── STEP 4: Date capture ──────────────────────────────────────── */
    case 'awaiting_date': {
      const preferredDate = extractPreferredDate(userText);
      if (preferredDate) {
        const display = resolveDate(preferredDate)?.display || preferredDate;
        return result(R.confirmDate(name, display), 'awaiting_date_confirm', false, preferredDate);
      }
      if (intent === INTENT.REJECT) return result(R.rejected(name), 'ended', true);
      // OBJECTION intents still valid here (customer keeps explaining)
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
      return result(R.askBranchAgain(name), state, false, date);
    }

    /* ── STEP 6: Already done details ──────────────────────────────── */
    case 'awaiting_service_details': {
      // Capture whatever they say and end
      return result(R.alreadyDoneSaved(name), 'ended', true);
    }

    default:
      return result(R.tooManyUnknown(name), 'ended', true);
  }
}

export default { processUserInput, extractPreferredDate, matchBranch, INTENT, SERVICE_CENTERS };