/**
 * Eiffel Tower content for the Real World Explorer. Every factual claim cites
 * a source below; numbers are the official website's (SETE, the company that
 * runs the tower) unless noted. Where the official pages give two values, the
 * fact says so. Simulation numbers are pretend units, never the tower's.
 *
 * The 3D model is a downloaded, approximate model ("Eiffel Tower" by
 * ingoenius, CC0, via the 3D Model Repository): see
 * public/assets/realworld/landmarks/eiffel-tower/LICENSE.txt.
 */
import {
  CONSTRUCTION_PROGRESS,
  type Fact,
  type Hotspot,
  type Lesson,
  type Mission,
  type Part,
  type QuizQuestion,
  type RealLandmark,
  type Source,
  type Stage,
  type Stop,
  type TimelineEntry,
} from '@/realworld/types';

/** Height used for the model and the timeline: today's height with the antennas (official key figures). */
export const EIFFEL_HEIGHT_M = 330;

const OFFICIAL = 'Official Eiffel Tower website';

export const EIFFEL_SOURCES: Source[] = [
  { id: 'eiffel-key-figures', title: 'La tour en chiffres (the tower in figures)', publisher: OFFICIAL, url: 'https://www.toureiffel.paris/fr/le-monument/chiffres-cle' },
  { id: 'eiffel-history', title: 'Origins and construction of the Eiffel Tower', publisher: OFFICIAL, url: 'https://www.toureiffel.paris/en/the-monument/history' },
  { id: 'eiffel-material', title: 'What is the Eiffel Tower made of? (Bertrand Lemoine)', publisher: OFFICIAL, url: 'https://www.toureiffel.paris/en/news/130-years/what-eiffel-tower-made' },
  { id: 'eiffel-size', title: 'Why does the Eiffel Tower change size?', publisher: OFFICIAL, url: 'https://www.toureiffel.paris/en/news/history-and-culture/why-does-eiffel-tower-change-size' },
  { id: 'eiffel-viaducts', title: 'The Eiffel Tower, daughter of tall metal viaducts (Bertrand Lemoine)', publisher: OFFICIAL, url: 'https://www.toureiffel.paris/en/news/130-years/eiffel-tower-daughter-tall-metal-viaducts' },
  { id: 'galileo-frames', title: 'The Design of Frame Structures', publisher: 'Galileo Educational Network', url: 'https://www.galileo.org/tips/structures/frames.html' },
];

