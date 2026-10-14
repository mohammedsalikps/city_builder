# RealWorld Explorer: the Golden Gate Bridge (model and content notes)

*Written 2026-10-14. Applies to `src/realworld/landmarks/goldenGateBridge.ts`
(content) and `src/realworld/models/GoldenGateBridgeModel.ts` (3D model).*

## What the 3D model is

- **Built in code by EAVARA.** It is not a scan, a photogrammetry model or an
  architectural model, and no third-party 3D file is used. The app labels it a
  "Simplified learning model" with a disclaimer saying it is approximate.
- **Why not a downloaded model:** the best candidate found (Poly Pizza
  "Golden Gate bridge" by Steren Giannini, CC-BY 3.0) could not be taken
  automatically, because that site's terms do not allow automated downloads.
  The 3D Model Repository had no bridge model, and the Smithsonian's 3D site
  blocked automated requests (the block was not bypassed). Google Maps, Earth
  and Street View data are not used.
- **Licence:** the model is EAVARA's own code, so no third-party model licence
  applies. No asset was added for it; it loads nothing from the network and
  needs no fallback file.

## Published figures the model uses

From the Golden Gate Bridge, Highway and Transportation District's
"Design & Construction Statistics" page
(<https://www.goldengate.org/bridge/history-research/statistics-data/design-construction-stats/>):

| Figure | Value used |
| --- | --- |
| Main span (between the towers) | 1,280 m (towers at +-640 m from the middle) |
| Side spans | 343 m each |
| Tower height above the water | 227 m |
| Roadway height above the water | about 67 m (at high tide) |
| Width | 27 m (cables and tower legs at its edges) |
| Tower leg base | about 10 m x 16 m |

The San Francisco tower pier height (44 ft above the water) comes from the
district's construction history page
(<https://www.goldengate.org/bridge/history-research/bridge-construction/construction/>).

## What is approximate or invented for display

- Tower setbacks, portal struts and cross bracing (shapes only).
- The cable sag (the cable dips to about 80 m in the middle; about 1/9 of the
  span) and the side-span curve.
- The thickness of the cables and suspender ropes, drawn thicker than the real
  0.92 m cables so they can be seen; the number and spacing of suspenders.
- Pier, fender wall, anchorage and headland shapes and sizes.
- The water and land around the bridge.
- Construction bands (how much is shown at each timeline step) are display
  values, not durations.

## Lessons and what they claim

- **Pull or squeeze?** (tension and compression): simplified force arrows on
  the cables, suspenders, towers, deck, anchorages and piers. Arrows are not to
  scale and are not engineering calculations.
- **How does a suspension bridge carry a load?** Separates *documented facts*
  (250 pairs of suspender ropes, two main cables of 27,572 wires each, two
  227 m towers, two 60,000-ton anchorages) from a *conceptual model*: a pretend
  cable made of two straight pieces meeting at the load (solved with the
  app's small truss solver). In that model a flatter cable pulls harder and
  the nearer tower carries more of the load. The lesson says the real bridge
  spreads loads through its stiff deck truss and many suspenders, so its
  numbers are different.
- Every lesson carries the caveat: "Educational model, not an engineering
  design calculation...".
- Force explanations follow PBS "Building Big"
  (<https://www.pbs.org/wgbh/buildingbig/bridge/susp_forces.html>,
  <https://www.pbs.org/wgbh/buildingbig/bridge/basics.html>).

## Timeline sources and caveats

Dates come from the district's "Key Dates in Bridge History"
(<https://www.goldengate.org/bridge/history-research/moments-events/key-dates/>)
and "Construction" pages. Where the two official pages give different dates
(for example when the north tower was finished, when the south tower was
finished, when deck work started and when the two halves were joined), the
timeline entry is marked medium confidence and says that the sources differ.

## Still to check before public release

- Legal review: whether the bridge's name and a recognisable depiction may be
  used in a commercial children's app (not verified; see
  `realworld-asset-licences.md`).
- A science teacher or engineer should review the lesson wording.
