# City Builder

A 3D construction game where players learn construction through challenges,
unlock building elements, and eventually create houses, villas, neighbourhoods,
cities, forests and custom worlds.

## Stack

- TypeScript (strict)
- three.js for the 3D world
- Vite for dev server and bundling
- Plain DOM for UI (no framework)

## Commands

```bash
npm install      # once
npm run dev      # dev server on http://localhost:5180
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build
```

## Structure

```
src/
  main.ts            bootstrap: finds DOM elements, creates Game, starts it
  game/              Game (composition root), GameLoop, GameMode
  state/             GameState shape, GameStore (observable store), actions
  world/             three.js scene: World, CameraController
  construction/      ConstructionObjectDefinition + ObjectRegistry (catalogue),
                     shapes/ (procedural geometry builders, one per ShapeId),
                     walls (wall frames, endpoints, corner joins, openings, wall geometry
                     with holes, connected-wall structure bounds),
                     PlacedObject (what the player built), bounds (AABB maths),
                     PlacementResolver (surface hit -> snapped, validated candidate),
                     ConstructionRenderer (data -> meshes), PlacementPreview (ghost),
                     ConstructionRaycaster, ConstructionController, constants
  input/             InputManager: PointerInput (canvas) + KeyboardInput (window)
  player/            PlayerProfile
  challenges/        Challenge Mode: Blueprint (target as data), Challenge (level),
                     ChallengeRegistry (validated JSON), ChallengeMatcher (pure matcher),
                     BlueprintRenderer (blue ghosts + build area), ChallengeSystem (glue)
  progression/       Progress types, stars (calculateStars), levelState (locked / available /
                     completed, next level), ProgressStorage (versioned localStorage),
                     ProgressionService (match result -> stars -> record -> save)
  ui/                UIManager, Screen base class, screens/, styles.css
  data/              JSON game content (objects.json, challenges.json) + loader index
  utils/             EventEmitter, id, math helpers
public/assets/       static assets (models, textures) served as-is
```

## Architecture rules

- `GameStore` is the single source of truth. Rendering and UI derive from it.
- State changes go through `GameActions`, never `store.setState` from UI or world code.
- Game content (objects, later levels/challenges) is JSON under `src/data/`,
  validated at boot by the relevant registry.
- Construction flow: `state.placedObjects` -> `ConstructionRenderer.sync()` -> meshes under
  `World.placementRoot`. Meshes are never the source of truth; the renderer mirrors state.
- Catalogue: every item is a definition in `src/data/objects.json` with a `category`, real
  metric `dimensions`, a `shape` id and colours. `src/construction/shapes` turns a definition
  into ONE merged, vertex-coloured geometry (bottom-centre origin, inside the dimensions box),
  cached per definition by `ConstructionResources`. One mesh per placed object keeps raycasting,
  selection, bounds and the blueprint matcher identical for a brick, a door or a car.
  Adding an object = adding JSON; adding a new look = adding one shape builder.
- Placement is generic first (ground / top / side + the object's snap rule), then the
  definition's `role` adds architecture:
  - `wall`: has two endpoints. Near another wall's end it snaps into a butt-joint corner
    (perpendicular) or continues it end to end (parallel). Four corners close a room exactly:
    2 m walls give a 2.2 m outer / 1.8 m inner square.
  - `opening` (door, window): needs a wall's side face. It takes the wall's rotation (R flips
    it), slides along the wall in 5 cm steps, sits centred in the wall's thickness at its
    `sillHeight`, and records the wall as `hostId`. The wall is rendered with a hole cut
    around every opening it hosts (per-wall geometry, rebuilt only when its openings change).
    Deleting a wall deletes its openings.
  - `floor`: 1.8 m tiles on a lattice; if a tile would run into a wall it slides the shortest
    distance so its edge meets the wall face, so it fills a room built from 2 m walls.
  - `roof`: only on top of walls/floors/beams/pillars; dropped on a wall it is centred over
    all walls connected to that wall.
- `placement.support` on a definition lists what an object may rest on (ground, support types
  or categories, top/side faces) plus a child-friendly `hint` shown when the preview goes red.
  Anything without rules can go anywhere.
- The placement ghost lives under `World.overlayRoot` and is never a placed object.
- Input: only `InputManager` attaches DOM listeners. Pointer events come from the canvas,
  so clicks on UI never reach the world. A press that moves is a camera drag, not a click.
- Placement rules live in `PlacementResolver` and are shared by the preview and the
  place action, so state never accepts a build the ghost would have shown as invalid.
  Ground: snap by the definition's rule (footprint / divisions, a fixed step, or the world
  grid). Top face: Y = support top, X/Z snapped relative to the support centre. Side face:
  pushed out along the face normal to touch exactly, slid along the face in snap steps,
  same course as the support. Undersides are refused. Overlap uses axis-aligned boxes
  (exact for quarter-turn rotations); touching faces are allowed.
- Removing an object leaves whatever rested on it in place (floating is allowed for now)
  and clears their `supportId`.