export const EIFFEL_FACTS: Fact[] = [
  {
    id: 'height',
    label: 'Height',
    value: '330 m today, with its antennas',
    note: 'When it was finished in 1889 it was 312 m tall. Radio and television antennas added in 1957, 2000 and 2022 made it taller.',
    sourceIds: ['eiffel-key-figures', 'eiffel-size'],
    confidence: 'high',
  },
  { id: 'floors', label: 'Floors', value: 'First floor 57 m, second floor 115 m, top floor 276 m above the ground', sourceIds: ['eiffel-key-figures'], confidence: 'high' },
  { id: 'base', label: 'Base', value: 'Four pillars on the corners of a square 125 m across; each pillar is 25 m wide on the ground', sourceIds: ['eiffel-key-figures'], confidence: 'high' },
  { id: 'weight', label: 'Weight', value: '7,300 tonnes of iron in the frame, 10,100 tonnes in total', sourceIds: ['eiffel-key-figures', 'eiffel-history'], confidence: 'high' },
  { id: 'parts', label: 'Iron parts', value: '18,038 iron parts held together by 2,500,000 rivets', sourceIds: ['eiffel-key-figures', 'eiffel-history'], confidence: 'high' },
  { id: 'material', label: 'Material', value: 'Puddled iron, made at the Forges de Pompey near Nancy', sourceIds: ['eiffel-material'], confidence: 'high' },
  { id: 'build-time', label: 'Building time', value: '2 years, 2 months and 5 days (26 January 1887 to 31 March 1889)', sourceIds: ['eiffel-history', 'eiffel-key-figures'], confidence: 'high' },
  {
    id: 'assembly-time',
    label: 'Putting the iron together',
    value: 'About 21 to 22 months',
    note: 'The official history page says both: the foundations took five months and the iron took twenty-one months, and also that the assembly of the supports was completed twenty-two months after it began.',
    sourceIds: ['eiffel-history'],
    confidence: 'medium',
  },
  { id: 'workers', label: 'Workers', value: 'About 150 in the factory and between 150 and 300 on the building site', sourceIds: ['eiffel-history'], confidence: 'high' },
  { id: 'drawings', label: 'Drawings', value: '5,300 workshop drawings by 50 engineers and designers', sourceIds: ['eiffel-history'], confidence: 'high' },
  {
    id: 'designers',
    label: 'Designed by',
    value: "Engineers Maurice Koechlin and Émile Nouguier and architect Stephen Sauvestre, for Gustave Eiffel's company",
    sourceIds: ['eiffel-history'],
    confidence: 'high',
  },
  {
    id: 'foundation-pressure',
    label: 'Pressure under each corner',
    value: 'About 3 to 4 kilograms on every square centimetre',
    note: 'That is the pressure of a 3 to 4 kg weight resting on each square centimetre (about 0.3 to 0.4 megapascals).',
    sourceIds: ['eiffel-history'],
    confidence: 'high',
  },
  { id: 'purpose', label: 'Built for', value: 'The 1889 Exposition Universelle in Paris, 100 years after the French Revolution', sourceIds: ['eiffel-key-figures'], confidence: 'high' },
  { id: 'visitors-1889', label: 'Visitors in 1889', value: 'About 2 million during the 1889 World’s Fair', sourceIds: ['eiffel-history'], confidence: 'high' },
  {
    id: 'tallest',
    label: 'Record',
    value: 'The tallest tower in the world until 1931',
    note: 'That year the Empire State Building (381 m) became taller.',
    sourceIds: ['eiffel-size'],
    confidence: 'high',
  },
  {
    id: 'sun',
    label: 'Moved by the sun',
    value: 'On a sunny day the top moves in a small circle about 15 cm across',
    note: 'The sun warms one side at a time. The iron on that side expands, so the tower leans slightly away from the sun.',
    sourceIds: ['eiffel-size'],
    confidence: 'high',
  },
  { id: 'paint', label: 'Paint', value: '60 tonnes of paint', sourceIds: ['eiffel-history'], confidence: 'high' },
];

const LEARNING_VIEW = 'This is the 3D learning model, not a photo of the real floor.';

export const EIFFEL_STOPS: Stop[] = [
  {
    id: 'foundations',
    name: 'Foundations',
    heightM: -4,
    kind: 'foundation',
    description: 'The four concrete foundation blocks, a few metres below the ground. They are shown as a simple learning view: their real size and shape are not drawn exactly.',
    reconstructed: true,
    camera: { distance: 26, elevation: 26, azimuth: 30 },
  },
  {
    id: 'ground',
    name: 'Ground',
    heightM: 0,
    kind: 'ground',
    description: 'At the foot of the tower. Its four pillars stand on the corners of a square 125 m across.',
    reconstructed: false,
    camera: { distance: 26, elevation: 12, azimuth: 35 },
  },
  {
    id: 'first-floor',
    name: 'First floor',
    heightM: 57,
    kind: 'floors',
    description: `The first floor, 57 m up. ${LEARNING_VIEW}`,
    reconstructed: true,
    camera: { distance: 22, elevation: 10, azimuth: 40 },
  },
  {
    id: 'second-floor',
    name: 'Second floor',
    heightM: 115,
    kind: 'floors',
    description: `The second floor, 115 m up. ${LEARNING_VIEW}`,
    reconstructed: true,
    camera: { distance: 18, elevation: 8, azimuth: 45 },
  },
  {
    id: 'top-floor',
    name: 'Top floor',
    heightM: 276,
    kind: 'floors',
    description: `The top floor, 276 m up. ${LEARNING_VIEW}`,
    reconstructed: true,
    camera: { distance: 14, elevation: 6, azimuth: 50 },
  },
  {
    id: 'summit',
    name: 'Antennas and top',
    heightM: 330,
    kind: 'top',
    description: 'The antennas at the very top. With them the tower is 330 m tall. The antennas are drawn simply.',
    reconstructed: false,
    camera: { distance: 16, elevation: 4, azimuth: 30 },
  },
];

