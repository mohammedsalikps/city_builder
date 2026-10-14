/**
 * Golden Gate Bridge content for the Real World Explorer. Facts, dates and
 * numbers come from the official website of the Golden Gate Bridge, Highway
 * and Transportation District (goldengate.org); how a suspension bridge
 * carries loads comes from PBS / WGBH "Building Big". Where the official
 * pages give different dates, the entry says so. Simulation numbers are
 * pretend units, never the bridge's own.
 *
 * The 3D model is built in code (src/realworld/models/GoldenGateBridgeModel.ts):
 * no downloadable model with a suitable licence and download terms was found.
 */
import type {
  Fact,
  Hotspot,
  Lesson,
  LandmarkCompanion,
  Mission,
  Part,
  QuizQuestion,
  RealLandmark,
  Source,
  Stage,
  Stop,
  TimelineEntry,
} from '@/realworld/types';

/** Tower height above the water (official), used for model scale and stops. */
export const GOLDEN_GATE_TOWER_M = 227;

const OFFICIAL = 'Golden Gate Bridge, Highway and Transportation District';

export const GOLDEN_GATE_SOURCES: Source[] = [
  { id: 'gg-stats', title: 'Design & Construction Statistics', publisher: OFFICIAL, url: 'https://www.goldengate.org/bridge/history-research/statistics-data/design-construction-stats/' },
  { id: 'gg-construction', title: 'Construction', publisher: OFFICIAL, url: 'https://www.goldengate.org/bridge/history-research/bridge-construction/construction/' },
  { id: 'gg-key-dates', title: 'Key Dates in Bridge History', publisher: OFFICIAL, url: 'https://www.goldengate.org/bridge/history-research/moments-events/key-dates/' },
  { id: 'gg-design', title: 'Bridge Design', publisher: OFFICIAL, url: 'https://www.goldengate.org/bridge/history-research/bridge-construction/bridge-design/' },
  { id: 'pbs-forces', title: 'Building Big: Suspension bridge forces', publisher: 'PBS / WGBH Educational Foundation', url: 'https://www.pbs.org/wgbh/buildingbig/bridge/susp_forces.html' },
  { id: 'pbs-basics', title: 'Building Big: Bridge Basics', publisher: 'PBS / WGBH Educational Foundation', url: 'https://www.pbs.org/wgbh/buildingbig/bridge/basics.html' },
];

export const GOLDEN_GATE_FACTS: Fact[] = [
  { id: 'length', label: 'Total length', value: '2,737 m (8,981 ft) from one end to the other', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'main-span', label: 'Main span', value: '1,280 m (4,200 ft) between the two towers', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'side-spans', label: 'Side spans', value: '343 m (1,125 ft) each', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'towers', label: 'Towers', value: '227 m (746 ft) above the water', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'clearance', label: 'Height of the roadway', value: 'About 67 m (220 ft) above the water at high tide', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'width', label: 'Width', value: '27 m (90 ft)', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'cables', label: 'Main cables', value: 'Two cables, each 0.92 m (36 3/8 in) thick and 2,332 m (7,650 ft) long', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'wires', label: 'Wires', value: '27,572 steel wires in each main cable; about 129,000 km (80,000 miles) of wire in both', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'suspenders', label: 'Suspender ropes', value: '250 pairs', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'anchorage-weight', label: 'Anchorages', value: '60,000 tons each', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'tower-weight', label: 'Weight of both towers', value: '44,000 tons', sourceIds: ['gg-stats'], confidence: 'high' },
  { id: 'built', label: 'Built', value: '5 January 1933 to April 1937; opened 27 May 1937', sourceIds: ['gg-construction', 'gg-key-dates'], confidence: 'high' },
  { id: 'cost', label: 'Cost', value: '$35 million, paid for with a bond issue approved by voters in 1930', sourceIds: ['gg-construction', 'gg-key-dates'], confidence: 'high' },
  {
    id: 'engineers',
    label: 'Engineers',
    value: 'Chief Engineer Joseph Strauss; Charles A. Ellis led the design and the stress calculations; Leon Moisseiff was a consultant',
    sourceIds: ['gg-design'],
    confidence: 'high',
  },
  { id: 'architect', label: 'Architect', value: 'Irving Morrow designed the architectural treatment', sourceIds: ['gg-key-dates'], confidence: 'high' },
  {
    id: 'safety',
    label: 'Safety',
    value: 'A safety net under the deck saved the lives of 19 workers; sadly, eleven workers died during construction',
    sourceIds: ['gg-construction'],
    confidence: 'high',
  },
  { id: 'new-deck', label: 'New roadway', value: 'In 1985 the original roadway was replaced with a steel deck', sourceIds: ['gg-key-dates'], confidence: 'high' },
];

