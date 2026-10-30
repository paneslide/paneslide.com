#!/usr/bin/env node
/* PaneSlide: build the BRIDGE for the old address paneslide.github.io (repo paneslide/paneslide.github.io).
   Usage:  node tools/build-bridge.js <outDir> [target=https://paneslide.com]
   Every old page (all sitemap URLs, /index.html and the 404.html fallback for anything else) becomes a tiny page that:
   - reads the old save (all ps2:* keys in localStorage) and packs it into the usual progress code (PS1.…),
   - sends the player to the SAME path (and ?query) on the new address with location.replace,
     adding #import=<code> only when a save exists (js/migrate.js on the new site imports it),
   - has rel=canonical to the matching new URL and a plain link for no-JavaScript visitors.
   sw.js is replaced by a worker that deletes every cache and unregisters itself, so installed apps
   stop serving the old cached game and reach the bridge. The old repo must NOT get a custom domain. */
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const OUT = path.resolve(process.argv[2] || "/workspace/paneslide-bridge");
const TARGET = (process.argv[3] || "https://paneslide.com").replace(/\/+$/, "");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
// the same format as progressCode() in js/game.js
const script = `(function(){var T=${JSON.stringify(TARGET)},c="";try{var d={},n=0;for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf("ps2:")===0){d[k]=localStorage.getItem(k);n++;}}if(n){var t=new Date(),p=function(x){return(x<10?"0":"")+x;};c="PS1."+btoa(unescape(encodeURIComponent(JSON.stringify({app:"paneslide",v:1,at:t.getFullYear()+"-"+p(t.getMonth()+1)+"-"+p(t.getDate()),data:d}))));}}catch(e){c="";}location.replace(T+location.pathname+location.search+(c?"#import="+encodeURIComponent(c):location.hash));})();`;
const page = (p, isFallback) => {
  const url = TARGET + p;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PaneSlide has moved to paneslide.com</title>
<link rel="canonical" href="${esc(url)}">${isFallback ? `\n<script>(function(){var l=document.querySelector('link[rel=canonical]');if(l)l.href=${JSON.stringify(TARGET)}+location.pathname;})();</script>` : ""}
<script>${script}</script>
<style>body{font:18px/1.5 system-ui,sans-serif;background:#FFFDF8;color:#2B1B4A;text-align:center;padding:12vh 20px}a{color:#6A2FB8;font-weight:600}</style>
</head>
<body>
<h1>PaneSlide has moved</h1>
<p>PaneSlide now lives at <a id="go" href="${esc(url)}">${esc(url.replace(/^https?:\/\//, ""))}</a>. Taking you there…</p>
<noscript><p>JavaScript is off, so we can't bring your saved progress along automatically. <a href="${esc(url)}">Open PaneSlide at its new address</a>. You can move progress by hand with Settings → Move progress.</p></noscript>
${isFallback ? `<script>(function(){var a=document.getElementById("go");if(a){a.href=${JSON.stringify(TARGET)}+location.pathname+location.search;a.textContent=a.href.replace(/^https?:\\/\\//,"");}})();</script>\n` : ""}</body>
</html>
`;
};
const sw = `/* PaneSlide moved to paneslide.com. This worker replaces the old offline-app worker on paneslide.github.io:
   it deletes every cache, unregisters itself and reloads open pages, so they load the bridge page from the network. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) await caches.delete(k);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) { try { c.navigate(c.url); } catch (err) {} }
})()));
// no fetch handler: every request goes straight to the network
`;
// every page path: from the sitemap of the real site
const sm = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
const paths = [...sm.matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map(m => m[1]);
if (paths.length < 10) throw new Error("build-bridge: sitemap has too few URLs");
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 3 }); // keeps nothing; the caller re-adds .git if it is a clone
const write = (f, s) => { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
for (const p of paths) write(p.endsWith("/") ? p + "index.html" : p, page(p, false));
write("index.html", page("/", false));
write("404.html", page("/", true));
write("sw.js", sw);
write(".nojekyll", "");
write("robots.txt", "User-agent: *\nAllow: /\n");
fs.copyFileSync(path.join(ROOT, "favicon.svg"), path.join(OUT, "favicon.svg"));
write("README.md", `# paneslide.github.io: bridge to paneslide.com

PaneSlide moved to **https://paneslide.com** (source: https://github.com/paneslide/paneslide.com).

Every page here sends visitors to the same path on paneslide.com. When the browser has an old save, the progress code is added as \`#import=<code>\` and the new site imports it (only if it has no save yet). \`sw.js\` clears the old offline caches and unregisters itself so installed apps move over too.

Generated by \`node tools/build-bridge.js\` in the main repo. Do not set a custom domain on this repo.
`);
console.log(`bridge: ${paths.length} pages + index.html + 404.html + sw.js in ${OUT} -> ${TARGET}`);
