/**
 * Hand-maintained name overlay.
 *
 * CLDR gives us the usual English exonym and the endonym in each official
 * language. This file adds names that are in circulation but not in CLDR, and
 * a short note where the name itself depends on who is doing the recognising.
 *
 * Every string listed here is accepted as a valid answer in search and quiz
 * matching. Nothing here is meant as a political endorsement.
 */
export interface NameOverride {
  /** Extra English or romanised names (alternate, former, formal). */
  alsoKnownAs?: string[]
  /** Extra endonyms not derivable from CLDR territory names. */
  endonyms?: string[]
  /** Short note when the name is contested or recently changed. */
  nameNote?: string
}

export const NAME_OVERRIDES: Record<string, NameOverride> = {
  TW: {
    alsoKnownAs: ['Republic of China', 'Chinese Taipei', 'Taiwan, Province of China', 'Formosa'],
    endonyms: ['中華民國', '臺灣'],
    nameNote:
      'Self-governed as the Republic of China. Recognised under different names depending on the recognising state or organisation (Taiwan, Republic of China, Chinese Taipei, Taiwan Province of China).',
  },
  XK: {
    alsoKnownAs: ['Republic of Kosovo', 'Kosovo and Metohija'],
    endonyms: ['Kosova', 'Косово'],
    nameNote:
      'Declared independence in 2008. Recognised by a majority but not all UN member states; some states refer to it as the Autonomous Province of Kosovo and Metohija.',
  },
  PS: {
    alsoKnownAs: ['State of Palestine', 'Palestinian Territories', 'West Bank and Gaza'],
    endonyms: ['فلسطين'],
    nameNote:
      'UN observer state. Referred to as the State of Palestine, the Palestinian Territories, or West Bank and Gaza depending on the source.',
  },
  VA: {
    alsoKnownAs: ['Holy See', 'Vatican', 'Vatican City State'],
    endonyms: ['Città del Vaticano', 'Status Civitatis Vaticanae'],
    nameNote: 'The Holy See is the UN observer entity; Vatican City is the territory it governs.',
  },
  CZ: { alsoKnownAs: ['Czech Republic'], nameNote: 'Czechia is the short name adopted in 2016; Czech Republic remains the formal name.' },
  TR: { alsoKnownAs: ['Turkey'], nameNote: 'Türkiye is the name used at the UN since 2022; Turkey remains widely used in English.' },
  CI: { alsoKnownAs: ['Ivory Coast'], nameNote: 'The government asks that Côte d\u2019Ivoire not be translated; Ivory Coast is still common in English.' },
  SZ: { alsoKnownAs: ['Swaziland'], nameNote: 'Renamed Eswatini in 2018.' },
  MM: { alsoKnownAs: ['Burma'], nameNote: 'Myanmar since 1989; some governments and media still use Burma.' },
  TL: { alsoKnownAs: ['East Timor'] },
  CV: { alsoKnownAs: ['Cape Verde'] },
  MK: { alsoKnownAs: ['Macedonia', 'Republic of North Macedonia'], nameNote: 'Renamed North Macedonia in 2019 following the Prespa agreement.' },
  KP: { alsoKnownAs: ['Democratic People\u2019s Republic of Korea', 'DPRK', 'North Korea'] },
  KR: { alsoKnownAs: ['Republic of Korea', 'ROK', 'South Korea'] },
  CD: { alsoKnownAs: ['Democratic Republic of the Congo', 'DR Congo', 'DRC', 'Congo-Kinshasa', 'Zaire'] },
  CG: { alsoKnownAs: ['Republic of the Congo', 'Congo-Brazzaville'] },
  NL: { alsoKnownAs: ['Holland', 'Kingdom of the Netherlands'] },
  US: { alsoKnownAs: ['United States of America', 'USA', 'America'] },
  GB: { alsoKnownAs: ['United Kingdom of Great Britain and Northern Ireland', 'UK', 'Great Britain', 'Britain'] },
  RU: { alsoKnownAs: ['Russian Federation'] },
  IR: { alsoKnownAs: ['Islamic Republic of Iran', 'Persia'] },
  SY: { alsoKnownAs: ['Syrian Arab Republic'] },
  LA: { alsoKnownAs: ['Lao People\u2019s Democratic Republic', 'Lao PDR'] },
  VN: { alsoKnownAs: ['Viet Nam', 'Socialist Republic of Vietnam'] },
  BN: { alsoKnownAs: ['Brunei Darussalam'] },
  BO: { alsoKnownAs: ['Plurinational State of Bolivia'] },
  VE: { alsoKnownAs: ['Bolivarian Republic of Venezuela'] },
  TZ: { alsoKnownAs: ['United Republic of Tanzania'] },
  FM: { alsoKnownAs: ['Federated States of Micronesia'] },
  MD: { alsoKnownAs: ['Republic of Moldova'] },
  BA: { alsoKnownAs: ['Bosnia-Herzegovina', 'Bosnia'] },
  AE: { alsoKnownAs: ['UAE', 'Emirates'] },
  GM: { alsoKnownAs: ['The Gambia'] },
  BS: { alsoKnownAs: ['The Bahamas'] },
  IE: { alsoKnownAs: ['Republic of Ireland', 'Éire'] },
  CN: { alsoKnownAs: ['People\u2019s Republic of China', 'PRC'] },
  IN: { alsoKnownAs: ['Bharat', 'Republic of India'] },
  EG: { alsoKnownAs: ['Arab Republic of Egypt'] },
  BY: { alsoKnownAs: ['Belorussia', 'Byelorussia'] },
  KG: { alsoKnownAs: ['Kirghizia', 'Kyrgyz Republic'] },
  SK: { alsoKnownAs: ['Slovak Republic'] },
  ST: { alsoKnownAs: ['Sao Tome and Principe'] },
  CF: { alsoKnownAs: ['CAR'] },
  DO: { alsoKnownAs: ['Dominican Rep.'] },
  PG: { alsoKnownAs: ['PNG'] },
  NZ: { alsoKnownAs: ['Aotearoa', 'Aotearoa New Zealand'] },
  ZA: { alsoKnownAs: ['RSA', 'Republic of South Africa'] },
  AU: { alsoKnownAs: ['Commonwealth of Australia'] },
  BR: { alsoKnownAs: ['Brasil'] },
  MX: { alsoKnownAs: ['United Mexican States'] },
  AR: { alsoKnownAs: ['Argentine Republic'] },
  DE: { alsoKnownAs: ['Federal Republic of Germany'] },
  CH: { alsoKnownAs: ['Swiss Confederation', 'Helvetia'] },
  AT: { alsoKnownAs: ['Republic of Austria'] },
  TD: { alsoKnownAs: ['Tchad'] },
  BF: { alsoKnownAs: ['Upper Volta'] },
  BJ: { alsoKnownAs: ['Dahomey'] },
  LK: { alsoKnownAs: ['Ceylon'] },
  KH: { alsoKnownAs: ['Kampuchea'] },
  ET: { alsoKnownAs: ['Abyssinia'] },
  GR: { alsoKnownAs: ['Hellenic Republic', 'Hellas'] },
  HU: { alsoKnownAs: ['Magyarország'] },
  FI: { alsoKnownAs: ['Suomi'] },
  GE: { alsoKnownAs: ['Sakartvelo'] },
  AM: { alsoKnownAs: ['Hayastan'] },
  JP: { alsoKnownAs: ['Nippon', 'Nihon'] },
  KZ: { alsoKnownAs: ['Republic of Kazakhstan'] },
  TM: { alsoKnownAs: ['Turkmenia'] },
  SS: { alsoKnownAs: ['Republic of South Sudan'] },
  EH: {
    alsoKnownAs: ['Sahrawi Arab Democratic Republic', 'SADR'],
    nameNote: 'Non-self-governing territory per the UN; administered largely by Morocco and claimed by the Sahrawi Arab Democratic Republic.',
  },
  CY: { alsoKnownAs: ['Republic of Cyprus'], nameNote: 'The northern part is administered by the Turkish Republic of Northern Cyprus, recognised only by Türkiye.' },
}
