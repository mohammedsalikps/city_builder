/**
 * Burj Khalifa content for the Real World Explorer.
 *
 * Every fact, part, hotspot and timeline entry cites `BURJ_SOURCES` by id.
 * Where published numbers differ, the value says so (or gives a range), the
 * `note` explains, and confidence is 'medium'. The two NASA Glenn pages are
 * cited only for general physics (pressure, dynamic pressure), never for
 * facts about the tower. The 3D model's part ids match `BURJ_PARTS`.
 */
import { CONSTRUCTION_PROGRESS, SCENE_SCALE } from '@/realworld/types';
import type {
  Fact,
  Hotspot,
  Lesson,
  Mission,
  Part,
  QuizQuestion,
  RealLandmark,
  Source,
  Stage,
  Stop,
  TimelineEntry,
} from '@/realworld/types';

/** Architectural height (CTBUH), metres: the model's top and the timeline's 100% height. */
export const BURJ_HEIGHT_M = 828;

export const BURJ_SOURCES: Source[] = [
  {
    id: 'ctbuh',
    title: 'Burj Khalifa - The Skyscraper Center',
    publisher: 'Council on Tall Buildings and Urban Habitat (CTBUH)',
    url: 'https://www.skyscrapercenter.com/building/burj-khalifa/3',
  },
  {
    id: 'guinness',
    title: 'Burj Khalifa: The tallest building in the world',
    publisher: 'Guinness World Records',
    url: 'https://www.guinnessworldrecords.com/records/hall-of-fame/burj-khalifa-tallest-building-in-the-world',
  },
  {
    id: 'som',
    title: 'Burj Khalifa',
    publisher: 'Skidmore, Owings & Merrill (SOM)',
    url: 'https://www.som.com/projects/burj-khalifa/',
  },
  {
    id: 'official-structures',
    title: 'Burj Khalifa Structure: Design and Construction',
    publisher: 'Burj Khalifa official website (Emaar)',
    url: 'https://www.burjkhalifa.ae/the-tower/structures/',
  },
  {
    id: 'official-architecture',
    title: 'Burj Khalifa Architecture and Design',
    publisher: 'Burj Khalifa official website (Emaar)',
    url: 'https://www.burjkhalifa.ae/the-tower/architecture-design/',
  },
  {
    id: 'emaar-2007',
    title: 'Burj Dubai reaches record high (Emaar Properties press release, 21 July 2007)',
    publisher: 'Al Bawaba (reprint)',
    url: 'https://www.albawaba.com/news/burj-dubai-reaches-record-high',
  },
  {
    id: 'gulf-news-2005',
    title: 'Burj Dubai to begin rising on April 15 (29 March 2005)',
    publisher: 'Gulf News',
    url: 'https://gulfnews.com/business/property/burj-dubai-to-begin-rising-on-april-15-1.282522',
  },
  {
    id: 'skyscraper-museum-exhibition',
    title: "World's Tallest Building: Burj Dubai (exhibition)",
    publisher: 'The Skyscraper Museum',
    url: 'https://skyscraper.org/exhibitions/worlds-tallest-building-burj-dubai/',
  },
  {
    id: 'skyscraper-museum-extreme',
    title: 'Extreme Building: the Challenges of Constructing Burj Dubai',
    publisher: 'The Skyscraper Museum',
    url: 'https://skyscraper.org/programs/extreme-building-the-challenges-of-constructing-burj-dubai/',
  },
  {
    id: 'skyscraper-museum-learned',
    title: 'Burj Khalifa: What We Learned (transcript)',
    publisher: 'The Skyscraper Museum',
    url: 'https://skyscraper.org/burj-khalifa-what-we-learned/',
  },
  {
    id: 'meed-2008',
    title: "Burj Dubai becomes world's tallest man-made structure (7 April 2008)",
    publisher: 'MEED',
    url: 'https://www.meed.com/burj-dubai-becomes-worlds-tallest-man-made-structure',
  },
  {
    id: 'canadian-consulting-engineer',
    title: 'Burj Dubai tops CN Tower',
    publisher: 'Canadian Consulting Engineer',
    url: 'https://www.canadianconsultingengineer.com/burj-dubai-tops-cn-tower/',
  },
  {
    id: 'csmonitor-2010',
    title: "World's tallest building opens in Dubai with a new name (4 January 2010)",
    publisher: 'The Christian Science Monitor',
    url: 'https://www.csmonitor.com/World/2010/0104/World-s-tallest-building-opens-in-Dubai-with-a-new-name',
  },
  {
    id: 'khl-2010',
    title: 'Setting the pinnacle atop Burj Khalifa',
    publisher: 'KHL Group',
    url: 'https://www.khl.com/news/Setting-the-pinnacle-atop-Burj-Khalifa-/1051504.article',
  },
  {
    id: 'poulos-bunce-2008',
    title: "Foundation Design for the Burj Dubai - the World's Tallest Building (Poulos and Bunce, 2008, abstract)",
    publisher: '6th International Conference on Case Histories in Geotechnical Engineering, via Scholars\' Mine (Missouri S&T)',
    url: 'https://scholarsmine.mst.edu/icchge/6icchge/session_01/14',
  },
  {
    id: 'irwin-baker-2005',
    title: 'The wind engineering of the Burj Dubai tower (Irwin and Baker, 2005, abstract)',
    publisher: 'Florida International University Discovery',
    url: 'https://discovery.fiu.edu/display/pub96941',
  },
  {
    id: 'otis-2024',
    title: 'Otis Wins Modernization Project and 10-Year Service Contract Extension for Burj Khalifa (6 March 2024)',
    publisher: 'Otis Worldwide',
    url: 'https://www.otisinvestors.com/news/news-details/2024/Otis-Wins-Modernization-Project-and-10-Year-Service-Contract-Extension-for-Burj-Khalifa/default.aspx',
  },
  {
    id: 'nasa-gas-pressure',
    title: 'Gas Pressure (Beginner\'s Guide to Aeronautics)',
    publisher: 'NASA Glenn Research Center',
    url: 'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/gas-pressure/',
  },
  {
    id: 'nasa-dynamic-pressure',
    title: 'Dynamic Pressure (Beginner\'s Guide to Aeronautics)',
    publisher: 'NASA Glenn Research Center',
    url: 'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/dynamic-pressure/',
  },
];