const LEARNING_VIEW = 'This is a camera view of the learning model, not a place visitors can go.';

export const GOLDEN_GATE_STOPS: Stop[] = [
  {
    id: 'pier',
    name: 'Tower pier',
    heightM: -12,
    heightLabel: 'Under the water',
    kind: 'foundation',
    description: 'The San Francisco tower stands on a concrete pier built in the open water, inside a fender wall that was pumped dry. It is shown as a simple learning view.',
    reconstructed: true,
    camera: { distance: 40, elevation: 16, azimuth: 40 },
    focusM: { x: -640, z: 0 },
  },
  {
    id: 'roadway',
    name: 'Middle of the bridge',
    heightM: 70,
    heightLabel: '67 m',
    kind: 'floors',
    description: 'The middle of the main span. The roadway runs about 67 m (220 ft) above the water at high tide, halfway between the two towers.',
    reconstructed: false,
    camera: { distance: 46, elevation: 12, azimuth: 30 },
    focusM: { x: 0, z: 0 },
  },
  {
    id: 'cables',
    name: 'Main cables',
    heightM: 150,
    heightLabel: 'Cables',
    kind: 'floors',
    description: `Between the San Francisco tower and the middle, the two main cables curve down toward the roadway. ${LEARNING_VIEW}`,
    reconstructed: true,
    camera: { distance: 34, elevation: 6, azimuth: 35 },
    focusM: { x: -320, z: 0 },
  },
  {
    id: 'tower-top',
    name: 'Top of a tower',
    heightM: 227,
    kind: 'top',
    description: `The top of the San Francisco tower, 227 m (746 ft) above the water. ${LEARNING_VIEW}`,
    reconstructed: true,
    camera: { distance: 30, elevation: 4, azimuth: 30 },
    focusM: { x: -640, z: 0 },
  },
  {
    id: 'anchorage',
    name: 'Anchorage',
    heightM: 20,
    heightLabel: 'North end',
    kind: 'ground',
    description: 'The anchorage at the Marin (north) end: a huge concrete block that holds the ends of the main cables. Each anchorage weighs 60,000 tons.',
    reconstructed: false,
    camera: { distance: 36, elevation: 18, azimuth: 120 },
    focusM: { x: 1000, z: 0 },
  },
];

