// End-to-end test of the move paneslide.github.io -> paneslide.com, on this computer:
//   old.test:8795 = the OLD site (git commit OLD_REF) first, then the bridge (tools/build-bridge.js),
//   new.test:8796 = this repo (the new site). Both served like GitHub Pages (404.html for unknown paths).
//   PW=$(npm root -g)/playwright-core node tools/test-migration.js [OLD_REF=3ebc7d5]
const pw = require(process.env.PW || "playwright-core"), http = require("http"), fs = require("fs"), path = require("path"), cp = require("child_process");
const ROOT = path.join(__dirname, ".."), OLD_REF = process.argv[2] || "3ebc7d5", TMP = "/tmp/ps-migration";
const OLD = "http://old.test:8795", NEW = "http://new.test:8796";
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml" };
function serve(port, getRoot) {
  return http.createServer((q, s) => {
    const root = getRoot(); let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    let f = path.join(root, p), code = 200;
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { if (fs.existsSync(f + "/index.html")) { s.writeHead(301, { Location: q.url.replace(/^([^?]*)/, "$1/") }); return s.end(); } f = path.join(root, "404.html"); code = 404; }
    s.writeHead(code, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "max-age=600" }); s.end(fs.readFileSync(f));
  }).listen(port);
}
const STUB = "window.__gc=[];window.goatcounter={count:function(o){window.__gc.push(o)}};";
async function solve(p) { // play the current level to the end with the game's own hint engine
  for (let n = 0; n < 200; n++) {
    const st = await p.evaluate(() => PS.state.status); if (st !== "playing") return;
    const m = await p.evaluate(() => PS.E.nextMove(PS.puzzle, PS.state.pos)); if (!m) return;
    await p.evaluate(m => PS.swipe(m.pane, m.dir), m); await p.waitForFunction(() => !PS.busy); await p.waitForTimeout(40);
  }
}
const save = p => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("ps2:")) o[k] = localStorage.getItem(k); } return o; });
(async () => {
  fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP + "/old-site", { recursive: true });
  cp.execSync(`git -C ${ROOT} archive ${OLD_REF} | tar -x -C ${TMP}/old-site`);
  cp.execFileSync("node", [path.join(__dirname, "build-bridge.js"), TMP + "/bridge", NEW], { stdio: "inherit" });
  let oldRoot = TMP + "/old-site";
  const s1 = serve(8795, () => oldRoot), s2 = serve(8796, () => ROOT);
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--host-resolver-rules=MAP old.test 127.0.0.1, MAP new.test 127.0.0.1", "--unsafely-treat-insecure-origin-as-secure=" + OLD + "," + NEW] });
  const errs = [];
  const newCtx = async () => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: "Asia/Kolkata" });
    await ctx.route("https://gc.zgo.at/count.js", r => r.fulfill({ contentType: "text/javascript", body: STUB }));
    ctx.on("page", p => { p.on("pageerror", e => errs.push(p.url() + " " + e.message)); p.on("console", m => { if (m.type() === "error" && !/status of 404/.test(m.text())) errs.push(p.url() + " console: " + m.text()); }); });
    return ctx;
  };
  const gcPaths = p => p.evaluate(() => (window.__gc || []).map(o => o.path));
  try {
    // ---------- 1. a player with a save on the OLD site (installed offline app = service worker) ----------
    console.log("== save on the old origin, then the bridge");
    let ctx = await newCtx(), p = await ctx.newPage();
    await p.goto(OLD + "/?test=1&sw=1&tutorial=0&level=1"); await p.waitForFunction(() => window.PS && PS.state && PS.puzzle); await p.waitForTimeout(600);
    await solve(p); await p.waitForTimeout(1500);
    await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(500);
    const oldSave = await save(p);
    const swOld = await p.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).length }));
    ok(Object.keys(oldSave).length >= 2 && /"unlocked"|unlocked/.test(oldSave["ps2:levels"] || JSON.stringify(oldSave)), "old site saved progress: " + Object.keys(oldSave).join(", "));
    ok(swOld.regs === 1 && swOld.caches >= 1, `old site has its offline worker (${swOld.regs} worker, ${swOld.caches} cache)`);
    oldRoot = TMP + "/bridge"; // deploy the bridge on the old address
    await p.goto(OLD + "/"); await p.waitForURL(u => u.href.startsWith(NEW), { timeout: 15000 });
    await p.waitForFunction(() => window.PS_MIGRATION !== undefined && document.readyState === "complete"); await p.waitForTimeout(1200);
    ok(p.url() === NEW + "/", "landed on the same path on the new address, #import removed: " + p.url());
    ok(await p.evaluate(() => window.PS_MIGRATION) === "imported", "progress imported");
    const newSave = await save(p);
    const same = ["ps2:levels", "ps2:stats", "ps2:prefs"].filter(k => oldSave[k]).every(k => newSave[k] === oldSave[k]) && Object.keys(oldSave).every(k => k in newSave);
    ok(same, "the new site has the same save (levels, stats, prefs and every other ps2 key)");
    const unl = JSON.parse(newSave["ps2:levels"] || "{}").unlocked;
    ok(unl >= 2, "imported progress: level " + unl + " unlocked (level 1 solved on the old site)");
    const toast = await p.evaluate(() => (document.querySelector(".ps-toast") || {}).textContent || "");
    ok(/Your progress moved over/.test(toast), "toast: " + toast.replace(/[✕]/g, "").trim());
    await p.waitForTimeout(4500);
    ok((await gcPaths(p)).includes("event/migrated"), "GoatCounter event event/migrated sent: " + (await gcPaths(p)).join(", "));
    // the old worker is gone
    const q = await ctx.newPage(); await q.goto(OLD + "/robots.txt"); await q.waitForTimeout(1500);
    const swNow = await q.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, caches: (await caches.keys()).length }));
    ok(swNow.regs === 0 && swNow.caches === 0, `old address: worker unregistered and caches cleared (${swNow.regs} workers, ${swNow.caches} caches)`);
    await q.close();
    // second visit: no new import, no second event
    await p.goto(OLD + "/how-to-play/?x=1"); await p.waitForURL(u => u.href.startsWith(NEW), { timeout: 15000 }); await p.waitForTimeout(800);
    ok(p.url() === NEW + "/how-to-play/?x=1", "later visit keeps path and query: " + p.url());
    ok(await p.evaluate(() => window.PS_MIGRATION) === "kept", "later visit: existing save kept, nothing overwritten");
    await ctx.close();

    // ---------- 2. no save on the old site ----------
    console.log("== no save");
    ctx = await newCtx(); p = await ctx.newPage();
    await p.goto(OLD + "/guides/faq/?a=1"); await p.waitForURL(u => u.href.startsWith(NEW), { timeout: 15000 }); await p.waitForTimeout(800);
    ok(p.url() === NEW + "/guides/faq/?a=1", "no save: same path, no #import: " + p.url());
    ok(await p.evaluate(() => window.PS_MIGRATION === undefined && !document.querySelector(".ps-toast")), "no save: nothing imported, no toast");
    await p.goto(OLD + "/no/such/page?x=2"); await p.waitForURL(u => u.href.startsWith(NEW), { timeout: 15000 });
    ok(p.url() === NEW + "/no/such/page?x=2", "404 fallback keeps an unknown path: " + p.url());
    const html = await (await fetch("http://127.0.0.1:8795/guides/colour-mixing/")).text();
    ok(/<link rel="canonical" href="http:\/\/new\.test:8796\/guides\/colour-mixing\/">/.test(html) && /<noscript>[\s\S]*href="http:\/\/new\.test:8796\/guides\/colour-mixing\/"/.test(html), "bridge page has canonical + noscript link to the matching new URL");
    await ctx.close();

    // ---------- 3. a save on BOTH addresses: the new one is kept ----------
    console.log("== existing save on the new address");
    ctx = await newCtx(); p = await ctx.newPage();
    oldRoot = TMP + "/old-site";
    await p.goto(OLD + "/?test=1&tutorial=0&level=1"); await p.waitForFunction(() => window.PS && PS.state && PS.puzzle); await p.waitForTimeout(600); await solve(p); await p.waitForTimeout(1200);
    await p.evaluate(() => { const l = JSON.parse(localStorage.getItem("ps2:levels")); l.unlocked = 7; localStorage.setItem("ps2:levels", JSON.stringify(l)); });
    const oldB = await save(p);
    await p.goto(NEW + "/?tutorial=0"); await p.waitForFunction(() => window.PS_MIGRATION === undefined && document.readyState === "complete"); await p.waitForTimeout(800);
    await p.evaluate(() => { const l = JSON.parse(localStorage.getItem("ps2:levels") || "{}"); l.unlocked = 3; l.marker = "new-site"; localStorage.setItem("ps2:levels", JSON.stringify(l)); });
    const before = await save(p);
    oldRoot = TMP + "/bridge";
    await p.goto(OLD + "/"); await p.waitForURL(u => u.href.startsWith(NEW), { timeout: 15000 }); await p.waitForTimeout(1500);
    ok(p.url() === NEW + "/", "redirected, #import removed: " + p.url());
    ok(await p.evaluate(() => window.PS_MIGRATION) === "kept", "existing save detected");
    const after = await save(p);
    ok(JSON.parse(after["ps2:levels"]).marker === "new-site" && JSON.parse(after["ps2:levels"]).unlocked === 3 && after["ps2:levels"] !== oldB["ps2:levels"], "existing save NOT overwritten (unlocked 3, not the old 7)");
    ok(!(await p.evaluate(() => /moved over/.test((document.querySelector(".ps-toast") || {}).textContent || ""))), "no 'moved over' toast");
    await p.waitForTimeout(4500);
    ok(!(await gcPaths(p)).includes("event/migrated"), "no event/migrated");
    // a broken code is ignored
    await p.goto(NEW + "/archive/#import=PS1.broken"); await p.waitForTimeout(800);
    ok(p.url() === NEW + "/archive/" && await p.evaluate(() => window.PS_MIGRATION) === "bad", "a broken #import code is ignored and removed");
    await ctx.close();
  } catch (e) { ok(false, "crashed: " + (e.stack || e)); }
  ok(errs.length === 0, "no console errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  await b.close(); s1.close(); s2.close();
  console.log(fails ? `FAILED: ${fails}` : "OK: migration end to end"); process.exit(fails ? 1 : 0);
})();
