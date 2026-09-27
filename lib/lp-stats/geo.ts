/**
 * Where an LP is, from the words a source used (LP stats, 27 Sep 2026). Dakota gives a billing
 * country; research gives free text ("Zug, Switzerland", "San Francisco Bay Area"). This reads a
 * country out of either, and rolls it up to a region. Client-safe: no server imports.
 *
 * A reading, not a fact: a place nobody wrote down, or one this list does not know, is unknown —
 * never a guess from a name or a phone code.
 */

export type Region =
  | 'north_america' | 'europe' | 'middle_east'
  | 'asia_sg' | 'asia_hk' | 'asia_jp' | 'asia_cn' | 'asia_in' | 'asia_other'
  | 'latam' | 'other' | 'unknown';

export const REGIONS: Region[] = [
  'north_america', 'europe', 'middle_east', 'asia_sg', 'asia_hk', 'asia_jp', 'asia_cn', 'asia_in', 'asia_other', 'latam', 'other', 'unknown',
];
export const REGION_LABEL: Record<Region, string> = {
  north_america: 'North America', europe: 'Europe', middle_east: 'Middle East',
  asia_sg: 'Asia · Singapore', asia_hk: 'Asia · Hong Kong', asia_jp: 'Asia · Japan', asia_cn: 'Asia · China',
  asia_in: 'Asia · India', asia_other: 'Asia · elsewhere', latam: 'Latin America', other: 'Elsewhere', unknown: 'Not known',
};

/** Country name → its region, and the other names it goes by. The first name is the one shown. */
const COUNTRIES: Array<[string, Region, string[]]> = [
  ['United States', 'north_america', ['usa', 'us', 'u.s.', 'u.s.a.', 'united states of america']],
  ['Canada', 'north_america', []],
  ['United Kingdom', 'europe', ['uk', 'u.k.', 'england', 'scotland', 'wales', 'great britain', 'britain', 'northern ireland']],
  ['Ireland', 'europe', []], ['France', 'europe', []], ['Germany', 'europe', ['deutschland']],
  ['Switzerland', 'europe', ['schweiz', 'suisse']], ['Netherlands', 'europe', ['the netherlands', 'holland']],
  ['Belgium', 'europe', []], ['Luxembourg', 'europe', []], ['Austria', 'europe', []], ['Italy', 'europe', []],
  ['Spain', 'europe', []], ['Portugal', 'europe', []], ['Sweden', 'europe', []], ['Norway', 'europe', []],
  ['Denmark', 'europe', []], ['Finland', 'europe', []], ['Iceland', 'europe', []], ['Poland', 'europe', []],
  ['Czech Republic', 'europe', ['czechia']], ['Estonia', 'europe', []], ['Latvia', 'europe', []], ['Lithuania', 'europe', []],
  ['Greece', 'europe', []], ['Cyprus', 'europe', []], ['Malta', 'europe', []], ['Monaco', 'europe', []],
  ['Liechtenstein', 'europe', []], ['Hungary', 'europe', []], ['Romania', 'europe', []], ['Bulgaria', 'europe', []],
  ['Croatia', 'europe', []], ['Slovenia', 'europe', []], ['Slovakia', 'europe', []], ['Serbia', 'europe', []],
  ['Ukraine', 'europe', []], ['Jersey', 'europe', []], ['Guernsey', 'europe', []], ['Isle of Man', 'europe', []],
  ['Gibraltar', 'europe', []], ['Andorra', 'europe', []],
  ['United Arab Emirates', 'middle_east', ['uae', 'u.a.e.', 'emirates']], ['Saudi Arabia', 'middle_east', ['ksa']],
  ['Qatar', 'middle_east', []], ['Kuwait', 'middle_east', []], ['Bahrain', 'middle_east', []], ['Oman', 'middle_east', []],
  ['Israel', 'middle_east', []], ['Jordan', 'middle_east', []], ['Lebanon', 'middle_east', []], ['Turkey', 'middle_east', ['türkiye', 'turkiye']],
  ['Egypt', 'middle_east', []],
  ['Singapore', 'asia_sg', []], ['Hong Kong', 'asia_hk', ['hong kong sar', 'hk']], ['Japan', 'asia_jp', []],
  ['China', 'asia_cn', ["people's republic of china", 'prc', 'mainland china']], ['India', 'asia_in', []],
  ['South Korea', 'asia_other', ['korea', 'republic of korea']], ['Taiwan', 'asia_other', []], ['Indonesia', 'asia_other', []],
  ['Malaysia', 'asia_other', []], ['Thailand', 'asia_other', []], ['Vietnam', 'asia_other', ['viet nam']],
  ['Philippines', 'asia_other', []], ['Pakistan', 'asia_other', []], ['Bangladesh', 'asia_other', []], ['Sri Lanka', 'asia_other', []],
  ['Kazakhstan', 'asia_other', []], ['Macau', 'asia_other', ['macao']],
  ['Mexico', 'latam', []], ['Brazil', 'latam', ['brasil']], ['Argentina', 'latam', []], ['Chile', 'latam', []],
  ['Colombia', 'latam', []], ['Peru', 'latam', []], ['Uruguay', 'latam', []], ['Panama', 'latam', []], ['Costa Rica', 'latam', []],
  ['Cayman Islands', 'latam', ['cayman']], ['British Virgin Islands', 'latam', ['bvi']], ['Bahamas', 'latam', []], ['Bermuda', 'latam', []],
  ['Puerto Rico', 'north_america', []],
  ['Australia', 'other', []], ['New Zealand', 'other', []], ['South Africa', 'other', []], ['Nigeria', 'other', []],
  ['Kenya', 'other', []], ['Mauritius', 'other', []], ['Morocco', 'other', []],
];