- Challenge Mode: a level is a `ChallengeDefinition` in `src/data/challenges.json` with a
  `reference` (what the player sees), a `buildOrigin` and a `blueprint` whose objects are
  positioned relative to that origin. Levels belong to a world (`worldId`, worlds in
  `src/data/worlds.json`); World 1 "Getting Started" has ten levels: Wall, Room, House,
  Wall with Window, Two Rooms, Furnished House, Garden, House with Driveway, Bedroom (a 4 m x 2 m
  room from long and plain walls, two large floors, bed, table, chair, door, window) and Living
  Room (four long walls, one large floor, sofa, table, armchair, door, window). Furniture targets
  in the interior levels use a per-object `positionTolerance` of 0.15 m (one 0.1 m snap cell in
  any direction); structure stays at 0.02 m. Adding a level =
  adding JSON; the campaign map (`WorldMapScreen`) and unlocking derive everything from the
  global level order and saved progress.
- Wall lengths are data: `wall_plain` (2.0 m), `wall_long` (2.2 m) and `wall_short` (1.8 m) share
  one wall implementation (role `wall`). A ring of four equal walls is a pinwheel whose interior is
  the wall length minus one thickness (2 m walls -> 1.8 m interior, 2.2 m walls -> 2.0 m interior,
  which fits the 2 m bed on `floor_large`). Two rooms can share one wall when the room widths add
  up: Level 5 uses six 2 m walls plus one 1.8 m wall and no back-to-back walls.
- Wall joins are found relative to the pointer, not the lattice-snapped position, so a wall aimed
  at a corner always sees that corner; both butt-in and run-past variants are offered.
- Each level may carry an optional `camera` hint (`target` relative to the build origin,
  `distance`, `azimuth`, `elevation` in degrees). `ChallengeSystem` passes it to
  `CameraController.frame`; a level without a hint gets the default three-quarter view.
- Floors slide clear of walls and of neighbouring floor tiles: each pass takes the smallest shift
  that leaves fewer obstacles overlapping, so tiles butt against walls and each other.
- The challenge panel can be collapsed to its header (Hide/Show) while building; it expands
  again on completion. The world map keeps the current level scrolled into view.
- Interior readability (presentation only, src/game/InteriorReadability.ts): while placing an
  object in a challenge, the unmatched blueprint targets of that object are the focus (a selected
  placed object is a focus too). Any wall or roof whose box crosses the line from the camera to a
  focus point is drawn faded by the renderer, with the doors and windows set into it. A box that
  contains the focus point is its host and never fades. The occluders of the placement targets
  are also passed to the placement ray (ConstructionController -> ConstructionRaycaster), which
  skips hits on exactly those ids and uses the next surface on the same ray, so a visible target
  is clickable. Only that ray changes: faded objects stay in state, keep their geometry, still
  count for overlap, support and matching, and still catch selection clicks. The check
  runs only when the camera moves or the relevant state changes; faded materials are cached
  clones, one per base material.
- Door and window ghosts are drawn slightly thicker than their host wall (1.5 cm proud of each
  face) so they stay visible once the wall is built. Their target position is unchanged.
- Furniture orientation is data: distinctOrientations on a definition (4 = every quarter turn is
  distinct, 2 = a half turn looks the same, 1 = rotation never matters; omitted = square
  footprint 1, otherwise 2). Objects with a front declare 4: chair, bed, sofa, stairs, car,
  streetlight. The matcher compares rotations with this rule only.
- Level-aware placement (src/challenges/PlacementTargets.ts, memoised per level and definition):
  the active blueprint tells the placement rules where an object's targets are and what they rest
  on. A wall with no neighbour to join snaps onto the nearest free target ghost whose rotation
  looks the same as the wall being placed, when the pointer is within the wall snap radius
  (0.75 m) of that ghost's footprint; the spot is then validated as usual, and the matcher still
  decides. When every target of an object names a support in the blueprint (furniture on a floor,
  the car on the driveway, the roof on walls), the level refuses it anywhere else, including the
  ground. Outside a level there are no targets, so free building keeps the catalogue rules.
- Known limits: floors snap to their own footprint lattice on open ground, so a floor lands on a
  blueprint position only after the walls around it exist (it is then pushed clear of them);
  opaque walls hide the interior from low camera angles, so furnishing needs the player to orbit;
  every object of a level is unlocked when the level starts.
  Blueprint objects may declare `host` (openings: must be set into the player's object matched
  to that target) and `support` (roofs: must rest on one of those targets). `rules.rotationMode`
  `anyQuarterTurn` lets the whole target be built rotated by 90 degree steps. The matcher pairs
  relation-free objects first, then related ones, nearest first, so build order never matters.
  `ChallengeSystem` re-runs `matchBlueprint` only when `placedObjects` or the active
  challenge changes and stores the result in `state.challengeMatch`. Correctness is judged on
  construction data only (definition, position within tolerance, quarter-turn rotation), never
  on pixels. Ground snapping is anchored to the build area centre so blueprint positions are
  reachable. Blueprint ghosts live under `World.overlayRoot`: never raycast, never in state.