export const BURJ_FACTS: Fact[] = [
  {
    id: 'height',
    label: 'Height',
    value: '828 m to the architectural top (829.8 m to the very tip)',
    sourceIds: ['ctbuh', 'guinness'],
    confidence: 'high',
  },
  {
    id: 'occupied-height',
    label: 'Highest occupied floor',
    value: '585.4 m above the ground',
    sourceIds: ['ctbuh'],
    confidence: 'high',
  },
  {
    id: 'floors',
    label: 'Floors',
    value: 'About 160-163 floors, depending on how floors are counted',
    note: 'CTBUH and Guinness count 163 floors above ground and 1 below. SOM lists 160 storeys and also describes the tower as 162 storeys.',
    sourceIds: ['ctbuh', 'guinness', 'som'],
    confidence: 'high',
  },
  {
    id: 'opened',
    label: 'Opened',
    value: '4 January 2010',
    note: 'During construction it was called Burj Dubai. It was renamed Burj Khalifa when it opened.',
    sourceIds: ['guinness', 'csmonitor-2010'],
    confidence: 'high',
  },
  {
    id: 'developer',
    label: 'Developer',
    value: 'Emaar Properties',
    sourceIds: ['ctbuh'],
    confidence: 'high',
  },
  {
    id: 'designers',
    label: 'Architects and structural engineers',
    value: 'Skidmore, Owings & Merrill (SOM). Architect Adrian Smith led the design, and William F. Baker led the structural engineering.',
    sourceIds: ['som', 'ctbuh', 'guinness', 'skyscraper-museum-exhibition'],
    confidence: 'high',
  },
  {
    id: 'contractor',
    label: 'Main builders',
    value: 'A joint venture of Samsung C&T, BESIX and Arabtec',
    sourceIds: ['ctbuh'],
    confidence: 'high',
  },
  {
    id: 'buttressed-core',
    label: 'Structure',
    value:
      'A "buttressed core": a six-sided (hexagonal) central core with three wings in a Y-shaped plan. The wings brace one another through the core, which makes the tower very stiff against twisting.',
    sourceIds: ['som', 'official-structures'],
    confidence: 'high',
  },
  {
    id: 'y-shape',
    label: 'Why a Y shape?',
    value: 'The Y-shaped plan reduces the wind forces on the tower and makes it easier to build.',
    sourceIds: ['som', 'official-structures'],
    confidence: 'high',
  },
  {
    id: 'confuse-the-wind',
    label: 'Confusing the wind',
    value:
      'The setbacks (places where the tower steps in) spiral upward, so the shape changes at each tier. The wind never meets the same shape for long, so swirling air (vortices) cannot organise. SOM calls this "confusing the wind".',
    sourceIds: ['som'],
    confidence: 'high',
  },
  {
    id: 'smooth-load-path',
    label: 'A smooth load path',
    value: 'At each setback, columns above line up with walls below, so the loads travel smoothly down the structure.',
    sourceIds: ['som'],
    confidence: 'high',
  },
  {
    id: 'setbacks',
    label: 'Setbacks',
    value: 'About 24-26 setbacks',
    note: 'Published counts differ (24 or 26) depending on how the steps are counted. The pages listed here describe the spiralling setbacks but do not all give a count.',
    sourceIds: ['som', 'skyscraper-museum-learned'],
    confidence: 'medium',
  },
  {
    id: 'materials',
    label: 'Concrete and steel',
    value: 'Reinforced concrete up to about level 156 (about 585 m), then structural steel above, including the spire.',
    sourceIds: ['skyscraper-museum-exhibition', 'khl-2010', 'ctbuh'],
    confidence: 'high',
  },
  {
    id: 'spire',
    label: 'The spire',
    value: 'The steel spire was put together inside the tower and then jacked (pushed) up from within.',
    sourceIds: ['official-structures', 'khl-2010'],
    confidence: 'high',
  },
  {
    id: 'foundation-type',
    label: 'Foundation',
    value: 'A piled raft: a thick concrete mat resting on piles, built in deep layers of carbonate soils and rock.',
    sourceIds: ['poulos-bunce-2008', 'official-structures'],
    confidence: 'high',
  },
  {
    id: 'raft',
    label: 'Raft thickness',
    value: '3.7 m thick',
    sourceIds: ['official-structures', 'gulf-news-2005'],
    confidence: 'high',
  },
  {
    id: 'pile-size',
    label: 'Pile size',
    value: '1.5 m wide (diameter) and 43 m long, according to the official site',
    note: 'Other sources give different lengths of about 45-50 m. Gulf News (2005) said the piles reach depths of more than 50 m; numbers depend on how the depth is measured.',
    sourceIds: ['official-structures', 'gulf-news-2005'],
    confidence: 'medium',
  },
  {
    id: 'pile-count',
    label: 'Number of piles',
    value: 'Nearly 200 piles under the tower',
    note: 'Gulf News (2005) reported 192 tower piles; other accounts give 194. William F. Baker described "slightly less than 200 piles".',
    sourceIds: ['gulf-news-2005', 'skyscraper-museum-learned'],
    confidence: 'medium',
  },
  {
    id: 'groundwater',
    label: 'Salty groundwater',
    value:
      'The groundwater is salty and corrosive, so the foundation uses special low-permeability concrete (concrete that lets very little water in) and cathodic protection (a system that stops buried steel from rusting).',
    note: 'The official structures page describes the high-density, low-permeability concrete; the details about the salty groundwater and cathodic protection come from earlier official and builder descriptions, so treat them with a little care.',
    sourceIds: ['official-structures'],
    confidence: 'medium',
  },
  {
    id: 'wind-main-load',
    label: 'The biggest sideways push',
    value: 'Wind was the main sideways (lateral) load that engineers had to design for.',
    sourceIds: ['irwin-baker-2005'],
    confidence: 'high',
  },
  {
    id: 'wind-tunnel',
    label: 'Wind-tunnel tests',
    value: 'More than 40 wind-tunnel tests',
    sourceIds: ['official-architecture'],
    confidence: 'high',
  },
  {
    id: 'design-rotated',
    label: 'Turned to face the wind',
    value: 'After early wind tests, the design was rotated and the direction of the setbacks was changed.',
    sourceIds: ['skyscraper-museum-learned'],
    confidence: 'medium',
  },
  {
    id: 'construction-pace',
    label: 'Building speed',
    value: 'The concrete frame rose about one floor every three days.',
    sourceIds: ['skyscraper-museum-extreme'],
    confidence: 'high',
  },
  {
    id: 'workers',
    label: 'Builders',
    value: 'More than 12,000 people worked on the construction.',
    sourceIds: ['guinness'],
    confidence: 'medium',
  },
  {
    id: 'lifts',
    label: 'Lifts and escalators',
    value: '57 lifts and 8 escalators',
    note: 'Other published counts range from about 52 to 58 (CTBUH counts 58 lift cars), depending on what is counted.',
    sourceIds: ['official-structures', 'otis-2024', 'ctbuh'],
    confidence: 'medium',
  },
  {
    id: 'lift-speed',
    label: 'Fastest lifts',
    value: 'Up to 10 m per second. Two double-deck lifts carry visitors from the ground to levels 124 and 125 in about 60 seconds.',
    sourceIds: ['otis-2024', 'ctbuh'],
    confidence: 'high',
  },
  {
    id: 'mechanical-floors',
    label: 'Machine floors',
    value: 'Seven double-height mechanical floors hold equipment such as electrical substations, water tanks, pumps and air-handling units.',
    sourceIds: ['official-structures'],
    confidence: 'high',
  },
];

