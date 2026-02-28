import { resolveDate } from "./dateResolver.js";

/* =====================================================================
   INTENT ENUM
   ===================================================================== */
export const INTENT = {
  CONFIRM: "confirm",
  REJECT: "reject",
  ALREADY_DONE: "already_done",
  DRIVER_NOT_AVAILABLE: "driver_not_available",
  MACHINE_BUSY: "machine_busy",
  WORKING_FINE: "working_fine",
  MONEY_ISSUE: "money_issue",
  CALL_LATER: "call_later",
  PROVIDE_DATE: "provide_date",
  PROVIDE_BRANCH: "provide_branch",
  RESCHEDULE: "reschedule",
  REPEAT: "repeat",
  CONFUSION: "confusion",
  UNCLEAR: "unclear",
  UNKNOWN: "unknown",
};

/* =====================================================================
   SERVICE CENTERS
   ===================================================================== */
export const SERVICE_CENTERS = [
  { id:1,  city_name:"AJMER",       branch_name:"AJMER",    branch_code:"1", lat:26.43488884,  lng:74.698112488, city_add:"F-100, Road No. 5, Riico Industrial Area, Near Power House, Palra, Ajmer",                                               is_active:1 },
  { id:2,  city_name:"ALWAR",       branch_name:"ALWAR",    branch_code:"2", lat:27.582258224, lng:76.647377014, city_add:"Khasra no. 2345, Tuleda Bye Pass, Alwar Bhiwadi Highway Alwar-301001",                                                    is_active:1 },
  { id:3,  city_name:"BANSWARA",    branch_name:"UDAIPUR",  branch_code:"7", lat:23.563598633, lng:74.417541504, city_add:"Near Nayak Hotel, Udaipur - Dungarpur Link Road, Banswara-327001",                                                        is_active:1 },
  { id:4,  city_name:"BHARATPUR",   branch_name:"ALWAR",    branch_code:"2", lat:27.201648712, lng:77.46295166,  city_add:"Kurka house, Sewar road, Near Jain Mandir, Bharatpur (Raj.)",                                                             is_active:1 },
  { id:5,  city_name:"BHILWARA",    branch_name:"BHILWARA", branch_code:"3", lat:25.374652863, lng:74.623023987, city_add:"Kundan Complex, Sukhadiya Circle, Near Bewar Booking, Ajmer Road, Bhilwara",                                              is_active:1 },
  { id:6,  city_name:"BHIWADI",     branch_name:"ALWAR",    branch_code:"2", lat:28.202623367, lng:76.808448792, city_add:"Rajesh Motors (Raj.) Pvt. Ltd., Near Hutch Tower, Alwar Bye pass road, Bhiwadi",                                          is_active:1 },
  { id:7,  city_name:"DAUSA",       branch_name:"JAIPUR",   branch_code:"4", lat:26.905101776, lng:76.370185852, city_add:"Opp. Anand Goods transport co. Near Saras Dairy Plant, Agra By Pass, N.H-11, Dausa-303303",                               is_active:1 },
  { id:8,  city_name:"DHOLPUR",     branch_name:"ALWAR",    branch_code:"2", lat:26.693515778, lng:77.876922607, city_add:"Bharatpur Road, Layania Marriage Home, Dholpur",                                                                          is_active:1 },
  { id:9,  city_name:"DUNGARPUR",   branch_name:"UDAIPUR",  branch_code:"7", lat:23.844612122, lng:73.737922668, city_add:"T.P.Complex Shopno 1-2 Nr. Reliance Petrol Pump, Sagwara Road, Dunagarpur",                                               is_active:1 },
  { id:10, city_name:"GONER ROAD",  branch_name:"JAIPUR",   branch_code:"4", lat:26.889762878, lng:75.873939514, city_add:"72, Goner Turn, Agra Road, Jaipur-302004, Rajasthan.",                                                                    is_active:1 },
  { id:11, city_name:"JAIPUR",      branch_name:"JAIPUR",   branch_code:"4", lat:26.865495682, lng:75.681541443, city_add:"Khasra No. 1170-1175, Near Delhi Public School, Bhankrota, Ajmer Road, Jaipur, Rajasthan-302026",                         is_active:1 },
  { id:12, city_name:"JHALAWAR",    branch_name:"KOTA",     branch_code:"5", lat:24.547901154, lng:76.194129944, city_add:"Opp. Roop Nagar Colony, Kota Road, Jhalawar",                                                                             is_active:1 },
  { id:13, city_name:"JHUNJHUNU",   branch_name:"SIKAR",    branch_code:"6", lat:28.09862709,  lng:75.374809265, city_add:"Opp. Police Line, Near Railway Crossing, Phase-2, Riico, Jhunjhunu",                                                      is_active:1 },
  { id:14, city_name:"KARAULI",     branch_name:"JAIPUR",   branch_code:"4", lat:26.512748718, lng:77.021934509, city_add:"Infront of S.P. Office, Shukla Colony Corner, Mandrayal Road, Karauli",                                                   is_active:1 },
  { id:15, city_name:"KEKRI",       branch_name:"AJMER",    branch_code:"1", lat:25.961145401, lng:75.157318115, city_add:"Ajmer Road, Near Peer Baba, Near R.T.O. Office, Kekri-305404",                                                            is_active:1 },
  { id:16, city_name:"KOTA",        branch_name:"KOTA",     branch_code:"5", lat:25.12909317,  lng:75.868736267, city_add:"B-259, Ipia Road No-06, Near Railway Flyover, Kota",                                                                      is_active:1 },
  { id:17, city_name:"KOTPUTLI",    branch_name:"JAIPUR",   branch_code:"4", lat:27.680557251, lng:76.160636902, city_add:"C/o Old Vijay Automobile N.H.8, Teh. Kotputli, Distt. Jaipur (Raj.)",                                                     is_active:1 },
  { id:18, city_name:"NEEM KA THANA",branch_name:"JAIPUR",  branch_code:"4", lat:27.741991043, lng:75.788673401, city_add:"Opp. Jodla Johra, Neem Ka Thana, Dist. Sikar",                                                                           is_active:1 },
  { id:19, city_name:"NIMBAHERA",   branch_name:"BHILWARA", branch_code:"3", lat:24.617570877, lng:74.672302246, city_add:"Near Mahaveer Rastaurant, Eidgah Chauraha, Udaipur Road, Nimbahera-312602",                                               is_active:1 },
  { id:20, city_name:"PRATAPGARH",  branch_name:"BHILWARA", branch_code:"3", lat:24.038845062, lng:74.776138306, city_add:"Ambedkar Circle, Near Anand Service Centre, Opp. Bank Of India, Pratapgarh",                                              is_active:1 },
  { id:21, city_name:"RAJSAMAND",   branch_name:"UDAIPUR",  branch_code:"7", lat:25.078897476, lng:73.866836548, city_add:"Near Indusind Bank Ltd. Tvs Chouraha, Shrinath Hotel, Kankroli, Rajsamand",                                               is_active:1 },
  { id:22, city_name:"RAMGANJMANDI",branch_name:"KOTA",     branch_code:"5", lat:24.655239105, lng:75.971496582, city_add:"Near Reliance Petrol Pump, Suket Road, Ramganj Mandi.",                                                                   is_active:1 },
  { id:23, city_name:"SIKAR",       branch_name:"SIKAR",    branch_code:"6", lat:27.591619492, lng:75.171058655, city_add:"Opp. Parnami Motors, Near Circuit House, Jaipur Road, Sikar",                                                             is_active:1 },
  { id:25, city_name:"SUJANGARH",   branch_name:"SIKAR",    branch_code:"6", lat:27.706758499, lng:74.481445312, city_add:"Opp. Krishi Upaj Mandi, Salasar Road, Sujangarh, Distt. Churu PIN:331507",                                                is_active:1 },
  { id:26, city_name:"TONK",        branch_name:"JAIPUR",   branch_code:"4", lat:26.177381516, lng:75.81086731,  city_add:"Plot No.5, Captain Colony, Jaipur Road, Tonk, Distt. Tonk (Raj.)",                                                        is_active:1 },
  { id:27, city_name:"UDAIPUR",     branch_name:"UDAIPUR",  branch_code:"7", lat:24.570493698, lng:73.745994568, city_add:"A-83, Road No. 1, Mewar Industrial Area, Madri, Udaipur (Raj.)",                                                          is_active:1 },
  { id:28, city_name:"VKIA",        branch_name:"JAIPUR",   branch_code:"4", lat:27.0103827,   lng:75.7703344,   city_add:"2nd Rd, New Karni Colony, Kishan Vatika, Ganesh Nagar, Jaipur, Rajasthan 302013",                                          is_active:1 },
];