- Progression: `ProgressionService` watches `state.challengeMatch`; when an attempt is
  completed it calls `calculateStars` (3 = nothing stray, 2 = fewer stray pieces than
  required pieces, 1 = otherwise) and records the result through an action. `progress`
  (completed ids + best stars, never decreasing) is saved to localStorage as a versioned,
  validated file whenever it changes; invalid saves fall back to clean progress. Level state
  is derived: first level available, level N available once N-1 is completed. Challenge Mode
  progress is separate from construction unlocks (future My World progression).
- Two modes share the core construction system: Challenge Mode (blueprint + matcher) and
  free building ("New Sandbox", the seed of the future My World mode).
- Navigation: main menu -> Challenge mode (world map) -> level; exiting or finishing a level
  returns to the map; Next Level follows the global level order.
- Controls while playing: click toolbar to pick, point at ground or an object and click to
  place, R / Shift+R rotate, Esc cancel or deselect, click a placed object to select,
  Delete / Backspace to remove.
- To add a UI screen: subclass `Screen`, register it in `UIManager.createScreens`,
  and list it under the relevant modes in `UIManager.SCREENS_BY_MODE`.

## Visual world and 3D assets (Step 16)

- `src/visual/` is presentation only. Gameplay (definitions, placed objects, placement, support,
  matching) never reads it.
  - `materials/MaterialLibrary.ts`: shared PBR materials (plaster, brick, stone, roof tile, wood,
    glass, metal, paint, asphalt, grass, soil, foliage, water...) with procedural tileable detail
    textures (`materials/textures.ts`) mapped in world space, so a tile or brick keeps its
    real-world size on any object. Construction objects use them via their catalogue `material`.
  - `assets/AssetRegistry.ts` + `src/data/assets.json`: data-driven model library (id, path,
    category, scale / rotation / offset correction, footprint, bounds, material binding, variants,
    animation, LOD, placeholder flag).
  - `assets/AssetLibrary.ts`: GLTFLoader (meshopt supported), load once and cache, cheap clones
    (SkeletonUtils), fit-to-gameplay-box, InstancedMesh batches, LOD, variant tints, animation
    mixers, disposal, and a fallback box + warning for missing files.
  - `environment/`: physically based sky (sky-only exposure), baked sky environment map, sun with
    shadows that follow the camera target, haze, a 1.8 km terrain with flat construction plateaus
    at exactly y = 0, hills, a lake and a mountain ring, water and clouds.
  - `scenery/Scenery.ts` + `src/data/scenery.json`: the neighbourhood around the sites (houses,
    street, sidewalks, lamps, fences, cars, gardens, park, windmill, instanced forests).
- The invisible flat `ground` plane in World is still the placement surface; terrain and scenery
  are never raycast. Catalogue objects may declare `visual: { asset, fit }`; the renderer then
  draws the model and keeps the gameplay mesh as an invisible raycast/selection proxy.
- Placeholder models are real GLB files generated by `npm run assets:placeholders`
  (scripts/generate-placeholder-assets.mjs). Replace any file in public/assets/3d with a real
  model under the same id to upgrade the look; see public/assets/3d/README.md.
- Camera: left drag orbits, right drag pans along the ground, wheel zooms to the cursor; keys 1-4
  ease to close / build / area / town views; menus slowly orbit the neighbourhood.

## Kenney art (Step 17)

- Real models from four CC0 Kenney packs live in `public/assets/3d/kenney/<pack>/` (only the
  files the game uses, each pack with its palette texture and original `License.txt`). The
  source packs themselves are untouched.
- Registry entries carry `source`, `recenter`, `textureFilter: "palette"` and `surface` besides
  the Step 16 fields. City kits are registered at `scale: 7` (7 m road tiles); the building kit
  is already metric.
- Construction objects with a Kenney model: walls (plain, long, short), floors, door, stairs,
  pillar, fence, tree, streetlight, road and sidewalk. The model is stretched or scaled onto the
  gameplay box from `objects.json`, which stays the only source of size, collision, placement
  and matching. A wall that hosts a door or window switches back to its procedural geometry
  (which has the real opening cut out) in the Kenney wall colour.
- Blueprint ghosts of those objects show the translucent model; the ghost's gameplay mesh stays
  the (invisible) part that is drawn for matching feedback, and ghosts are never raycast.
- No Kenney equivalent exists for window, gable roof, furniture, car, bush, flower, brick,
  block, beam or utility box; those keep their procedural or placeholder visuals.
- `src/data/scenery.json` is a Kenney neighbourhood: a 7 m-tile main street with a crossing,
  T-junction and driveway curb cuts, suburban houses with fenced gardens, lamps, traffic lights,
  a stop sign, a small works yard, parks, a side street into a commercial district with a
  low-detail skyline, and Kenney trees in the forests. Cars remain placeholders.
