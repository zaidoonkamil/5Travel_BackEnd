// Arabic names for flight places. The supplier's flight autocomplete only knows English,
// so an Arabic query is routed through this list and the results are shown in Arabic.

// [Arabic name, English name (what the supplier matches), IATA city code, ...extra spellings]
const CITIES = [
  // Iraq
  ["بغداد", "Baghdad", "BGW"],
  ["البصرة", "Basra", "BSR", "بصرة"],
  ["أربيل", "Erbil", "EBL", "اربيل", "هولير"],
  ["النجف", "Najaf", "NJF", "نجف"],
  ["السليمانية", "Sulaymaniyah", "ISU", "سليمانية"],
  ["كركوك", "Kirkuk", "KIK"],
  // Gulf & Arab world
  ["دبي", "Dubai", "DXB"],
  ["أبوظبي", "Abu Dhabi", "AUH", "ابو ظبي", "أبو ظبي"],
  ["الشارقة", "Sharjah", "SHJ", "شارقة"],
  ["الدوحة", "Doha", "DOH", "قطر"],
  ["المنامة", "Bahrain", "BAH", "البحرين"],
  ["الكويت", "Kuwait", "KWI"],
  ["مسقط", "Muscat", "MCT", "عمان مسقط"],
  ["الرياض", "Riyadh", "RUH", "رياض"],
  ["جدة", "Jeddah", "JED", "جده"],
  ["المدينة المنورة", "Medina", "MED", "المدينة"],
  ["الدمام", "Dammam", "DMM", "دمام"],
  ["عمّان", "Amman", "AMM", "عمان", "الأردن"],
  ["بيروت", "Beirut", "BEY", "لبنان"],
  ["دمشق", "Damascus", "DAM", "الشام", "سوريا"],
  ["القاهرة", "Cairo", "CAI", "مصر"],
  ["الإسكندرية", "Alexandria", "ALY", "اسكندرية"],
  ["شرم الشيخ", "Sharm El Sheikh", "SSH", "شرم"],
  ["الغردقة", "Hurghada", "HRG", "غردقة"],
  ["الأقصر", "Luxor", "LXR", "اقصر"],
  ["تونس", "Tunis", "TUN"],
  ["الجزائر", "Algiers", "ALG"],
  ["الدار البيضاء", "Casablanca", "CMN", "كازابلانكا"],
  ["مراكش", "Marrakech", "RAK"],
  ["طرابلس", "Tripoli", "TIP", "ليبيا"],
  ["الخرطوم", "Khartoum", "KRT", "السودان"],
  // Türkiye
  ["إسطنبول", "Istanbul", "IST", "اسطنبول", "استنبول", "تركيا"],
  ["أنقرة", "Ankara", "ANK", "انقرة"],
  ["أنطاليا", "Antalya", "AYT", "انطاليا", "انطاكيا"],
  ["إزمير", "Izmir", "IZM", "ازمير"],
  ["طرابزون", "Trabzon", "TZX"],
  ["بودروم", "Bodrum", "BJV"],
  ["دالامان", "Dalaman", "DLM"],
  ["غازي عنتاب", "Gaziantep", "GZT", "عنتاب"],
  ["أضنة", "Adana", "COV", "اضنة"],
  ["بورصة", "Bursa", "YEI"],
  // Iran & Caucasus
  ["طهران", "Tehran", "THR", "ايران"],
  ["مشهد", "Mashhad", "MHD"],
  ["أصفهان", "Isfahan", "IFN", "اصفهان"],
  ["شيراز", "Shiraz", "SYZ"],
  ["تبريز", "Tabriz", "TBZ"],
  ["باكو", "Baku", "BAK", "اذربيجان"],
  ["تبليسي", "Tbilisi", "TBS", "جورجيا"],
  ["باتومي", "Batumi", "BUS"],
  ["يريفان", "Yerevan", "EVN", "ارمينيا"],
  // Europe
  ["لندن", "London", "LON", "بريطانيا"],
  ["مانشستر", "Manchester", "MAN"],
  ["باريس", "Paris", "PAR", "فرنسا"],
  ["نيس", "Nice", "NCE"],
  ["فرانكفورت", "Frankfurt", "FRA"],
  ["ميونخ", "Munich", "MUC", "ميونيخ"],
  ["برلين", "Berlin", "BER", "المانيا"],
  ["دوسلدورف", "Dusseldorf", "DUS"],
  ["هامبورغ", "Hamburg", "HAM"],
  ["فيينا", "Vienna", "VIE", "النمسا"],
  ["زيورخ", "Zurich", "ZRH"],
  ["جنيف", "Geneva", "GVA", "سويسرا"],
  ["أمستردام", "Amsterdam", "AMS", "امستردام", "هولندا"],
  ["بروكسل", "Brussels", "BRU", "بلجيكا"],
  ["روما", "Rome", "ROM", "ايطاليا"],
  ["ميلانو", "Milan", "MIL"],
  ["البندقية", "Venice", "VCE", "فينيسيا"],
  ["مدريد", "Madrid", "MAD", "اسبانيا"],
  ["برشلونة", "Barcelona", "BCN"],
  ["لشبونة", "Lisbon", "LIS", "البرتغال"],
  ["أثينا", "Athens", "ATH", "اثينا", "اليونان"],
  ["لارنكا", "Larnaca", "LCA", "قبرص"],
  ["كوبنهاغن", "Copenhagen", "CPH", "الدنمارك"],
  ["ستوكهولم", "Stockholm", "STO", "السويد"],
  ["أوسلو", "Oslo", "OSL", "اوسلو", "النرويج"],
  ["هلسنكي", "Helsinki", "HEL", "فنلندا"],
  ["براغ", "Prague", "PRG", "التشيك"],
  ["بودابست", "Budapest", "BUD", "المجر"],
  ["وارسو", "Warsaw", "WAW", "بولندا"],
  ["موسكو", "Moscow", "MOW", "روسيا"],
  ["سانت بطرسبرغ", "St Petersburg", "LED", "بطرسبرغ"],
  ["كييف", "Kyiv", "IEV", "اوكرانيا"],
  ["بلغراد", "Belgrade", "BEG", "صربيا"],
  ["سراييفو", "Sarajevo", "SJJ", "البوسنة"],
  ["دبلن", "Dublin", "DUB", "ايرلندا"],
  // Asia
  ["دلهي", "Delhi", "DEL", "نيودلهي", "الهند"],
  ["مومباي", "Mumbai", "BOM"],
  ["بنغالور", "Bangalore", "BLR"],
  ["حيدر أباد", "Hyderabad", "HYD", "حيدر اباد"],
  ["تشيناي", "Chennai", "MAA"],
  ["كولومبو", "Colombo", "CMB", "سريلانكا"],
  ["ماليه", "Male", "MLE", "المالديف", "مالديف"],
  ["كاتماندو", "Kathmandu", "KTM", "نيبال"],
  ["إسلام آباد", "Islamabad", "ISB", "اسلام اباد", "باكستان"],
  ["كراتشي", "Karachi", "KHI"],
  ["لاهور", "Lahore", "LHE"],
  ["دكا", "Dhaka", "DAC", "بنغلاديش"],
  ["بانكوك", "Bangkok", "BKK", "تايلاند"],
  ["بوكيت", "Phuket", "HKT"],
  ["كوالالمبور", "Kuala Lumpur", "KUL", "ماليزيا", "كوالا لمبور"],
  ["سنغافورة", "Singapore", "SIN"],
  ["جاكرتا", "Jakarta", "JKT", "اندونيسيا"],
  ["بالي", "Denpasar", "DPS", "دنباسار"],
  ["مانيلا", "Manila", "MNL", "الفلبين"],
  ["هانوي", "Hanoi", "HAN", "فيتنام"],
  ["هو تشي منه", "Ho Chi Minh City", "SGN"],
  ["هونغ كونغ", "Hong Kong", "HKG"],
  ["بكين", "Beijing", "BJS", "الصين"],
  ["شنغهاي", "Shanghai", "SHA"],
  ["قوانغتشو", "Guangzhou", "CAN", "جوانزو", "غوانزو"],
  ["طوكيو", "Tokyo", "TYO", "اليابان"],
  ["سيول", "Seoul", "SEL", "كوريا"],
  ["طشقند", "Tashkent", "TAS", "اوزبكستان"],
  ["ألماتي", "Almaty", "ALA", "الماتي", "كازاخستان"],
  // Africa
  ["أديس أبابا", "Addis Ababa", "ADD", "اديس ابابا", "اثيوبيا"],
  ["نيروبي", "Nairobi", "NBO", "كينيا"],
  ["زنجبار", "Zanzibar", "ZNZ"],
  ["دار السلام", "Dar Es Salaam", "DAR", "تنزانيا"],
  ["جوهانسبرغ", "Johannesburg", "JNB", "جنوب افريقيا"],
  ["كيب تاون", "Cape Town", "CPT"],
  // Americas & Oceania
  ["نيويورك", "New York", "NYC", "امريكا"],
  ["واشنطن", "Washington", "WAS"],
  ["شيكاغو", "Chicago", "CHI"],
  ["ديترويت", "Detroit", "DTT"],
  ["لوس أنجلوس", "Los Angeles", "LAX", "لوس انجلوس"],
  ["سان فرانسيسكو", "San Francisco", "SFO"],
  ["ميامي", "Miami", "MIA"],
  ["هيوستن", "Houston", "HOU"],
  ["دالاس", "Dallas", "DFW"],
  ["أتلانتا", "Atlanta", "ATL", "اتلانتا"],
  ["بوسطن", "Boston", "BOS"],
  ["تورنتو", "Toronto", "YTO", "كندا"],
  ["مونتريال", "Montreal", "YMQ"],
  ["فانكوفر", "Vancouver", "YVR"],
  ["سيدني", "Sydney", "SYD", "استراليا"],
  ["ملبورن", "Melbourne", "MEL"],
];