/** Places that name a country without saying it: US states and the cities LP records most often give alone. */
const PLACES: Record<string, string> = {
  // US states, by name and by postal code (codes are read only after a comma: "Austin, TX").
  alabama: 'United States', alaska: 'United States', arizona: 'United States', arkansas: 'United States', california: 'United States',
  colorado: 'United States', connecticut: 'United States', delaware: 'United States', florida: 'United States', georgia: 'United States',
  hawaii: 'United States', idaho: 'United States', illinois: 'United States', indiana: 'United States', iowa: 'United States',
  kansas: 'United States', kentucky: 'United States', louisiana: 'United States', maine: 'United States', maryland: 'United States',
  massachusetts: 'United States', michigan: 'United States', minnesota: 'United States', mississippi: 'United States', missouri: 'United States',
  montana: 'United States', nebraska: 'United States', nevada: 'United States', 'new hampshire': 'United States', 'new jersey': 'United States',
  'new mexico': 'United States', 'new york': 'United States', 'north carolina': 'United States', 'north dakota': 'United States', ohio: 'United States',
  oklahoma: 'United States', oregon: 'United States', pennsylvania: 'United States', 'rhode island': 'United States', 'south carolina': 'United States',
  'south dakota': 'United States', tennessee: 'United States', texas: 'United States', utah: 'United States', vermont: 'United States',
  virginia: 'United States', washington: 'United States', 'west virginia': 'United States', wisconsin: 'United States', wyoming: 'United States',
  'district of columbia': 'United States', 'washington dc': 'United States', 'washington, d.c.': 'United States',
  'san francisco': 'United States', 'bay area': 'United States', 'silicon valley': 'United States', 'palo alto': 'United States',
  'menlo park': 'United States', 'los angeles': 'United States', 'nyc': 'United States', 'new york city': 'United States', boston: 'United States',
  cambridge: 'United States', seattle: 'United States', austin: 'United States', miami: 'United States', chicago: 'United States',
  denver: 'United States', 'san diego': 'United States', 'san jose': 'United States', 'mountain view': 'United States', greenwich: 'United States',
  toronto: 'Canada', vancouver: 'Canada', montreal: 'Canada', ontario: 'Canada', 'british columbia': 'Canada', quebec: 'Canada', alberta: 'Canada',
  london: 'United Kingdom', edinburgh: 'United Kingdom', oxford: 'United Kingdom', paris: 'France', berlin: 'Germany', munich: 'Germany',
  zurich: 'Switzerland', 'zürich': 'Switzerland', geneva: 'Switzerland', zug: 'Switzerland', lugano: 'Switzerland', amsterdam: 'Netherlands',
  stockholm: 'Sweden', oslo: 'Norway', copenhagen: 'Denmark', helsinki: 'Finland', madrid: 'Spain', barcelona: 'Spain', lisbon: 'Portugal',
  milan: 'Italy', rome: 'Italy', vienna: 'Austria', dublin: 'Ireland', tallinn: 'Estonia', warsaw: 'Poland', prague: 'Czech Republic',
  dubai: 'United Arab Emirates', 'abu dhabi': 'United Arab Emirates', riyadh: 'Saudi Arabia', doha: 'Qatar', 'tel aviv': 'Israel',
  tokyo: 'Japan', osaka: 'Japan', beijing: 'China', shanghai: 'China', shenzhen: 'China', hangzhou: 'China', mumbai: 'India',
  bangalore: 'India', bengaluru: 'India', 'new delhi': 'India', delhi: 'India', seoul: 'South Korea', taipei: 'Taiwan', jakarta: 'Indonesia',
  'kuala lumpur': 'Malaysia', bangkok: 'Thailand', manila: 'Philippines', sydney: 'Australia', melbourne: 'Australia', auckland: 'New Zealand',
  'são paulo': 'Brazil', 'sao paulo': 'Brazil', 'mexico city': 'Mexico', 'buenos aires': 'Argentina', santiago: 'Chile', bogota: 'Colombia',
  // Added after the first real pass (27 Sep): the cities and forms LP records give for Asia and the Gulf,
  // and European cities that otherwise fell to a two-letter code ("Frankfurt, DE" was read as Delaware).
  'raffles place': 'Singapore', 'marina bay': 'Singapore', 'orchard road': 'Singapore', '新加坡': 'Singapore',
  kowloon: 'Hong Kong', 'wan chai': 'Hong Kong', 'causeway bay': 'Hong Kong', 'tsim sha tsui': 'Hong Kong', 'sheung wan': 'Hong Kong',
  '香港': 'Hong Kong',
  kyoto: 'Japan', yokohama: 'Japan', nagoya: 'Japan', fukuoka: 'Japan', kobe: 'Japan', sapporo: 'Japan', minato: 'Japan', 'minato-ku': 'Japan',
  shibuya: 'Japan', 'shibuya-ku': 'Japan', chiyoda: 'Japan', 'chiyoda-ku': 'Japan', '日本': 'Japan', '東京': 'Japan', '东京': 'Japan',
  busan: 'South Korea', incheon: 'South Korea', seongnam: 'South Korea', pangyo: 'South Korea', gangnam: 'South Korea', daejeon: 'South Korea',
  '한국': 'South Korea', '서울': 'South Korea', 'south korean': 'South Korea',
  sharjah: 'United Arab Emirates', 'ras al khaimah': 'United Arab Emirates', difc: 'United Arab Emirates', adgm: 'United Arab Emirates',
  jeddah: 'Saudi Arabia', dammam: 'Saudi Arabia', khobar: 'Saudi Arabia', 'al khobar': 'Saudi Arabia', dhahran: 'Saudi Arabia', neom: 'Saudi Arabia',
  'kuwait city': 'Kuwait', manama: 'Bahrain', muscat: 'Oman', amman: 'Jordan', beirut: 'Lebanon', istanbul: 'Turkey', jerusalem: 'Israel', herzliya: 'Israel', haifa: 'Israel',
  guangzhou: 'China', chengdu: 'China', suzhou: 'China', nanjing: 'China', '中国': 'China', '北京': 'China', '上海': 'China', '深圳': 'China',
  hyderabad: 'India', chennai: 'India', pune: 'India', gurgaon: 'India', gurugram: 'India', noida: 'India', kolkata: 'India',
  'ho chi minh city': 'Vietnam', hanoi: 'Vietnam', 'hsinchu': 'Taiwan',
  frankfurt: 'Germany', hamburg: 'Germany', cologne: 'Germany', düsseldorf: 'Germany', dusseldorf: 'Germany', stuttgart: 'Germany',
  lausanne: 'Switzerland', basel: 'Switzerland', bern: 'Switzerland', rotterdam: 'Netherlands', 'the hague': 'Netherlands', antwerp: 'Belgium',
  brussels: 'Belgium', gothenburg: 'Sweden', malmö: 'Sweden', lyon: 'France', vaduz: 'Liechtenstein', valletta: 'Malta', nicosia: 'Cyprus',
  limassol: 'Cyprus', athens: 'Greece', budapest: 'Hungary', bucharest: 'Romania', vilnius: 'Lithuania', riga: 'Latvia', kyiv: 'Ukraine',
  'st. helier': 'Jersey', 'st helier': 'Jersey', 'st peter port': 'Guernsey', manchester: 'United Kingdom', cambridgeshire: 'United Kingdom',
  brisbane: 'Australia', perth: 'Australia', canberra: 'Australia', wellington: 'New Zealand', 'cape town': 'South Africa', johannesburg: 'South Africa',
  lagos: 'Nigeria', nairobi: 'Kenya', 'rio de janeiro': 'Brazil', lima: 'Peru', montevideo: 'Uruguay', 'george town, cayman': 'Cayman Islands',
  'grand cayman': 'Cayman Islands', calgary: 'Canada', ottawa: 'Canada',
  'new york, ny': 'United States', manhattan: 'United States', brooklyn: 'United States', 'los altos': 'United States', 'woodside': 'United States',
  atherton: 'United States', 'redwood city': 'United States', berkeley: 'United States', oakland: 'United States', 'santa monica': 'United States',
  'san mateo': 'United States', sunnyvale: 'United States', philadelphia: 'United States', pittsburgh: 'United States', houston: 'United States',
  dallas: 'United States', atlanta: 'United States', nashville: 'United States', 'salt lake city': 'United States', phoenix: 'United States',
  portland: 'United States', minneapolis: 'United States', detroit: 'United States', 'palm beach': 'United States', 'west palm beach': 'United States',
  aspen: 'United States', 'jackson hole': 'United States', stamford: 'United States', princeton: 'United States',
  'new haven': 'United States', 'd.c': 'United States', honolulu: 'United States', 'las vegas': 'United States',
};
/**
 * ISO country codes read as a country when they stand alone after a comma ("Frankfurt, DE" aside —
 * that one is also a US state, see US_CODES). Codes that are also a US state's are left to US_CODES.
 */
