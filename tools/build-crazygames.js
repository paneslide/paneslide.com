#!/usr/bin/env node
/* PaneSlide: CrazyGames HTML5 build, "PaneSlide Levels" (build-only; nothing in the live site changes).
   Usage:  node tools/build-crazygames.js [outDir] [zipPath]
   Default: /workspace/paneslide-builds/crazygames  and  /workspace/paneslide-builds/paneslide-crazygames-YYYY-MM-DD.zip

   Made for a CrazyGames "Basic Launch" (no SDK) and its rules (docs.crazygames.com/requirements/...):
   - Levels mode only: no daily puzzle, no archive, no DAILY button, no daily result popup / daily stats / daily badge;
     the tutorial now hands over to level 1 (on the website it opens the daily)
   - no share buttons (they put the website address in the share text), no website intro block, footer, guides,
     mailto or "How to play" links; the only outbound links are Privacy and Terms (new tab), as CrazyGames allows
   - no service worker, manifest, install button or "new version - Refresh" toast; no SEO/Search Console tags
   - ads forced OFF (Basic Launch has ads disabled; only SDK ads are allowed anyway)
   - every path is relative; one HTML file (index.html) at the top of the zip
   - GoatCounter (cookie-free) stays, tagged so it never mixes with the website: page view /crazygames/,
     events crazygames/<event>; allow_frame is set for CrazyGames' iframe; Do Not Track / GPC still honoured;
     a small non-blocking notice on the home screen links Privacy and Terms (CrazyGames "User Consent" rule)
   - 16:9 iframes: a compact 3-column layout for short landscape frames (e.g. 800x450, 821x462, 907x510, 960x540)
     that the website would show as a tall phone layout needing scrolling (css/crazygames.css + game.js measure())
   - copy falls back to execCommand when the iframe blocks the Clipboard API (progress code)
   - <body> is the scroller (the level map and long popups scroll even if the frame has scrolling="no")
   - js/crazygames.js: focuses a dialog's main button (Chrome ignores autofocus in a cross-origin frame), stops
     the page scrolling with arrow keys/space/wheel outside scrollable parts, and blocks the context menu
   Every text patch is asserted, so the build fails loudly if the source changes under it. */
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const SITE = "https://paneslide.com";
const d = new Date(), pad = n => String(n).padStart(2, "0");
const DATE = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const OUT = path.resolve(process.argv[2] || "/workspace/paneslide-builds/crazygames");
const ZIP = path.resolve(process.argv[3] || `/workspace/paneslide-builds/paneslide-crazygames-${DATE}.zip`);
const TITLE = "PaneSlide Levels";
const EXT = `target="_blank" rel="noopener"`;
const LEGAL = `<a href="${SITE}/privacy/" ${EXT}>Privacy</a> · <a href="${SITE}/terms/" ${EXT}>Terms</a>`;

const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
function write(f, s) { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
function copy(f) { const p = path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), p); }
function patch(s, from, to, what) {
  const n = typeof from === "string" ? s.split(from).length - 1 : (s.match(new RegExp(from.source, from.flags.includes("g") ? from.flags : from.flags + "g")) || []).length;
  if (!n) throw new Error("build-crazygames: patch did not match: " + what);
  return s.replace(from, to);
}