export const BURJ_PARTS: Part[] = [
  {
    id: 'piles',
    name: 'Piles',
    description:
      'Nearly 200 long concrete columns reaching deep into the ground under the raft. Each is 1.5 m wide. This model shows a representative set, not the exact number or layout.',
    sourceIds: ['official-structures', 'gulf-news-2005', 'skyscraper-museum-learned'],
  },
  {
    id: 'raft',
    name: 'Raft',
    description: 'A huge reinforced-concrete mat, 3.7 m thick, resting on the piles. A raft on piles is called a piled raft.',
    sourceIds: ['official-structures', 'poulos-bunce-2008'],
  },
  {
    id: 'podium',
    name: 'Podium',
    description: 'The low base around the bottom of the tower. In this model it is a simple round platform; the real podium has a more complex shape.',
    sourceIds: ['gulf-news-2005'],
  },
  {
    id: 'core',
    name: 'Central core',
    description: 'The strong six-sided (hexagonal) concrete core in the middle. It is the hub that ties the three wings together and resists twisting.',
    sourceIds: ['som', 'official-structures'],
  },
  {
    id: 'wing-a',
    name: 'Wing A',
    description: 'One of the three wings of the Y shape. Each wing braces the other two through the central core.',
    sourceIds: ['som', 'official-structures'],
  },
  {
    id: 'wing-b',
    name: 'Wing B',
    description: 'One of the three wings of the Y shape. Each wing braces the other two through the central core.',
    sourceIds: ['som', 'official-structures'],
  },
  {
    id: 'wing-c',
    name: 'Wing C',
    description: 'One of the three wings of the Y shape. Each wing braces the other two through the central core.',
    sourceIds: ['som', 'official-structures'],
  },
  {
    id: 'floors',
    name: 'Floors',
    description:
      'The floor slabs, one for each level: about 160-163 levels depending on how floors are counted. In this model the floors are evenly spaced; real floor heights vary.',
    sourceIds: ['ctbuh', 'guinness', 'som'],
  },
  {
    id: 'mechanical',
    name: 'Mechanical floors',
    description:
      'Seven double-height floors full of equipment that keeps the tower running. Their positions in this model are illustrative, not exact.',
    sourceIds: ['official-structures'],
  },
  {
    id: 'facade',
    name: 'Glass facade and setbacks',
    description: 'The glass outer skin. It steps in at setbacks that spiral up the tower, so the shape keeps changing as it rises.',
    sourceIds: ['som', 'official-structures'],
  },
  {
    id: 'spire',
    name: 'Steel spire',
    description: 'The steel top of the tower, above the concrete. It was assembled inside the tower and jacked up from within.',
    sourceIds: ['official-structures', 'khl-2010', 'skyscraper-museum-exhibition'],
  },
];

