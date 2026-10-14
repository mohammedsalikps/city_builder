# RealWorld Explorer — licences and legal-review notes

Last updated: 14 October 2026.

These notes record the licence of each downloaded asset and the questions a lawyer should review before public release. They are **not** legal advice, and they do not show that the product is legally compliant.

## Licences of the downloaded assets

| Asset | Licence | What it allows | Credit required? | Credit we show |
|---|---|---|---|---|
| Kloofendal 43d Clear (Pure Sky) HDRI, Greg Zaal, Poly Haven | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) ([Poly Haven licence page](https://polyhaven.com/license)) | Any use, including commercial, with no conditions | No (CC0) | "Sky and ground photos: Poly Haven (CC0)" in RealWorld Explorer. Poly Haven's API terms ask apps to make clear to users that the assets came from Poly Haven. |
| Sand 01 texture set, Poly Haven | CC0 1.0 | As above | No | As above |
| Concrete Floor 01 texture set, Poly Haven | CC0 1.0 | As above | No | As above |
| "Eiffel Tower" 3D model by ingoenius, from 3DMR model 4 revision 3 (originally BlendSwap 67944; the same model is on Wikimedia Commons as `File:Eiffel.stl`, licence reviewed there on 6 March 2019) | CC0 1.0 | Any use, including commercial | No (CC0) | Named in the landmark's model notes (the "Simplified learning model" badge) and in the RealWorld credits line |

The exact source, author and download details for each asset are in its `LICENSE.txt` next to the file, and in [realworld-asset-manifest.md](realworld-asset-manifest.md).

## Questions for legal review before public release

1. **Landmark names and likenesses.** The products are educational. The names "Burj Khalifa" and "Eiffel Tower" (or "Tour Eiffel"), and recognisable 3D depictions of these buildings, may be protected as trademarks or by image rights in some countries. This was **not verified** in this work.
   - The Eiffel Tower is run by SETE (Société d'Exploitation de la Tour Eiffel).
   - The Burj Khalifa is developed by Emaar.
   - The Golden Gate Bridge is run by the Golden Gate Bridge, Highway and Transportation District. Whether the bridge's name or a recognisable depiction needs permission for commercial products was **not verified**.
   - A review should confirm that naming and showing simplified models of these landmarks in a commercial children's app is permitted, and whether any notice is needed.
2. **Eiffel Tower illuminations.** SETE states that image rights apply to night filming because the tower's illuminations are protected. This comes from a search snippet of SETE's page; the page blocked direct fetch. RealWorld Explorer shows the tower only in daylight and does not reproduce the illuminations. Please keep it that way unless rights are cleared.
3. **Design and patent notice.** Wikimedia Commons tags 3D files with a general design- or patent-rights warning (`{{3dpatent}}`). The tower's design dates from 1884–1889 and is generally regarded as public domain, but a reviewer should confirm.
4. **Golden Gate Bridge model.** The best candidate (Poly Pizza, CC-BY 3.0) was not downloaded, because the site's terms forbid automated downloads. The app's bridge is built in code by EAVARA from published dimensions, so no third-party model licence applies to it. If the Poly Pizza model is added later by hand, CC-BY 3.0 needs a visible credit (author, title, licence link), and the app would then need a credits page that covers CC-BY items.
5. **Facts and quotations.** Landmark facts are short summaries in EAVARA's own words, and each carries its source (title, publisher, address) in the app for grown-ups. No copyrighted photos, diagrams or long quotations from the sources are reproduced. The Eiffel Tower facts come from the official website and the Galileo Educational Network; the Burj Khalifa facts come from the sources listed in its content file; the Golden Gate Bridge facts and timeline come from the bridge district's official pages (goldengate.org) and the force explanations from PBS "Building Big". Where the district's own pages give different dates, the timeline says so. A reviewer may want to confirm this use is acceptable for the target markets.
6. **Simplified and reconstructed views.** Every model is labelled as simplified or approximate. Inside and floor views are marked as learning views, not real interiors, and underground foundations are described as schematic. The app does not claim that any floor is publicly accessible, or that any model is an exact architectural or photographic record.

## What the app does to stay within the licences

- It uses only CC0 assets, so no credit is legally required. Poly Haven and the Eiffel Tower model's author are still credited, out of courtesy and to follow Poly Haven's API terms.
- No file was taken from behind a login, paywall or bot check, and no Google Maps, Earth or Street View data is used.
- Each asset folder keeps its licence file, and the ZIP delivery includes them.