// ---- index.html ----
function buildHtml() {
  let h = read("index.html");
  h = h.replace(/\n?<script src="\/?js\/migrate\.js\?v=[^"]*"><\/script>/g, ""); // the move-from-github.io importer is website-only
  // head: a plain title + description; no canonical/og/twitter/JSON-LD (they describe the website), no PWA bits
  h = patch(h, /<title>[^<]*<\/title>[\s\S]*?<link rel="stylesheet" href="css\/site\.css/,
    `<title>${TITLE}</title>\n<meta name="description" content="${TITLE}: a colour-glass sliding puzzle. Slide glass panes so the window matches the picture. Where glass overlaps, colours mix.">\n<link rel="icon" href="favicon.svg" type="image/svg+xml">\n<link rel="stylesheet" href="css/site.css`, "head");
  if (/manifest|apple-touch-icon|google-site-verification|canonical|og:|ld\+json/.test(h.split("</head>")[0])) throw new Error("build-crazygames: website head tags left");
  // the title says "PaneSlide Levels"
  h = patch(h, '<h1 class="title">Pane<span>Slide</span></h1>', '<h1 class="title">Pane<span>Slide</span><small class="cg-sub">Levels</small></h1>', "home title");
  // no daily: feature line, DAILY button
  h = patch(h, '<li><i class="ico pad" aria-hidden="true"></i><span><b>A new daily puzzle</b> for everyone, every day</span></li>',
    '<li><i class="ico pad" aria-hidden="true"></i><span><b>Mix the colours</b>: cyan, magenta and yellow glass blend where they overlap</span></li>', "daily feature line");
  h = patch(h, /\n  <button class="cbtn big blue" id="btnDaily">[\s\S]*?<\/button>/, "", "DAILY button");
  // no website block (intro text, ad slot, footer links, mailto, install button)
  h = patch(h, /<!--site-intro-->[\s\S]*?<!--\/site-intro-->\n/, "", "site intro + footer");
  // no share buttons
  h = patch(h, /\n    <button class="cbtn round blue" id="btnShare"[\s\S]*?<\/button>/, "", "daily share button");
  h = patch(h, /\n  <button class="cbtn round blue share-mini" id="btnLvShare"[\s\S]*?<\/button>/, "", "level share button");
  h = patch(h, /\n    <button class="cbtn round blue" id="btnMileShare"[\s\S]*?<\/button>/, "", "milestone share button");
  // install buttons
  h = patch(h, /\n?\s*<button[^>]*data-install[^>]*>[\s\S]*?<\/button>/g, "", "install buttons");
  // Esc closes CrazyGames' fullscreen, so don't advertise it as a game key (popups have a close button)
  h = patch(h, "\n      <dt><kbd>Esc</kbd></dt><dd>close a window</dd>", "", "Esc row");
  // settings: Privacy and Terms only, in a new tab
  h = patch(h, '<p class="set-links"><a href="/how-to-play/">How to play</a> · <a href="/guides/">Guides</a> · <a href="/privacy/">Privacy</a></p>',
    `<p class="set-links">${LEGAL}</p>`, "settings links");
  // home: short, non-blocking privacy notice (anonymous counts) with the two links
  h = patch(h, /(\n  <div class="home-meta">[\s\S]*?\n  <\/div>)/,
    `$1\n  <p class="cg-legal">Anonymous play counts, no cookies · ${LEGAL}</p>`, "home notice");
  // autofocus is ignored (and logged) in a cross-origin frame: js/crazygames.js focuses data-af buttons instead
  h = patch(h, / autofocus>/g, " data-af>", "autofocus");
  h = h.replace(/(src|href)="\/((?:js|css|fonts|site\.config)[^"]*)"/g, '$1="$2"');
  h = patch(h, "</head>", '<link rel="stylesheet" href="css/crazygames.css?v=cg1">\n</head>', "crazygames.css");
  h = patch(h, "</body>", '<script src="js/crazygames.js?v=cg1"></script>\n</body>', "crazygames.js");
  return h;
}

