import { useState } from 'react'
import type { Dataset } from '../data/load'
import type { Country } from '../data/types'
import { WorldMap } from '../map/WorldMap'
import { CountryPanel } from './CountryPanel'
import { CountrySearch } from './CountrySearch'

/** Free-roam map: click or search a country to see its facts. */
export function Explore({ dataset, onBack }: { dataset: Dataset; onBack: () => void }) {
  const [selected, setSelected] = useState<Country | null>(null)
  const [flyTo, setFlyTo] = useState<{ bbox: Country['bbox']; nonce: number } | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const select = (c: Country, fly: boolean) => {
    setSelected(c)
    if (fly) setFlyTo({ bbox: c.bbox, nonce: Date.now() })
  }

  return (
    <div className="screen">
      <WorldMap
        geojson={dataset.geojson}
        lakes={dataset.lakes}
        states={dataset.states}
        interaction="country"
        roles={selected ? { [selected.iso2]: 'selected' } : undefined}
        flyTo={flyTo}
        onCountryClick={(iso2) => select(dataset.countries[iso2], false)}
        onHover={setHovered}
      />
      <div className="overlay top-left">
        <button className="btn ghost" onClick={onBack}>
          ← Back
        </button>
        <CountrySearch countries={dataset.countryList} onSelect={(c) => select(c, true)} autoFocus />
        {hovered && !selected && <div className="hover-hint">{dataset.countries[hovered]?.exonymEn}</div>}
      </div>
      {selected && (
        <div className="overlay bottom-left">
          <CountryPanel country={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}