const ISO2: Record<string, string> = {
  gb: 'United Kingdom', sg: 'Singapore', hk: 'Hong Kong', jp: 'Japan', kr: 'South Korea', ae: 'United Arab Emirates', sa: 'Saudi Arabia',
  ch: 'Switzerland', fr: 'France', nl: 'Netherlands', se: 'Sweden', dk: 'Denmark', fi: 'Finland', au: 'Australia', nz: 'New Zealand',
  br: 'Brazil', mx: 'Mexico', cn: 'China', tw: 'Taiwan', qa: 'Qatar', kw: 'Kuwait', bh: 'Bahrain', om: 'Oman', th: 'Thailand',
  ie: 'Ireland', es: 'Spain', it: 'Italy', pt: 'Portugal', at: 'Austria', be: 'Belgium', lu: 'Luxembourg', pl: 'Poland', cz: 'Czech Republic',
  gr: 'Greece', tr: 'Turkey', eg: 'Egypt', za: 'South Africa', ng: 'Nigeria', ke: 'Kenya', cl: 'Chile', pe: 'Peru', uy: 'Uruguay',
  li: 'Liechtenstein', mc: 'Monaco', cy: 'Cyprus', ee: 'Estonia', vn: 'Vietnam', ph: 'Philippines', my: 'Malaysia',
};
const US_CODES = new Set(['al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc']);

