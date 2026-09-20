/**
 * Top-3 merchandise exporters for the Export Guess mini-game.
 * Rankings are by export quantity or value as the cited source reports for that year —
 * not a statement of production. Re-export hubs (e.g. Swiss gold) are avoided.
 */
import type { ExportCommodity } from '../src/data/types.ts'

export type { ExportCommodity }

const wp = (slug: string, label: string) => ({
  sourceUrl: `https://en.wikipedia.org/wiki/${slug}`,
  sourceLabel: `Wikipedia: ${label}`,
})

const oec = (slug: string, label: string, year: number) => ({
  sourceUrl: `https://oec.world/en/profile/hs/${slug}`,
  sourceLabel: `OEC · ${label} (${year})`,
})

export const EXPORTS: ExportCommodity[] = [
  { id: 'coffee', name: 'coffee', iso2s: ['BR', 'VN', 'CO'], year: 2023, ...oec('coffee', 'Coffee', 2023) },
  { id: 'cocoa', name: 'cocoa beans', iso2s: ['CI', 'GH', 'EC'], year: 2023, ...oec('cocoa-beans', 'Cocoa beans', 2023) },
  { id: 'tea', name: 'tea', iso2s: ['KE', 'CN', 'IN'], year: 2023, ...oec('tea', 'Tea', 2023) },
  { id: 'wheat', name: 'wheat', iso2s: ['RU', 'US', 'CA'], year: 2023, ...wp('List_of_countries_by_wheat_exports', 'List of countries by wheat exports') },
  { id: 'rice', name: 'rice', iso2s: ['IN', 'TH', 'VN'], year: 2023, ...wp('List_of_countries_by_rice_exports', 'List of countries by rice exports') },
  { id: 'soybeans', name: 'soybeans', iso2s: ['BR', 'US', 'AR'], year: 2023, ...oec('soybeans', 'Soybeans', 2023) },
  { id: 'maize', name: 'maize (corn)', iso2s: ['US', 'BR', 'AR'], year: 2023, ...oec('corn', 'Corn', 2023) },
  { id: 'sugar', name: 'sugar', iso2s: ['BR', 'IN', 'TH'], year: 2023, ...oec('raw-sugar', 'Raw sugar', 2023) },
  { id: 'palm-oil', name: 'palm oil', iso2s: ['ID', 'MY', 'TH'], year: 2023, ...oec('palm-oil', 'Palm oil', 2023) },
  { id: 'bananas', name: 'bananas', iso2s: ['EC', 'PH', 'CR'], year: 2023, ...oec('bananas', 'Bananas', 2023) },
  { id: 'cotton', name: 'cotton', iso2s: ['US', 'BR', 'AU'], year: 2023, ...oec('cotton', 'Cotton', 2023) },
  { id: 'rubber', name: 'natural rubber', iso2s: ['TH', 'ID', 'VN'], year: 2023, ...oec('natural-rubber', 'Natural rubber', 2023) },
  { id: 'wine', name: 'wine', iso2s: ['FR', 'IT', 'ES'], year: 2023, ...oec('wine', 'Wine', 2023) },
  { id: 'olive-oil', name: 'olive oil', iso2s: ['ES', 'IT', 'TN'], year: 2023, ...oec('olive-oil', 'Olive oil', 2023) },
  { id: 'crude-oil', name: 'crude oil', iso2s: ['SA', 'RU', 'IQ'], year: 2023, ...wp('List_of_countries_by_oil_exports', 'List of countries by oil exports') },
  { id: 'lng', name: 'liquefied natural gas', iso2s: ['US', 'QA', 'AU'], year: 2023, ...wp('List_of_countries_by_natural_gas_exports', 'List of countries by natural gas exports') },
  { id: 'copper', name: 'copper ore', iso2s: ['CL', 'PE', 'CD'], year: 2023, ...oec('copper-ore', 'Copper ore', 2023) },
  { id: 'iron-ore', name: 'iron ore', iso2s: ['AU', 'BR', 'ZA'], year: 2023, ...oec('iron-ore', 'Iron ore', 2023) },
  { id: 'lithium', name: 'lithium', iso2s: ['AU', 'CL', 'CN'], year: 2023, ...wp('List_of_countries_by_lithium_production', 'List of countries by lithium production') },
  { id: 'uranium', name: 'uranium', iso2s: ['KZ', 'CA', 'NA'], year: 2023, ...wp('List_of_countries_by_uranium_production', 'List of countries by uranium production') },
  { id: 'diamonds', name: 'rough diamonds', iso2s: ['RU', 'BW', 'CA'], year: 2023, ...oec('diamonds', 'Diamonds', 2023) },
  { id: 'phosphate', name: 'phosphate rock', iso2s: ['MA', 'CN', 'US'], year: 2023, ...wp('List_of_countries_by_phosphate_production', 'Phosphate production') },
  { id: 'nickel', name: 'nickel', iso2s: ['ID', 'PH', 'RU'], year: 2023, ...oec('nickel-ores-and-concentrates', 'Nickel ores', 2023) },
  { id: 'cobalt', name: 'cobalt', iso2s: ['CD', 'RU', 'AU'], year: 2023, ...wp('List_of_countries_by_cobalt_production', 'List of countries by cobalt production') },
  { id: 'cars', name: 'cars', iso2s: ['CN', 'JP', 'DE'], year: 2023, ...oec('cars', 'Cars', 2023) },
]