export const GOLDEN_GATE_PARTS: Part[] = [
  {
    id: 'towers',
    name: 'Towers',
    description: 'Two steel towers rise 227 m (746 ft) above the water. Each tower leg stands on a base about 10 m by 16 m (33 ft by 54 ft).',
    sourceIds: ['gg-stats'],
  },
  {
    id: 'main-cables',
    name: 'Main cables',
    description: 'Two main cables hang over the towers. Each is 0.92 m (36 3/8 in) thick and 2,332 m (7,650 ft) long, and is made of 27,572 steel wires.',
    sourceIds: ['gg-stats'],
  },
  {
    id: 'suspenders',
    name: 'Suspender ropes',
    description: 'Vertical suspender ropes hang from the main cables and hold up the deck. There are 250 pairs of them.',
    sourceIds: ['gg-stats'],
  },
  {
    id: 'deck',
    name: 'Deck',
    description: 'The deck carries the roadway, about 67 m (220 ft) above the water at high tide. The bridge is 27 m (90 ft) wide. Like most suspension bridges, it has a stiffening framework (a truss) under the roadway that resists bending and twisting.',
    sourceIds: ['gg-stats', 'pbs-basics'],
  },
  {
    id: 'anchorages',
    name: 'Anchorages',
    description: 'At each end, a huge concrete block called an anchorage holds the ends of the main cables. Each anchorage weighs 60,000 tons.',
    sourceIds: ['gg-stats', 'pbs-forces'],
  },
  {
    id: 'piers',
    name: 'Tower piers',
    description: 'The towers stand on concrete piers. The Marin (north) pier was finished in about six months in 1933; the San Francisco pier was built in the open water inside a fender wall and finished in January 1935.',
    sourceIds: ['gg-key-dates', 'gg-construction'],
  },
];

export const GOLDEN_GATE_HOTSPOTS: Hotspot[] = [
  {
    id: 'cable-spinning',
    partId: 'main-cables',
    title: 'Spun on the spot',
    text: 'The main cables were spun and compressed right on the bridge, from October 1935 to May 1936. Together they hold about 129,000 km (80,000 miles) of wire.',
    sourceIds: ['gg-construction', 'gg-stats'],
  },
  {
    id: 'tower-squeeze',
    partId: 'towers',
    title: 'Squeezed from above',
    text: 'The cables pass the weight of the deck and its traffic to the two towers as compression: the towers are squeezed, and they support most of the bridge’s weight.',
    sourceIds: ['pbs-forces'],
  },
  {
    id: 'safety-net',
    partId: 'deck',
    title: 'A safety net',
    text: 'While the deck was built, a safety net hung underneath it. The net saved the lives of 19 workers.',
    sourceIds: ['gg-construction'],
  },
  {
    id: 'anchor-hold',
    partId: 'anchorages',
    title: 'Holding the ends',
    text: 'The ends of the main cables are tied into the anchorages, so the cables’ pull ends in these heavy concrete blocks.',
    sourceIds: ['pbs-forces', 'gg-stats'],
  },
  {
    id: 'stormy-start',
    partId: 'piers',
    title: 'Built in rough water',
    text: 'In 1933 a cargo ship crashed into the access trestle for the San Francisco pier, and storms damaged it twice. The pier was still finished in January 1935.',
    sourceIds: ['gg-key-dates'],
  },
];

/** Stages of the construction view (display bands of the learning model, not durations). */
export const GOLDEN_GATE_STAGES: Stage[] = [
  { id: 'site', name: 'Plans', description: 'The bridge is designed and paid for.', progress: 0 },
  { id: 'foundation', name: 'Piers and anchorages', description: 'Concrete piers for the towers and anchorages for the cables are built.', progress: 0.08 },
  { id: 'structure', name: 'Towers, cables and deck', description: 'The towers rise, the main cables are spun, and the deck is hung from them.', progress: 0.86 },
  { id: 'exterior', name: 'Roadway', description: 'The roadway is paved and the last rivet is driven.', progress: 0.95 },
  { id: 'complete', name: 'Open', description: 'The bridge is open.', progress: 1 },
];

/**
 * The construction story, from the official pages. `progress` places each
 * entry in the learning model (see GoldenGateBridgeModel): piers and
 * anchorages, the Marin tower, the San Francisco pier and tower, the cables,
 * then the deck from the towers outward.
 */