export const EIFFEL_PARTS: Part[] = [
  {
    id: 'foundations',
    name: 'Foundations',
    description: 'Each corner of the tower stands on its own concrete block, a few metres below the ground, on a layer of packed gravel. The blocks are joined to each other by walls.',
    sourceIds: ['eiffel-history'],
  },
  {
    id: 'pillars',
    name: 'Four pillars',
    description: 'The tower stands on four pillars on the corners of a square 125 m across. Each pillar is 25 m wide where it meets the ground.',
    sourceIds: ['eiffel-key-figures'],
  },
  {
    id: 'arches',
    name: 'Arches',
    description: "The big arches between the pillars come from the architect Stephen Sauvestre's design. The project was simplified, but the arches at the base were kept, and they help give the tower its famous look.",
    sourceIds: ['eiffel-history'],
  },
  {
    id: 'first-floor',
    name: 'First floor',
    description: 'The first floor is 57 m above the ground. Its floor covers 4,415 square metres.',
    sourceIds: ['eiffel-key-figures'],
  },
  {
    id: 'legs',
    name: 'Lattice legs',
    description: 'The four legs are lattice girders: criss-crossing iron bars instead of solid walls. They start apart at the bottom and come together at the top, joined by more girders on the way up.',
    sourceIds: ['eiffel-history'],
  },
  {
    id: 'second-floor',
    name: 'Second floor',
    description: 'The second floor is 115 m above the ground. Its floor covers 1,430 square metres.',
    sourceIds: ['eiffel-key-figures'],
  },
  {
    id: 'upper-tower',
    name: 'Upper tower',
    description: 'Above the second floor the four legs come together and rise as one tall lattice tower.',
    sourceIds: ['eiffel-history'],
  },
  {
    id: 'top',
    name: 'Top floor',
    description: 'The top floor is 276 m above the ground and covers 250 square metres.',
    sourceIds: ['eiffel-key-figures'],
  },
  {
    id: 'antennas',
    name: 'Antennas',
    description: 'Radio and television antennas were added at the top in 1957, 2000 and 2022. With them, the tower is 330 m tall.',
    sourceIds: ['eiffel-size', 'eiffel-key-figures'],
  },
];

export const EIFFEL_HOTSPOTS: Hotspot[] = [
  {
    id: 'puddled-iron',
    partId: 'pillars',
    title: 'Made of puddled iron',
    text: 'The whole tower is made of puddled iron: almost pure iron, made by refining cast iron to remove extra carbon. It came from the Forges de Pompey near Nancy. Eiffel trusted iron, which he had used in all his earlier buildings.',
    sourceIds: ['eiffel-material'],
  },
  {
    id: 'rivets',
    partId: 'legs',
    title: '2.5 million rivets',
    text: 'The 18,038 iron parts are held together by 2,500,000 rivets. It took a team of four workers to put in each rivet, and only a third of them were put in on the building site: the rest were fitted at the factory.',
    sourceIds: ['eiffel-history', 'eiffel-key-figures'],
  },
  {
    id: 'gentle-pressure',
    partId: 'foundations',
    title: 'Gentle on the ground',
    text: 'Each corner block presses on the ground with about 3 to 4 kilograms on every square centimetre. On the side near the river Seine, workers dug inside watertight metal boxes filled with compressed air, called caissons, so they could work below the level of the water.',
    sourceIds: ['eiffel-history'],
  },
  {
    id: 'shaped-by-wind',
    partId: 'upper-tower',
    title: 'Shaped by the wind',
    text: "The curve of the legs was calculated so the tower resists the wind well. Eiffel's engineers learned how strong wind can be in 1884, when a gust of wind blew the deck of a viaduct they were building down into the valley.",
    sourceIds: ['eiffel-history', 'eiffel-viaducts'],
  },
  {
    id: 'tallest-tower',
    partId: 'top',
    title: 'Tallest in the world',
    text: 'When it was finished in 1889, the tower was 312 m tall: the tallest tower in the world until 1931. On the narrow platform at the top, Gustave Eiffel was awarded the Legion of Honour.',
    sourceIds: ['eiffel-size', 'eiffel-history'],
  },
];

/** Stages of the construction view (display bands of the learning model, not durations). */
export const EIFFEL_STAGES: Stage[] = [
  { id: 'site', name: 'The idea', description: 'The tower is designed and the patent is registered.', progress: 0 },
  { id: 'foundation', name: 'Foundations', description: 'Concrete foundation blocks are built under the four corners.', progress: CONSTRUCTION_PROGRESS.foundationDone },
  { id: 'structure', name: 'Iron structure', description: 'The four iron pillars rise and come together at the top.', progress: CONSTRUCTION_PROGRESS.structureDone },
  { id: 'complete', name: 'Today', description: 'The tower with the antennas added later.', progress: CONSTRUCTION_PROGRESS.complete },
];

