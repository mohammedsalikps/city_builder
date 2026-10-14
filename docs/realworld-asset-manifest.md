# RealWorld Explorer — asset manifest

Last updated: 14 October 2026.

This manifest lists every downloaded file used by RealWorld Explorer, where it came from, how it was verified and how the app uses it. It also lists the assets that were not downloaded, and why. Licence details and legal-review notes are in [realworld-asset-licences.md](realworld-asset-licences.md).

All files live under `public/assets/realworld/`, and each folder has its own `LICENSE.txt`. The app loads them only when RealWorld Explorer is opened. The Eiffel Tower model loads only when its landmark is opened. Every file has a fallback, so a missing file never leaves a blank scene.

## Downloaded files

| File | Bytes | SHA-256 | Source | Author | Licence | Used for |
|---|---:|---|---|---|---|---|
| `environments/kloofendal_43d_clear_puresky_1k.hdr` | 1,184,531 | `de7ba9d0b070470dbb70d0144294c8708068df353537b26ab59c394707e84377` | [Poly Haven](https://polyhaven.com/a/kloofendal_43d_clear_puresky) | Greg Zaal | CC0 1.0 | Sky lighting and reflections for landmark scenes. Fallback: the app's built-in sky. |
| `materials/sand_01/sand_01_diff_1k.jpg` | 485,088 | `a73b90eaa6d675ef57e7d48a8cf23e1f412e353ab2e29cf73930b8ecd4e76875` | [Poly Haven](https://polyhaven.com/a/sand_01) | Poly Haven (individual author not recorded) | CC0 1.0 | Ground texture around the landmarks. Fallback: plain sand colour. |
| `materials/sand_01/sand_01_nor_gl_1k.jpg` | 877,821 | `73984aecdc35b1ffbc322d64b7f8d8165b06970d11f37dd47010609fcb532704` | Poly Haven | Poly Haven | CC0 1.0 | Downloaded with the set; **not used yet**. |
| `materials/sand_01/sand_01_rough_1k.jpg` | 189,667 | `ccb179b12c56a9032d60e4f4e2da690b3612a58e1784eb14576372690cdcd1cb` | Poly Haven | Poly Haven | CC0 1.0 | Downloaded with the set; **not used yet**. |
| `materials/concrete_floor_01/concrete_floor_01_diff_1k.jpg` | 755,740 | `db7c800f1464359b5f359fc743e82ac51b34e014fdfd53844f4af34bb1949229` | [Poly Haven](https://polyhaven.com/a/concrete_floor_01) | Poly Haven (individual author not recorded) | CC0 1.0 | Concrete of the Burj Khalifa raft and podium and the Eiffel Tower foundations. Fallback: plain colour. |
| `materials/concrete_floor_01/concrete_floor_01_nor_gl_1k.jpg` | 909,898 | `28be1f6fa82eeab137c84954bf7ea0f5d8a4434352d01c29f15e20926eb7227e` | Poly Haven | Poly Haven | CC0 1.0 | Downloaded with the set; **not used yet**. |
| `materials/concrete_floor_01/concrete_floor_01_rough_1k.jpg` | 354,529 | `f5239e1c6db5f0ddb4c2397e881a5938ab511386aab19a23c20d40f4ab2c181b` | Poly Haven | Poly Haven | CC0 1.0 | Downloaded with the set; **not used yet**. |
| `landmarks/eiffel-tower/eiffel_tower_3dmr_model4_rev3.glb` | 10,713,064 | `6cbbb7cbbfe55c1d32d32df40c6d99b89db24b2eaa83960d686a779b3d75826f` | [3D Model Repository (3DMR), model 4, revision 3](https://3dmr.eu/model/4), downloaded through its documented API | ingoenius (original, BlendSwap 67944); uploaded to 3DMR by n42k | CC0 1.0 | The Eiffel Tower landmark. Fallback: a simplified lattice tower built in code, labelled as such. |

The downloads were approved one by one in the session on 14 October 2026: the seven Poly Haven files, then the Eiffel Tower GLB. Poly Haven files came from its public API (`dl.polyhaven.org`), which needs no login or API key. The GLB came from `https://3dmr.eu/api/model/4/3`, with no login.

### Verification

- **Sizes and checksums:** the byte counts above match the downloads, and the SHA-256 values were computed from the files in `public/` on 14 October 2026.
- **Eiffel Tower GLB:**
  - glTF 2.0 binary from the generator obj2gltf, in metres with Y up.
  - 9 meshes, 40 materials and 34 embedded textures (PNG and JPEG, at most 1000 × 683 pixels, about 30 MB of GPU memory once decoded).
  - 86,230 triangles, about 120 m across and 300 m tall.
  - `npm run test:realworld` parses the real file headlessly (with the images removed, because Node cannot decode them). It checks all 86,230 triangles, the 300 m top, the height bands assigned to each part, opaque drawing, the construction steps and picking.
- **Rendering checked in the browser** (in-app browser, desktop and phone sizes, 14 October 2026):
  - the HDR sky lighting, the sand texture and the concrete on the Burj Khalifa;
  - the Eiffel Tower GLB:
    - fetched from the app's asset address with all 36 textured pieces decoded (for example 1000 × 683 pixels), and built as "downloaded" in about 0.5 s on this machine;
    - drawn in RealWorld Explorer with crisp cut-out lattice, in the complete, cutaway (foundations and load path) and construction views; the construction view for 1 April 1888 shows the tower up to the first floor only;
    - the built-in fallback model was drawn too, for comparison.
- **Screenshots:** `docs/screenshots/realworld-interior-2026-10-14/`.

## How the app loads these files

- `RealWorldScene` loads the sky and the two colour textures when RealWorld Explorer opens, and frees them when it closes.
- A landmark whose model is a downloaded file loads that file only when the child opens it, through `prepareLandmarkModel` in `src/realworld/loadModel.ts`. While it loads, the screen says "Getting the … model ready".
- If the file is missing, cannot be read, or loads but cannot be used, the landmark's built-in model is shown. The screen says so in the model notes ("The downloaded 3D model could not be loaded, so a simpler model built into the app is shown") and in EAVARA's welcome line. Tests cover all three cases.

## Built in code (no downloaded asset)

| Model | Why | How it is labelled |
|---|---|---|
| Burj Khalifa | No downloadable model with a licence compatible with commercial use was found without logging in (see below). | "Simplified learning model" badge and disclaimer; the foundation view and the floors between the ground and the top are marked "learning view". |
| Eiffel Tower fallback | Shown only if the downloaded model cannot be used. | The model notes and EAVARA's welcome say it is the simpler built-in model. |
| Eiffel Tower foundations and antennas | Not part of the downloaded model. | The foundations are described as a schematic learning view; the antennas are described as drawn simply. |
| Golden Gate Bridge (added 2026-10-14) | No model with suitable licence and download terms could be obtained automatically (see below). Built in code in `src/realworld/models/GoldenGateBridgeModel.ts`; it loads nothing from the network. | "Simplified learning model" badge and disclaimer: built in code, approximate, cables and suspenders drawn thicker, force arrows simplified and not engineering calculations. The underwater pier, the cable view and the tower top are marked "learning view". |

The Golden Gate model uses these published figures from the Golden Gate Bridge, Highway and Transportation District (goldengate.org, "Design & Construction Stats"): 1,280 m main span, 343 m side spans, towers 227 m above the water, roadway about 67 m above the water, 27 m wide, tower legs on 10 m x 16 m bases. The San Francisco pier height (44 ft) comes from the District's construction history page. Everything else (tower setbacks, cable sag, pier, anchorage and headland shapes) is a visual approximation, and the lesson's "flatter cable" is a pretend comparison.

## Assets not downloaded

| Wanted | Candidate found | Why not downloaded |
|---|---|---|
| Burj Khalifa 3D model | None suitable | No CC0 or commercial-use model was available without logging in. Sketchfab downloads need an account, and its public search API returned no downloadable CC0 Burj Khalifa. Poly Pizza, Poly Haven, Kenney, OpenGameArt and Wikimedia Commons had none. |
| Golden Gate Bridge 3D model | Poly Pizza "Golden Gate bridge" by Steren Giannini (CC-BY 3.0, GLB, 3,712 triangles) | The site's terms do not allow automated downloading. It was not downloaded. A person can download it by hand from the model page if the licence and credit requirements are accepted. The search was repeated on 2026-10-14 (3D Model Repository: no bridge model; Smithsonian: still blocked to automated requests), so the bridge is now built in code instead (see above). |
| Smithsonian 3D models | — | The site returned HTTP 403 and a bot check to automated requests. The check was not bypassed, and no relevant landmark model was found. |
| Google Earth, Maps or Street View, and Google Arts & Culture 3D | — | Not allowed by the brief without explicit permission, and Arts & Culture offers no download. |
| Normal and roughness maps (Poly Haven) | Downloaded | Kept for a later visual upgrade; not used yet (see table). |

## Delivery ZIP

`docs/realworld-assets-2026-10-14.zip` contains:

- the eight downloaded asset files with their `LICENSE.txt` files (12 files, same folder layout as `public/assets/realworld/`);
- `docs/realworld-asset-manifest.md` (this file) and `docs/realworld-asset-licences.md`;
- `docs/realworld-golden-gate-bridge.md`: the Golden Gate Bridge model and content notes. The bridge is built in code, so the ZIP has no bridge model file.

It was rebuilt on 2026-10-14 in the release-hardening pass so that the documents inside match the ones in `docs/`; the asset files did not change. Its checksum and contents are listed in that pass's final report. No asset in it was added without a licence that allows redistribution (all are CC0).