export const GOLDEN_GATE_TIMELINE: TimelineEntry[] = [
  {
    id: 'permit',
    dateLabel: '11 August 1930',
    sortKey: '1930-08',
    title: 'Permission to build',
    text: 'The War Department issues its final permit to build a suspension bridge with a 4,200-foot (1,280 m) main span.',
    stage: 'site',
    builtHeightM: null,
    sourceIds: ['gg-construction', 'gg-key-dates'],
    confidence: 'high',
    progress: 0,
  },
  {
    id: 'bonds',
    dateLabel: '4 November 1930',
    sortKey: '1930-11',
    title: 'Voters say yes',
    text: 'Voters approve a $35 million bond issue to pay for the bridge.',
    stage: 'site',
    builtHeightM: null,
    sourceIds: ['gg-key-dates'],
    confidence: 'high',
    progress: 0,
  },
  {
    id: 'start',
    dateLabel: '5 January 1933',
    sortKey: '1933-01',
    title: 'Work begins',
    text: 'Construction officially starts. The ground-breaking celebration follows on 26 February 1933 at Crissy Field.',
    stage: 'foundation',
    builtHeightM: null,
    sourceIds: ['gg-construction', 'gg-key-dates'],
    confidence: 'high',
    progress: 0.02,
  },
  {
    id: 'marin-pier',
    dateLabel: 'June 1933',
    sortKey: '1933-06',
    title: 'The north pier is ready',
    text: 'The concrete pier for the Marin (north) tower is finished after about six months.',
    stage: 'foundation',
    builtHeightM: null,
    sourceIds: ['gg-key-dates'],
    confidence: 'high',
    progress: 0.08,
  },
  {
    id: 'storms',
    dateLabel: 'August to December 1933',
    sortKey: '1933-12',
    title: 'Ships and storms',
    text: 'A cargo ship crashes into the access trestle for the San Francisco pier in fog, and two storms damage it again. Repairs follow.',
    stage: 'foundation',
    builtHeightM: null,
    sourceIds: ['gg-key-dates', 'gg-construction'],
    confidence: 'high',
    progress: 0.14,
  },
  {
    id: 'marin-tower',
    dateLabel: '28 June 1934',
    sortKey: '1934-06',
    title: 'The north tower is topped off',
    text: 'The Marin (north) tower reaches its full height.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['gg-key-dates', 'gg-construction'],
    confidence: 'medium',
    note: 'The official construction page says the Marin tower was completed either on 28 June 1934 or in November 1934, depending on the source; the key dates page lists both (topped off in June, ready for cable spinning in November).',
    progress: 0.22,
  },
  {
    id: 'sf-pier',
    dateLabel: '8 January 1935',
    sortKey: '1935-01',
    title: 'A pier in the open water',
    text: 'The San Francisco (south) pier is completed. It was built in the open water inside a fender wall that was pumped dry.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['gg-key-dates', 'gg-construction'],
    confidence: 'high',
    progress: 0.34,
  },
  {
    id: 'sf-tower',
    dateLabel: 'June 1935',
    sortKey: '1935-06',
    title: 'The south tower is finished',
    text: 'The San Francisco (south) tower is completed in about six months.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['gg-key-dates', 'gg-construction'],
    confidence: 'medium',
    note: 'The official key dates page says 24 June 1935; its construction page gives 28 June 1935.',
    progress: 0.45,
  },
  {
    id: 'catwalks',
    dateLabel: '27 September 1935',
    sortKey: '1935-09',
    title: 'Catwalks across the strait',
    text: 'The first cable was strung between the towers on 1 August 1935. By 27 September the catwalks are finished, ready for spinning the main cables.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['gg-key-dates'],
    confidence: 'high',
    progress: 0.48,
  },
  {
    id: 'cables-spun',
    dateLabel: '22 May 1936',
    sortKey: '1936-05',
    title: 'The main cables are spun',
    text: 'Spinning of the two main cables is completed, after starting in October 1935.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['gg-key-dates', 'gg-construction'],
    confidence: 'high',
    progress: 0.65,
  },
  {
    id: 'deck-starts',
    dateLabel: 'June 1936',
    sortKey: '1936-06',
    title: 'The deck goes up',
    text: 'Work starts on the main suspended structure: the deck that hangs from the cables.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['gg-key-dates', 'gg-construction'],
    confidence: 'medium',
    note: 'The official key dates page says work started on 18 June 1936; its construction page gives July 1936.',
    progress: 0.67,
  },
  {
    id: 'joined',
    dateLabel: 'November 1936',
    sortKey: '1936-11',
    title: 'Joined in the middle',
    text: 'The two halves of the main span are joined in the middle of the bridge.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['gg-key-dates', 'gg-construction'],
    confidence: 'medium',
    note: 'The official key dates page gives 20 November 1936 and says other sources cite 18 or 19 November; its construction page gives 18 November.',
    progress: 0.86,
  },
  {
    id: 'paved',
    dateLabel: '19 April 1937',
    sortKey: '1937-04',
    title: 'The roadway is paved',
    text: 'Paving of the roadway is completed. On 27 April the Last Rivet ceremony is held in the middle of the bridge.',
    stage: 'exterior',
    builtHeightM: null,
    sourceIds: ['gg-key-dates', 'gg-construction'],
    confidence: 'high',
    progress: 0.95,
  },
  {
    id: 'opening',
    dateLabel: '27 May 1937',
    sortKey: '1937-05',
    title: 'Opening day',
    text: 'The bridge opens to people on foot. Cars follow at noon the next day.',
    stage: 'complete',
    builtHeightM: null,
    sourceIds: ['gg-key-dates'],
    confidence: 'high',
    progress: 1,
  },
  {
    id: 'new-deck',
    dateLabel: '15 August 1985',
    sortKey: '1985-08',
    title: 'A new roadway',
    text: 'The original roadway is replaced with a lighter steel deck.',
    stage: 'complete',
    builtHeightM: null,
    sourceIds: ['gg-key-dates'],
    confidence: 'high',
    progress: 1,
  },
];

