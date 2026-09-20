import { useMemo, useState } from 'react'
import type { Country } from '../data/types'
import { searchCountries } from '../data/search'

export function NameGuess({
  countries,
  disabled,
  onGuess,
}: {
  countries: Country[]
  disabled?: boolean
  onGuess: (iso2: string) => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const hits = useMemo(() => searchCountries(query, countries, 8), [query, countries])

  const pick = (iso2: string) => {
    if (disabled) return
    onGuess(iso2)
  }

  return (
    <div className="name-guess">
      <input
        className="search-input"
        type="text"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        autoFocus
        placeholder="Type a country name"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, Math.max(0, hits.length - 1)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter' && hits[active]) {
            e.preventDefault()
            pick(hits[active].country.iso2)
          }
        }}
      />
      {hits.length > 0 && !disabled && (
        <ul className="search-results name-suggestions" role="listbox">
          {hits.map((h, i) => (
            <li
              key={h.country.iso2}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(h.country.iso2)}
            >
              <span className="search-name">{h.country.exonymEn}</span>
              {h.matched !== h.country.exonymEn && <span className="search-matched">{h.matched}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