// Fold the spellings people type interchangeably: hamzas, taa marbuta, alef maqsura, tatweel, diacritics.
function normalize(text) {
  return String(text || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const entries = CITIES.map(([ar, en, code, ...aliases]) => ({
  ar,
  en,
  code,
  keys: [ar, ...aliases].map(normalize),
}));
const byCode = new Map(entries.map((e) => [e.code, e]));
const byEnglish = new Map(entries.map((e) => [e.en.toLowerCase(), e]));

const ARABIC_RE = /[؀-ۿ]/;
const isArabic = (text) => ARABIC_RE.test(String(text || ""));

/** Cities whose Arabic name (or a common spelling) starts with — or contains — the query, best first. */
function matchCities(query, limit = 3) {
  const q = normalize(query);
  if (!q) return [];
  const scored = [];
  for (const e of entries) {
    let score = 0;
    for (const k of e.keys) {
      if (k === q) score = Math.max(score, 3);
      else if (k.startsWith(q) || k.replace(/^ال/, "").startsWith(q)) score = Math.max(score, 2);
      else if (q.length >= 3 && k.includes(q)) score = Math.max(score, 1);
    }
    if (score) scored.push([score, e]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, e]) => e);
}

let countryNames;
try {
  countryNames = new Intl.DisplayNames(["ar"], { type: "region" });
} catch {
  countryNames = null;
}

function arabicCountry(code, fallback) {
  try {
    return (code && countryNames?.of(code)) || fallback;
  } catch {
    return fallback;
  }
}

/** Same place object with Arabic `name` / `country`; the originals stay in `name_en` / `country_en`. */
function localizePlace(place) {
  const city = byCode.get(place.city_code) || (place.type === "city" ? byEnglish.get(String(place.name).toLowerCase()) : null);
  let name = place.name;
  if (city) {
    if (place.type === "city") name = city.ar;
    else if (/airport|international|intl/i.test(place.name)) name = `مطار ${city.ar}`;
  }
  return {
    ...place,
    name,
    name_en: place.name,
    country: arabicCountry(place.country_code, place.country),
    country_en: place.country,
  };
}

// Common words in activity searches. Longer phrases first so "رحلة بحرية" beats "رحلة".
const KEYWORDS = [
  ["رحلة بحرية", "cruise"],
  ["برج خليفة", "Burj Khalifa"],
  ["مدينة العاب", "theme park"],
  ["حديقة حيوانات", "zoo"],
  ["حمام تركي", "hammam"],
  ["حوض اسماك", "aquarium"],
  ["اكواريوم", "aquarium"],
  ["سفاري", "safari"],
  ["صحراء", "desert"],
  ["متحف", "museum"],
  ["برج", "tower"],
  ["قصر", "palace"],
  ["مسجد", "mosque"],
  ["جامع", "mosque"],
  ["جزيره", "island"],
  ["جزر", "islands"],
  ["حديقه", "park"],
  ["منتزه", "park"],
  ["العاب مائيه", "water park"],
  ["مائيه", "water"],
  ["قارب", "boat"],
  ["يخت", "yacht"],
  ["غوص", "diving"],
  ["منطاد", "balloon"],
  ["تزلج", "ski"],
  ["شلال", "waterfall"],
  ["عشاء", "dinner"],
  ["تذكره", "ticket"],
  ["تذاكر", "ticket"],
  ["جوله", "tour"],
  ["رحله", "tour"],
  ["صاله", "lounge"],
  ["مطار", "airport"],
].map(([ar, en]) => [normalize(ar), en]);

/**
 * English search for an Arabic query: { query, city }, or null when nothing is recognised.
 * "سفاري دبي" → { query: "safari", city: "Dubai" }; unknown words (في، من…) are dropped.
 */
function englishSearch(query) {
  let rest = ` ${normalize(query)} `;
  const words = [];
  let city = null;
  const take = (ar) => {
    const at = rest.indexOf(` ${ar} `);
    if (at < 0) return -1;
    rest = rest.slice(0, at) + " ".repeat(ar.length + 1) + rest.slice(at + ar.length + 1);
    return at;
  };
  for (const [ar, en] of KEYWORDS) {
    for (let at; (at = take(ar)) >= 0; ) words.push([at, en]);
  }
  for (const e of entries) {
    for (const k of e.keys) if (take(k) >= 0 || take(k.replace(/^ال/, "")) >= 0) city ??= e.en;
  }
  // A single partial word ("اسطن") can still be a city.
  if (!words.length && !city) city = matchCities(query, 1)[0]?.en ?? null;
  if (!words.length && !city) return null;
  return { query: words.sort((a, b) => a[0] - b[0]).map(([, en]) => en).join(" ") || null, city };
}

/** Arabic name for an English city name from the supplier, if we know it. */
const arabicCity = (name) => byEnglish.get(String(name || "").toLowerCase())?.ar;

module.exports = { isArabic, matchCities, localizePlace, englishSearch, arabicCity, CITIES };