export const GOLDEN_GATE_QUIZ: QuizQuestion[] = [
  {
    id: 'quiz-cable-force',
    question: 'What kind of force do the main cables mostly carry?',
    options: ['Pulling (tension)', 'Squeezing (compression)', 'No force at all', 'Only wind'],
    correctIndex: 0,
    explanation: 'The deck hangs from the suspenders and the suspenders hang from the main cables, so the cables are pulled tight: tension. The cables press down on the tops of the towers, so the towers are squeezed: compression.',
  },
  {
    id: 'quiz-load-order',
    question: 'A bus stops in the middle of the bridge. In which order does its weight travel?',
    options: [
      'Deck, then suspenders, then main cables, then the towers and anchorages, then the ground',
      'Main cables, then deck, then water',
      'Towers, then deck, then suspenders',
      'It stays in the bus',
    ],
    correctIndex: 0,
    explanation: 'The deck hangs from the suspenders, the suspenders hang from the main cables, and the cables carry the load over the towers (squeezing them down to their piers) and into the anchorages at the ends.',
  },
];

const SIMPLIFIED =
  'Educational model, not an engineering design calculation: real loads also depend on the stiffening truss of the deck, the suspenders, the anchorages, the weight of the bridge itself, wind and the actual structural design. Arrows are simplified and not drawn to scale.';

