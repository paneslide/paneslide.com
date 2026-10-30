// Tests the CrazyGames build (tools/build-crazygames.js) the way a portal shows it: inside a cross-origin iframe
// (scrolling="no", no clipboard permission) at CrazyGames' 16:9 sizes, full window on phones in portrait, and in
// the portal's fullscreen. Screenshots go to the shots folder.
//   1. serve the builds folder and a parent page on two host names, e.g.
//        (cd /workspace/paneslide-builds && python3 -m http.server 8783 --bind 127.0.0.1) &
//        (cd <dir with tools/crazygames-parent.html as parent.html> && python3 -m http.server 8784 --bind 127.0.0.1) &
//   2. PW=$(npm root -g)/playwright-core node tools/test-crazygames.js [shotsDir]
// game.test / parent.test map to 127.0.0.1 so the frame is cross-origin and not "localhost" (GoatCounter loads).
// All GoatCounter requests are intercepted and answered locally: nothing is sent to the real counter.
const pw = require(process.env.PW || "playwright-core");
const fs = require("fs"), path = require("path");
const SHOTS = path.resolve(process.argv[2] || "/workspace/paneslide-builds/crazygames-shots");
const GAME = "http://game.test:8783/crazygames/", PARENT = "http://parent.test:8784/parent.html";
const PREFS = { sound: true, music: true, tutDone: true, glideTut: true, mixSeen: ["C","M","Y"], marks: ["glide","stick","order","stars","undo","hint","stuck","map","rank","shard","gift","house","shop","music","daily","everyone","mix","new","boss","rule"] };
const SIZES = [[1280, 720], [960, 540], [907, 510], [821, 462], [1216, 684], [1077, 606], [1920, 1080], [1366, 768], [1536, 864], [1080, 607], [800, 450, "touch"]];
fs.mkdirSync(SHOTS, { recursive: true });
let bad = 0; const ok = (c, m) => { console.log(c ? "✓" : "✗", m); if (!c) bad++; };
const parentUrl = (src, o = {}) => PARENT + "?src=" + encodeURIComponent(GAME + src) + (o.full ? "&full=1" : "&w=" + (o.w || 1280) + "&h=" + (o.h || 720));