export const BURJ_HOTSPOTS: Hotspot[] = [
  {
    id: 'hotspot-raft',
    partId: 'raft',
    title: 'A raft on piles',
    text:
      'The tower stands on a piled raft: a 3.7 m thick concrete mat resting on nearly 200 piles. The ground here is made of deep layers of carbonate soils and rock, so the foundation was carefully designed and tested.',
    sourceIds: ['official-structures', 'poulos-bunce-2008', 'skyscraper-museum-learned'],
  },
  {
    id: 'hotspot-piles',
    partId: 'piles',
    title: 'Deep piles',
    text:
      'Each pile is 1.5 m wide. The official site says they are 43 m long; other sources give a little more. The piles grip the soil and rock around them and hold the raft up.',
    sourceIds: ['official-structures', 'gulf-news-2005'],
  },
  {
    id: 'hotspot-core',
    partId: 'core',
    title: 'The buttressed core',
    text:
      'In the middle is a six-sided concrete core. The three wings are joined to it and brace one another, which makes the tower very stiff against twisting. Engineers call this a buttressed core.',
    sourceIds: ['som', 'official-structures'],
  },
  {
    id: 'hotspot-wing',
    partId: 'wing-a',
    title: 'Wings that brace each other',
    text:
      'Each of the three wings acts like a buttress, a support that leans against something to hold it steady. Together the wings and the core make a Y shape that resists the wind and was easier to build.',
    sourceIds: ['som', 'official-structures'],
  },
  {
    id: 'hotspot-setbacks',
    partId: 'facade',
    title: 'Confusing the wind',
    text:
      'The tower steps in many times as it rises, and the steps spiral around it. Because the shape keeps changing, swirling wind cannot organise into a steady rhythm. The designers called this "confusing the wind".',
    sourceIds: ['som'],
  },
  {
    id: 'hotspot-spire',
    partId: 'spire',
    title: 'A spire pushed up from inside',
    text:
      'Above about level 156 the tower is made of steel. The spire was put together inside the tower and then jacked up from within until the tower reached 828 m.',
    sourceIds: ['official-structures', 'khl-2010', 'skyscraper-museum-exhibition'],
  },
  {
    id: 'hotspot-lifts',
    partId: 'core',
    title: 'Super-fast lifts',
    text:
      'The tower has 57 lifts and 8 escalators. The fastest lifts travel at up to 10 metres per second, and two double-deck lifts carry visitors from the ground to levels 124 and 125 in about 60 seconds.',
    sourceIds: ['official-structures', 'otis-2024'],
  },
  {
    id: 'hotspot-mechanical',
    partId: 'mechanical',
    title: 'Machine floors',
    text:
      'Seven double-height floors hold equipment such as electrical substations, water tanks, pumps and air-handling units. In this model their positions are only illustrative.',
    sourceIds: ['official-structures'],
  },
];

