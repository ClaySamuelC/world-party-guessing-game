import type { Endonym } from './types'

export function formatEndonym(e: Endonym): string {
  return e.language ? `${e.text} (${e.language})` : e.text
}

export function formatEndonyms(list: Endonym[]): string {
  return list.map(formatEndonym).join(' · ')
}

export function endonymTexts(list: Endonym[]): string[] {
  return list.map((e) => e.text)
}