async function newCtx(b, opt = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1360, height: 820 } }, opt.ctx || {}));
  if (opt.prefs !== false) await ctx.addInitScript(p => { if (location.hostname === "game.test" && !localStorage.getItem("ps2:prefs")) localStorage.setItem("ps2:prefs", p); }, JSON.stringify(PREFS));
  if (opt.gpc) await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }); });
  await ctx.addInitScript(() => { window.__errs = []; addEventListener("error", e => window.__errs.push(String(e.message))); addEventListener("unhandledrejection", e => window.__errs.push("rejection: " + (e.reason && e.reason.message || e.reason))); });
  const log = { errors: [], http: [], gc: [] };
  ctx.on("console", m => { if (m.type() !== "error" && m.type() !== "warning") return; const t = m.text();
    if (/^Unrecognized feature: '|^Allow attribute will take precedence over 'allowfullscreen'/.test(t)) return; // parent page markup, not the game
    log.errors.push(m.type() + ": " + t + (m.location() && m.location().url ? " @ " + m.location().url : "")); });
  ctx.on("weberror", e => log.errors.push("pageerror: " + e.error().message));
  ctx.on("response", r => { if (r.status() >= 400) log.http.push(r.status() + " " + r.url()); });
  ctx.on("requestfailed", r => { if (!/goatcounter|paneslide\.com/.test(r.url())) log.http.push("failed " + r.url()); });
  ctx.on("request", r => { if (/goatcounter\.com\/count/.test(r.url())) log.gc.push(r.url()); });
  await ctx.route(/goatcounter\.com\/count/, r => r.fulfill({ status: 204, body: "" }));
  return { ctx, log };
}
async function frameOf(p) { await p.waitForSelector("#game_drop"); const f = await (await p.$("#game_drop")).contentFrame(); await f.waitForLoadState("load"); return f; }
async function frameBox(p) { return (await p.$("#game_drop")).boundingBox(); }
async function shot(p, name) { await (await p.$("#game_drop")).screenshot({ path: SHOTS + "/" + name + ".png" }); }
// how: "keys" (number key + arrow), "mouse" (a real mouse swipe on the pane), "touch" (a real finger swipe), "api"
async function solve(p, f, how) {
  const box = await frameBox(p);
  for (let g = 0; g < 60; g++) {
    if (await f.evaluate(() => PS.state.status) !== "playing") return true;
    const m = await f.evaluate(() => PS.E.nextMove(PS.puzzle, PS.state.pos)); if (!m) return false;
    if (how === "keys") {
      await p.keyboard.press(String(m.pane + 1)); await p.waitForTimeout(60);
      const ax = await f.evaluate(i => PS.puzzle.panes[i].axis, m.pane);
      await p.keyboard.press(ax === "h" ? (m.dir > 0 ? "ArrowRight" : "ArrowLeft") : (m.dir > 0 ? "ArrowDown" : "ArrowUp"));
    } else if (how === "api") await f.evaluate(m => PS.swipe(m.pane, m.dir), m);
    else {
      const gp = await f.evaluate(i => PS.grabPoint(i), m.pane), d = gp.step * 0.9;
      const dx = gp.axis === "h" ? m.dir * d : 0, dy = gp.axis === "h" ? 0 : m.dir * d, x = box.x + gp.x, y = box.y + gp.y;
      if (how === "touch") {
        const cdp = p.__cdp || (p.__cdp = await p.context().newCDPSession(p)), T = (type, X, Y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: X, y: Y }] });
        await T("touchStart", x, y); for (let k = 1; k <= 8; k++) await T("touchMove", x + dx * k / 8, y + dy * k / 8); await T("touchEnd");
      } else { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y + dy, { steps: 8 }); await p.mouse.up(); }
    }
    await f.waitForFunction(() => !PS.busy); await p.waitForTimeout(200);
  }
  return (await f.evaluate(() => PS.state.status)) !== "playing";
}
async function clickEl(p, f, sel) { const e = await f.waitForSelector(sel, { state: "visible" }); const r = await e.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
async function frameErrors(f) { try { return await f.evaluate(() => window.__errs || []); } catch (e) { return []; } }
async function fits(f, label) { // the play screen fits the frame: nothing sideways, the board and the buttons fully visible, no scrolling needed
  const r = await f.evaluate(() => {
    const b = document.getElementById("board").getBoundingClientRect(), sw = document.body.scrollWidth, sh = document.body.scrollHeight;
    const els = [...document.querySelectorAll("#playView > *, .hud")].filter(e => e.offsetParent && getComputedStyle(e).visibility !== "hidden");
    const out = els.map(e => [e.className || e.id, e.getBoundingClientRect()]).filter(x => x[1].right > innerWidth + 1 || x[1].left < -1 || x[1].bottom > innerHeight + 1).map(x => x[0]);
    return { board: [Math.round(b.width), Math.round(b.bottom)], W: innerWidth, H: innerHeight, sw, sh, out, cols: getComputedStyle(document.getElementById("playView")).gridTemplateColumns };
  });
  ok(r.out.length === 0 && r.sw <= r.W + 1 && r.sh <= r.H + 1 && r.board[1] <= r.H && r.board[0] >= 200, `${label}: board ${r.board[0]}px, bottom ${r.board[1]}/${r.H}, page ${r.sw}x${r.sh} in ${r.W}x${r.H}, columns "${r.cols}"` + (r.out.length ? " OUT: " + r.out.join(",") : ""));
  return r;
}
async function dlgFits(f, label) {
  const r = await f.evaluate(() => { const d = document.querySelector("dialog[open]"); if (!d) return null; const x = d.getBoundingClientRect(), af = d.querySelector("[data-af], .btnrow .cbtn.big, #btnClaim"); const a = af && af.getBoundingClientRect(); return { id: d.id, top: Math.round(x.top), bottom: Math.round(x.bottom), H: innerHeight, main: a ? [Math.round(a.top), Math.round(a.bottom)] : null }; });
  ok(r && r.top >= 0 && r.bottom <= r.H + 1 && (!r.main || r.main[1] <= r.H), `${label}: popup ${r && r.id} ${r && r.top}-${r && r.bottom} in ${r && r.H}px` + (r && r.main ? `, main button ${r.main.join("-")}` : ""));
}
async function noWebsiteBits(f, label) {
  const r = await f.evaluate(() => ({
    title: document.title, daily: !!document.querySelector("#btnDaily, #dailyStat, #btnShare, #btnLvShare, #btnMileShare, .home-site, .ad-slot, [data-install], link[rel=manifest]"),
    links: [...document.querySelectorAll("a[href]")].map(a => [a.getAttribute("href"), a.target, a.rel]),
    text: /daily puzzle|archive|guides/i.test(document.body.innerText), fsBtn: !!document.querySelector("[id*=ull], [aria-label*=ullscreen]")
  }));
  ok(r.title === "PaneSlide Levels", `${label}: title "${r.title}"`);
  ok(!r.daily && !r.text, `${label}: no daily/archive/share/install/website elements or text`);
  ok(r.links.length > 0 && r.links.every(x => /^https:\/\/paneslide\.com\/(privacy|terms)\/$/.test(x[0]) && x[1] === "_blank" && /noopener/.test(x[2])), `${label}: only outbound links are Privacy/Terms in a new tab (${r.links.map(x => x[0]).join(", ")})`);
  ok(!r.fsBtn, `${label}: no in-game fullscreen button`);
}
async function toLevel(p, f, tap) { // home -> PLAY -> map -> current level
  for (let i = 0; i < 4; i++) {
    const mode = await f.evaluate(() => PS.mode); if (mode === "level") return true;
    const sel = mode === "map" ? ".node.current" : "#btnPlay";
    if (tap) { const e = await f.waitForSelector(sel, { state: "visible" }); await e.evaluate(el => el.scrollIntoView({ block: "center" })); await p.waitForTimeout(300); const r = await e.boundingBox(); await p.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); }
    else await clickEl(p, f, sel);
    await p.waitForTimeout(900);
  }
  return (await f.evaluate(() => PS.mode)) === "level";
}