const { foundationDone, structureDone, exteriorDone } = CONSTRUCTION_PROGRESS;

export const BURJ_STAGES: Stage[] = [
  { id: 'site', name: 'The site', description: 'The empty site, ready for digging.', progress: 0 },
  { id: 'foundation', name: 'Foundation', description: 'Piles are drilled deep into the ground and the thick concrete raft is poured on top.', progress: foundationDone },
  {
    id: 'structure',
    name: 'Structure',
    description:
      'The core, wings and floors rise, then the steel spire. Timeline steps in this stage show the documented height when a source gives one.',
    progress: structureDone,
  },
  { id: 'exterior', name: 'Outer skin', description: 'The glass facade is finished, except for the very top.', progress: exteriorDone },
  { id: 'complete', name: 'Complete', description: 'The finished tower, opened in January 2010.', progress: 1 },
];

export const BURJ_TIMELINE: TimelineEntry[] = [
  {
    id: 'design-competition',
    dateLabel: 'March 2003',
    sortKey: '2003-03',
    title: 'A design competition',
    text: "On 9 March 2003, Emaar Properties invited SOM's Chicago office and four other international architecture firms to design the tower. SOM's design was chosen.",
    stage: 'site',
    builtHeightM: null,
    sourceIds: ['skyscraper-museum-exhibition', 'som', 'ctbuh'],
    confidence: 'medium',
  },
  {
    id: 'excavation',
    dateLabel: 'January 2004',
    sortKey: '2004-01',
    title: 'Digging begins',
    text: 'Excavation of the site begins.',
    stage: 'site',
    builtHeightM: null,
    sourceIds: ['official-architecture', 'emaar-2007'],
    confidence: 'high',
  },
  {
    id: 'first-concrete',
    dateLabel: 'September 2004',
    sortKey: '2004-09',
    title: 'The first concrete',
    text: 'The first concrete is poured. Guinness World Records gives 21 September 2004 as the start of construction.',
    stage: 'foundation',
    builtHeightM: null,
    sourceIds: ['emaar-2007', 'guinness'],
    confidence: 'high',
  },
  {
    id: 'foundation-complete',
    dateLabel: 'March 2005',
    sortKey: '2005-03',
    title: 'Foundation finished',
    text: 'The foundation is finished in about 12 months, and the tower is set to start rising above the ground in mid-April 2005.',
    stage: 'foundation',
    builtHeightM: null,
    sourceIds: ['gulf-news-2005'],
    confidence: 'high',
  },
  {
    id: 'rising',
    dateLabel: '2005-2008',
    sortKey: '2005-04',
    title: 'Rising fast',
    text: 'The concrete frame rises about one floor every three days.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['skyscraper-museum-extreme'],
    confidence: 'high',
  },
  {
    id: 'level-100',
    dateLabel: 'Early 2007',
    sortKey: '2007-01',
    title: 'Level 100',
    text: 'The tower reaches its 100th level.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['emaar-2007', 'skyscraper-museum-exhibition'],
    confidence: 'medium',
    note: 'Sources differ: Emaar says January 2007 and The Skyscraper Museum says March 2007.',
  },
  {
    id: 'passes-taipei-101',
    dateLabel: '21 July 2007',
    sortKey: '2007-07',
    title: 'Taller than Taipei 101',
    text: 'At 512.1 m and 141 storeys, the tower becomes taller than Taipei 101.',
    stage: 'structure',
    builtHeightM: 512.1,
    sourceIds: ['emaar-2007'],
    confidence: 'high',
  },
  {
    id: 'passes-cn-tower',
    dateLabel: 'September 2007',
    sortKey: '2007-09',
    title: 'Taller than the CN Tower',
    text: 'At about 555 m, the tower passes the CN Tower in Toronto.',
    stage: 'structure',
    builtHeightM: 555,
    sourceIds: ['canadian-consulting-engineer'],
    confidence: 'medium',
  },
  {
    id: 'tallest-structure',
    dateLabel: '7 April 2008',
    sortKey: '2008-04',
    title: 'The tallest structure ever built',
    text: 'At 629 m, the tower becomes the tallest structure ever built at that time, just above a 628.8 m TV mast in North Dakota, USA.',
    stage: 'structure',
    builtHeightM: 629,
    sourceIds: ['meed-2008'],
    confidence: 'high',
  },
  {
    id: 'topped-out',
    dateLabel: 'January 2009',
    sortKey: '2009-01',
    title: 'Topped out',
    text: 'The tower reaches its full height.',
    stage: 'structure',
    builtHeightM: 828,
    sourceIds: ['skyscraper-museum-extreme', 'khl-2010', 'csmonitor-2010'],
    confidence: 'medium',
    note: 'The exact day differs between sources. The final height was kept secret until the opening, so some reports at the time gave other figures.',
  },
  {
    id: 'exterior-complete',
    dateLabel: 'Autumn 2009',
    sortKey: '2009-10',
    title: 'Outside finished',
    text: 'The outside of the tower is completed.',
    stage: 'exterior',
    builtHeightM: 828,
    sourceIds: ['guinness', 'official-architecture'],
    confidence: 'medium',
    note: 'Guinness World Records gives 1 October 2009; the official site says September 2009.',
  },
  {
    id: 'opening',
    dateLabel: '4 January 2010',
    sortKey: '2010-01',
    title: 'Opening day',
    text: 'The tower officially opens and is given its new name, Burj Khalifa. During construction it was called Burj Dubai.',
    stage: 'complete',
    builtHeightM: 828,
    sourceIds: ['guinness', 'csmonitor-2010'],
    confidence: 'high',
  },
];