export const GOLDEN_GATE_LESSONS: Lesson[] = [
  {
    id: 'tension-compression',
    title: 'Pull or squeeze? Forces in the Golden Gate Bridge',
    subject: 'Physics',
    summary: 'Pick a cable, a tower or the deck and see which parts are pulled and which are squeezed.',
    steps: [
      {
        kind: 'experience',
        title: 'Meet the parts',
        text: 'Two main cables hang over two tall towers. Thin suspender ropes hang from the cables and hold up the deck. At each end, the cables disappear into huge concrete anchorages.',
        focusPartIds: ['main-cables', 'towers', 'suspenders'],
        stopId: 'cables',
      },
      {
        kind: 'interact',
        title: 'Pick a part',
        text: 'Choose a part to see simplified force arrows on it. Blue arrows pointing apart mean it is being pulled (tension). Orange arrows pointing together mean it is being squeezed (compression).',
        simulation: 'bridge-forces',
      },
      {
        kind: 'explain',
        title: 'What is going on?',
        text:
          'Tension is a pull that tries to stretch something; compression is a push that tries to squash it. The deck hangs from the suspenders and the suspenders hang from the main cables, so the suspenders and cables are pulled: they carry mainly tension. The cables pass the load to the towers as compression: the towers are squeezed and carry it down toward their foundations. The ends of the cables are held by the anchorages. ' +
          'That is the basic idea. The complete load path also depends on the deck and its stiffening truss, the suspenders, the anchorages and the actual structural design.',
        focusPartIds: ['main-cables', 'towers'],
      },
      {
        kind: 'check',
        title: 'Check your thinking',
        text: 'Answer one question to check what you found out.',
        quizId: 'quiz-cable-force',
      },
    ],
    caveat: SIMPLIFIED,
    sourceIds: ['pbs-forces', 'pbs-basics', 'gg-stats'],
  },
  {
    id: 'load-path-bridge',
    title: 'How does a suspension bridge carry a load?',
    subject: 'Engineering',
    summary: 'Put a load anywhere on the deck and follow its weight to the towers, anchorages and foundations.',
    steps: [
      {
        kind: 'experience',
        title: 'A load on the deck',
        text: 'Imagine a heavy truck stopping on the deck. Its weight has to get all the way down to the ground. Which way does it go?',
        focusPartIds: ['deck', 'suspenders'],
        stopId: 'roadway',
      },
      {
        kind: 'interact',
        title: 'Move the load',
        text: 'Slide the load along the deck and watch the arrows. Then try the pretend flatter cable and compare how hard the cable has to pull.',
        simulation: 'suspension-load',
      },
      {
        kind: 'explain',
        title: 'What is going on?',
        text:
          'Documented facts: the deck hangs from 250 pairs of suspender ropes, the suspenders hang from two main cables of 27,572 wires each, the cables pass over two 227 m towers, and their ends are held by two 60,000-ton anchorages. The cables pass the load to the towers as compression, and the towers stand on concrete piers. ' +
          'Conceptual model: the panel treats the cable as two straight pieces meeting at the load. In that pretend model a flatter cable must pull much harder to hold the same load, and the tower nearer to the load carries more of it. The real bridge spreads a load through its stiff deck truss and many suspenders, so its numbers are different.',
        focusPartIds: ['main-cables', 'anchorages'],
      },
      {
        kind: 'check',
        title: 'Check your thinking',
        text: 'Answer one question to check what you found out.',
        quizId: 'quiz-load-order',
      },
    ],
    caveat: SIMPLIFIED,
    sourceIds: ['pbs-forces', 'gg-stats'],
  },
];

export const GOLDEN_GATE_MISSIONS: Mission[] = [
  { id: 'find-towers', title: 'Find a tower', description: 'Find one of the two tall towers.', kind: 'find-part', partIds: ['towers'], reward: 'You found one of the two 227 m towers!' },
  { id: 'find-cables', title: 'Find a main cable', description: 'Find one of the two main cables.', kind: 'find-part', partIds: ['main-cables'], reward: 'You found a cable made of 27,572 wires!' },
  { id: 'find-anchorage', title: 'Find an anchorage', description: 'Find the concrete block that holds the end of a cable.', kind: 'find-part', partIds: ['anchorages'], reward: 'You found where the cables are tied down!' },
  {
    id: 'trace-the-load',
    title: 'Trace the load',
    description: 'Tap the parts in order, from the deck to the ground: deck, a suspender, a main cable, a tower, then a tower pier.',
    kind: 'tap-sequence',
    sequence: [['deck'], ['suspenders'], ['main-cables'], ['towers'], ['piers']],
    reward: 'You traced the load from the deck to the foundations!',
  },
  { id: 'forces', title: 'Pull or squeeze?', description: 'Finish the lesson about tension and compression.', kind: 'lesson', lessonId: 'tension-compression', reward: 'You know which parts are pulled and which are squeezed!' },
  {
    id: 'compare-cables',
    title: 'Compare two cables',
    description: 'In the load lesson, try the normal cable and the pretend flatter cable.',
    kind: 'compare',
    lessonId: 'load-path-bridge',
    reward: 'You saw that a flatter cable has to pull harder!',
  },
  { id: 'watch-it-built', title: 'Watch it being built', description: 'Watch the construction timeline to the end.', kind: 'timeline', reward: 'You watched the bridge go up, from piers to opening day!' },
];