(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--host-resolver-rules=MAP game.test 127.0.0.1, MAP parent.test 127.0.0.1"] });

  // ---------- 1. every CrazyGames 16:9 size ----------
  for (const [w, h, touch] of (process.env.SIZES ? SIZES.filter(s => process.env.SIZES.split(",").includes(s[0] + "x" + s[1])) : SIZES)) {
    const tag = `${w}x${h}`; console.log(`== 16:9 iframe ${tag}${touch ? " (phone landscape, touch)" : ""}`);
    const { ctx, log } = await newCtx(b, { ctx: touch ? { viewport: { width: w + 40, height: h + 60 }, isMobile: true, hasTouch: true } : { viewport: { width: Math.max(1360, w + 40), height: Math.max(820, h + 60) } } });
    const p = await ctx.newPage();
    await p.goto(parentUrl("index.html?test=1&tutorial=0", { w, h })); let f = await frameOf(p); await p.waitForTimeout(1200);
    await shot(p, `${tag}-home`);
    if (touch) { await p.reload(); f = await frameOf(p); await p.waitForTimeout(1200); } // mobile-emulation screenshot quirk: reload before the next tap
    const home = await f.evaluate(() => { const r = [...document.querySelectorAll("#homeView *")].filter(e => e.offsetParent).map(e => e.getBoundingClientRect()); return { bottom: Math.round(Math.max(...r.map(x => x.bottom))), right: Math.round(Math.max(...r.map(x => x.right))), H: innerHeight, W: innerWidth, sh: document.body.scrollHeight }; });
    ok(home.bottom <= home.H && home.right <= home.W && home.sh <= home.H + 1, `home screen fits ${tag} without scrolling (content bottom ${home.bottom}, page ${home.sh})`);
    if (tag === "1280x720") await noWebsiteBits(f, tag);
    ok(await toLevel(p, f, !!touch), "PLAY opens level " + await f.evaluate(() => PS.puzzle && PS.puzzle.level));
    let music = false; for (let i = 0; i < 40 && !music; i++) { await p.waitForTimeout(250); music = await f.evaluate(() => PS.music.playing); }
    ok(music, "music starts after the first " + (touch ? "tap" : "click") + " (audio unlock inside the iframe)");
    await fits(f, tag + " level 1"); await shot(p, `${tag}-level1`);
    if (touch) { await f.goto(GAME + "index.html?test=1&tutorial=0&level=" + await f.evaluate(() => PS.puzzle.level)); await p.waitForTimeout(1500); } // screenshot quirk: reload the frame
    ok(await solve(p, f, touch ? "touch" : "keys"), "level 1 solved with " + (touch ? "finger swipes" : "the keyboard (number keys + arrows)")); await p.waitForTimeout(1700);
    await dlgFits(f, tag + " win popup"); await shot(p, `${tag}-level1-won`);
    if (!touch) ok(await f.evaluate(() => document.activeElement && document.activeElement.id === "btnNext"), "win popup focuses NEXT (stands in for autofocus)");
    // a big later level (5x5 boss)
    await f.goto(GAME + "index.html?test=1&tutorial=0&level=40"); await p.waitForTimeout(1500);
    await fits(f, tag + " level 40 (5x5)"); await shot(p, `${tag}-level40`);
    if (!touch) { ok(await solve(p, f, "mouse"), "level 40 solved with mouse swipes"); await p.waitForTimeout(1700); await dlgFits(f, tag + " level 40 popup"); await shot(p, `${tag}-level40-won`); }
    if (tag === "1280x720" || tag === "800x450") { // popups
      await f.goto(GAME + "index.html?test=1&tutorial=0"); await p.waitForTimeout(1000);
      for (const [btn, name] of [["btnStats", "stats"], ["btnHomeSettings", "settings"], ["btnHelp", "help"], ["btnShop", "shop"], ["btnGift", "gift"]]) {
        await f.evaluate(id => { document.querySelectorAll("dialog[open]").forEach(d => d.close()); document.getElementById(id).click(); }, btn); await p.waitForTimeout(700);
        await dlgFits(f, `${tag} ${name} popup`); await shot(p, `${tag}-${name}`);
      }
      await f.evaluate(() => document.querySelectorAll("dialog[open]").forEach(d => d.close()));
    }
    if (tag === "1280x720") {
      // arrow keys / space don't scroll the page during play; M mutes
      await f.goto(GAME + "index.html?test=1&tutorial=0&level=3"); await p.waitForTimeout(1200); await clickEl(p, f, ".goal");
      await p.keyboard.press("ArrowDown"); await p.keyboard.press("Space"); await p.waitForTimeout(300);
      ok(await f.evaluate(() => document.body.scrollTop === 0 && document.documentElement.scrollTop === 0), "arrow keys / space don't scroll the frame during play");
      await p.keyboard.press("m"); await p.waitForTimeout(300); ok(await f.evaluate(() => PS.music.on === false), "M toggles music off"); await p.keyboard.press("m");
      ok(await f.evaluate(() => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); document.getElementById("board").dispatchEvent(e); return e.defaultPrevented; }), "right-click menu is suppressed on the game");
      // the map scrolls with the wheel inside scrolling="no"
      await f.evaluate(() => { const pr = JSON.parse(localStorage.getItem("ps2:levels")); pr.unlocked = 30; localStorage.setItem("ps2:levels", JSON.stringify(pr)); });
      await f.goto(GAME + "index.html?test=1&tutorial=0&mode=levels"); await p.waitForTimeout(1500);
      const s0 = await f.evaluate(() => document.body.scrollTop); const fb = await frameBox(p); await p.mouse.move(fb.x + 640, fb.y + 360); await p.mouse.wheel(0, -500); await p.waitForTimeout(500);
      const s1 = await f.evaluate(() => document.body.scrollTop);
      ok(s0 > 0 && s1 < s0, `level map scrolls with the mouse wheel (${s0} → ${s1})`); await shot(p, `${tag}-map`);
      // old website URLs for the daily / archive just open the game
      await f.goto(GAME + "index.html?test=1&tutorial=0&mode=daily"); await p.waitForTimeout(1000);
      ok(await f.evaluate(() => PS.mode === "home"), "?mode=daily opens the home screen (no daily in this build)");
      await f.goto(GAME + "index.html?test=1&tutorial=0&date=2026-10-01"); await p.waitForTimeout(1000);
      ok(await f.evaluate(() => PS.mode === "home" && !PS.practice), "?date=... is ignored (no archive)");
      // progress code: copy in a frame without clipboard permission
      await f.evaluate(() => document.getElementById("btnHomeSettings").click()); await p.waitForTimeout(400);
      await clickEl(p, f, "#btnSaveCode"); await p.waitForTimeout(400); await clickEl(p, f, "#btnCopyCode"); await p.waitForTimeout(600);
      const toastTxt = await f.evaluate(() => document.getElementById("toast").textContent);
      ok(/copied/i.test(toastTxt), "progress code Copy works in the iframe (" + toastTxt + ")");
      await f.evaluate(() => document.querySelectorAll("dialog[open]").forEach(d => d.close()));
      // Privacy opens a new tab, the game stays
      await f.evaluate(() => document.getElementById("btnHomeSettings").click()); await p.waitForTimeout(300);
      const [pop] = await Promise.all([ctx.waitForEvent("page"), f.click(".set-links a[href$='/privacy/']")]);
      await pop.waitForURL(/paneslide\.com\/privacy/, { timeout: 20000 }).catch(() => {});
      ok(/paneslide\.com\/privacy\//.test(pop.url()), "Privacy link opens a new tab: " + pop.url()); await pop.close();
      ok(await f.evaluate(() => PS.mode === "home"), "the game stays put in the frame");
    }
    const errs = log.errors.concat(await frameErrors(f));
    ok(errs.length === 0, "no console errors/warnings" + (errs.length ? ": " + errs.join(" | ") : ""));
    ok(log.http.filter(u => !/paneslide\.com/.test(u)).length === 0, "no 404s / failed requests" + (log.http.length ? ": " + log.http.join(" | ") : ""));
    await ctx.close();
  }

  // ---------- 2. phones in portrait (full-window frame, touch) ----------
  for (const [w, h] of (process.env.SKIP_MOBILE ? [] : [[390, 844], [360, 640]])) {
    console.log(`== mobile portrait ${w}x${h}`);
    const { ctx, log } = await newCtx(b, { ctx: { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } }); const p = await ctx.newPage();
    await p.goto(parentUrl("index.html?test=1&tutorial=0", { full: true })); let f = await frameOf(p); await p.waitForTimeout(1200);
    await shot(p, `mobile-${w}x${h}-home`);
    await p.reload(); f = await frameOf(p); await p.waitForTimeout(1200);
    ok(await toLevel(p, f, true), "tap PLAY opens a level");
    await fits(f, `${w}x${h} level 1`); await shot(p, `mobile-${w}x${h}-level1`);
    await f.goto(GAME + "index.html?test=1&tutorial=0&level=1"); await p.waitForTimeout(1500);
    ok(await solve(p, f, "touch"), "level 1 solved with finger swipes"); await p.waitForTimeout(1700);
    await dlgFits(f, `${w}x${h} win popup`); await shot(p, `mobile-${w}x${h}-level1-won`);
    await f.goto(GAME + "index.html?test=1&tutorial=0&level=40"); await p.waitForTimeout(1500);
    await fits(f, `${w}x${h} level 40`); await shot(p, `mobile-${w}x${h}-level40`);
    await f.goto(GAME + "index.html?test=1&tutorial=0&level=40"); await p.waitForTimeout(1500);
    ok(await solve(p, f, "touch"), "level 40 solved with finger swipes"); await p.waitForTimeout(1500);
    const errs = log.errors.concat(await frameErrors(f));
    ok(errs.length === 0, "no console errors/warnings" + (errs.length ? ": " + errs.join(" | ") : ""));
    ok(log.http.length === 0, "no 404s" + (log.http.length ? ": " + log.http.join(" | ") : ""));
    await ctx.close();
  }

  // ---------- 3. new player: the tutorial hands over to level 1 (it used to open the daily) ----------
  {
    console.log("== new player tutorial");
    const { ctx, log } = await newCtx(b, { prefs: false }); const p = await ctx.newPage();
    await p.goto(parentUrl("index.html?test=1", { w: 960, h: 540 })); const f = await frameOf(p); await p.waitForTimeout(1500);
    ok(await f.evaluate(() => PS.mode === "tutorial"), "a new player lands straight in the tutorial");
    await fits(f, "960x540 tutorial"); await shot(p, "960x540-tutorial");
    ok(await solve(p, f, "mouse"), "tutorial solved with mouse swipes"); await p.waitForTimeout(1800);
    await shot(p, "960x540-tutorial-done");
    await f.evaluate(() => document.getElementById("btnEndMain").click()); await p.waitForTimeout(1200);
    ok(await f.evaluate(() => PS.mode === "level" && PS.puzzle.level === 1), "PLAY after the tutorial opens level 1 (mode " + await f.evaluate(() => PS.mode) + ")");
    const errs = log.errors.concat(await frameErrors(f));
    ok(errs.length === 0 && log.http.length === 0, "no errors / 404s" + (errs.length || log.http.length ? ": " + errs.concat(log.http).join(" | ") : ""));
    await ctx.close();
  }

  // ---------- 4. the portal's fullscreen (requestFullscreen on the iframe) ----------
  {
    console.log("== portal fullscreen (1920x1080 screen)");
    const { ctx, log } = await newCtx(b, { ctx: { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } } }); const p = await ctx.newPage();
    await p.goto(parentUrl("index.html?test=1&tutorial=0", { w: 960, h: 540 })); let f = await frameOf(p); await p.waitForTimeout(800);
    await p.click("#fs"); await p.waitForTimeout(900);
    const size = await f.evaluate(() => [innerWidth, innerHeight]);
    ok(await p.evaluate(() => !!document.fullscreenElement) && size[0] >= 1900, "iframe goes fullscreen, game resizes to " + size.join("x"));
    await toLevel(p, f, false); await fits(f, "fullscreen level"); await shot(p, "fullscreen-1920x1080-level");
    await p.evaluate(() => document.exitFullscreen()); await p.waitForTimeout(900);
    const size2 = await f.evaluate(() => [innerWidth, innerHeight]);
    ok(size2[0] === 960 && size2[1] === 540, "back to 960x540 after leaving fullscreen (" + size2.join("x") + ")");
    await fits(f, "960x540 after fullscreen");
    const errs = log.errors.concat(await frameErrors(f));
    ok(errs.length === 0 && log.http.length === 0, "no errors / 404s" + (errs.length || log.http.length ? ": " + errs.concat(log.http).join(" | ") : ""));
    await ctx.close();
  }

  // ---------- 5. GoatCounter tagging (no test mode, requests intercepted, nothing reaches the counter) ----------
  {
    console.log("== GoatCounter tagging");
    const { ctx, log } = await newCtx(b); const p = await ctx.newPage();
    await p.goto(parentUrl("index.html?tutorial=0")); const f = await frameOf(p); await p.waitForTimeout(2500);
    await f.evaluate(() => document.getElementById("btnPlay").click()); await p.waitForTimeout(900);
    await f.evaluate(() => { const b = document.getElementById("btnPlayNext"); (b && b.offsetParent ? b : document.querySelector(".node.current")).click(); }); await p.waitForTimeout(900);
    await f.evaluate(() => document.getElementById("btnBack").click()); await p.waitForTimeout(600);
    await p.waitForTimeout(5500);
    const hits = log.gc.map(u => { const q = new URL(u).searchParams; return { p: q.get("p"), e: q.get("e"), r: q.get("r") }; });
    hits.forEach(h => console.log("   ", h.e === "true" ? "event" : "view ", h.p, h.r ? "ref=" + h.r : ""));
    ok(hits.some(h => h.p === "/crazygames/" && h.e !== "true"), "page view counted as /crazygames/");
    ok(hits.some(h => /^crazygames\/level\/\d{3}\/start$/.test(h.p) && h.e === "true") && hits.some(h => /^crazygames\/level\/\d{3}\/quit$/.test(h.p)), "events tagged crazygames/... (level start, quit)");
    ok(hits.length > 0 && hits.every(h => /^\/?crazygames\//.test(h.p)), "every hit is tagged crazygames (none mixed into the website's /, event/...)");
    await ctx.close();
  }
  // ---------- 6. GPC: nothing loads ----------
  {
    console.log("== Global Privacy Control");
    const { ctx } = await newCtx(b, { gpc: true }); const p = await ctx.newPage();
    const reqs = []; ctx.on("request", r => { if (/goatcounter|zgo\.at/.test(r.url())) reqs.push(r.url()); });
    await p.goto(parentUrl("index.html?tutorial=0")); const f = await frameOf(p); await p.waitForTimeout(1500);
    await clickEl(p, f, "#btnPlay"); await p.waitForTimeout(5500);
    ok(reqs.length === 0, "GPC on: GoatCounter never loads, nothing sent (" + reqs.length + " requests)");
    await ctx.close();
  }
  await b.close();
  console.log(bad ? `FAILED: ${bad} check(s)` : "OK: CrazyGames build works in 16:9 iframes, on phones and in fullscreen"); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
