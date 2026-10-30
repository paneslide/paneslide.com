#!/usr/bin/env node
/* PaneSlide: itch.io HTML5 build (build-only; nothing in the live site changes).
   Usage:  node tools/build-itch.js [outDir] [zipPath]
   Default: /workspace/paneslide-builds/itch  and  /workspace/paneslide-builds/paneslide-itch-YYYY-MM-DD.zip

   What it does, compared with the website:
   - copies only the game (index.html, js, css, font, favicon) plus a small local archive.html;
     the 49 content pages are NOT bundled: links to them open https://paneslide.com/... in a new tab
   - every path is relative (itch serves the game from a sub-folder on html-classic.itch.zone)
   - no service worker, no manifest, no install button, no "new version - Refresh" toast
   - ads forced OFF
   - GoatCounter stays on but is tagged: page views count as /itch/ (and /itch/archive), events as itch/<event>
     (the website uses event/<event>), allow_frame is set so counts work inside itch's iframe;
     Do Not Track / Global Privacy Control are still honoured
   - copying a share text falls back to execCommand when itch's iframe blocks the Clipboard API
   - itch embeds with scrolling="no", so <body> is made the scroller (css/itch.css + game.js scroll calls)
   - css/itch.css: small build-only layout overrides for a 960x600 iframe
   - js/itch.js: focuses a dialog's main button (Chrome ignores autofocus in a cross-origin frame)
   Every text patch is asserted, so the build fails loudly if the source changes under it. */
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const SITE = "https://paneslide.com";
const d = new Date(), pad = n => String(n).padStart(2, "0");
const DATE = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const OUT = path.resolve(process.argv[2] || "/workspace/paneslide-builds/itch");
const ZIP = path.resolve(process.argv[3] || `/workspace/paneslide-builds/paneslide-itch-${DATE}.zip`);

const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
function write(f, s) { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
function copy(f) { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), p); }
function patch(s, from, to, what) {
  const n = typeof from === "string" ? s.split(from).length - 1 : (s.match(new RegExp(from.source, from.flags.includes("g") ? from.flags : from.flags + "g")) || []).length;
  if (!n) throw new Error("build-itch: patch did not match: " + what);
  return s.replace(from, to);
}

// ---- links: local game pages stay local, everything else opens the website in a new tab ----
function mapHref(u) {
  if (u === "/") return { local: "index.html" };
  if (/^\/\?(mode=daily|mode=levels|date=[\d-]+)$/.test(u)) return { local: "index.html" + u.slice(1) };
  if (u === "/archive/") return { local: "archive.html" };
  return { ext: SITE + u };
}
function rewriteHtml(html, page) {
  // head: no manifest, no PWA icons, no Search Console tag (it belongs to the website)
  html = patch(html, /<link rel="manifest"[^>]*>\n?/, "", page + " manifest");
  html = patch(html, /<link rel="apple-touch-icon"[^>]*>\n?/, "", page + " apple-touch-icon");
  html = patch(html, /<link rel="icon" href="\/icons\/[^"]*"[^>]*>\n?/, "", page + " png icon");
  html = patch(html, '<link rel="icon" href="/favicon.svg"', '<link rel="icon" href="favicon.svg"', page + " favicon");
  html = html.replace(/<meta name="google-site-verification"[^>]*>\n?/, "");
  // install buttons
  html = patch(html, /<button[^>]*data-install[^>]*>[\s\S]*?<\/button>/g, "", page + " install buttons");
  // autofocus is blocked in a cross-origin frame (Chrome logs an error each time a dialog opens): mark the
  // buttons data-af instead and focus them from js/itch.js once the dialog is open (the frame has focus by then)
  if (page === "index.html") html = patch(html, / autofocus>/g, " data-af>", page + " autofocus");
  // src="/x" and href="/x" on assets
  html = html.replace(/(src|href)="\/((?:js|css|fonts|site\.config)[^"]*)"/g, '$1="$2"');
  // remaining links
  html = html.replace(/\n?<script src="\/?js\/migrate\.js\?v=[^"]*"><\/script>/g, ""); // the move-from-github.io importer is website-only
  html = html.replace(/<a ([^>]*?)href=(["'])(\/[^"']*)\2([^>]*)>/g, (m, pre, q, u, post) => {
    const t = mapHref(u);
    if (t.local) return `<a ${pre}href=${q}${t.local}${q}${post}>`;
    return `<a ${pre}href=${q}${t.ext}${q} target="_blank" rel="noopener"${post}>`;
  });
  // mailto opens outside the iframe too
  html = html.replace(/<a href="(&#109;&#97;&#105;&#108;&#116;&#111;&#58;[^"]*)">/g, '<a href="$1" target="_blank" rel="noopener">');
  html = patch(html, "</head>", '<link rel="stylesheet" href="css/itch.css?v=itch">\n</head>', page + " itch.css");
  if (page === "index.html") html = patch(html, "</body>", '<script src="js/itch.js?v=itch"></script>\n</body>', page + " itch.js");
  return html;
}