// ---- site.js: no ads, no service worker, no install prompt, tagged analytics ----
function buildSiteJs() {
  let s = read("js/site.js");
  s = patch(s, /\n  \/\/ ---------- offline app \(service worker\) ----------[\s\S]*?\n  window\.PaneSlideSite = /,
    "\n  // CrazyGames build: no offline worker, no update prompt and no install button.\n\n  window.PaneSlideSite = ", "remove SW + install");
  // no share buttons and no outbound share links here, so no visit can arrive from a shared link
  s = patch(s, /\n  \/\/ A visit from a shared link[^\n]*\n[^\n]*\n  if \(\/\[\?&\]ref=share[^\n]*/, "", "share arrival");
  s = patch(s, "function start() { loadAds(); loadAnalytics(); setupSW(); }", "function start() { loadAnalytics(); } // CrazyGames build: ads off, no service worker", "start()");
  s = patch(s, /\n  \/\/ ---------- ads \(off by default\) ----------[\s\S]*?\n  \}\n/, "\n  // CrazyGames build: no ad code at all (Basic Launch has ads disabled).\n", "remove ads code");
  s = patch(s, 'gc.count({ path: "event/" + p,', 'gc.count({ path: "crazygames/" + p,', "event prefix");
  s = patch(s, 'var s = document.createElement("script"); s.async = true;\n    s.setAttribute("data-goatcounter",',
    'var s = document.createElement("script"); s.async = true;\n' +
    '    // CrazyGames build: count inside the portal\'s iframe and tag the traffic. Page view: /crazygames/; events: crazygames/<event>.\n' +
    '    window.goatcounter = window.goatcounter || {}; window.goatcounter.allow_frame = true;\n' +
    '    window.goatcounter.path = function (p) { return /^crazygames\\//.test(p || "") ? p : "/crazygames/"; };\n' +
    '    s.setAttribute("data-goatcounter-settings", JSON.stringify({ allow_frame: true }));\n' +
    '    s.setAttribute("data-goatcounter",', "goatcounter settings");
  s = patch(s, "/* PaneSlide site helper", "/* CrazyGames build of js/site.js (made by tools/build-crazygames.js; do not edit here).\n   PaneSlide site helper", "header");
  return s;
}

