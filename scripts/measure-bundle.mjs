/**
 * Measures the production build in dist/ (run `npm run build` first):
 * what the first page load downloads (the entry script, its stylesheet and
 * anything index.html preloads), what is fetched only on demand (the
 * RealWorld Explorer chunks), and the asset folders. Sizes are raw and
 * gzipped (gzip level 9, close to what static hosts serve).
 *
 *   node scripts/measure-bundle.mjs           (a table)
 *   node scripts/measure-bundle.mjs --json    (the same numbers as JSON)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html not found: run `npm run build` first.');
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const referenced = new Set([...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]));
const assetsDir = join(dist, 'assets');
const files = readdirSync(assetsDir).filter((name) => /\.(js|css)$/.test(name));

const kb = (bytes) => Math.round(bytes / 10) / 100;
const measure = (rel) => {
  const data = readFileSync(join(dist, rel));
  return { file: rel, raw: data.length, gzip: gzipSync(data, { level: 9 }).length };
};

const initial = files.map((name) => `assets/${name}`).filter((rel) => referenced.has(rel)).map(measure);
const onDemand = files.map((name) => `assets/${name}`).filter((rel) => !referenced.has(rel)).map(measure);
const sum = (list, key) => list.reduce((total, item) => total + item[key], 0);

const folderSize = (dir) => {
  if (!existsSync(dir)) return { files: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const inner = folderSize(path);
      count += inner.files;
      bytes += inner.bytes;
    } else {
      count++;
      bytes += stat.size;
    }
  }
  return { files: count, bytes };
};

// The entry script must not carry RealWorld Explorer's landmark content any more.
const entry = initial.find((item) => item.file.endsWith('.js'));
const entryText = entry ? readFileSync(join(dist, entry.file), 'utf8') : '';
const landmarkLeaks = ['Golden Gate Bridge', 'Burj Khalifa', 'Eiffel Tower', 'suspender ropes'].filter((text) => entryText.includes(text));

const report = {
  initial: { js: initial.filter((i) => i.file.endsWith('.js')), css: initial.filter((i) => i.file.endsWith('.css')) },
  onDemand,
  totals: {
    initialJs: { raw: sum(initial.filter((i) => i.file.endsWith('.js')), 'raw'), gzip: sum(initial.filter((i) => i.file.endsWith('.js')), 'gzip') },
    initialCss: { raw: sum(initial.filter((i) => i.file.endsWith('.css')), 'raw'), gzip: sum(initial.filter((i) => i.file.endsWith('.css')), 'gzip') },
    onDemand: { raw: sum(onDemand, 'raw'), gzip: sum(onDemand, 'gzip') },
  },
  assets: {
    models3d: folderSize(join(dist, 'assets', '3d')),
    realworld: folderSize(join(dist, 'assets', 'realworld')),
    all: folderSize(dist),
  },
  landmarkTextInEntryScript: landmarkLeaks,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const row = (label, item) => console.log(`${label.padEnd(52)} ${String(kb(item.raw)).padStart(10)} kB  ${String(kb(item.gzip)).padStart(9)} kB gz`);
  console.log('First load (index.html and what it references):');
  for (const item of [...report.initial.js, ...report.initial.css]) row(`  ${item.file}`, item);
  row('  = initial JavaScript', report.totals.initialJs);
  row('  = initial CSS', report.totals.initialCss);
  console.log('Fetched only when needed:');
  for (const item of onDemand) row(`  ${item.file}`, item);
  row('  = on demand', report.totals.onDemand);
  console.log('Asset folders (fetched as each model or texture is needed):');
  console.log(`  dist/assets/3d          ${report.assets.models3d.files} files, ${kb(report.assets.models3d.bytes)} kB`);
  console.log(`  dist/assets/realworld   ${report.assets.realworld.files} files, ${kb(report.assets.realworld.bytes)} kB`);
  console.log(`  dist (everything)       ${report.assets.all.files} files, ${kb(report.assets.all.bytes)} kB`);
  console.log(landmarkLeaks.length === 0 ? 'Entry script carries no landmark text: OK' : `Entry script still contains: ${landmarkLeaks.join(', ')}`);
}
process.exit(landmarkLeaks.length === 0 ? 0 : 1);