// ---- site.js: no service worker, no install prompt, tagged analytics ----
function buildSiteJs() {
  let s = read("js/site.js");
  s = patch(s, /\n  \/\/ ---------- offline app \(service worker\) ----------[\s\S]*?\n  window\.PaneSlideSite = /,
    "\n  // itch build: no offline worker, no update prompt and no install button.\n\n  window.PaneSlideSite = ", "remove SW + install");
  s = patch(s, "function start() { loadAds(); loadAnalytics(); setupSW(); }", "function start() { loadAnalytics(); } // itch build: ads off, no service worker", "start()");
  s = patch(s, 'gc.count({ path: "event/" + p,', 'gc.count({ path: "itch/" + p,', "event prefix");
  s = patch(s, 'var s = document.createElement("script"); s.async = true;\n    s.setAttribute("data-goatcounter",',
    'var s = document.createElement("script"); s.async = true;\n' +
    '    // itch build: count inside itch\'s iframe and tag the traffic. Page views: /itch/ or /itch/archive; events: itch/<event>.\n' +
    '    var page = document.getElementById("archive") ? "/itch/archive" : "/itch/";\n' +
    '    window.goatcounter = window.goatcounter || {}; window.goatcounter.allow_frame = true;\n' +
    '    window.goatcounter.path = function (p) { return /^itch\\//.test(p || "") ? p : page; };\n' +
    '    s.setAttribute("data-goatcounter-settings", JSON.stringify({ allow_frame: true }));\n' +
    '    s.setAttribute("data-goatcounter",', "goatcounter settings");
  s = patch(s, "/* PaneSlide site helper", "/* itch.io build of js/site.js (made by tools/build-itch.js; do not edit here).\n   PaneSlide site helper", "header");
  return s;
}

// ---- game.js: copy fallback (itch's iframe has no clipboard-write permission in Chrome) ----
function buildGameJs() {
  let s = read("js/game.js");
  s = patch(s, "if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);",
    "if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(function () { return copyOld(t); });\n    return copyOld(t);\n  }\n  function copyOld(t) {",
    "copyText fallback");
  // itch embeds the game with scrolling="no", so the page itself can't scroll there. The build lets <body>
  // scroll instead (css/itch.css), so the level map and long dialogs stay reachable.
  s = patch(s, "    window.scrollTo(0, 0);\n  }", "    document.body.scrollTo(0, 0);\n  }", "scroll to top");
  s = patch(s, "window.scrollTo(0, Math.max(0, window.scrollY + r.top", "document.body.scrollTo(0, Math.max(0, document.body.scrollTop + r.top", "map scroll");
  if (/window\.scroll(To|Y|By)\b/.test(s)) throw new Error("build-itch: game.js still scrolls the window");
  return s;
}

// ---- css ----
const ITCH_CSS = `/* itch.io build only (tools/build-itch.js). Small fixes for itch's embed frame. */
/* itch's iframe has scrolling="no": the window can't scroll, so <body> becomes the scroller. */
html { height: 100%; overflow: hidden; overscroll-behavior: none; }
body { height: 100%; min-height: 0 !important; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
/* The intro card is website SEO text; inside itch keep just the footer links (they open the website). */
.home-site > .s-card, .home-site .ad-slot { display: none !important; }
/* 960x600 iframe (itch's default desktop size): the 3-column layout kicks in at 960x560,
   so tighten it to fit without scrolling. */
@media (min-width: 960px) and (max-height: 700px) and (min-height: 560px) {
  .play { column-gap: 22px; row-gap: 12px; padding-top: 8px; grid-template-columns: minmax(200px, 230px) auto minmax(200px, 230px); }
  .play > .goal, .keys { margin-top: 12px; }
  .keys { padding: 12px 14px; }
  .keys dl { gap: 5px 8px; font-size: 13px; }
  .keys p { margin-top: 8px; font-size: 12.5px; }
  .home { padding: 12px 0 40px; }
}
`;

