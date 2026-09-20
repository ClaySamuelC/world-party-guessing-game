/**
 * Hand-written Pin-the-location questions for wonders, landmarks, and other
 * well-known places. Coordinates point at the named site and are accurate to a
 * few kilometres — well inside the 25 km full-marks radius of pin scoring.
 * Each entry links to a Wikipedia article for context.
 */
export interface LandmarkInput {
  id: string
  text: string
  name: string
  lat: number
  lng: number
  iso2?: string | null
  sourceUrl: string
  sourceLabel: string
}

const wp = (slug: string, label: string) => ({ sourceUrl: `https://en.wikipedia.org/wiki/${slug}`, sourceLabel: `Wikipedia: ${label}` })

export const LANDMARKS: LandmarkInput[] = [
  // New 7 Wonders + classic wonders
  { id: 'great-pyramid', text: 'Pin the Great Pyramid of Giza', name: 'Great Pyramid of Giza', lat: 29.9792, lng: 31.1342, iso2: 'EG', ...wp('Great_Pyramid_of_Giza', 'Great Pyramid of Giza') },
  { id: 'great-wall', text: 'Pin the Great Wall of China (Badaling)', name: 'Great Wall at Badaling', lat: 40.3598, lng: 116.02, iso2: 'CN', ...wp('Great_Wall_of_China', 'Great Wall of China') },
  { id: 'petra', text: 'Pin Petra, the rock-cut city in Jordan', name: 'Petra', lat: 30.3285, lng: 35.4444, iso2: 'JO', ...wp('Petra', 'Petra') },
  { id: 'colosseum', text: 'Pin the Colosseum', name: 'Colosseum', lat: 41.8902, lng: 12.4922, iso2: 'IT', ...wp('Colosseum', 'Colosseum') },
  { id: 'chichen-itza', text: 'Pin Chichén Itzá', name: 'Chichén Itzá', lat: 20.6843, lng: -88.5678, iso2: 'MX', ...wp('Chichen_Itza', 'Chichén Itzá') },
  { id: 'machu-picchu', text: 'Pin Machu Picchu', name: 'Machu Picchu', lat: -13.1631, lng: -72.545, iso2: 'PE', ...wp('Machu_Picchu', 'Machu Picchu') },
  { id: 'taj-mahal', text: 'Pin the Taj Mahal', name: 'Taj Mahal', lat: 27.1751, lng: 78.0421, iso2: 'IN', ...wp('Taj_Mahal', 'Taj Mahal') },
  { id: 'christ-redeemer', text: 'Pin Christ the Redeemer', name: 'Christ the Redeemer, Rio de Janeiro', lat: -22.9519, lng: -43.2105, iso2: 'BR', ...wp('Christ_the_Redeemer_(statue)', 'Christ the Redeemer') },
  { id: 'stonehenge', text: 'Pin Stonehenge', name: 'Stonehenge', lat: 51.1789, lng: -1.8262, iso2: 'GB', ...wp('Stonehenge', 'Stonehenge') },
  { id: 'angkor-wat', text: 'Pin Angkor Wat', name: 'Angkor Wat', lat: 13.4125, lng: 103.867, iso2: 'KH', ...wp('Angkor_Wat', 'Angkor Wat') },
  { id: 'acropolis', text: 'Pin the Acropolis of Athens', name: 'Acropolis of Athens', lat: 37.9715, lng: 23.7267, iso2: 'GR', ...wp('Acropolis_of_Athens', 'Acropolis of Athens') },
  { id: 'alhambra', text: 'Pin the Alhambra', name: 'Alhambra', lat: 37.176, lng: -3.5881, iso2: 'ES', ...wp('Alhambra', 'Alhambra') },
  { id: 'hagia-sophia', text: 'Pin Hagia Sophia', name: 'Hagia Sophia', lat: 41.0086, lng: 28.9802, iso2: 'TR', ...wp('Hagia_Sophia', 'Hagia Sophia') },
  { id: 'forbidden-city', text: 'Pin the Forbidden City', name: 'Forbidden City', lat: 39.9163, lng: 116.3972, iso2: 'CN', ...wp('Forbidden_City', 'Forbidden City') },
  { id: 'terracotta-army', text: 'Pin the Terracotta Army', name: 'Terracotta Army, Xi’an', lat: 34.3848, lng: 109.2731, iso2: 'CN', ...wp('Terracotta_Army', 'Terracotta Army') },
  { id: 'borobudur', text: 'Pin Borobudur', name: 'Borobudur', lat: -7.6079, lng: 110.2038, iso2: 'ID', ...wp('Borobudur', 'Borobudur') },
  { id: 'abu-simbel', text: 'Pin the temples of Abu Simbel', name: 'Abu Simbel', lat: 22.3372, lng: 31.6258, iso2: 'EG', ...wp('Abu_Simbel', 'Abu Simbel') },
  { id: 'karnak', text: 'Pin the Karnak temple complex', name: 'Karnak', lat: 25.7188, lng: 32.6573, iso2: 'EG', ...wp('Karnak', 'Karnak') },
  { id: 'teotihuacan', text: 'Pin Teotihuacan', name: 'Teotihuacan', lat: 19.6925, lng: -98.8438, iso2: 'MX', ...wp('Teotihuacan', 'Teotihuacan') },
  { id: 'nazca-lines', text: 'Pin the Nazca Lines', name: 'Nazca Lines', lat: -14.739, lng: -75.13, iso2: 'PE', ...wp('Nazca_Lines', 'Nazca Lines') },
  { id: 'moai', text: 'Pin the moai of Easter Island', name: 'Easter Island (Rapa Nui)', lat: -27.125, lng: -109.276, iso2: 'CL', ...wp('Moai', 'Moai') },
  { id: 'great-zimbabwe', text: 'Pin Great Zimbabwe', name: 'Great Zimbabwe', lat: -20.268, lng: 30.931, iso2: 'ZW', ...wp('Great_Zimbabwe', 'Great Zimbabwe') },
  { id: 'lalibela', text: 'Pin the rock-hewn churches of Lalibela', name: 'Lalibela', lat: 12.031, lng: 39.048, iso2: 'ET', ...wp('Lalibela', 'Lalibela') },
  { id: 'bagan', text: 'Pin the temple plain of Bagan', name: 'Bagan', lat: 21.1722, lng: 94.8606, iso2: 'MM', ...wp('Bagan', 'Bagan') },
  { id: 'potala', text: 'Pin the Potala Palace', name: 'Potala Palace, Lhasa', lat: 29.6578, lng: 91.117, iso2: 'CN', ...wp('Potala_Palace', 'Potala Palace') },

  // Famous buildings and monuments
  { id: 'statue-of-liberty', text: 'Pin the Statue of Liberty', name: 'Statue of Liberty', lat: 40.6892, lng: -74.0445, iso2: 'US', ...wp('Statue_of_Liberty', 'Statue of Liberty') },
  { id: 'eiffel-tower', text: 'Pin the Eiffel Tower', name: 'Eiffel Tower', lat: 48.8584, lng: 2.2945, iso2: 'FR', ...wp('Eiffel_Tower', 'Eiffel Tower') },
  { id: 'sydney-opera', text: 'Pin the Sydney Opera House', name: 'Sydney Opera House', lat: -33.8568, lng: 151.2153, iso2: 'AU', ...wp('Sydney_Opera_House', 'Sydney Opera House') },
  { id: 'st-basil', text: 'Pin Saint Basil’s Cathedral', name: 'Saint Basil’s Cathedral', lat: 55.7525, lng: 37.6231, iso2: 'RU', ...wp('Saint_Basil%27s_Cathedral', 'Saint Basil’s Cathedral') },
  { id: 'neuschwanstein', text: 'Pin Neuschwanstein Castle', name: 'Neuschwanstein Castle', lat: 47.5576, lng: 10.7498, iso2: 'DE', ...wp('Neuschwanstein_Castle', 'Neuschwanstein Castle') },
  { id: 'sagrada-familia', text: 'Pin the Sagrada Família', name: 'Sagrada Família', lat: 41.4036, lng: 2.1744, iso2: 'ES', ...wp('Sagrada_Fam%C3%ADlia', 'Sagrada Família') },
  { id: 'leaning-pisa', text: 'Pin the Leaning Tower of Pisa', name: 'Leaning Tower of Pisa', lat: 43.723, lng: 10.3966, iso2: 'IT', ...wp('Leaning_Tower_of_Pisa', 'Leaning Tower of Pisa') },
  { id: 'st-peters', text: 'Pin St. Peter’s Basilica', name: 'St. Peter’s Basilica', lat: 41.9022, lng: 12.4539, iso2: 'VA', ...wp('St._Peter%27s_Basilica', 'St. Peter’s Basilica') },
  { id: 'kaaba', text: 'Pin the Kaaba in Mecca', name: 'Kaaba', lat: 21.4225, lng: 39.8262, iso2: 'SA', ...wp('Kaaba', 'Kaaba') },
  { id: 'golden-gate', text: 'Pin the Golden Gate Bridge', name: 'Golden Gate Bridge', lat: 37.8199, lng: -122.4783, iso2: 'US', ...wp('Golden_Gate_Bridge', 'Golden Gate Bridge') },
  { id: 'mount-rushmore', text: 'Pin Mount Rushmore', name: 'Mount Rushmore', lat: 43.8791, lng: -103.4591, iso2: 'US', ...wp('Mount_Rushmore', 'Mount Rushmore') },
  { id: 'big-ben', text: 'Pin Big Ben (Elizabeth Tower)', name: 'Elizabeth Tower (Big Ben)', lat: 51.5007, lng: -0.1246, iso2: 'GB', ...wp('Big_Ben', 'Big Ben') },
  { id: 'burj-khalifa', text: 'Pin the Burj Khalifa', name: 'Burj Khalifa', lat: 25.1972, lng: 55.2744, iso2: 'AE', ...wp('Burj_Khalifa', 'Burj Khalifa') },
  { id: 'petronas', text: 'Pin the Petronas Towers', name: 'Petronas Towers', lat: 3.1579, lng: 101.7116, iso2: 'MY', ...wp('Petronas_Towers', 'Petronas Towers') },
  { id: 'brandenburg', text: 'Pin the Brandenburg Gate', name: 'Brandenburg Gate', lat: 52.5163, lng: 13.3777, iso2: 'DE', ...wp('Brandenburg_Gate', 'Brandenburg Gate') },
  { id: 'white-house', text: 'Pin the White House', name: 'White House', lat: 38.8977, lng: -77.0365, iso2: 'US', ...wp('White_House', 'White House') },
  { id: 'kremlin', text: 'Pin the Moscow Kremlin', name: 'Moscow Kremlin', lat: 55.752, lng: 37.6175, iso2: 'RU', ...wp('Kremlin', 'Kremlin') },
  { id: 'buckingham', text: 'Pin Buckingham Palace', name: 'Buckingham Palace', lat: 51.5014, lng: -0.1419, iso2: 'GB', ...wp('Buckingham_Palace', 'Buckingham Palace') },
  { id: 'notre-dame', text: 'Pin Notre-Dame de Paris', name: 'Notre-Dame de Paris', lat: 48.853, lng: 2.3499, iso2: 'FR', ...wp('Notre-Dame_de_Paris', 'Notre-Dame de Paris') },
  { id: 'tower-bridge', text: 'Pin Tower Bridge', name: 'Tower Bridge', lat: 51.5055, lng: -0.0754, iso2: 'GB', ...wp('Tower_Bridge', 'Tower Bridge') },
  { id: 'alcatraz', text: 'Pin Alcatraz Island', name: 'Alcatraz Island', lat: 37.827, lng: -122.423, iso2: 'US', ...wp('Alcatraz_Island', 'Alcatraz Island') },
  { id: 'cn-tower', text: 'Pin the CN Tower', name: 'CN Tower', lat: 43.6426, lng: -79.3871, iso2: 'CA', ...wp('CN_Tower', 'CN Tower') },

  // Natural wonders and geography
  { id: 'everest', text: 'Pin Mount Everest', name: 'Mount Everest', lat: 27.9881, lng: 86.925, iso2: 'NP', ...wp('Mount_Everest', 'Mount Everest') },
  { id: 'kilimanjaro', text: 'Pin Mount Kilimanjaro', name: 'Mount Kilimanjaro', lat: -3.0674, lng: 37.3556, iso2: 'TZ', ...wp('Mount_Kilimanjaro', 'Mount Kilimanjaro') },
  { id: 'fuji', text: 'Pin Mount Fuji', name: 'Mount Fuji', lat: 35.3606, lng: 138.7274, iso2: 'JP', ...wp('Mount_Fuji', 'Mount Fuji') },
  { id: 'matterhorn', text: 'Pin the Matterhorn', name: 'Matterhorn', lat: 45.9763, lng: 7.6586, iso2: 'CH', ...wp('Matterhorn', 'Matterhorn') },
  { id: 'mont-blanc', text: 'Pin Mont Blanc', name: 'Mont Blanc', lat: 45.8326, lng: 6.8652, iso2: 'FR', ...wp('Mont_Blanc', 'Mont Blanc') },
  { id: 'denali', text: 'Pin Denali', name: 'Denali', lat: 63.0692, lng: -151.007, iso2: 'US', ...wp('Denali', 'Denali') },
  { id: 'aconcagua', text: 'Pin Aconcagua', name: 'Aconcagua', lat: -32.6532, lng: -70.0109, iso2: 'AR', ...wp('Aconcagua', 'Aconcagua') },
  { id: 'uluru', text: 'Pin Uluru (Ayers Rock)', name: 'Uluru', lat: -25.3444, lng: 131.0369, iso2: 'AU', ...wp('Uluru', 'Uluru') },
  { id: 'grand-canyon', text: 'Pin the Grand Canyon', name: 'Grand Canyon', lat: 36.0544, lng: -112.1401, iso2: 'US', ...wp('Grand_Canyon', 'Grand Canyon') },
  { id: 'niagara', text: 'Pin Niagara Falls', name: 'Horseshoe Falls, Niagara', lat: 43.0799, lng: -79.0756, iso2: 'CA', ...wp('Niagara_Falls', 'Niagara Falls') },
  { id: 'victoria-falls', text: 'Pin Victoria Falls', name: 'Victoria Falls', lat: -17.9243, lng: 25.8572, iso2: 'ZM', ...wp('Victoria_Falls', 'Victoria Falls') },
  { id: 'iguazu', text: 'Pin Iguazu Falls', name: 'Iguazu Falls', lat: -25.6953, lng: -54.4367, iso2: 'AR', ...wp('Iguazu_Falls', 'Iguazu Falls') },
  { id: 'angel-falls', text: 'Pin Angel Falls', name: 'Angel Falls', lat: 5.9674, lng: -62.5355, iso2: 'VE', ...wp('Angel_Falls', 'Angel Falls') },
  { id: 'table-mountain', text: 'Pin Table Mountain', name: 'Table Mountain', lat: -33.9628, lng: 18.4098, iso2: 'ZA', ...wp('Table_Mountain', 'Table Mountain') },
  { id: 'sugarloaf', text: 'Pin Sugarloaf Mountain in Rio de Janeiro', name: 'Sugarloaf Mountain', lat: -22.9486, lng: -43.157, iso2: 'BR', ...wp('Sugarloaf_Mountain', 'Sugarloaf Mountain') },
  { id: 'dead-sea', text: 'Pin the Dead Sea', name: 'Dead Sea', lat: 31.5, lng: 35.5, iso2: 'JO', ...wp('Dead_Sea', 'Dead Sea') },
  { id: 'baikal', text: 'Pin Lake Baikal', name: 'Lake Baikal (Olkhon Island)', lat: 53.15, lng: 107.38, iso2: 'RU', ...wp('Lake_Baikal', 'Lake Baikal') },
  { id: 'titicaca', text: 'Pin Lake Titicaca', name: 'Lake Titicaca', lat: -15.925, lng: -69.335, iso2: 'PE', ...wp('Lake_Titicaca', 'Lake Titicaca') },
  { id: 'great-barrier-reef', text: 'Pin the Great Barrier Reef', name: 'Great Barrier Reef', lat: -18.2871, lng: 147.6992, iso2: 'AU', ...wp('Great_Barrier_Reef', 'Great Barrier Reef') },
  { id: 'ha-long-bay', text: 'Pin Hạ Long Bay', name: 'Hạ Long Bay', lat: 20.9101, lng: 107.1839, iso2: 'VN', ...wp('Ha_Long_Bay', 'Hạ Long Bay') },
  { id: 'yellowstone', text: 'Pin Yellowstone National Park', name: 'Yellowstone National Park', lat: 44.428, lng: -110.5885, iso2: 'US', ...wp('Yellowstone_National_Park', 'Yellowstone National Park') },
  { id: 'yosemite', text: 'Pin Yosemite Valley', name: 'Yosemite Valley', lat: 37.7459, lng: -119.5332, iso2: 'US', ...wp('Yosemite_Valley', 'Yosemite Valley') },
  { id: 'galapagos', text: 'Pin the Galápagos Islands', name: 'Puerto Ayora, Galápagos', lat: -0.743, lng: -90.315, iso2: 'EC', ...wp('Gal%C3%A1pagos_Islands', 'Galápagos Islands') },
  { id: 'cape-horn', text: 'Pin Cape Horn', name: 'Cape Horn', lat: -55.9833, lng: -67.2667, iso2: 'CL', ...wp('Cape_Horn', 'Cape Horn') },
  { id: 'cape-good-hope', text: 'Pin the Cape of Good Hope', name: 'Cape of Good Hope', lat: -34.3568, lng: 18.4969, iso2: 'ZA', ...wp('Cape_of_Good_Hope', 'Cape of Good Hope') },
  { id: 'north-cape', text: 'Pin the North Cape', name: 'North Cape (Nordkapp)', lat: 71.1694, lng: 25.7828, iso2: 'NO', ...wp('North_Cape,_Norway', 'North Cape, Norway') },
  { id: 'cliffs-of-moher', text: 'Pin the Cliffs of Moher', name: 'Cliffs of Moher', lat: 53.0117, lng: -9.4033, iso2: 'IE', ...wp('Cliffs_of_Moher', 'Cliffs of Moher') },
  { id: 'giants-causeway', text: 'Pin the Giant’s Causeway', name: 'Giant’s Causeway', lat: 55.2408, lng: -6.5117, iso2: 'GB', ...wp('Giant%27s_Causeway', 'Giant’s Causeway') },
  { id: 'cappadocia', text: 'Pin Cappadocia', name: 'Göreme, Cappadocia', lat: 38.6431, lng: 34.8289, iso2: 'TR', ...wp('Cappadocia', 'Cappadocia') },
  { id: 'pamukkale', text: 'Pin Pamukkale', name: 'Pamukkale', lat: 37.9137, lng: 29.1187, iso2: 'TR', ...wp('Pamukkale', 'Pamukkale') },
  { id: 'vesuvius', text: 'Pin Mount Vesuvius', name: 'Mount Vesuvius', lat: 40.8214, lng: 14.4261, iso2: 'IT', ...wp('Mount_Vesuvius', 'Mount Vesuvius') },
  { id: 'etna', text: 'Pin Mount Etna', name: 'Mount Etna', lat: 37.751, lng: 14.9934, iso2: 'IT', ...wp('Mount_Etna', 'Mount Etna') },
  { id: 'geirangerfjord', text: 'Pin Geirangerfjord', name: 'Geirangerfjord', lat: 62.101, lng: 7.094, iso2: 'NO', ...wp('Geirangerfjord', 'Geirangerfjord') },
  { id: 'milford-sound', text: 'Pin Milford Sound', name: 'Milford Sound', lat: -44.6414, lng: 167.897, iso2: 'NZ', ...wp('Milford_Sound', 'Milford Sound') },
  { id: 'aoraki', text: 'Pin Aoraki / Mount Cook', name: 'Aoraki / Mount Cook', lat: -43.595, lng: 170.141, iso2: 'NZ', ...wp('Aoraki_/_Mount_Cook', 'Aoraki / Mount Cook') },
  { id: 'meeting-of-waters', text: 'Pin the Meeting of Waters near Manaus', name: 'Meeting of Waters, Amazon', lat: -3.136, lng: -59.905, iso2: 'BR', ...wp('Meeting_of_Waters', 'Meeting of Waters') },
  { id: 'okavango', text: 'Pin the Okavango Delta', name: 'Okavango Delta', lat: -19.3, lng: 22.85, iso2: 'BW', ...wp('Okavango_Delta', 'Okavango Delta') },
  { id: 'serengeti', text: 'Pin the Serengeti', name: 'Serengeti', lat: -2.333, lng: 34.833, iso2: 'TZ', ...wp('Serengeti', 'Serengeti') },
  { id: 'gibraltar-strait', text: 'Pin the Strait of Gibraltar', name: 'Strait of Gibraltar', lat: 35.97, lng: -5.61, iso2: 'ES', ...wp('Strait_of_Gibraltar', 'Strait of Gibraltar') },
  { id: 'bosporus', text: 'Pin the Bosporus', name: 'Bosporus', lat: 41.12, lng: 29.07, iso2: 'TR', ...wp('Bosporus', 'Bosporus') },
  { id: 'south-pole', text: 'Pin the geographic South Pole', name: 'South Pole', lat: -90, lng: 0, iso2: null, ...wp('South_Pole', 'South Pole') },
  { id: 'north-pole', text: 'Pin the geographic North Pole', name: 'North Pole', lat: 90, lng: 0, iso2: null, ...wp('North_Pole', 'North Pole') },
]