const S = SCENE_SCALE;
const LEARNING_VIEW =
  'This is an educational cutaway made for learning: the real interiors are not shown, and not every floor is open to the public.';

export const BURJ_STOPS: Stop[] = [
  {
    id: 'foundation',
    name: 'Foundation',
    heightM: -4,
    kind: 'foundation',
    description:
      'Below the ground: an educational cutaway of the thick concrete raft and the piles under it. You could never see this view in real life, because it is buried.',
    reconstructed: true,
    camera: { distance: 220 * S, elevation: 20, azimuth: 35 },
  },
  {
    id: 'ground',
    name: 'Ground',
    heightM: 0,
    kind: 'ground',
    description: 'Ground level, at the foot of the tower and its podium, looking up at the model.',
    reconstructed: false,
    camera: { distance: 260 * S, elevation: 8, azimuth: 30 },
  },
  {
    id: 'lower-floors',
    name: 'Lower floors',
    heightM: 100,
    kind: 'floors',
    description: `About 100 m up, where the three wings are widest. ${LEARNING_VIEW}`,
    reconstructed: true,
    camera: { distance: 220 * S, elevation: 6, azimuth: 40 },
  },
  {
    id: 'middle-floors',
    name: 'Middle floors',
    heightM: 300,
    kind: 'floors',
    description: `About 300 m up. Look for the setbacks where the wings step in. ${LEARNING_VIEW}`,
    reconstructed: true,
    camera: { distance: 220 * S, elevation: 4, azimuth: 50 },
  },
  {
    id: 'upper-floors',
    name: 'Upper floors',
    heightM: 500,
    kind: 'floors',
    description: `About 500 m up, where the wings are much shorter. ${LEARNING_VIEW}`,
    reconstructed: true,
    camera: { distance: 200 * S, elevation: 4, azimuth: 60 },
  },
  {
    id: 'highest-occupied',
    name: 'Highest occupied floor',
    heightM: 585.4,
    kind: 'floors',
    description: `The highest floor people use, 585.4 m above the ground. Above here the tower is made of steel. ${LEARNING_VIEW}`,
    reconstructed: true,
    camera: { distance: 170 * S, elevation: 6, azimuth: 70 },
  },
  {
    id: 'top',
    name: 'Spire and top',
    heightM: 828,
    kind: 'top',
    description: 'The steel spire at the top, 828 m above the ground (829.8 m to the very tip). It was assembled inside the tower and jacked up from within.',
    reconstructed: false,
    camera: { distance: 240 * S, elevation: 10, azimuth: 80 },
  },
];

