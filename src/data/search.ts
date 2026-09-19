import { endonymTexts } from './names'
import type { Country } from './types'

/** Lower-case, strip diacritics and punctuation so "Cote d'Ivoire" matches "Côte d’Ivoire". */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`´.,()\-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every string that counts as this country's name, for search and answer matching. */
export function allNames(c: Country): string[] {
  return [c.exonymEn, ...endonymTexts(c.endonyms), ...c.alsoKnownAs]
}

export interface SearchHit {
  country: Country
  /** The name that matched, so the UI can show why. */
  matched: string
  score: number
}

export function searchCountries(query: string, countries: Country[], limit = 8): SearchHit[] {
  const q = normalize(query)
  if (!q) return []
  const hits: SearchHit[] = []
  for (const country of countries) {
    let best: SearchHit | null = null
    for (const name of allNames(country)) {
      const n = normalize(name)
      let score = 0
      if (n === q) score = 100
      else if (n.startsWith(q)) score = 80
      else if (n.split(' ').some((w) => w.startsWith(q))) score = 60
      else if (n.includes(q)) score = 40
      else if (country.iso2.toLowerCase() === q || country.iso3?.toLowerCase() === q) score = 90
      if (score && (!best || score > best.score)) best = { country, matched: name, score }
    }
    if (best) hits.push(best)
  }
  return hits
    .sort((a, b) => b.score - a.score || a.country.exonymEn.localeCompare(b.country.exonymEn))
    .slice(0, limit)
}