/**
 * The construction story. Dates are the official site's; sort keys of
 * year-only entries use January for ordering only (the label shows the
 * year). Heights are documented floor heights; other entries are placed
 * between them by date, for display only.
 */
export const EIFFEL_TIMELINE: TimelineEntry[] = [
  {
    id: 'idea',
    dateLabel: 'June 1884',
    sortKey: '1884-06',
    title: 'The idea',
    text: "Maurice Koechlin and Émile Nouguier, the two chief engineers of Gustave Eiffel's company, have the idea of a very tall tower: four lattice columns, apart at the bottom and coming together at the top.",
    stage: 'site',
    builtHeightM: null,
    sourceIds: ['eiffel-history'],
    confidence: 'high',
  },
  {
    id: 'patent',
    dateLabel: '18 September 1884',
    sortKey: '1884-09',
    title: 'A patent',
    text: 'Gustave Eiffel registers a patent for a new way of building metal supports and pylons more than 300 m tall.',
    stage: 'site',
    builtHeightM: null,
    sourceIds: ['eiffel-history'],
    confidence: 'high',
  },
  {
    id: 'works-begin',
    dateLabel: '26 January 1887',
    sortKey: '1887-01',
    title: 'Digging begins',
    text: 'Work starts on the Champ-de-Mars in Paris. Building the foundations takes about five months.',
    stage: 'foundation',
    builtHeightM: null,
    sourceIds: ['eiffel-history'],
    confidence: 'high',
  },
  {
    id: 'pillars-begin',
    dateLabel: '1 July 1887',
    sortKey: '1887-07',
    title: 'The pillars start to rise',
    text: 'Workers begin to assemble the four iron pillars on their foundations, using parts made in Eiffel’s factory at Levallois-Perret.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['eiffel-history'],
    confidence: 'high',
  },
  {
    id: 'first-level-joined',
    dateLabel: '7 December 1887',
    sortKey: '1887-12',
    title: 'Joined at the first level',
    text: 'The big girders that join the four pillars at the first level are in place. Wooden scaffolds and sand boxes with jacks held the girders until they were exactly right.',
    stage: 'structure',
    builtHeightM: null,
    sourceIds: ['eiffel-history'],
    confidence: 'high',
  },
  {
    id: 'first-floor',
    dateLabel: '1 April 1888',
    sortKey: '1888-04',
    title: 'First floor finished',
    text: 'The first floor, 57 m above the ground, is finished. Steam cranes climb the tower as it grows, lifting the iron parts.',
    stage: 'structure',
    builtHeightM: 57,
    sourceIds: ['eiffel-history', 'eiffel-key-figures'],
    confidence: 'high',
  },
  {
    id: 'second-floor',
    dateLabel: '14 August 1888',
    sortKey: '1888-08',
    title: 'Second floor finished',
    text: 'The second floor, 115 m above the ground, is finished.',
    stage: 'structure',
    builtHeightM: 115,
    sourceIds: ['eiffel-history', 'eiffel-key-figures'],
    confidence: 'high',
  },
  {
    id: 'completed',
    dateLabel: '31 March 1889',
    sortKey: '1889-03',
    title: 'The tower is complete',
    text: 'The top is finished, 2 years, 2 months and 5 days after work began. At 312 m the tower is the tallest in the world. On the platform at the top, Gustave Eiffel is awarded the Legion of Honour.',
    stage: 'structure',
    builtHeightM: 312,
    sourceIds: ['eiffel-history', 'eiffel-size'],
    confidence: 'high',
  },
  {
    id: 'exposition',
    dateLabel: '15 May 1889',
    sortKey: '1889-05',
    title: 'The World’s Fair opens',
    text: 'The Exposition Universelle opens and runs until 6 November 1889. The tower welcomes about two million visitors during the fair.',
    stage: 'structure',
    builtHeightM: 312,
    sourceIds: ['eiffel-key-figures', 'eiffel-history'],
    confidence: 'high',
  },
  {
    id: 'record-passed',
    dateLabel: '1931',
    sortKey: '1931-01',
    title: 'No longer the tallest',
    text: 'The Empire State Building in New York, 381 m tall, becomes taller. The Eiffel Tower had been the tallest tower in the world for 42 years.',
    stage: 'structure',
    builtHeightM: 312,
    sourceIds: ['eiffel-size'],
    confidence: 'high',
  },
  {
    id: 'antennas',
    dateLabel: '1957, 2000 and 2022',
    sortKey: '2022-01',
    title: 'Antennas make it taller',
    text: 'Radio and television antennas are added at the top in 1957, 2000 and 2022. Today the tower is 330 m tall.',
    stage: 'complete',
    builtHeightM: null,
    sourceIds: ['eiffel-size', 'eiffel-key-figures'],
    confidence: 'high',
  },
];