const REGION_OF = new Map<string, Region>();
const NAME_OF = new Map<string, string>();
for (const [name, region, aliases] of COUNTRIES) {
  REGION_OF.set(name, region);
  for (const n of [name, ...aliases]) NAME_OF.set(n.toLowerCase(), name);
}

/** Every name read inside a phrase: countries and their other names, then places. */
const WHOLE: Array<[string, string]> = [...NAME_OF.entries(), ...Object.entries(PLACES)];

const CJK = Object.entries(PLACES).filter(([n]) => /[\u3000-\u9fff\uac00-\ud7af]/.test(n));

/** The region a country (as named by countryOf) rolls up to; unknown for anything else. */
export const regionOf = (country: string | null): Region => (country ? REGION_OF.get(country) ?? 'other' : 'unknown');

/**
 * The country a piece of location text names, or null. Reads the text's comma parts from the last
 * (the broadest) to the first, so "Cambridge, United Kingdom" is the UK and "Cambridge, MA" the US.
 */
export function countryOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const parts = text.split(/[,;/|]|\s[-–—]\s|\(|\)/).map((p) => p.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    const named = NAME_OF.get(p);
    if (named) return named;
    if (i > 0 && US_CODES.has(p)) {
      // Two letters are ambiguous ("Mumbai, IN"): a place before them that names another country wins.
      const before = parts.slice(0, i).map((x) => PLACES[x] ?? NAME_OF.get(x)).find(Boolean);
      return before ?? 'United States';
    }
    const place = PLACES[p];
    if (place) return place;
    if (i > 0 && ISO2[p]) return ISO2[p]!;
  }
  // A whole phrase ("based in the Greater London area"): the longest known name inside it, so
  // "New Jersey" is read before "Jersey".
  const whole = ` ${text.toLowerCase().replace(/[^\p{L}\s.']/gu, ' ').replace(/\s+/g, ' ')} `;
  let best: { name: string; len: number } | null = null;
  for (const [n, country] of WHOLE) if (n.length > (best?.len ?? 3) && whole.includes(` ${n} `)) best = { name: country, len: n.length };
  if (best) return best.name;
  // Scripts written without spaces between words (東京都港区): a known name anywhere in the text.
  for (const [n, country] of CJK) if (text.includes(n)) return country;
  return null;
}
