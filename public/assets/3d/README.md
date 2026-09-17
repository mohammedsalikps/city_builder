# 3D asset library

Every model here is registered in `src/data/assets.json` and loaded through
`src/visual/assets/AssetLibrary.ts`. Models are visual only: gameplay size,
collision, placement and challenge matching always come from
`src/data/objects.json`, and a model is fitted onto that gameplay transform.

## What is in this folder

- `kenney/` — real art from nine Kenney packs (all **CC0**). Only the models
  the game uses are copied; each pack keeps its own palette texture and its
  original `License.txt`. Do not edit or remove the licence files.
  - `building-kit/` — Kenney Building Kit: wall, floor, door, stairs, column.
  - `suburban/` — Kenney City Kit (Suburban) 2.0: houses, trees, fence,
    planter, garden paths, driveway.
  - `commercial/` — Kenney City Kit (Commercial) 2.1: shops, offices,
    skyscraper and low-detail skyline buildings.
  - `roads/` — Kenney City Kit (Roads): road tiles, bends, junctions, lamps,
    signs, traffic light, electricity poles, construction barriers, dumpster.
  - `industrial/` — Kenney City Kit (Industrial) 2.0: warehouses and factories,
    chimneys, tanks, shipping containers, solar panels, water tower, wind turbine.
  - `factory/` — Kenney Factory Kit 3.0: outdoor yard pieces only (crates, silo
    hoppers, gantry crane, machines, large pipe, traffic post).
  - `cars/`, `nature/`, `furniture/` — Kenney Car, Nature and Furniture kits:
    cars and trucks, trees, bushes, flowers, rocks, park props, bench.

  Every entry in `assets.json` also has a `kind` (residential, commercial,
  industrial, road, sidewalk, vehicle, tree, bush, rock, water,
  street-furniture, construction, furniture, decoration, utility) and optional
  `tags`, and city-kit models may list `palettes`: the pack's alternative
  colour atlases (`Textures/variation-*.png`, copied beside `colormap.png`)
  the world can draw them with. Sizes follow the visual scale policy in
  `src/visual/assets/scalePolicy.ts` (checked at boot). My World's valley (`src/visual/world/WorldComposer.ts`) picks its
  scenery by kind, so a newly classified model can appear there without code.

  The GLBs reference `Textures/colormap.png` next to them, so keep each pack's
  files and its `Textures/` folder together. Building-kit models are in
  metres; the city kits use one unit per road tile and are registered with
  `scale: 7` (7 m road tiles).
- `architecture/`, `vegetation/`, `vehicles/`, `props/`, `roads/`,
  `environment/` — **generated placeholders** (`npm run assets:placeholders`)
  for what the Kenney packs do not contain (cars, round bushes) and for the
  Step 16 pipeline tests. They are real GLB files meant to be replaced.

## Replacing or adding a model

1. Export as `.glb` (preferred) or `.gltf`. Meshopt compression is supported.
2. Put it in the matching folder (or a `kenney/<pack>/` folder for Kenney art,
   with the pack's texture and licence beside it).
3. Register or update the entry in `src/data/assets.json`:
   - `scale`, `rotationY` (degrees) and `offset` correct the file so that it is
     in metres, Y up, front facing +Z, bottom-centre at the origin.
   - `recenter: true` moves the corrected model onto its bottom-centre, for
     files whose origin sits on an edge or a door hinge.
   - `footprint` / `bounds` describe the corrected size.
   - `materials`: `"embedded"` keeps the file's own materials (use this for
     finished art such as the Kenney models); `"library"` rebinds materials by
     name to the game's shared PBR library (plaster, brick, stone, roof_tile,
     wood, trim, glass, metal, paint, rubber, asphalt, marking, grass, soil,
     bark, foliage, fabric).
   - `textureFilter: "palette"` turns off mipmapping for colour-atlas textures
     so distant models do not blend neighbouring swatches.
   - `source` names the pack the file came from.
   - optional `surface` (roughness/metalness), `variants` (tint by material
     name), `animations.autoplay`, `lod`.
4. To use a model for a construction object, set `visual: { asset, fit }` on
   the object in `objects.json`. `fit` is `stretch` (scale each axis to the
   gameplay box: walls, floors, roads), `height` (uniform scale to the gameplay
   height: doors, trees, lamps) or `contain` (uniform scale to fit inside).
5. Keep textures at 1K or 2K, prefer shared texture sets, keep triangle counts
   modest (houses ~5-20k, props ~0.5-3k, trees ~1-5k, vehicles ~5-15k).

A missing or broken file never breaks the game: a grey box of the registered
`bounds` is shown and a warning is logged.