export const EIFFEL_QUIZ: QuizQuestion[] = [
  {
    id: 'quiz-diagonal',
    question: 'How can you stop a four-sided frame from leaning over when you push it?',
    options: ['Add a diagonal bar', 'Make the bars longer', 'Paint it', 'Take a bar away'],
    correctIndex: 0,
    explanation: 'A diagonal bar splits the frame into two triangles. A triangle cannot change its shape unless one of its sides stretches or squashes, so the frame stays rigid.',
  },
  {
    id: 'quiz-eiffel-pressure',
    question: 'Each corner of the Eiffel Tower stands on a big concrete block. Why big?',
    options: [
      'To spread the force over a bigger area, so the pressure on the ground is smaller',
      'To make the tower taller',
      'To make the tower lighter',
      'So the tower can float on the river',
    ],
    correctIndex: 0,
    explanation: 'Pressure is force divided by area: P = F / A. A bigger block spreads the same force over more ground, so the pressure on the ground is smaller.',
  },
];

export const EIFFEL_LESSONS: Lesson[] = [
  {
    id: 'triangles',
    title: 'Why is the Eiffel Tower full of triangles?',
    subject: 'Engineering',
    summary: 'Push two frames and find out why triangles make the tower rigid and light.',
    steps: [
      {
        kind: 'experience',
        title: 'Look at the lattice',
        text: 'Look closely at the legs. They are not solid walls: they are lattice girders, made of many iron bars that cross each other. Can you find triangles?',
        focusPartIds: ['legs', 'pillars'],
        stopId: 'first-floor',
      },
      {
        kind: 'interact',
        title: 'Push the frames',
        text: 'Here are two pretend frames made of bars joined with pins, like a construction kit. Push the top of each frame sideways. What is different?',
        simulation: 'triangulation',
      },
      {
        kind: 'explain',
        title: 'What is going on?',
        text:
          'A frame with four sides can change its shape without any bar getting longer or shorter: it leans over into a slanted shape, and nothing stops it. Add one diagonal bar and the frame becomes two triangles. A triangle cannot change its shape unless one of its sides stretches or squashes, so the frame stays rigid. When you push, the diagonal is pulled (tension) or squashed (compression), depending on which way you push. ' +
          "The Eiffel Tower's legs are lattice girders full of triangles, so they are rigid and light at the same time, and the many openings let the wind blow through. Gustave Eiffel's company had already used the same kind of lattice on its tall metal viaducts.",
        focusPartIds: ['legs'],
      },
      {
        kind: 'check',
        title: 'Check your thinking',
        text: 'Answer one question to check what you found out.',
        quizId: 'quiz-diagonal',
      },
    ],
    caveat:
      'Educational simulation: the joints are pins and the bars are springs that hardly stretch. The real tower is riveted and every one of its parts was calculated by engineers. Movements are drawn much bigger than they really are.',
    sourceIds: ['galileo-frames', 'eiffel-history', 'eiffel-viaducts'],
  },
  {
    id: 'four-feet',
    title: 'How do four feet hold up a 10,000-tonne tower?',
    subject: 'Physics',
    summary: 'Follow the weight down the four pillars and discover why big foundation blocks keep the pressure on the ground gentle.',
    steps: [
      {
        kind: 'experience',
        title: 'Down to the foundations',
        text: 'Each of the four pillars stands on its own concrete block, a few metres below the ground. The arrows show the load path: the weight of the tower travelling down the pillars to the foundations.',
        focusPartIds: ['foundations', 'pillars'],
        stopId: 'foundations',
      },
      {
        kind: 'interact',
        title: 'Try the pressure experiment',
        text: 'This is a simulation with pretend "weight blocks", not the real tower. Change the number of floors and the foundation area, and watch the pressure meter.',
        simulation: 'foundation-pressure',
      },
      {
        kind: 'explain',
        title: 'What is going on?',
        text:
          'Pressure is force divided by area: P = F / A. The same force spread over a bigger area gives a smaller pressure. The weight of the tower travels down the four pillars into the four foundation blocks, and each block spreads it over the ground. ' +
          'The official website says each corner block presses on the ground with about 3 to 4 kilograms on every square centimetre. Real foundation design is more than one sum: engineers also study the soil, the water in the ground and how much the ground may settle, and they add safety margins.',
        focusPartIds: ['foundations'],
      },
      {
        kind: 'check',
        title: 'Check your thinking',
        text: 'Answer one question to check what you found out.',
        quizId: 'quiz-eiffel-pressure',
      },
    ],
    caveat: 'Simplified simulation with pretend weight blocks, not the real tower. Real foundation design also depends on the soil, the groundwater and safety factors.',
    sourceIds: ['eiffel-history', 'eiffel-key-figures'],
  },
];