export const GOLDEN_GATE_COMPANION: LandmarkCompanion = {
  welcome: 'Welcome to the Golden Gate Bridge. Shall we explore the towers or the cables?',
  welcomeChoices: [
    { label: 'Explore the towers', stopId: 'tower-top' },
    { label: 'Look at the cables', stopId: 'cables' },
    { label: 'See how it was built', view: 'construction' },
  ],
  parts: {
    'main-cables': { text: 'These cables carry tension. Want to see how the bridge transfers a load?', choices: [{ label: 'Show me the load', lessonId: 'load-path-bridge' }] },
    suspenders: { text: 'The suspenders are pulled too: they hang the deck from the main cables. Want to follow a load?', choices: [{ label: 'Follow a load', lessonId: 'load-path-bridge' }] },
    towers: { text: 'The towers are squeezed: the cables press down on their tops. Which parts pull and which push?', choices: [{ label: 'Pull or squeeze?', lessonId: 'tension-compression' }] },
    deck: { text: 'Cars and people travel on the deck. Can you trace the load from the deck toward the foundations?', choices: [{ label: 'Trace a load', lessonId: 'load-path-bridge' }] },
    anchorages: { text: 'This anchorage holds the ends of the main cables: their pull ends here.', choices: [{ label: 'Pull or squeeze?', lessonId: 'tension-compression' }] },
    piers: { text: 'The towers stand on concrete piers. The San Francisco pier was built in the open water.', choices: [{ label: 'Follow a load', lessonId: 'load-path-bridge' }] },
  },
  lessons: {
    'tension-compression': 'Which parts are pulled, and which are squeezed? Pick one to see.',
    'load-path-bridge': 'Can you trace the load from the deck toward the foundations?',
  },
};

export const GOLDEN_GATE_BRIDGE: RealLandmark = {
  id: 'golden-gate-bridge',
  name: 'Golden Gate Bridge',
  place: 'San Francisco, USA',
  status: 'available',
  tagline: 'A famous suspension bridge across the Golden Gate strait',
  summary: 'A suspension bridge with a 1,280 m main span between two 227 m towers, opened in 1937.',
  disclaimer:
    'This is a simplified 3D learning model of the Golden Gate Bridge, built in code by EAVARA because no suitable downloadable model with a compatible licence was found. Its shapes and proportions are approximate (the cables and suspenders are drawn thicker so you can see them), the underwater piers are a simple learning view, and the force arrows are simplified, not engineering design calculations.',
  model: { kind: 'procedural', builder: 'golden-gate-bridge' },
  heightM: GOLDEN_GATE_TOWER_M,
  facts: GOLDEN_GATE_FACTS,
  sources: GOLDEN_GATE_SOURCES,
  stops: GOLDEN_GATE_STOPS,
  parts: GOLDEN_GATE_PARTS,
  hotspots: GOLDEN_GATE_HOTSPOTS,
  stages: GOLDEN_GATE_STAGES,
  timeline: GOLDEN_GATE_TIMELINE,
  lessons: GOLDEN_GATE_LESSONS,
  quiz: GOLDEN_GATE_QUIZ,
  missions: GOLDEN_GATE_MISSIONS,
  subjects: ['Engineering', 'Physics', 'History'],
  companion: GOLDEN_GATE_COMPANION,
};
