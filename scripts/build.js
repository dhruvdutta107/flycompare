'use strict';
/**
 * Static build: compiles Tailwind -> one minified CSS file (no runtime Tailwind CDN), self-hosts fonts,
 * fingerprints CSS/JS filenames (so they can be cached for a year) and renders pages from web/layout.html.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const web = path.join(root, 'web');
const out = path.join(root, 'public');
const assets = path.join(out, 'assets');

const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10);
const mkdir = (p) => fs.mkdirSync(p, { recursive: true });

fs.rmSync(out, { recursive: true, force: true });
mkdir(path.join(assets, 'fonts')); mkdir(path.join(assets, 'js'));

// ---------- fonts (self-hosted from npm packages) ----------
const fontSrc = {
  'sora-600': ['@fontsource/sora/files/sora-latin-600-normal.woff2', 'Sora', 600],
  'sora-700': ['@fontsource/sora/files/sora-latin-700-normal.woff2', 'Sora', 700],
  'jakarta-400': ['@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-400-normal.woff2', 'Plus Jakarta Sans', 400],
  'jakarta-500': ['@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-500-normal.woff2', 'Plus Jakarta Sans', 500],
  'jakarta-600': ['@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-600-normal.woff2', 'Plus Jakarta Sans', 600],
  'jakarta-700': ['@fontsource/plus-jakarta-sans/files/plus-jakarta-sans-latin-700-normal.woff2', 'Plus Jakarta Sans', 700],
  material: ['@material-symbols/font-400/material-symbols-outlined.woff2', 'Material Symbols Outlined', 'normal'],
};
const fontUrl = {}; let fontFaces = '';
for (const [key, [pkgPath, family, weight]] of Object.entries(fontSrc)) {
  const buf = fs.readFileSync(path.join(root, 'node_modules', pkgPath));
  const name = `${key}.${hash(buf)}.woff2`;
  fs.writeFileSync(path.join(assets, 'fonts', name), buf);
  fontUrl[key] = `/assets/fonts/${name}`;
  fontFaces += `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:${key === 'material' ? 'block' : 'swap'};src:url(${fontUrl[key]}) format('woff2');}\n`;
}

// ---------- CSS ----------
const tmpCss = path.join(out, '.tmp.css');
execFileSync(process.execPath, [path.join(root, 'node_modules', 'tailwindcss', 'lib', 'cli.js'), '-c', path.join(root, 'tailwind.config.js'), '-i', path.join(web, 'css', 'input.css'), '-o', tmpCss, '--minify'], { stdio: 'inherit', cwd: root });
const css = fontFaces + fs.readFileSync(tmpCss, 'utf8');
fs.rmSync(tmpCss);
const assetMap = {};
const cssName = `app.${hash(css)}.css`;
fs.writeFileSync(path.join(assets, cssName), css);
assetMap['app.css'] = `/assets/${cssName}`;

// ---------- JS (fingerprinted copies) ----------
for (const f of fs.readdirSync(path.join(web, 'js'))) {
  if (!f.endsWith('.js')) continue;
  const buf = fs.readFileSync(path.join(web, 'js', f));
  const name = f.replace(/\.js$/, `.${hash(buf)}.js`);
  fs.writeFileSync(path.join(assets, 'js', name), buf);
  assetMap[`js/${f}`] = `/assets/js/${name}`;
}

// ---------- static files ----------
const publicRoot = ['favicon.svg', 'robots.txt'];
for (const f of fs.readdirSync(path.join(web, 'assets'))) {
  fs.copyFileSync(path.join(web, 'assets', f), path.join(publicRoot.includes(f) ? out : assets, f));
}

// ---------- pages ----------
const layout = fs.readFileSync(path.join(web, 'layout.html'), 'utf8');
const partial = (n) => fs.readFileSync(path.join(web, 'partials', `${n}.html`), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const resolveTokens = (html) => html
  .replace(/\{\{asset:([^}]+)\}\}/g, (_, k) => { if (!assetMap[k]) throw new Error(`Unknown asset ${k}`); return assetMap[k]; })
  .replace(/\{\{font:([^}]+)\}\}/g, (_, k) => { if (!fontUrl[k]) throw new Error(`Unknown font ${k}`); return fontUrl[k]; });

for (const file of fs.readdirSync(path.join(web, 'pages'))) {
  if (!file.endsWith('.html')) continue;
  let src = fs.readFileSync(path.join(web, 'pages', file), 'utf8');
  const m = /^<!--meta\s*([\s\S]*?)-->\s*/.exec(src);
  if (!m) throw new Error(`${file}: missing <!--meta {...} --> header`);
  const meta = JSON.parse(m[1]); src = src.slice(m[0].length);
  const page = file.replace(/\.html$/, '');
  let html = layout
    .replace('{{title}}', esc(meta.title))
    .replace('{{description}}', esc(meta.description || 'FlyCompare - compare fares across airlines and book with confidence.'))
    .replace('{{robots}}', meta.noindex ? '<meta name="robots" content="noindex"/>' : '')
    .replace('{{nav}}', meta.nav || '')
    .replace('{{page}}', page)
    .replace(/\{\{partial:([a-z-]+)\}\}/g, (_, n) => partial(n))
    .replace('{{content}}', () => src)
    .replace('{{scripts}}', (meta.scripts || []).map((s) => `<script src="{{asset:js/${s}.js}}" defer></script>`).join('\n'));
  html = resolveTokens(html);
  fs.writeFileSync(path.join(out, file), html);
}

// sitemap (indexable pages only)
const base = (process.env.SITE_URL || '').replace(/\/$/, '');
if (base) {
  const urls = ['index', 'offers', 'help'].map((p) => `<url><loc>${base}/${p === 'index' ? '' : p + '.html'}</loc></url>`).join('');
  fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  fs.appendFileSync(path.join(out, 'robots.txt'), `\nSitemap: ${base}/sitemap.xml\n`);
}
console.log(`Built ${fs.readdirSync(out).filter((f) => f.endsWith('.html')).length} pages -> public/ (css ${(css.length / 1024).toFixed(0)} KB)`);