/* =====================================================================
   TEXT NORMALISER
   ===================================================================== */
function normalise(raw) {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"()[\]{}।॥]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =====================================================================
   HINDI CITY NAME MAP  (expanded with Rajasthani/alternate STT variants)
   ===================================================================== */
const HINDI_CITY_MAP = {
  अजमेर:"ajmer",    अजमेरा:"ajmer",
  अलवर:"alwar",     अलावर:"alwar",
  बांसवाड़ा:"banswara", बाँसवाड़ा:"banswara", बासवाड़ा:"banswara",
  भरतपुर:"bharatpur",  भारतपुर:"bharatpur",
  भीलवाड़ा:"bhilwara", भिलवाड़ा:"bhilwara", भिलवारा:"bhilwara",
  भिवाड़ी:"bhiwadi",  भीवाड़ी:"bhiwadi",  भिवादी:"bhiwadi",
  दौसा:"dausa",     दावसा:"dausa",
  धौलपुर:"dholpur", धोलपुर:"dholpur",
  डूंगरपुर:"dungarpur", डुंगरपुर:"dungarpur", दुंगरपुर:"dungarpur",
  "गोनेर रोड":"goner road",
  जयपुर:"jaipur",   जेपुर:"jaipur",    जैपुर:"jaipur",
  झालावाड़:"jhalawar", "झाला वाड़":"jhalawar",
  झुंझुनू:"jhunjhunu", झुंझुनु:"jhunjhunu", झुझुनू:"jhunjhunu",
  करौली:"karauli",  करोली:"karauli",
  केकड़ी:"kekri",   केकरी:"kekri",
  कोटा:"kota",      कोट:"kota",
  कोटपूतली:"kotputli",
  "नीम का थाना":"neem ka thana",
  निम्बाहेड़ा:"nimbahera", निंबाहेड़ा:"nimbahera",
  प्रतापगढ़:"pratapgarh",
  राजसमंद:"rajsamand", राजसमन्द:"rajsamand",
  रामगंजमंडी:"ramganjmandi", "रामगंज मंडी":"ramganjmandi",
  सीकर:"sikar",     सिकर:"sikar",
  सुजानगढ़:"sujangarh",
  टोंक:"tonk",
  उदयपुर:"udaipur", उदैपुर:"udaipur",
  वीकेआईए:"vkia",
};

/* =====================================================================
   BRANCH MATCHER (pre-cached candidates)
   ===================================================================== */
const SORTED_HINDI_ENTRIES = Object.entries(HINDI_CITY_MAP).sort(
  (a, b) => b[0].length - a[0].length
);

const BRANCH_CANDIDATES = SERVICE_CENTERS
  .filter(c => c.is_active)
  .flatMap(center => {
    const ct = normalise(center.city_name);
    const bt = normalise(center.branch_name);
    const r  = [{ token: ct, center }];
    if (bt !== ct) r.push({ token: bt, center });
    return r;
  })
  .sort((a, b) => b.token.length - a.token.length);

export function matchBranch(userText) {
  if (!userText) return null;
  let translated = userText;
  for (const [hindi, latin] of SORTED_HINDI_ENTRIES) {
    if (translated.includes(hindi)) translated = translated.replace(hindi, latin);
  }
  const norm = normalise(translated);
  for (const { token, center } of BRANCH_CANDIDATES) {
    if (token && norm.includes(token)) {
      return { code: center.branch_code, name: center.branch_name, city: center.city_name, address: center.city_add };
    }
  }
  return null;
}

/* =====================================================================
   HINDI NUMBER WORD MAP
   ===================================================================== */
const HINDI_NUM_WORDS = {
  एक:"1",दो:"2",तीन:"3",चार:"4",पाँच:"5",पांच:"5",छह:"6",छः:"6",
  सात:"7",आठ:"8",नौ:"9",दस:"10",ग्यारह:"11",बारह:"12",तेरह:"13",
  चौदह:"14",पंद्रह:"15",सोलह:"16",सत्रह:"17",अठारह:"18",उन्नीस:"19",
  बीस:"20",इक्कीस:"21",बाईस:"22",तेईस:"23",चौबीस:"24",पच्चीस:"25",
  छब्बीस:"26",सत्ताईस:"27",अट्ठाईस:"28",उनतीस:"29",तीस:"30",इकतीस:"31",
  ek:"1",do:"2",teen:"3",char:"4",paanch:"5",panch:"5",chhe:"6",
  saat:"7",aath:"8",nau:"9",das:"10",gyarah:"11",barah:"12",terah:"13",
  chaudah:"14",pandrah:"15",solah:"16",satrah:"17",atharah:"18",unnees:"19",
  bees:"20",ikkees:"21",baaees:"22",teyees:"23",chaubees:"24",pachees:"25",
  chhabbees:"26",sattaees:"27",atthaees:"28",unatees:"29",tees:"30",ikattees:"31",
};

const SORTED_NUM_WORDS = Object.entries(HINDI_NUM_WORDS).sort(
  (a, b) => b[0].length - a[0].length
);

function replaceHindiNumbers(text) {
  // Fast path — skip if no Hindi number words present (saves ~90% of calls)
  if (!/[एकदोतीनचारपाँपांछहसातआठनौदस]|ek\b|do\b|teen\b|char\b|paanch/u.test(text)) return text;
  let out = text;
  for (const [word, digit] of SORTED_NUM_WORDS) {
    const re = new RegExp(`(^|\\s)${word}(\\s|$)`, "gu");
    out = out.replace(re, `$1${digit}$2`);
  }
  return out;
}

/* =====================================================================
   DATE EXTRACTION
   ===================================================================== */
const MONTH_NAMES_PATTERN =
  "january|february|march|april|may|june|july|august|september|october|november|december" +
  "|जनवरी|फरवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितंबर|अक्टूबर|नवंबर|दिसंबर";

const HINDI_MONTH_MAP = {
  january:"जनवरी", february:"फरवरी", march:"मार्च", april:"अप्रैल",
  may:"मई", june:"जून", july:"जुलाई", august:"अगस्त",
  september:"सितंबर", october:"अक्टूबर", november:"नवंबर", december:"दिसंबर",
  जनवरी:"जनवरी",फरवरी:"फरवरी",मार्च:"मार्च",अप्रैल:"अप्रैल",मई:"मई",
  जून:"जून",जुलाई:"जुलाई",अगस्त:"अगस्त",सितंबर:"सितंबर",
  अक्टूबर:"अक्टूबर",नवंबर:"नवंबर",दिसंबर:"दिसंबर",
};

const DAY_LABEL_MAP = {
  kal:"कल", parso:"परसों",
  agle:"अगले", "agle hi":"अगले", next:"अगले", asap:"अगले",
  "agle hafte":"अगले हफ्ते", "agle week":"अगले हफ्ते", "next week":"अगले हफ्ते",
  "agle mahine":"अगले महीने", "next month":"अगले महीने",
  "do din baad":"2 दिन बाद", "teen din baad":"3 दिन बाद", "ek hafte baad":"1 हफ्ते बाद",
  monday:"सोमवार", tuesday:"मंगलवार", wednesday:"बुधवार",
  thursday:"गुरुवार", friday:"शुक्रवार", saturday:"शनिवार", sunday:"रविवार",
  mon:"सोमवार", tue:"मंगलवार", wed:"बुधवार", thu:"गुरुवार",
  fri:"शुक्रवार", sat:"शनिवार", sun:"रविवार",
  somwar:"सोमवार", mangalwar:"मंगलवार", budhwar:"बुधवार",
  guruwar:"गुरुवार", shukrawar:"शुक्रवार", shaniwar:"शनिवार", raviwar:"रविवार",
  कल:"कल", परसों:"परसों",
  सोमवार:"सोमवार", समवार:"सोमवार",
  मंगलवार:"मंगलवार", मंगल:"मंगलवार",
  बुधवार:"बुधवार", बुध:"बुधवार",
  गुरुवार:"गुरुवार", गुरु:"गुरुवार",
  शुक्रवार:"शुक्रवार", शुक्र:"शुक्रवार",
  शनिवार:"शनिवार", शनि:"शनिवार",
  रविवार:"रविवार", रवि:"रविवार",
  अगले:"अगले", "अगले ही":"अगले",
  "अगले हफ्ते":"अगले हफ्ते", "अगले महीने":"अगले महीने",
};

const SORTED_DAY_KEYS = Object.keys(DAY_LABEL_MAP).sort((a, b) => b.length - a.length);

export function extractPreferredDate(raw) {
  if (!raw) return null;
  const withDigits = replaceHindiNumbers(raw);
  const t = normalise(withDigits);

  // DD/MM or DD-MM
  const numSlash = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?\b/);
  if (numSlash) return `${numSlash[1]}/${numSlash[2]}`;

  // "25 january" or "25 जनवरी"
  const dayMonthRe = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAMES_PATTERN})\\b`, "u");
  const dayMonth = t.match(dayMonthRe);
  if (dayMonth) return `${dayMonth[1]} ${HINDI_MONTH_MAP[dayMonth[2]] || dayMonth[2]}`;

  // "25 tarikh" / "25 तारीख" / "25 को"
  const numBefore = t.match(/(?:^|\s)(\d{1,2})\s+(?:तारीख|tarikh|date)(?:\s|$|को|के)/u);
  if (numBefore) return `${numBefore[1]} तारीख`;
  const numAfter = t.match(/(?:तारीख|tarikh|date)\s+(\d{1,2})(?:\s|$)/u);
  if (numAfter) return `${numAfter[1]} तारीख`;
  const numKo = t.match(/(?:^|\s)(\d{1,2})\s+(?:ko|को)(?:\s|$)/u);
  if (numKo) return `${numKo[1]} तारीख`;
  const bookCtx = t.match(/\b(\d{1,2})\s+(?:ke\s+liye|को\s+बुक|तक|से\s+पहले)/);
  if (bookCtx) return `${bookCtx[1]} तारीख`;

  // Hindi weekday names
  const hindiWDPat = /(?:^|\s)(सोमवार|समवार|मंगलवार|मंगल|बुधवार|बुध|गुरुवार|गुरु|शुक्रवार|शुक्र|शनिवार|शनि|रविवार|रवि)(?:\s|$)/u;
  const hindiWD = t.match(hindiWDPat);
  if (hindiWD) return DAY_LABEL_MAP[hindiWD[1]] || hindiWD[1];

  // English weekday
  const enWDPat = /(?:^|\s)(monday|mon|tuesday|tue|wednesday|wed|thursday|thu|friday|fri|saturday|sat|sunday|sun)(?:\s|$)/i;
  const enWD = t.match(enWDPat);
  if (enWD) {
    const canonical = DAY_LABEL_MAP[enWD[1].toLowerCase()];
    if (canonical) return canonical;
  }

  // Named day/relative tokens (longest first to catch "agle hafte" before "agle")
  for (const kw of SORTED_DAY_KEYS) {
    if (t.includes(kw)) return DAY_LABEL_MAP[kw];
  }

  // Bare number 1-31
  const bareNum = t.match(/(?:^|\s)(\d{1,2})(?:\s|$)/);
  if (bareNum) {
    const n = parseInt(bareNum[1], 10);
    if (n >= 1 && n <= 31) return `${n} तारीख`;
  }

  return null;
}

/* =====================================================================
   KEYWORD PATTERN TABLES
   ===================================================================== */
const REPEAT_PATTERNS = [
  "dobara boliye","dobara bolo","phir se boliye","phir se bolo","fir se bolo",
  "ek baar aur","kya kaha","kya bola","kya bol raha","suna nahi","sunai nahi",
  "awaz nahi","awaaz nahi","clear nahi","repeat karo","repeat karein","say again",
  "thoda dheere","dheere boliye","nahi suna","kuch nahi suna",
  "दोबारा बोलो","दोबारा बोलिए","फिर से बोलो","फिर बोलो","एक बार और",
  "क्या कहा","क्या बोले","नहीं सुना","आवाज़ नहीं","धीरे बोलिए","साफ बोलिए",
];

const CONFUSION_PATTERNS = [
  "kaunsi machine","konsi machine","kaun si machine","kaunsa service",
  "meri machine nahi","galat machine","galat number","yeh meri nahi",
  "samajh nahi aaya","nahi samjha","nahi samjhi","kya matlab","kya bol rahe",
  "kya pooch rahe","kya hai yeh","kon hai","kaun bol raha","galat call",
  "wrong number","mujhe nahi pata","samajh nahi","kuch samajh nahi aaya",
  "कौन सी मशीन","गलत मशीन","गलत नंबर","यह मेरी नहीं","समझ नहीं",
  "क्या मतलब","गलत कॉल","यह क्या है","मुझे नहीं पता",
];

/* ─────────────────────────────────────────────────────────────────────
   CONFIRM_PATTERNS
   FIX v9: Expanded with Hinglish booking-affirmative phrases that
   Rajasthani JCB operators actually use. Key additions:
   - "karwana hai" / "karna hai" / "karwa do" families
   - "kar lenge" / "kar denge" (we'll get it done)
   - Marwari: "chhaal karo", "kar dena ji"
   - Bhojpuri: "haan ba", "theek ba"
   ───────────────────────────────────────────────────────────────────── */
const CONFIRM_PATTERNS = [
  // Strong explicit booking
  "haan ji bilkul","ji haan zaroor","bilkul theek hai",
  "haan book karo","book kar do","book kardo","book kar","book karo",
  "confirm karo","confirm kar do","karwa do","karvao","karwa lo",
  "zaroor karo","haan zaroor","please book",
  // FIX v9: "karwana hai" family — "I want it done / need to get it done"
  "karwana hai","karwana h","karna hai","karna h",
  "book karwana hai","service karwana hai","karwa lenge","kar lenge",
  "kar denge","karwa denge","karwa dijiye","kar dijiye","book kar dijiye",
  "karwa dena","kardo","kar do","haan kar do","haan karo","haan haan karo",
  "acha kar do","acha karo","theek hai kar do","theek h kar do",
  "haan ek dum","ek dum theek","bilkul karo","zaroor karwao",
  // Marwari / Rajasthani
  "haan ji karo","kar do bhai","kar dena ji","theek karo",
  "chhaal karo","chhalo karo",
  // Bhojpuri
  "haan ba","theek ba","kar dijiye na","kar do na",
  // Generic affirmatives
  "haan ji","ji haan","ji ha","theek hai","theek h","thik hai",
  "bilkul","zaroor","sahi hai","acha","accha","achha","achcha",
  "haan","haa","han","ok","okay","yes","yep","done","perfect","hmm","confirm",
  "proceed","chalega","chalta hai","chalo","chalte hain","sahi","agreed","agree",
  // Devanagari
  "हाँ बुक करो","बुक कर दो","बुक करो","कन्फर्म करो","करवा दो","करवाओ",
  "ज़रूर करो","हाँ जी","जी हाँ","बिल्कुल","ज़रूर","ठीक है","सही है",
  "अच्छा","हाँ","हां","ओके","करवाना है","करना है","कर दो","कर दीजिए",
  "हाँ करो","बुक करवाना है","सर्विस करवाना है","कर लेंगे","कर देंगे",
];

const REJECT_PATTERNS = [
  "nahi chahiye abhi","abhi nahi karna","nahi karna hai","nahi book karna",
  "book nahi karna","cancel kar do","nahi chahiye","nahi karna","mat karo",
  "mat kar","rehne do","rehne de","chhod do","band karo","zaroorat nahi",
  "need nahi","mat karna","abhi nahi","don't","dont","no","nope","cancel",
  "नहीं चाहिए","नहीं करना","मत करो","मत कर","छोड़ दो","बंद करो",
  "ज़रूरत नहीं","अभी नहीं","कैंसल कर दो","ना",
  "koi tarikh nahi","koi date nahi","abhi koi date nahi",
  "date nahi dunga","tarikh nahi bataunga","koi bhi tarikh nahi",
  "कोई भी तारीख नहीं","कोई तारीख नहीं","तारीख नहीं दूंगा","कोई दिन नहीं",
];

const ALREADY_DONE_PATTERNS = [
  "ho chuki hai","ho gayi hai","karwa chuka","karwa chuki","kar chuka","kar chuki",
  "pehle karwa li","already karwa li","already ho gayi","service ho gayi",
  "service karwa chuke","service karwa li","karwa di hai","kar di hai",
  "serviced","already done","already serviced","done hai","ho gayi","karwa li",
  "karwa chuke hain","service ho chuki",
  "पहले करवा ली","पहले करवाई","पहले हो गई","हो चुकी","पहले ही करवा ली",
  "कर दी","करवा दी","हो गई है","पहले की",
];

const DRIVER_NOT_AVAILABLE_PATTERNS = [
  "driver nahi hai","driver available nahi","driver chutti par","driver gaya hua",
  "driver nahi","koi driver nahi","operator nahi","operator available nahi",
  "chalane wala nahi","driver busy","driver nahi milega","driver nahi aa raha",
  "ड्राइवर नहीं","ड्राइवर उपलब्ध नहीं","ड्राइवर छुट्टी","ऑपरेटर नहीं",
  "ड्राइवर है नहीं","मेरे ड्राइवर नहीं","चालक नहीं",
];

function hasDriverNotAvailableKeywords(text) {
  const hasDriver = /driver|ड्राइवर|चालक|operator|ऑपरेटर/i.test(text);
  const hasNot    = /nahi|नहीं|ना|उपलब्ध नहीं|available nahi/i.test(text);
  return hasDriver && hasNot;
}

const MACHINE_BUSY_PATTERNS = [
  "machine chal rahi hai","machine kaam kar rahi","site pe chal rahi",
  "kaam chal raha","project chal raha","site pe hai","machine busy hai",
  "chal rahi hai abhi","kaam me lagi hai","nikali nahi ja sakti",
  "rok nahi sakte","nikal nahi sakti","machine site pe","site par hai",
  "मशीन चल रही","साइट पर है","काम चल रहा","मशीन बिज़ी","काम में लगी",
];

const WORKING_FINE_PATTERNS = [
  "machine thik hai","machine sahi hai","koi problem nahi","chalti rehti hai",
  "theek chal rahi","abhi thik hai","koi dikkat nahi","service ki zaroorat nahi",
  "sab theek hai","koi issue nahi","machine kharab nahi","breakdown nahi",
  "मशीन ठीक है","कोई दिक्कत नहीं","ठीक चल रही","सब ठीक है",
];

const MONEY_ISSUE_PATTERNS = [
  "paisa nahi","paise nahi","budget nahi","abhi paisa nahi","funding nahi",
  "payment nahi","mehnga hai","afford nahi","payment problem","funds nahi",
  "rakh nahi sakta","mahanga","paisa khatam","thoda paisa nahi",
  "पैसा नहीं","पैसे नहीं","बजट नहीं","महंगा है","अभी पैसे नहीं","फंड नहीं",
];

const CALL_LATER_PATTERNS = [
  "baad mein call karo","baad mein baat karo","phir se call karo",
  "busy hoon abhi","drive kar raha hoon","gaadi chala raha hoon",
  "meeting mein hoon","thodi der baad","kuch time baad","later karo",
  "call back karo","dobaara call","phir call","phir karo","free nahi",
  "waqt nahi","busy hoon","baad mein","baad me","thoda baad",
  "बाद में कॉल करो","बाद में बात करो","बिज़ी हूँ","गाड़ी चला रहा",
  "मीटिंग में हूँ","थोड़ी देर बाद","बाद में","खाली नहीं","वक्त नहीं",
];

const RESCHEDULE_PATTERNS = [
  "date change kar do","date badal do","date badlo","schedule badal do",
  "reschedule karo","koi aur din","dusra din","aur koi din","baad ki date",
  "agle mahine","next month","agle hafte","agle week","next week",
  "ek hafte baad","do din baad","teen din baad","kal karo","parso karo",
  "monday","tuesday","wednesday","thursday","friday","saturday","sunday",
  "somwar","mangalwar","budhwar","guruwar","shukrawar","shaniwar","raviwar",
  "tarikh","reschedule","time change","kal","parso",
  "तारीख बदल दो","तारीख बदलो","शेड्यूल बदलो","रीशेड्यूल करो","कोई और दिन",
  "दूसरा दिन","अगले महीने","अगले हफ्ते","दो दिन बाद","तीन दिन बाद",
  "एक हफ्ते बाद","कल करो","परसों करो","कल","परसों",
  "सोमवार","समवार","मंगल","मंगलवार","बुध","बुधवार",
  "गुरु","गुरुवार","शुक्र","शुक्रवार","शनि","शनिवार","रवि","रविवार","तारीख",
];

/* =====================================================================
   PRE-COMPILED INTENT REGEXES  (built once at module load)
   ===================================================================== */
function buildIntentRegex(patterns) {
  const escaped = patterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("|"), "u");
}

const REPEAT_RE       = buildIntentRegex(REPEAT_PATTERNS);
const CONFUSION_RE    = buildIntentRegex(CONFUSION_PATTERNS);
const CONFIRM_RE      = buildIntentRegex(CONFIRM_PATTERNS);
const REJECT_RE       = buildIntentRegex(REJECT_PATTERNS);
const ALREADY_DONE_RE = buildIntentRegex(ALREADY_DONE_PATTERNS);
const DRIVER_RE       = buildIntentRegex(DRIVER_NOT_AVAILABLE_PATTERNS);
const MACHINE_BUSY_RE = buildIntentRegex(MACHINE_BUSY_PATTERNS);
const WORKING_FINE_RE = buildIntentRegex(WORKING_FINE_PATTERNS);
const MONEY_ISSUE_RE  = buildIntentRegex(MONEY_ISSUE_PATTERNS);
const CALL_LATER_RE   = buildIntentRegex(CALL_LATER_PATTERNS);
const RESCHEDULE_RE   = buildIntentRegex(RESCHEDULE_PATTERNS);
const STANDALONE_NAHI = /(?:^|\s)(?:nahi|nahin|नहीं|ना)(?:\s|$)/u;

/* =====================================================================
   INTENT DETECTOR
   Priority: REPEAT > CONFUSION > ALREADY_DONE > DRIVER > MACHINE_BUSY
           > WORKING_FINE > MONEY_ISSUE > CALL_LATER > RESCHEDULE
           > CONFIRM > PROVIDE_BRANCH > REJECT > UNKNOWN
   ===================================================================== */
function detectIntent(normText, rawText, cachedBranch = null) {
  if (!normText || normText.length === 0) return INTENT.UNCLEAR;

  if (REPEAT_RE.test(normText))                                           return INTENT.REPEAT;
  if (CONFUSION_RE.test(normText))                                        return INTENT.CONFUSION;
  if (ALREADY_DONE_RE.test(normText))                                     return INTENT.ALREADY_DONE;
  if (DRIVER_RE.test(normText) || hasDriverNotAvailableKeywords(normText)) return INTENT.DRIVER_NOT_AVAILABLE;
  if (MACHINE_BUSY_RE.test(normText))                                     return INTENT.MACHINE_BUSY;
  if (WORKING_FINE_RE.test(normText))                                     return INTENT.WORKING_FINE;
  if (MONEY_ISSUE_RE.test(normText))                                      return INTENT.MONEY_ISSUE;
  if (CALL_LATER_RE.test(normText))                                       return INTENT.CALL_LATER;
  if (RESCHEDULE_RE.test(normText))                                       return INTENT.RESCHEDULE;
  if (CONFIRM_RE.test(normText))                                          return INTENT.CONFIRM;
  if (cachedBranch)                                                        return INTENT.PROVIDE_BRANCH;
  if (REJECT_RE.test(normText) || STANDALONE_NAHI.test(normText))        return INTENT.REJECT;

  return INTENT.UNKNOWN;
}

/* =====================================================================
   RESPONSE CATALOGUE (NLP-level; voice.service.js overrides key states)
   ===================================================================== */
const R = {
  greeting:     (n)         => `Namaste ${n} ji, main Rajesh JSB Motors se. Aapki machine ki service due hai. Kya book kar dun?`,
  askDate:      (n)         => `${n} ji, kaunsa din theek rahega? Kal, parso, somwar, ya tarikh boliye.`,
  askReason:    (n)         => `Koi baat nahi ${n} ji. Batao kya dikkat hai — shayad kuch kar sakein.`,
  askAlreadyDoneDetails: (n)=> `${n} ji, bahut acha! Kab, kahan aur kaunsi service karwai thi?`,
  objectionDriverNotAvailable: (n)=>`Samajh gaya ${n} ji. Driver ke aate hi ek din bata dena — fix kar denge.`,
  objectionMachineBusy: (n) => `Samajh aaya ${n} ji. Jab machine thodi der ke liye free ho sake, tab ka din batao.`,
  objectionWorkingFine: (n) => `${n} ji, machine thik hai — acha hai. 500 hour service se life aur badhti hai. Kab karein?`,
  objectionMoneyIssue:  (n) => `Tension nahi ${n} ji. Agle mahine ki date fix karo — payment baad mein.`,
  objectionCallLater:   (n) => `Theek hai ${n} ji. Koi ek din bata do — main mark kar leta hun.`,
  persuasionFinal:      (n) => `${n} ji, service skip se baad mein zyada kharcha aata hai. Ek tarikh batao — baaki sab hum karte hain.`,
  askBranch:    (n)         => `${n} ji, machine abhi kis city mein hai? Jaipur, Kota, Ajmer, Alwar, Udaipur, ya Sikar?`,
  askBranchAgain: (n)       => `${n} ji, city clearly boliye — Jaipur, Kota, Ajmer, ya Udaipur?`,
  confirmBooking:(n,bn,bc,d)=> `${n} ji, service ${bn} (${bc}) mein ${d} ko book ho gayi. Dhanyawad!`,
  alreadyDoneSaved: (n)     => `${n} ji, shukriya. Record update ho gaya. Agli service ka reminder pehle aayega. Dhanyawad!`,
  rejected:     (n)         => `Theek hai ${n} ji. Jab zaroorat ho, JSB Motors mein call karna. Dhanyawad!`,
  tooManyUnknown:(n)        => `${n} ji, hum baad mein sampark karenge. Dhanyawad!`,
  confirmDate:  (n, d)      => `${n} ji, ${d} ko book kar dun? Haan ya nahi boliye.`,
  confusionClarify:(n)      => `${n} ji, main JSB Motors se service reminder ke liye call kar raha hun. Service book karwani hai?`,
  politeAskAgain:(n)        => `${n} ji, samajh nahi aaya. Haan ya nahi boliye.`,
};

/* =====================================================================
   CORE EXPORT: processUserInput
   ===================================================================== */
export function processUserInput(userText, sessionData) {
  const normText    = normalise(userText);
  const cachedBranch = matchBranch(userText);
  const intent      = detectIntent(normText, userText, cachedBranch);
  const state       = sessionData.state || "awaiting_initial_decision";
  const name        = sessionData.customerName || "sir";
  const unknownStreak    = sessionData.unknownStreak    || 0;
  const persuasionCount  = sessionData.persuasionCount  || 0;

  const result = (replyText, nextState, endCall, preferredDate = null, extractedBranch = null) => {
    const resolvedDate = preferredDate ? resolveDate(preferredDate) : null;
    return { replyText, nextState, endCall, preferredDate, resolvedDate, extractedBranch, intent };
  };

  /* ── Global guards ── */
  if (unknownStreak >= 3) return result(R.tooManyUnknown(name), "ended", true);
  if (intent === INTENT.REPEAT) {
    const lastMsg = sessionData.lastMessage || "";
    return result(lastMsg ? `${name} ji, dobara bol raha hun — ${lastMsg}` : R.greeting(name), state, false);
  }
  if (intent === INTENT.CONFUSION) return result(R.confusionClarify(name), "awaiting_initial_decision", false);
  if (intent === INTENT.UNCLEAR)   return result(R.politeAskAgain(name), state, false);

  /* ══════════════════════════════════════════════════════════════════
     STATE MACHINE
     ══════════════════════════════════════════════════════════════════ */
  switch (state) {

    /* ── STEP 2: Initial decision ── */
    case "awaiting_initial_decision": {
      if (intent === INTENT.CONFIRM)              return result(R.askDate(name), "awaiting_date", false);
      if (intent === INTENT.ALREADY_DONE)         return result(R.askAlreadyDoneDetails(name), "awaiting_service_details", false);
      if (intent === INTENT.REJECT)               return result(R.askReason(name), "awaiting_reason", false);
      if (intent === INTENT.DRIVER_NOT_AVAILABLE) return result(R.objectionDriverNotAvailable(name), "awaiting_date", false);
      if (intent === INTENT.MACHINE_BUSY)         return result(R.objectionMachineBusy(name), "awaiting_date", false);
      if (intent === INTENT.WORKING_FINE)         return result(R.objectionWorkingFine(name), "awaiting_date", false);
      if (intent === INTENT.MONEY_ISSUE)          return result(R.objectionMoneyIssue(name), "awaiting_date", false);
      if (intent === INTENT.CALL_LATER)           return result(R.objectionCallLater(name), "awaiting_date", false);
      if (intent === INTENT.RESCHEDULE || intent === INTENT.PROVIDE_DATE) {
        const pd = extractPreferredDate(userText);
        if (pd) return result(R.confirmDate(name, resolveDate(pd)?.display || pd), "awaiting_date_confirm", false, pd);
        return result(R.askDate(name), "awaiting_date", false);
      }
      if (intent === INTENT.PROVIDE_BRANCH) return result(R.askDate(name), "awaiting_date", false);
      return result(R.politeAskAgain(name), state, false);
    }

    /* ── STEP 3: Reason / objection handling ── */
    case "awaiting_reason": {
      if (intent === INTENT.CONFIRM) {
        // Check for co-occurring objection to avoid false "yes, book it"
        if (DRIVER_RE.test(normText))     return result(R.objectionDriverNotAvailable(name), "awaiting_date", false);
        if (MACHINE_BUSY_RE.test(normText)) return result(R.objectionMachineBusy(name), "awaiting_date", false);
        const pd = extractPreferredDate(userText);
        if (pd) return result(R.confirmDate(name, resolveDate(pd)?.display || pd), "awaiting_date_confirm", false, pd);
        return result(R.askDate(name), "awaiting_date", false);
      }
      if (intent === INTENT.RESCHEDULE || intent === INTENT.PROVIDE_DATE) {
        const pd = extractPreferredDate(userText);
        if (pd) return result(R.confirmDate(name, resolveDate(pd)?.display || pd), "awaiting_date_confirm", false, pd);
        return result(R.askDate(name), "awaiting_date", false);
      }
      if (intent === INTENT.DRIVER_NOT_AVAILABLE) return result(R.objectionDriverNotAvailable(name), "awaiting_date", false);
      if (intent === INTENT.MACHINE_BUSY)          return result(R.objectionMachineBusy(name), "awaiting_date", false);
      if (intent === INTENT.WORKING_FINE)          return result(R.objectionWorkingFine(name), "awaiting_date", false);
      if (intent === INTENT.MONEY_ISSUE)           return result(R.objectionMoneyIssue(name), "awaiting_date", false);
      if (intent === INTENT.CALL_LATER)            return result(R.objectionCallLater(name), "awaiting_date", false);
      if (intent === INTENT.REJECT) {
        if (persuasionCount === 0) return result(R.persuasionFinal(name), "awaiting_reason_persisted", false);
        return result(R.rejected(name), "ended", true);
      }
      return result(R.persuasionFinal(name), "awaiting_reason_persisted", false);
    }

    /* ── After first persuasion attempt ── */
    case "awaiting_reason_persisted": {
      if (intent === INTENT.CONFIRM || intent === INTENT.RESCHEDULE || intent === INTENT.PROVIDE_DATE) {
        const pd = extractPreferredDate(userText);
        if (pd) return result(R.confirmDate(name, resolveDate(pd)?.display || pd), "awaiting_date_confirm", false, pd);
        return result(R.askDate(name), "awaiting_date", false);
      }
      if (intent === INTENT.DRIVER_NOT_AVAILABLE) return result(R.objectionDriverNotAvailable(name), "awaiting_date", false);
      if (intent === INTENT.MACHINE_BUSY)          return result(R.objectionMachineBusy(name), "awaiting_date", false);
      if (intent === INTENT.WORKING_FINE)          return result(R.objectionWorkingFine(name), "awaiting_date", false);
      if (intent === INTENT.MONEY_ISSUE)           return result(R.objectionMoneyIssue(name), "awaiting_date", false);
      if (intent === INTENT.CALL_LATER)            return result(R.objectionCallLater(name), "awaiting_date", false);
      // FIX v9: Check for any date token in UNKNOWN/REJECT utterances before giving up
      const dateTry = extractPreferredDate(userText);
      if (dateTry) return result(R.confirmDate(name, resolveDate(dateTry)?.display || dateTry), "awaiting_date_confirm", false, dateTry);
      return result(R.rejected(name), "ended", true);
    }

    /* ── STEP 4: Date capture ── */
    case "awaiting_date": {
      const pd = extractPreferredDate(userText);
      if (pd) return result(R.confirmDate(name, resolveDate(pd)?.display || pd), "awaiting_date_confirm", false, pd);

      // FIX v9: CONFIRM without extracted date → do NOT silently default to tomorrow.
      // Re-ask so customer explicitly states a day.
      if (intent === INTENT.CONFIRM) {
        return result(`${name} ji, kaunsa din theek rahega batao — kal, somwar, ya 15 tarikh.`, state, false);
      }
      if (intent === INTENT.REJECT)                    return result(R.askBranch(name), "awaiting_branch", false);
      if (intent === INTENT.RESCHEDULE || intent === INTENT.PROVIDE_DATE) return result(R.askDate(name), state, false);
      if (intent === INTENT.DRIVER_NOT_AVAILABLE)      return result(R.objectionDriverNotAvailable(name), state, false);
      if (intent === INTENT.MACHINE_BUSY)              return result(R.objectionMachineBusy(name), state, false);
      if (intent === INTENT.WORKING_FINE)              return result(R.objectionWorkingFine(name), state, false);
      if (intent === INTENT.MONEY_ISSUE)               return result(R.objectionMoneyIssue(name), state, false);
      if (intent === INTENT.CALL_LATER)                return result(R.objectionCallLater(name), state, false);

      return result(`${name} ji, kaunsa din batayenge? Kal, somwar, ya 15 tarikh boliye.`, state, false);
    }

    /* ── Date confirmation ── */
    case "awaiting_date_confirm": {
      const date = sessionData.preferredDate || null;
      const display = date ? resolveDate(date)?.display || date : "nirdharit tarikh";

      if (intent === INTENT.CONFIRM)
        return result(R.askBranch(name), "awaiting_branch", false, date);

      // FIX v9: REJECT in awaiting_date_confirm clears date before going back
      if (intent === INTENT.REJECT) {
        if (/abhi|shayad|maybe|later|thoda time|अभी|शायद|बाद में|थोड़ा/i.test(userText)) {
          // Soft: postpone — clear date and re-ask
          return result(R.objectionCallLater(name), "awaiting_date", false, null);
        }
        // Hard rejection of this date — go back, clear date
        return result(R.askDate(name), "awaiting_date", false, null);
      }

      if (intent === INTENT.RESCHEDULE)
        return result(R.askDate(name), "awaiting_date", false, null);

      // Customer gives a new date inline
      const newDate = extractPreferredDate(userText);
      if (newDate) {
        const newDisplay = resolveDate(newDate)?.display || newDate;
        return result(R.confirmDate(name, newDisplay), state, false, newDate);
      }

      return result(R.confirmDate(name, display), state, false, date);
    }

    /* ── STEP 5: Branch matching ── */
    case "awaiting_branch": {
      const branch = matchBranch(userText);
      const date   = sessionData.preferredDate || null;
      const display= date ? resolveDate(date)?.display || date : "nirdharit tarikh";

      if (!date && intent !== INTENT.REJECT)
        return result(R.askDate(name), "awaiting_date", false);

      if (branch)
        return result(R.confirmBooking(name, branch.name, branch.city, display), "ended", true, date, branch);

      if (intent === INTENT.REJECT) {
        if (date) return result(R.persuasionFinal(name), state, false, date);
        return result(R.askBranch(name), state, false);
      }

      return result(R.askBranchAgain(name), state, false, date);
    }

    /* ── STEP 6: Already done details ── */
    case "awaiting_service_details":
      return result(R.alreadyDoneSaved(name), "ended", true);

    default:
      return result(R.tooManyUnknown(name), "ended", true);
  }
}

export default { processUserInput, extractPreferredDate, matchBranch, INTENT, SERVICE_CENTERS };