import { useMemo, useRef, useState } from 'react'
import { searchCountries } from '../data/search'
import type { Country } from '../data/types'
import { Flag } from './Flag'

interface Props {
  countries: Country[]
  onSelect: (country: Country) => void
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
}

/** Search box for finding countries too small to click. Enter picks the top hit. */
export function CountrySearch({ countries, onSelect, placeholder, autoFocus, disabled }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => searchCountries(query, countries), [query, countries])

  const pick = (c: Country) => {
    onSelect(c)
    setQuery('')
    inputRef.current?.blur()
  }

  return (
    <div className="search">
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Search a country (any name, e.g. Nippon, 日本, Deutschland)'}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && hits[active]) {
            e.preventDefault()
            pick(hits[active].country)
          } else if (e.key === 'Escape') {
            setQuery('')
          }
        }}
      />
      {hits.length > 0 && (
        <ul className="search-results" role="listbox">
          {hits.map((h, i) => (
            <li
              key={h.country.iso2}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(h.country)}
            >
              <Flag iso2={h.country.iso2} size="sm" />
              <span className="search-name">{h.country.exonymEn}</span>
              {h.matched !== h.country.exonymEn && <span className="search-matched">{h.matched}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