// ---- build ----
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

write("index.html", rewriteHtml(read("index.html"), "index.html"));
write("archive.html", rewriteHtml(read("archive/index.html"), "archive.html"));

let cfg = read("site.config.js");
cfg = patch(cfg, /ADS_ENABLED:\s*(true|false)/, "ADS_ENABLED: false", "ads off");
cfg = patch(cfg, /GSC_VERIFICATION:\s*"[^"]*"/, 'GSC_VERIFICATION: ""', "gsc");
cfg = patch(cfg, "window.PANESLIDE_CONFIG = {", "window.PANESLIDE_CONFIG = {\n  BUILD: \"itch\",                                // itch.io build (tools/build-itch.js)", "config build tag");
write("site.config.js", cfg);

write("js/site.js", buildSiteJs());
write("js/game.js", buildGameJs());
copy("js/engine.js"); copy("js/levels.js");
write("js/archive.js", patch(read("js/archive.js"), 'var href = k === today ? "/?mode=daily" : "/?date=" + k;', 'var href = k === today ? "index.html?mode=daily" : "index.html?date=" + k;', "archive links"));

write("css/style.css", read("css/style.css"));
write("css/site.css", patch(read("css/site.css"), "url(/fonts/fredoka-latin.woff2)", "url(../fonts/fredoka-latin.woff2)", "font url"));
write("css/itch.css", ITCH_CSS);
write("js/itch.js", `/* itch.io build only (tools/build-itch.js). In a cross-origin frame Chrome ignores autofocus, so focus the
   dialog's main button (marked data-af) after showModal(), as the website does with autofocus. */
(function () {
  var show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () {
    show.apply(this, arguments);
    var b = this.querySelector("[data-af]");
    if (b && document.hasFocus()) try { b.focus({ preventScroll: true }); } catch (e) {}
  };
})();
`);
copy("fonts/fredoka-latin.woff2"); copy("fonts/OFL-Fredoka.txt"); copy("favicon.svg"); copy("credits.txt");

// ---- checks ----
const files = [];
(function walk(dir) { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(OUT);
const bad = [];
for (const f of files) {
  if (!/\.(html|js|css)$/.test(f)) continue;
  const s = fs.readFileSync(f, "utf8"), rel = path.relative(OUT, f);
  [/href=["']\//, /src=["']\//, /serviceWorker/, /url\(["']?\//, /manifest\.webmanifest/, /\bsw\.js\b/, /beforeinstallprompt/, /data-install/, /fetch\(["']\//].forEach(re => { if (re.test(s)) bad.push(rel + ": " + re); });
}
if (bad.length) { console.error("build-itch: root-absolute paths or PWA bits left:\n  " + bad.join("\n  ")); process.exit(1); }
const bytes = files.reduce((a, f) => a + fs.statSync(f).size, 0);
if (files.length >= 1000 || bytes >= 500e6) { console.error("build-itch: too big for itch"); process.exit(1); }

fs.mkdirSync(path.dirname(ZIP), { recursive: true }); fs.rmSync(ZIP, { force: true });
const top = fs.readdirSync(OUT).map(f => path.join(OUT, f));
cp.execFileSync("python3", ["-m", "zipfile", "-c", ZIP, ...top], { stdio: "inherit" });
const list = cp.execFileSync("python3", ["-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);n=[i.filename for i in z.infolist() if not i.is_dir()];print(len(n));print('index.html' in n)", ZIP]).toString().trim().split("\n");
if (list[1] !== "True") { console.error("build-itch: index.html is not at the top of the zip"); process.exit(1); }
console.log(`itch build: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB in ${OUT}`);
console.log(`zip: ${ZIP} (${list[0]} files, ${(fs.statSync(ZIP).size / 1024).toFixed(0)} KB), index.html at the top level`);
