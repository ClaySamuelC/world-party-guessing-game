import { formatArea, formatNumber } from '../data/load'
import type { Country } from '../data/types'
import { Flag } from './Flag'

export function CountryPanel({ country, onClose }: { country: Country; onClose?: () => void }) {
  return (
    <div className="panel country-panel">
      <div className="country-head">
        <Flag iso2={country.iso2} size="xl" title={country.exonymEn} />
        <div>
          <h2>{country.exonymEn}</h2>
          {country.endonyms.length > 0 && <div className="endonyms">{country.endonyms.join(' · ')}</div>}
        </div>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>
      <dl className="facts">
        <dt>Capital</dt>
        <dd>{country.capitals.length ? country.capitals.join(', ') : 'n/a'}</dd>
        <dt>Population</dt>
        <dd>
          {formatNumber(country.population)}
          {country.populationYear && <small> (UN WPP, {country.populationYear})</small>}
        </dd>
        <dt>Land area</dt>
        <dd>
          {formatArea(country.areaKm2)}
          <small> ({country.areaSource === 'worldbank' ? 'World Bank' : 'computed from map polygon'})</small>
        </dd>
        <dt>Region</dt>
        <dd>{[country.subregion, country.region].filter(Boolean).join(', ') || 'n/a'}</dd>
        <dt>Codes</dt>
        <dd>
          {country.iso2}
          {country.iso3 ? ` / ${country.iso3}` : ''}
          {country.unMember ? ' · UN member' : ' · not a UN member'}
        </dd>
        {country.alsoKnownAs.length > 0 && (
          <>
            <dt>Also known as</dt>
            <dd>{country.alsoKnownAs.join(', ')}</dd>
          </>
        )}
      </dl>
      {country.nameNote && <p className="name-note">{country.nameNote}</p>}
    </div>
  )
}