export const EIFFEL_MISSIONS: Mission[] = [
  {
    id: 'find-pillar',
    title: 'Find a pillar',
    description: 'Find one of the four pillars the tower stands on.',
    kind: 'find-part',
    partIds: ['pillars'],
    reward: 'You found one of the four feet that carry the tower!',
  },
  {
    id: 'find-first-floor',
    title: 'Find the first floor',
    description: 'Find the first floor, 57 m up.',
    kind: 'find-part',
    partIds: ['first-floor'],
    reward: 'You found the first floor!',
  },
  {
    id: 'follow-the-weight',
    title: 'Follow the weight down',
    description: 'Tap the parts in order, from the top down to the ground: the top or the upper tower, then the second floor or the legs, then a pillar, then the foundations.',
    kind: 'tap-sequence',
    sequence: [['top', 'antennas', 'upper-tower'], ['second-floor', 'legs', 'first-floor'], ['pillars', 'arches'], ['foundations']],
    reward: 'You followed the load path from the top to the ground!',
  },
  {
    id: 'triangles',
    title: 'Discover the triangles',
    description: 'Finish the lesson about triangles.',
    kind: 'lesson',
    lessonId: 'triangles',
    reward: 'You know why triangles make the tower rigid!',
  },
  {
    id: 'brace-the-frame',
    title: 'Brace a frame',
    description: 'In the triangles lesson, push both frames: the one without a diagonal and the one with it.',
    kind: 'compare',
    lessonId: 'triangles',
    reward: 'You saw a diagonal stop a frame from folding!',
  },
  {
    id: 'pressure-puzzle',
    title: 'Pressure puzzle',
    description: 'Answer the question about the foundation blocks.',
    kind: 'quiz',
    quizId: 'quiz-eiffel-pressure',
    reward: 'You worked out why big blocks keep the pressure gentle!',
  },
  {
    id: 'watch-it-grow',
    title: 'Watch it grow',
    description: 'Watch the construction timeline to the end.',
    kind: 'timeline',
    reward: 'You watched the tower rise in 2 years, 2 months and 5 days!',
  },
];

export const EIFFEL_TOWER: RealLandmark = {
  id: 'eiffel-tower',
  name: 'Eiffel Tower',
  place: 'Paris, France',
  status: 'available',
  tagline: 'An iron tower built in just over two years',
  summary: 'A 330 m tall iron lattice tower in Paris, built for the 1889 World’s Fair.',
  disclaimer:
    'This is a simplified 3D model of the Eiffel Tower ("Eiffel Tower" by ingoenius, shared without copyright restrictions under CC0, via the 3D Model Repository). Its shapes and proportions are approximate, the underground foundations are a simple learning view, and inside views are not the real interiors.',
  model: { kind: 'glb', path: 'assets/realworld/landmarks/eiffel-tower/eiffel_tower_3dmr_model4_rev3.glb', fallbackBuilder: 'eiffel-tower' },
  heightM: EIFFEL_HEIGHT_M,
  facts: EIFFEL_FACTS,
  sources: EIFFEL_SOURCES,
  stops: EIFFEL_STOPS,
  parts: EIFFEL_PARTS,
  hotspots: EIFFEL_HOTSPOTS,
  stages: EIFFEL_STAGES,
  timeline: EIFFEL_TIMELINE,
  lessons: EIFFEL_LESSONS,
  quiz: EIFFEL_QUIZ,
  missions: EIFFEL_MISSIONS,
  subjects: ['Engineering', 'History', 'Materials', 'Physics'],
};