export const BURJ_QUIZ: QuizQuestion[] = [
  {
    id: 'quiz-pressure-area',
    question: 'What happens to the average pressure if the same force acts on a smaller area?',
    options: ['It gets bigger', 'It gets smaller', 'It stays exactly the same', 'The force disappears'],
    correctIndex: 0,
    explanation:
      'Pressure is force divided by area: P = F / A. Imagine pushing into soft clay with your whole hand, then with one finger, using the same push. The finger sinks in deeper, because the same force is squeezed onto a smaller area, so the pressure is bigger.',
  },
  {
    id: 'quiz-wind-speed',
    question: 'If the wind blows twice as fast, about how much harder does it push on a building?',
    options: ['About the same', 'About twice as hard', 'About four times as hard', 'About ten times as hard'],
    correctIndex: 2,
    explanation:
      'The push of the wind grows roughly with the square of its speed. Twice as fast means 2 x 2 = 4, so it pushes about four times as hard. That is why engineers study strong winds so carefully.',
  },
  {
    id: 'quiz-confuse-wind',
    question: 'Why does the shape of the Burj Khalifa keep changing as it goes up?',
    options: ['To confuse the wind', 'To make room for car parks', 'Because the builders ran out of glass', 'So the tower can spin'],
    correctIndex: 0,
    explanation:
      'The setbacks spiral up the tower, so the wind never meets the same shape for long. Swirling air cannot organise into a steady rhythm. The designers called this "confusing the wind".',
  },
  {
    id: 'quiz-foundation',
    question: 'What holds the Burj Khalifa up under the ground?',
    options: ['A thick concrete raft on long piles', 'One giant rock', 'Nothing, it just stands on the sand', 'Huge springs'],
    correctIndex: 0,
    explanation: 'The tower stands on a piled raft: a 3.7 m thick concrete mat resting on nearly 200 piles that reach deep into the ground.',
  },
  {
    id: 'quiz-spire',
    question: 'What is the spire at the very top made of?',
    options: ['Steel', 'Wood', 'Only glass', 'Concrete'],
    correctIndex: 0,
    explanation: 'The tower is reinforced concrete up to about level 156. Above that, including the spire, it is structural steel.',
  },
  {
    id: 'quiz-load-path',
    question: 'Which order follows the load path from the floors down to the ground?',
    options: [
      'Floors, then core and wings, then raft, then piles',
      'Piles, then floors, then spire',
      'Spire, then windows, then sky',
      'Raft, then floors, then core',
    ],
    correctIndex: 0,
    explanation:
      'The floors pass their loads to the core and wings. These carry the loads down to the raft, and the raft spreads them onto the piles, which pass them into the ground.',
  },
];

export const BURJ_LESSONS: Lesson[] = [
  {
    id: 'foundation-pressure',
    title: 'Why does the base of a skyscraper need a special foundation?',
    subject: 'Physics',
    summary: 'Follow the weight of the tower down to the ground and discover why spreading a force over a bigger area lowers the pressure.',
    steps: [
      {
        kind: 'experience',
        title: 'Stand at the bottom',
        text:
          'You are standing at ground level. The raft and the piles under your feet and the core above you are glowing. The arrows show the load path: the route the weight of the tower takes down toward the ground.',
        focusPartIds: ['raft', 'piles', 'core'],
        stopId: 'ground',
      },
      {
        kind: 'interact',
        title: 'Try the pressure experiment',
        text:
          'This is a simulation with pretend "weight blocks", not the real tower. Add or remove floors, compare a low building with a tall one, and make the foundation area bigger or smaller. Watch what happens to the pressure meter.',
        simulation: 'foundation-pressure',
      },
      {
        kind: 'explain',
        title: 'What is going on?',
        text:
          'Gravity pulls everything in a building downward: the concrete, steel and glass it is made of, and all the people and things inside. The structure (the floors, the core and the wings) carries these forces down toward the foundations. This route is called the load path. ' +
          'Pressure is force divided by area: P = F / A. If the force being supported gets bigger while the contact area stays the same, the average pressure gets bigger. If the same force is spread over a bigger area, the average pressure gets smaller. ' +
          'Careful: a floor does not feel more pressure just because it is lower down. Instead, the loads add up along the load paths as you go down the structure, and the pressure under the foundation depends on the force passed down to it and the area it acts on. ' +
          'Real foundation design is much more than one sum. Engineers study the soil or rock, the shape of the foundation, the groundwater, the loads from the structure, how much the ground may settle, and they add safety factors.',
        focusPartIds: ['raft', 'piles'],
      },
      {
        kind: 'check',
        title: 'Check your thinking',
        text: 'Answer one question to check what you found out.',
        quizId: 'quiz-pressure-area',
      },
    ],
    caveat: 'Simplified model, not an engineering calculation.',
    sourceIds: ['som', 'official-structures', 'poulos-bunce-2008', 'nasa-gas-pressure'],
  },
  {
    id: 'wind',
    title: 'How does wind push on a tall building?',
    subject: 'Physics',
    summary: 'Turn up the wind, watch the push grow, and see how the Y shape and spiralling setbacks help the tower.',
    steps: [
      {
        kind: 'experience',
        title: 'Feel the wind',
        text: 'Wind arrows are flowing toward the tower. For this tower, wind was the biggest sideways push the engineers had to design for.',
        focusPartIds: ['facade', 'wing-a', 'wing-b', 'wing-c'],
        stopId: 'upper-floors',
      },
      {
        kind: 'interact',
        title: 'Change the wind',
        text:
          'Move the wind slider from calm to stormy and watch the push meter. The sway is exaggerated so that you can see it; this is a visualisation, not the real movement of the tower.',
        simulation: 'wind',
      },
      {
        kind: 'explain',
        title: 'What is going on?',
        text:
          'Wind pushes sideways on a tall building. The push grows quickly with wind speed: roughly with the square of the speed, so wind that is twice as fast pushes about four times as hard (2 x 2 = 4). ' +
          "The Burj Khalifa's Y shape and its spiralling setbacks change the shape of the tower as it rises. This breaks up the swirling wind, so the swirls cannot organise into a steady rhythm. " +
          'Real buildings are more complicated: how they move depends on their shape, how stiff they are, how quickly their movement dies away (damping) and the wind conditions.',
        focusPartIds: ['facade'],
      },
      {
        kind: 'check',
        title: 'Check your thinking',
        text: 'Answer one question to check what you found out.',
        quizId: 'quiz-wind-speed',
      },
    ],
    caveat: 'Educational visualisation, not a structural engineering calculation. The sway is shown exaggerated.',
    sourceIds: ['irwin-baker-2005', 'som', 'official-architecture', 'skyscraper-museum-learned', 'nasa-dynamic-pressure'],
  },
];