// ---- game.js: levels only ----
function buildGameJs() {
  let s = read("js/game.js");
  s = patch(s, "/* PaneSlide game UI.", "/* CrazyGames build (\"PaneSlide Levels\") of js/game.js, made by tools/build-crazygames.js; do not edit here.\n   PaneSlide game UI.", "header");
  // no archive days from the URL
  s = patch(s, 'var date = /^\\d{4}-\\d{2}-\\d{2}$/.test(qs.get("date") || "") ? qs.get("date") : today;', "var date = today; // CrazyGames build: no daily / archive", "date param");
  // the daily puzzle is gone: anything that used to open it (end of tutorial, Skip) opens the next level
  s = patch(s, "  function startDaily() {\n", "  function startDaily() { startLevel(prog.unlocked); } // CrazyGames build: levels only, no daily puzzle\n  function dailyUnused() {\n", "startDaily");
  s = patch(s, '\n    var d = new Date(); $("calMon").textContent = d.toLocaleString("en", { month: "short" }).toUpperCase(); $("calDay").textContent = d.getDate();', "", "home calendar");
  s = patch(s, '\n    var st = load("ps2:game:" + today, null), ds = $("dailyStat");', "", "home daily stat");
  s = patch(s, ' mark("daily", "btnDaily");', "", "daily coach mark");
  s = patch(s, /\n    if \(st && st\.status === "won"\) ds\.innerHTML[^\n]*\n[^\n]*\n[^\n]*ds\.innerHTML = "<span class='new'>NEW<\/span>";/, "", "home daily badge");
  s = patch(s, '\n    $("btnDaily").addEventListener("click", startDaily);', "", "DAILY listener");
  s = patch(s, '\n  else if (qs.get("mode") === "daily" || practice) startDaily();', "", "?mode=daily");
  // tutorial end popup: no share button any more
  s = patch(s, ' $("btnShare").hidden = true;', "", "share hide");
  s = patch(s, '$("btnShare").hidden = false; ', "", "share show");
  s = patch(s, '\n    $("btnShare").addEventListener("click", onShareBtn);', "", "share listener");
  s = patch(s, /\n    \$\("btnLvShare"\)\.addEventListener[^\n]*/, "", "level share listener");
  s = patch(s, /\n    \$\("btnMileShare"\)\.addEventListener[^\n]*/, "", "milestone share listener");
  // stats: no daily section; badges: no "Daily solver"
  s = patch(s, /var h = "<div class='sect'><i class='ico pad'><\/i>Daily<\/div>[\s\S]*?\}\)\.join\(""\) \+ "<\/div>";\n    h \+= "<div class='sect'><i class='ico medal'><\/i>Levels/,
    "var h = \"<div class='sect'><i class='ico medal'></i>Levels", "daily stats");
  s = patch(s, /\n    \["daily5", [^\n]*/, "", "daily badge");
  // copy fallback (the portal's iframe may not grant clipboard-write)
  s = patch(s, "if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);",
    "if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(function () { return copyOld(t); });\n    return copyOld(t);\n  }\n  function copyOld(t) {", "copyText fallback");
  // <body> is the scroller (css/crazygames.css)
  s = patch(s, "    window.scrollTo(0, 0);\n  }", "    document.body.scrollTo(0, 0);\n  }", "scroll to top");
  s = patch(s, "window.scrollTo(0, Math.max(0, window.scrollY + r.top", "document.body.scrollTo(0, Math.max(0, document.body.scrollTop + r.top", "map scroll");
  if (/window\.scroll(To|Y|By)\b/.test(s)) throw new Error("build-crazygames: game.js still scrolls the window");
  // 16:9 frames: short landscape frames get the 3-column layout too (css/crazygames.css, same test)
  s = patch(s, "function isDesk() { return window.innerWidth >= 960 && window.innerHeight >= 560; }",
    "function isLand() { var W = window.innerWidth, H = window.innerHeight; return W >= 640 && H >= 340 && W >= H * 1.3 && !(W >= 960 && H >= 560); } // CrazyGames build: short 16:9 frames\n" +
    "  function isDesk() { return window.innerWidth >= 960 && window.innerHeight >= 560 || isLand(); }", "isDesk");
  s = patch(s, "    if (desk) avail -= PAD * 2 + GAP * (n - 1);\n",
    "    if (isLand()) avail = Math.min(W - 2 * (W >= 900 ? 210 : 180) - 2 * 18 - 24, 620);\n    if (desk) avail -= PAD * 2 + GAP * (n - 1);\n", "measure land width");
  s = patch(s, "var maxH = window.innerHeight - (desk ? 190 : ", "var maxH = window.innerHeight - (isLand() ? 128 : desk ? 190 : W < 700 && window.innerHeight <= 700 && window.innerHeight > W ? (mode === \"tutorial\" ? 330 : 430) : ", "measure land height");
  s = patch(s, "* (isDesk() ? 1.6 : 1))", "* (isLand() ? 1.05 : isDesk() ? 1.6 : 1))", "target size in short frames");
  return s;
}

// ---- css ----
function deskBlock() { // the website's 3-column desktop rules, reused for short 16:9 frames
  const css = read("css/style.css"), head = "@media (min-width: 960px) and (min-height: 560px) {";
  const i = css.indexOf(head); if (i < 0) throw new Error("build-crazygames: desktop media block not found");
  let depth = 0, j = i + head.length - 1;
  for (; j < css.length; j++) { if (css[j] === "{") depth++; else if (css[j] === "}" && --depth === 0) break; }
  return css.slice(i + head.length, j);
}
const LAND = "(min-width: 640px) and (min-height: 340px) and (min-aspect-ratio: 13/10) and (max-height: 559.98px), (min-width: 640px) and (max-width: 959.98px) and (min-height: 340px) and (min-aspect-ratio: 13/10)";
const CG_CSS = `/* CrazyGames build only (tools/build-crazygames.js). */
/* The frame may not scroll the page: <body> is the scroller (level map, long popups). */
html { height: 100%; overflow: hidden; overscroll-behavior: none; }
body { height: 100%; min-height: 0 !important; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; scrollbar-width: thin;
  -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; -webkit-touch-callout: none;
  padding: 0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); box-sizing: border-box; }
textarea, input { -webkit-user-select: text; user-select: text; }
/* "PaneSlide Levels" */
.title .cg-sub { display: block; margin-top: 4px; font-size: .42em; letter-spacing: 3px; color: #fff; text-transform: uppercase; -webkit-text-stroke: 1.5px #4630A8; text-align: center; }
.home-hero .title .cg-sub { text-align: inherit; }
/* privacy notice (non-blocking) */
.cg-legal { margin: 6px 0 0; font: 500 13px/1.4 "Fredoka", system-ui, sans-serif; color: rgba(255,255,255,.88); text-align: center; text-shadow: 0 1px 3px rgba(20,0,60,.5); }
.cg-legal a, .set-links a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.cg-legal a { color: #fff; }
/* home: no empty scroll space under the menu (the website leaves room for its intro text) */
@media (min-width: 960px) and (min-height: 560px) { body[data-view="home"] main { padding-bottom: 0; } .home { padding-bottom: 24px; } }
@media (min-width: 960px) and (min-height: 560px) and (max-height: 660px) {
  .home-hero { gap: 8px; } .home-hero .logo-big { zoom: .78; } .home-hero .title { font-size: 60px; }
  .home-feats { gap: 7px; margin-top: 8px; } .home-feats li { padding: 7px 14px; }
  .home-actions { gap: 14px; padding: 26px 30px 18px; } .home .cbtn.big { min-height: 68px; }
}
/* 960-1280 wide and up to 700 tall (1077x606, 1216x684, 1280x720): tighten the 3-column layout */
@media (min-width: 960px) and (max-height: 720px) and (min-height: 560px) {
  .play { column-gap: 22px; row-gap: 12px; padding-top: 8px; grid-template-columns: minmax(200px, 230px) auto minmax(200px, 230px); }
  .play > .goal, .keys { margin-top: 12px; }
  .play { grid-template-areas: "goal stage keys" "meter stage actions" ". stage ."; }
  .play > .actions { flex-wrap: nowrap; gap: 10px; align-self: center; }
  .keys { padding: 12px 14px; }
  .keys dl { gap: 5px 8px; font-size: 13px; }
  .keys p { margin-top: 8px; font-size: 12.5px; }
  .home { padding: 12px 0 24px; }
  .home-feats li { padding: 9px 14px; }
}
/* short 16:9 frames (800x450 ... 960x540): the 3-column layout, compact */
@media ${LAND} {${deskBlock()}}
@media ${LAND} {
  .hud { padding-top: max(6px, env(safe-area-inset-top)); padding-bottom: 4px; }
  .hud .cbtn.round { width: 40px; height: 40px; border-radius: 14px; }
  main { padding: 0 18px 8px; }
  .play { column-gap: 18px; row-gap: 8px; padding-top: 0; grid-template-columns: minmax(170px, 180px) auto minmax(170px, 180px); }
  .stage-wrap { margin-top: 28px; }
  .play > .goal { margin-top: 28px; padding: 8px 10px; gap: 6px; }
  .play > .goal::after { font-size: 13px; }
  .play > .meter { padding: 6px 10px 8px; }
  .play { grid-template-areas: "goal stage keys" "meter stage actions" ". stage ."; }
  .play > .actions { gap: 6px; align-self: center; flex-wrap: nowrap; }
  .keys dd { white-space: normal; }
  .play > .actions .cbtn.round { width: 40px; height: 40px; border-radius: 14px; }
  .play > .actions .cbtn svg { width: 22px; height: 22px; }
  .keys { margin-top: 28px; padding: 10px 12px; }
  .keys h2 { font-size: 15px; margin-bottom: 6px; }
  .keys dl { gap: 3px 6px; font-size: 12.5px; }
  .keys kbd { min-width: 18px; font-size: 11.5px; padding: 0 3px; }
  .keys p { margin-top: 6px; font-size: 12px; }
  .home { gap: clamp(24px, 5vw, 64px); padding: 4px 0 10px; }
  .home-hero { gap: 6px; max-width: 380px; }
  .home-hero .logo-big { zoom: .6; margin: 26px 0 28px 28px; }
  .home-hero .title { font-size: 50px; }
  .home-tag { font-size: 17px; }
  .home-feats { gap: 6px; margin-top: 6px; font-size: 14.5px; }
  .home-feats li { padding: 7px 12px; border-radius: 14px; }
  .home-feats .ico { width: 22px; height: 22px; }
  .home-actions { gap: 12px; padding: 20px 24px 16px; border-radius: 28px; }
  .home .cbtn.big { width: 270px; min-height: 62px; font-size: 27px; }
  .home-row .cbtn.round { width: 54px; height: 54px; }
  .home-meta { margin-top: 0; }
  dialog.panel[open] { max-height: calc(100dvh - 52px); padding-top: 38px; padding-bottom: 16px; }
  .medal-stage { zoom: .66; }
  @media (max-height: 480px) { .home-feats li:nth-child(3) { display: none; } }
}
/* short phones in portrait (e.g. 360x640): the website needs a little scrolling there; fit it on one screen */
@media (max-width: 699.98px) and (max-height: 700px) and (orientation: portrait) {
  .play { gap: 6px; }
  .stage-wrap { margin-top: 30px; }
  main { padding-bottom: 8px; }
  .meter { padding: 5px 14px 7px; gap: 3px; }
  .actions { gap: 10px; }
  .actions .cbtn.round { width: 48px; height: 48px; border-radius: 16px; }
  .actions .cbtn svg { width: 24px; height: 24px; }
}
@media (min-width: 960px) and (min-aspect-ratio: 13/10) and (max-height: 559.98px) { .play { grid-template-columns: minmax(190px, 210px) auto minmax(190px, 210px); } }
`;

const CG_JS = `/* CrazyGames build only (tools/build-crazygames.js). */
(function () {
  // In a cross-origin frame Chrome ignores autofocus: focus the dialog's main button (marked data-af) after
  // showModal(), as the website does with autofocus.
  var show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () {
    show.apply(this, arguments);
    var b = this.querySelector("[data-af]");
    if (b && document.hasFocus()) try { b.focus({ preventScroll: true }); } catch (e) {}
  };
  // CrazyGames "common fixes": game keys must not scroll the portal page around the frame, and no context menu.
  function scrollable(t) {
    for (var e = t; e && e !== document.body && e.nodeType === 1; e = e.parentElement) {
      if (e.tagName === "TEXTAREA" || e.tagName === "INPUT" || e.tagName === "DIALOG" || e.classList.contains("pscroll")) return true;
    }
    return document.body.dataset.view === "map";
  }
  window.addEventListener("keydown", function (e) {
    if ((e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === " " || e.key === "PageUp" || e.key === "PageDown") && !scrollable(e.target) && !e.defaultPrevented) {
      if (e.key !== " " || e.target === document.body) e.preventDefault();
    }
  });
  window.addEventListener("wheel", function (e) { if (!scrollable(e.target) && document.body.scrollHeight <= document.body.clientHeight + 1) e.preventDefault(); }, { passive: false });
  window.addEventListener("contextmenu", function (e) { if (!/^(TEXTAREA|INPUT)$/.test(e.target.tagName)) e.preventDefault(); });
})();
`;

// ---- build ----
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
write("index.html", buildHtml());
let cfg = read("site.config.js");
cfg = patch(cfg, /ADS_ENABLED:\s*(true|false)/, "ADS_ENABLED: false", "ads off");
cfg = patch(cfg, /GSC_VERIFICATION:\s*"[^"]*"/, 'GSC_VERIFICATION: ""', "gsc");
cfg = patch(cfg, "window.PANESLIDE_CONFIG = {", "window.PANESLIDE_CONFIG = {\n  BUILD: \"crazygames\",                          // CrazyGames build (tools/build-crazygames.js)", "config build tag");
write("site.config.js", cfg);
write("js/site.js", buildSiteJs());
write("js/game.js", buildGameJs());
copy("js/engine.js"); copy("js/levels.js");
write("css/style.css", read("css/style.css"));
write("css/site.css", patch(read("css/site.css"), "url(/fonts/fredoka-latin.woff2)", "url(../fonts/fredoka-latin.woff2)", "font url"));
write("css/crazygames.css", CG_CSS);
write("js/crazygames.js", CG_JS);
copy("fonts/fredoka-latin.woff2"); copy("fonts/OFL-Fredoka.txt"); copy("favicon.svg"); copy("credits.txt");

// ---- checks ----
const files = [];
(function walk(dir) { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(OUT);
const bad = [];
for (const f of files) {
  if (!/\.(html|js|css)$/.test(f)) continue;
  const s = fs.readFileSync(f, "utf8"), rel = path.relative(OUT, f);
  [/href=["']\//, /src=["']\//, /serviceWorker/, /url\(["']?\//, /manifest\.webmanifest/, /\bsw\.js\b/, /beforeinstallprompt/, /data-install/, /fetch\(["']\//,
   /requestFullscreen/, /adsbygoogle|googlesyndication/, /mailto|&#109;&#97;&#105;&#108;/, /\/guides\/|how-to-play/].forEach(re => { if (re.test(s)) bad.push(rel + ": " + re); });
  if (!/\.css$/.test(f) && /btnDaily|dailyStat|btnShare|btnLvShare|btnMileShare|archive\.html|\/archive\//.test(s)) bad.push(rel + ": daily/archive/share element left"); // (style.css keeps unused rules for them)
}
const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
const links = [...html.matchAll(/<a\b[^>]*>/g)].map(m => m[0]);
links.forEach(a => { if (!/href="https:\/\/paneslide\.com\/(privacy|terms)\/" target="_blank" rel="noopener"/.test(a)) bad.push("index.html: link other than Privacy/Terms: " + a); });
if (!/<title>PaneSlide Levels<\/title>/.test(html)) bad.push("index.html: title");
if (/[Dd]aily (puzzle|#)|DAILY/.test(html)) bad.push("index.html: daily text left");
if (bad.length) { console.error("build-crazygames: checks failed:\n  " + bad.join("\n  ")); process.exit(1); }
const bytes = files.reduce((a, f) => a + fs.statSync(f).size, 0);
if (files.length > 1500 || bytes > 50 * 1024 * 1024) { console.error("build-crazygames: over CrazyGames' limits (1500 files, 50 MB without the SDK)"); process.exit(1); }

fs.mkdirSync(path.dirname(ZIP), { recursive: true }); fs.rmSync(ZIP, { force: true });
const top = fs.readdirSync(OUT).map(f => path.join(OUT, f));
cp.execFileSync("python3", ["-m", "zipfile", "-c", ZIP, ...top], { stdio: "inherit" });
const list = cp.execFileSync("python3", ["-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);n=[i.filename for i in z.infolist() if not i.is_dir()];print(len(n));print('index.html' in n)", ZIP]).toString().trim().split("\n");
if (list[1] !== "True") { console.error("build-crazygames: index.html is not at the top of the zip"); process.exit(1); }
console.log(`CrazyGames build: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB in ${OUT}; ${links.length} outbound links (Privacy, Terms)`);
console.log(`zip: ${ZIP} (${list[0]} files, ${(fs.statSync(ZIP).size / 1024).toFixed(0)} KB), index.html at the top level`);
