/**
 * Hand-written Historical Pin questions. Coordinates point at the named site (city centre,
 * battlefield, launch pad, etc.) and are accurate to a few kilometres, which is well inside the
 * 25 km full-marks radius of pin scoring. Each entry links to a Wikipedia article for context.
 */
export interface HistoryEventInput {
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

export const HISTORY_EVENTS: HistoryEventInput[] = [
  { id: 'columbus-1492', text: 'Pin where Columbus first landed in the Americas (1492)', name: 'San Salvador Island (Guanahani)', lat: 24.05, lng: -74.5, iso2: 'BS', ...wp('Guanahani', 'Guanahani') },
  { id: 'magna-carta-1215', text: 'Pin where the Magna Carta was sealed (1215)', name: 'Runnymede', lat: 51.444, lng: -0.565, iso2: 'GB', ...wp('Runnymede', 'Runnymede') },
  { id: 'hastings-1066', text: 'Pin the site of the Battle of Hastings (1066)', name: 'Battle, East Sussex', lat: 50.911, lng: 0.487, iso2: 'GB', ...wp('Battle_of_Hastings', 'Battle of Hastings') },
  { id: 'waterloo-1815', text: 'Pin the site of the Battle of Waterloo (1815)', name: 'Waterloo, Belgium', lat: 50.68, lng: 4.41, iso2: 'BE', ...wp('Battle_of_Waterloo', 'Battle of Waterloo') },
  { id: 'wright-1903', text: "Pin where the Wright brothers made the first powered airplane flight (1903)", name: 'Kill Devil Hills, North Carolina', lat: 36.014, lng: -75.668, iso2: 'US', ...wp('Wright_Flyer', 'Wright Flyer') },
  { id: 'versailles-1919', text: 'Pin where the Treaty of Versailles was signed (1919)', name: 'Palace of Versailles', lat: 48.804, lng: 2.12, iso2: 'FR', ...wp('Treaty_of_Versailles', 'Treaty of Versailles') },
  { id: 'berlin-wall-1989', text: 'Pin the city whose wall came down in November 1989', name: 'Berlin', lat: 52.516, lng: 13.378, iso2: 'DE', ...wp('Fall_of_the_Berlin_Wall', 'Fall of the Berlin Wall') },
  { id: 'hiroshima-1945', text: 'Pin the first city hit by an atomic bomb (1945)', name: 'Hiroshima', lat: 34.394, lng: 132.455, iso2: 'JP', ...wp('Atomic_bombings_of_Hiroshima_and_Nagasaki', 'Atomic bombings of Hiroshima and Nagasaki') },
  { id: 'pompeii-79', text: 'Pin the Roman city buried by Mount Vesuvius (AD 79)', name: 'Pompeii', lat: 40.75, lng: 14.485, iso2: 'IT', ...wp('Pompeii', 'Pompeii') },
  { id: 'titanic-1912', text: 'Pin where the Titanic sank (1912)', name: 'Titanic wreck site, North Atlantic', lat: 41.726, lng: -49.948, iso2: null, ...wp('Wreck_of_the_Titanic', 'Wreck of the Titanic') },
  { id: 'chernobyl-1986', text: 'Pin the nuclear plant that exploded in April 1986', name: 'Chernobyl', lat: 51.389, lng: 30.099, iso2: 'UA', ...wp('Chernobyl_disaster', 'Chernobyl disaster') },
  { id: 'dday-1944', text: 'Pin the beaches of the D-Day landings (June 1944)', name: 'Omaha Beach, Normandy', lat: 49.37, lng: -0.88, iso2: 'FR', ...wp('Normandy_landings', 'Normandy landings') },
  { id: 'bastille-1789', text: 'Pin the prison stormed on 14 July 1789', name: 'Bastille, Paris', lat: 48.853, lng: 2.369, iso2: 'FR', ...wp('Storming_of_the_Bastille', 'Storming of the Bastille') },
  { id: 'rosetta-1799', text: 'Pin the town where the Rosetta Stone was found (1799)', name: 'Rashid (Rosetta), Egypt', lat: 31.4, lng: 30.42, iso2: 'EG', ...wp('Rosetta_Stone', 'Rosetta Stone') },
  { id: 'mayflower-1620', text: 'Pin where the Mayflower Pilgrims founded their colony (1620)', name: 'Plymouth, Massachusetts', lat: 41.958, lng: -70.662, iso2: 'US', ...wp('Plymouth_Colony', 'Plymouth Colony') },
  { id: 'gettysburg-1863', text: 'Pin the town where Lincoln gave the Gettysburg Address (1863)', name: 'Gettysburg, Pennsylvania', lat: 39.82, lng: -77.23, iso2: 'US', ...wp('Gettysburg_Address', 'Gettysburg Address') },
  { id: 'trinity-1945', text: 'Pin the site of the first nuclear weapon test, "Trinity" (1945)', name: 'Trinity Site, New Mexico', lat: 33.677, lng: -106.475, iso2: 'US', ...wp('Trinity_(nuclear_test)', 'Trinity (nuclear test)') },
  { id: 'apollo11-1969', text: 'Pin where Apollo 11 launched for the Moon (1969)', name: 'Kennedy Space Center, Florida', lat: 28.608, lng: -80.604, iso2: 'US', ...wp('Apollo_11', 'Apollo 11') },
  { id: 'gagarin-1961', text: 'Pin the cosmodrome that launched the first human into space (1961)', name: 'Baikonur Cosmodrome', lat: 45.965, lng: 63.305, iso2: 'KZ', ...wp('Vostok_1', 'Vostok 1') },
  { id: 'thermopylae-480bc', text: 'Pin the pass where 300 Spartans fought the Persians (480 BC)', name: 'Thermopylae', lat: 38.796, lng: 22.536, iso2: 'GR', ...wp('Battle_of_Thermopylae', 'Battle of Thermopylae') },
  { id: 'babylon-323bc', text: 'Pin the ancient city where Alexander the Great died (323 BC)', name: 'Babylon', lat: 32.542, lng: 44.421, iso2: 'IQ', ...wp('Babylon', 'Babylon') },
  { id: 'caesar-44bc', text: 'Pin the city where Julius Caesar was assassinated (44 BC)', name: 'Rome', lat: 41.895, lng: 12.475, iso2: 'IT', ...wp('Assassination_of_Julius_Caesar', 'Assassination of Julius Caesar') },
  { id: 'dandi-1930', text: "Pin the coastal village where Gandhi's Salt March ended (1930)", name: 'Dandi, Gujarat', lat: 20.885, lng: 72.807, iso2: 'IN', ...wp('Salt_March', 'Salt March') },
  { id: 'robben-island', text: 'Pin the island prison where Nelson Mandela was held for 18 years', name: 'Robben Island', lat: -33.807, lng: 18.371, iso2: 'ZA', ...wp('Robben_Island', 'Robben Island') },
  { id: 'stalingrad-1942', text: 'Pin the city of the Battle of Stalingrad (1942–43)', name: 'Volgograd (Stalingrad)', lat: 48.708, lng: 44.514, iso2: 'RU', ...wp('Battle_of_Stalingrad', 'Battle of Stalingrad') },
  { id: 'constantinople-1453', text: 'Pin the city that fell to the Ottomans in 1453', name: 'Istanbul (Constantinople)', lat: 41.008, lng: 28.978, iso2: 'TR', ...wp('Fall_of_Constantinople', 'Fall of Constantinople') },
  { id: 'dagama-1498', text: 'Pin where Vasco da Gama landed in India (1498)', name: 'Kappad, near Kozhikode (Calicut)', lat: 11.38, lng: 75.72, iso2: 'IN', ...wp('Vasco_da_Gama', 'Vasco da Gama') },
  { id: 'magellan-1521', text: 'Pin the island where Ferdinand Magellan was killed (1521)', name: 'Mactan Island', lat: 10.31, lng: 124.01, iso2: 'PH', ...wp('Battle_of_Mactan', 'Battle of Mactan') },
  { id: 'cook-1770', text: 'Pin the bay where Captain Cook first landed in Australia (1770)', name: 'Botany Bay', lat: -34.0, lng: 151.22, iso2: 'AU', ...wp('Botany_Bay', 'Botany Bay') },
  { id: 'panama-1914', text: 'Pin the canal that opened in 1914 linking two oceans', name: 'Panama Canal', lat: 9.08, lng: -79.68, iso2: 'PA', ...wp('Panama_Canal', 'Panama Canal') },
  { id: 'machu-picchu-1911', text: 'Pin the Inca city brought to world attention by Hiram Bingham (1911)', name: 'Machu Picchu', lat: -13.163, lng: -72.545, iso2: 'PE', ...wp('Machu_Picchu', 'Machu Picchu') },
  { id: 'tordesillas-1494', text: 'Pin the town where Spain and Portugal divided the world (1494)', name: 'Tordesillas', lat: 41.5, lng: -5.0, iso2: 'ES', ...wp('Treaty_of_Tordesillas', 'Treaty of Tordesillas') },
  { id: 'vienna-1815', text: 'Pin the city that hosted the Congress that redrew Europe (1814–15)', name: 'Vienna', lat: 48.208, lng: 16.373, iso2: 'AT', ...wp('Congress_of_Vienna', 'Congress of Vienna') },
  { id: 'sarajevo-1914', text: 'Pin the city where Archduke Franz Ferdinand was assassinated (1914)', name: 'Sarajevo', lat: 43.858, lng: 18.429, iso2: 'BA', ...wp('Assassination_of_Archduke_Franz_Ferdinand', 'Assassination of Archduke Franz Ferdinand') },
  { id: 'un-charter-1945', text: 'Pin the city where the UN Charter was signed (1945)', name: 'San Francisco', lat: 37.779, lng: -122.419, iso2: 'US', ...wp('Charter_of_the_United_Nations', 'Charter of the United Nations') },
  { id: 'boston-tea-1773', text: 'Pin the harbour where colonists dumped British tea (1773)', name: 'Boston', lat: 42.352, lng: -71.051, iso2: 'US', ...wp('Boston_Tea_Party', 'Boston Tea Party') },
  { id: 'agincourt-1415', text: 'Pin the site of the Battle of Agincourt (1415)', name: 'Azincourt', lat: 50.463, lng: 2.141, iso2: 'FR', ...wp('Battle_of_Agincourt', 'Battle of Agincourt') },
  { id: 'tenochtitlan-1521', text: 'Pin the Aztec capital that fell to Cortés (1521)', name: 'Tenochtitlan (Mexico City)', lat: 19.433, lng: -99.133, iso2: 'MX', ...wp('Fall_of_Tenochtitlan', 'Fall of Tenochtitlan') },
  { id: 'london-fire-1666', text: 'Pin the city swept by a great fire in 1666', name: 'London', lat: 51.51, lng: -0.086, iso2: 'GB', ...wp('Great_Fire_of_London', 'Great Fire of London') },
  { id: 'adwa-1896', text: 'Pin the town where Ethiopia defeated an Italian invasion (1896)', name: 'Adwa', lat: 14.17, lng: 38.9, iso2: 'ET', ...wp('Battle_of_Adwa', 'Battle of Adwa') },
  { id: 'gutenberg-1455', text: 'Pin the city where Gutenberg printed his Bible (c. 1455)', name: 'Mainz', lat: 49.999, lng: 8.273, iso2: 'DE', ...wp('Gutenberg_Bible', 'Gutenberg Bible') },
  { id: 'wittenberg-1517', text: 'Pin the town where Martin Luther posted his Ninety-five Theses (1517)', name: 'Wittenberg', lat: 51.866, lng: 12.646, iso2: 'DE', ...wp('Ninety-five_Theses', 'Ninety-five Theses') },
  { id: 'taj-mahal-1653', text: 'Pin the city where the Taj Mahal was completed (1653)', name: 'Agra', lat: 27.175, lng: 78.042, iso2: 'IN', ...wp('Taj_Mahal', 'Taj Mahal') },
  { id: 'midway-1942', text: 'Pin the Pacific atoll of the Battle of Midway (1942)', name: 'Midway Atoll', lat: 28.2, lng: -177.35, iso2: null, ...wp('Battle_of_Midway', 'Battle of Midway') },
  { id: 'pearl-harbor-1941', text: 'Pin the naval base attacked on 7 December 1941', name: 'Pearl Harbor, Hawaii', lat: 21.365, lng: -157.95, iso2: 'US', ...wp('Attack_on_Pearl_Harbor', 'Attack on Pearl Harbor') },
  { id: 'angkor-wat', text: 'Pin the largest temple complex in the world, built in the 12th century', name: 'Angkor Wat', lat: 13.412, lng: 103.867, iso2: 'KH', ...wp('Angkor_Wat', 'Angkor Wat') },
  { id: 'great-zimbabwe', text: 'Pin the medieval stone city that gave a modern country its name', name: 'Great Zimbabwe', lat: -20.27, lng: 30.93, iso2: 'ZW', ...wp('Great_Zimbabwe', 'Great Zimbabwe') },
  { id: 'petra', text: 'Pin the rock-cut Nabataean capital rediscovered by Europeans in 1812', name: 'Petra', lat: 30.329, lng: 35.444, iso2: 'JO', ...wp('Petra', 'Petra') },
  { id: 'meroe', text: 'Pin the pyramids of the Kingdom of Kush at Meroë', name: 'Meroë', lat: 16.94, lng: 33.75, iso2: 'SD', ...wp('Mero%C3%AB', 'Meroë') },
  { id: 'plassey-1757', text: 'Pin the battle that opened Bengal to British rule (1757)', name: 'Plassey (Palashi)', lat: 23.8, lng: 88.25, iso2: 'IN', ...wp('Battle_of_Plassey', 'Battle of Plassey') },
  { id: 'sutters-mill-1848', text: 'Pin the mill where gold was found, starting the California Gold Rush (1848)', name: "Sutter's Mill, Coloma", lat: 38.802, lng: -120.893, iso2: 'US', ...wp('Sutter%27s_Mill', "Sutter's Mill") },
  { id: 'fort-clatsop-1805', text: 'Pin where Lewis and Clark wintered after reaching the Pacific (1805)', name: 'Fort Clatsop, Oregon', lat: 46.13, lng: -123.88, iso2: 'US', ...wp('Fort_Clatsop', 'Fort Clatsop') },
  { id: 'eiffel-1889', text: 'Pin the iron tower built for the 1889 World Fair', name: 'Eiffel Tower', lat: 48.858, lng: 2.294, iso2: 'FR', ...wp('Eiffel_Tower', 'Eiffel Tower') },
  { id: 'trafalgar-1805', text: 'Pin the cape off which Nelson won the Battle of Trafalgar (1805)', name: 'Cape Trafalgar', lat: 36.18, lng: -6.03, iso2: 'ES', ...wp('Battle_of_Trafalgar', 'Battle of Trafalgar') },
  { id: 'suez-1869', text: 'Pin the Mediterranean entrance of the canal opened in 1869', name: 'Port Said, Suez Canal', lat: 31.26, lng: 32.3, iso2: 'EG', ...wp('Suez_Canal', 'Suez Canal') },
  { id: 'kitty-hawk-sputnik-1957', text: 'Pin where Sputnik 1, the first satellite, was launched (1957)', name: 'Baikonur Cosmodrome', lat: 45.92, lng: 63.342, iso2: 'KZ', ...wp('Sputnik_1', 'Sputnik 1') },
  { id: 'hong-kong-1997', text: 'Pin the territory handed from the UK to China in 1997', name: 'Hong Kong', lat: 22.32, lng: 114.17, iso2: 'CN', ...wp('Handover_of_Hong_Kong', 'Handover of Hong Kong') },
  { id: 'timbuktu', text: 'Pin the Saharan trading city famed for its medieval manuscripts', name: 'Timbuktu', lat: 16.773, lng: -3.007, iso2: 'ML', ...wp('Timbuktu', 'Timbuktu') },
  { id: 'kyoto-1997', text: 'Pin the city that gave its name to the 1997 climate protocol', name: 'Kyoto', lat: 35.011, lng: 135.768, iso2: 'JP', ...wp('Kyoto_Protocol', 'Kyoto Protocol') },
  { id: 'yalta-1945', text: 'Pin the resort where Churchill, Roosevelt and Stalin met in February 1945', name: 'Yalta, Crimea', lat: 44.495, lng: 34.166, iso2: 'UA', ...wp('Yalta_Conference', 'Yalta Conference') },
  { id: 'lalibela', text: 'Pin the town of rock-hewn churches built around the 12th–13th centuries', name: 'Lalibela', lat: 12.03, lng: 39.04, iso2: 'ET', ...wp('Lalibela', 'Lalibela') },
  { id: 'krakatoa-1883', text: 'Pin the volcano whose 1883 eruption was heard thousands of kilometres away', name: 'Krakatoa', lat: -6.102, lng: 105.423, iso2: 'ID', ...wp('1883_eruption_of_Krakatoa', '1883 eruption of Krakatoa') },
  { id: 'easter-island', text: 'Pin the remote island famous for its moai statues', name: 'Easter Island (Rapa Nui)', lat: -27.11, lng: -109.35, iso2: 'CL', ...wp('Easter_Island', 'Easter Island') },
  { id: 'gallipoli-1915', text: 'Pin the peninsula of the Gallipoli campaign (1915)', name: 'Gallipoli Peninsula', lat: 40.24, lng: 26.28, iso2: 'TR', ...wp('Gallipoli_campaign', 'Gallipoli campaign') },
  { id: 'cape-town-1652', text: 'Pin the Dutch supply station founded at the Cape in 1652', name: 'Cape Town', lat: -33.925, lng: 18.424, iso2: 'ZA', ...wp('Cape_Town', 'Cape Town') },
]