export const BURJ_MISSIONS: Mission[] = [
  {
    id: 'find-foundation',
    title: 'Find the foundation',
    description: 'Find the part that holds the whole tower up under the ground.',
    kind: 'find-part',
    partIds: ['raft', 'piles'],
    reward: 'You found what holds the whole tower up!',
  },
  {
    id: 'find-support',
    title: 'Find the supports',
    description: 'Find the core or one of the wings that keep the tower standing straight.',
    kind: 'find-part',
    partIds: ['core', 'wing-a', 'wing-b', 'wing-c'],
    reward: 'You found the backbone of the tower!',
  },
  {
    id: 'load-path',
    title: 'Follow the load path',
    description: 'Tap the parts in order, from the floors down to the piles: floors, then the core or a wing, then the raft, then the piles.',
    kind: 'tap-sequence',
    sequence: [['floors', 'facade'], ['core', 'wing-a', 'wing-b', 'wing-c'], ['raft'], ['piles']],
    reward: 'You followed the load path all the way to the ground!',
  },
  {
    id: 'find-wind',
    title: 'Explore the wind',
    description: 'Finish the wind lesson and discover how the tower handles strong winds.',
    kind: 'lesson',
    lessonId: 'wind',
    reward: 'Now you know how the tower confuses the wind!',
  },
  {
    id: 'compare-designs',
    title: 'Compare two buildings',
    description: 'In the foundation experiment, compare a low building with a tall one on the same foundation area.',
    kind: 'compare',
    lessonId: 'foundation-pressure',
    reward: 'You saw how a taller building puts more force on its foundation!',
  },
  {
    id: 'physics-question',
    title: 'Pressure puzzle',
    description: 'Answer the pressure question from the foundation lesson.',
    kind: 'quiz',
    quizId: 'quiz-pressure-area',
    reward: 'You worked out how force and area change pressure!',
  },
  {
    id: 'timeline',
    title: 'Watch it grow',
    description: 'Watch the construction timeline from the empty site to opening day.',
    kind: 'timeline',
    reward: 'You watched the tallest building in the world rise from the ground!',
  },
];

export const BURJ_KHALIFA: RealLandmark = {
  id: 'burj-khalifa',
  name: 'Burj Khalifa',
  place: 'Dubai, United Arab Emirates',
  status: 'available',
  tagline: 'The tallest building in the world',
  summary:
    'An 828 m tower that stands on a raft of concrete and nearly 200 piles, braced by a six-sided core and three wings in a Y shape. Explore how it was built, how it stands up, and how it copes with the wind.',
  disclaimer:
    'This is a simplified 3D learning model built for EAVARA. Its shape and proportions are approximate, and the inside views are educational cutaways, not the real interiors.',
  model: { kind: 'procedural', builder: 'burj-khalifa' },
  heightM: BURJ_HEIGHT_M,
  facts: BURJ_FACTS,
  sources: BURJ_SOURCES,
  stops: BURJ_STOPS,
  parts: BURJ_PARTS,
  hotspots: BURJ_HOTSPOTS,
  stages: BURJ_STAGES,
  timeline: BURJ_TIMELINE,
  lessons: BURJ_LESSONS,
  quiz: BURJ_QUIZ,
  missions: BURJ_MISSIONS,
  subjects: ['Engineering', 'Physics', 'Architecture', 'History'],
};
