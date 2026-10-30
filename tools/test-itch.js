// Tests the itch.io build (tools/build-itch.js) the way itch shows it: inside a cross-origin iframe with
// itch's own attributes (scrolling="no", allow="autoplay; fullscreen *; ..."), at 960x600 on desktop, full
// screen on a phone in portrait, and in real fullscreen.
//   1. serve the build and a parent page on two different host names, e.g.
//        (cd /workspace/paneslide-builds/itch && python3 -m http.server 8781 --bind 127.0.0.1) &
//        (cd <dir with tools/itch-parent.html as parent.html> && python3 -m http.server 8782 --bind 127.0.0.1) &
//   2. PW=$(npm root -g)/playwright-core node tools/test-itch.js [shotsDir]
// Host names game.test and parent.test are mapped to 127.0.0.1, so the frame is cross-origin and not "localhost"
// (GoatCounter really loads). GoatCounter count requests are intercepted and answered locally, except in the one
// "real endpoint" check, which sends a single request flagged as a bot (headless), so it is not counted.
const pw = require(process.env.PW || "playwright-core");
const fs = require("fs"), path = require("path");
const SHOTS = path.resolve(process.argv[2] || "/workspace/paneslide-builds/itch-shots");
const GAME = "http://game.test:8781/", PARENT = "http://parent.test:8782/parent.html";
const PREFS = { sound: true, music: true, tutDone: true, glideTut: true, mixSeen: ["C","M","Y"], marks: ["glide","stick","order","stars","undo","hint","stuck","map","rank","shard","gift","house","shop","music","daily","everyone","mix","new","boss","rule"] };
fs.mkdirSync(SHOTS, { recursive: true });
let bad = 0; const ok = (c, m) => { console.log(c ? "✓" : "✗", m); if (!c) bad++; };
const parentUrl = (src, o = {}) => PARENT + "?src=" + encodeURIComponent(GAME + src) + (o.full ? "&full=1" : "&w=" + (o.w || 960) + "&h=" + (o.h || 600));

async function newCtx(b, opt = {}) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opt.ctx || {}));
  if (opt.prefs !== false) await ctx.addInitScript(p => { if (location.hostname === "game.test" && !localStorage.getItem("ps2:prefs")) localStorage.setItem("ps2:prefs", p); }, JSON.stringify(PREFS));
  if (opt.gpc) await ctx.addInitScript(() => { Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }); });
  await ctx.addInitScript(() => { window.__errs = []; addEventListener("error", e => window.__errs.push(String(e.message))); addEventListener("unhandledrejection", e => window.__errs.push("rejection: " + (e.reason && e.reason.message || e.reason))); });
  const log = { errors: [], http: [], gc: [] };
  ctx.on("console", m => { if (m.type() !== "error" && m.type() !== "warning") return; const t = m.text();
    // the parent page copies itch's exact allow="..." list; Chrome warns about features it doesn't know - that's itch's markup, not the game
    if (/^Unrecognized feature: '|^Allow attribute will take precedence over 'allowfullscreen'/.test(t)) return;
    log.errors.push(m.type() + ": " + t + (m.location() && m.location().url ? " @ " + m.location().url : "")); });
  ctx.on("weberror", e => log.errors.push("pageerror: " + e.error().message));
  ctx.on("response", r => { if (r.status() >= 400) log.http.push(r.status() + " " + r.url()); });
  ctx.on("request", r => { if (/goatcounter\.com\/count/.test(r.url())) log.gc.push(r.url()); });
  if (!opt.realGc) await ctx.route(/goatcounter\.com\/count/, r => r.fulfill({ status: 204, body: "" }));
  return { ctx, log };
}
async function frameOf(p) { await p.waitForSelector("#game_drop"); const f = await (await p.$("#game_drop")).contentFrame(); await f.waitForLoadState("load"); return f; }
async function frameBox(p) { return (await p.$("#game_drop")).boundingBox(); }
async function solve(p, f, how) { // how: "keys" | "swipe" | "drag"
  const box = await frameBox(p);
  for (let g = 0; g < 60; g++) {
    if (await f.evaluate(() => PS.state.status) !== "playing") return true;
    if (!(await f.evaluate(() => PS.puzzle.glide))) { // classic drag rules (dailies before 30 Oct 2026)
      const todo = await f.evaluate(() => PS.puzzle.panes.map((q, i) => i).filter(i => !PS.puzzle.panes[i].locked && PS.state.pos[i] !== PS.puzzle.solution[i]));
      for (const i of todo.reverse()) {
        if (await f.evaluate(() => PS.state.status) !== "playing") return true;
        const gp = await f.evaluate(i => PS.grabPoint(i), i), from = await f.evaluate(i => PS.state.pos[i], i), to = await f.evaluate(k => PS.puzzle.solution[k], i);
        let dx = 0, dy = 0;
        if (gp.axis === "b") { const w = gp.mc + 1; dx = (to % w - from % w) * gp.step; dy = (Math.floor(to / w) - Math.floor(from / w)) * gp.step; }
        else if (gp.axis === "h") dx = (to - from) * gp.step; else dy = (to - from) * gp.step;
        const x = box.x + gp.x, y = box.y + gp.y;
        if (p.__touch === undefined) p.__touch = await p.evaluate(() => navigator.maxTouchPoints > 0);
        if (p.__touch) { // phones: a real finger drag (touch events), not the mouse
          const cdp = p.__cdp || (p.__cdp = await p.context().newCDPSession(p)), T = (type, X, Y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: X, y: Y }] });
          await T("touchStart", x, y); for (let k = 1; k <= 12; k++) await T("touchMove", x + dx * k / 12, y + dy * k / 12); await T("touchEnd"); await p.waitForTimeout(450);
        } else { await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y + dy, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(450); }
      }
      continue;
    }
    const m = await f.evaluate(() => PS.E.nextMove(PS.puzzle, PS.state.pos)); if (!m) return false;
    if (how === "keys") {
      await p.keyboard.press(String(m.pane + 1)); await p.waitForTimeout(60);
      const ax = await f.evaluate(i => PS.puzzle.panes[i].axis, m.pane);
      await p.keyboard.press(ax === "h" ? (m.dir > 0 ? "ArrowRight" : "ArrowLeft") : (m.dir > 0 ? "ArrowDown" : "ArrowUp"));
    } else await f.evaluate(m => PS.swipe(m.pane, m.dir), m);
    await f.waitForFunction(() => !PS.busy); await p.waitForTimeout(120);
  }
  return (await f.evaluate(() => PS.state.status)) !== "playing";
}
async function clickEl(p, f, sel) { const e = await f.waitForSelector(sel, { state: "visible" }); const r = await e.boundingBox(); await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
async function frameErrors(f) { try { return await f.evaluate(() => window.__errs || []); } catch (e) { return []; } }
async function fits(f, label) { // nothing pokes out of the frame on the play screen
  const r = await f.evaluate(() => {
    const b = document.getElementById("board").getBoundingClientRect(), sw = document.body.scrollWidth, sh = document.body.scrollHeight;
    const out = [...document.querySelectorAll("#playView > *, .hud")].filter(e => e.offsetParent).map(e => [e.className || e.id, e.getBoundingClientRect()]).filter(x => x[1].right > innerWidth + 1 || x[1].left < -1).map(x => x[0]);
    return { board: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.bottom)], W: innerWidth, H: innerHeight, sw, sh, out, cols: getComputedStyle(document.getElementById("playView")).gridTemplateColumns };
  });
  ok(r.out.length === 0 && r.sw <= r.W + 1 && r.board[3] <= r.H && r.board[2] > 150, `${label}: board ${r.board[2]}px wide, bottom ${r.board[3]}/${r.H}, no sideways overflow, page height ${r.sh}/${r.H}, columns "${r.cols}"`);
  return r;
}

(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--host-resolver-rules=MAP game.test 127.0.0.1, MAP parent.test 127.0.0.1"] });

  // ---------- 1. desktop, itch's default 960x600 frame ----------
  if (!process.env.SKIP1) {
    console.log("== desktop 960x600 iframe");
    const { ctx, log } = await newCtx(b); const p = await ctx.newPage();
    await p.goto(parentUrl("index.html?test=1&tutorial=0")); let f = await frameOf(p); await p.waitForTimeout(1200);
    await p.screenshot({ path: SHOTS + "/desktop-960x600-home.png" });
    ok(await f.evaluate(() => !("serviceWorker" in navigator) || navigator.serviceWorker.getRegistrations().then(r => r.length === 0)), "no service worker registered");
    ok(await f.evaluate(() => !document.querySelector("link[rel=manifest], [data-install]")), "no manifest link, no install button");
    ok(await f.evaluate(() => PS.music.playing === false), "music waits for the first tap (autoplay rules)");
    // first tap: PLAY
    await clickEl(p, f, "#btnPlay"); await p.waitForTimeout(600);
    if (await f.evaluate(() => PS.mode) !== "level") { await clickEl(p, f, "#btnPlayNext"); await p.waitForTimeout(600); }
    ok(await f.evaluate(() => PS.mode) === "level", "PLAY opens level " + await f.evaluate(() => PS.puzzle && PS.puzzle.level));
    let music = false; for (let i = 0; i < 40 && !music; i++) { await p.waitForTimeout(250); music = await f.evaluate(() => PS.music.playing); }
    ok(music, "music starts after the first tap inside the iframe (audio unlock)");
    ok(await f.evaluate(() => { const c = document.querySelector("#board canvas, canvas#board, #board"); return !!c; }), "canvas board present");
    await fits(f, "960x600 level");
    await p.screenshot({ path: SHOTS + "/desktop-960x600-level.png" });
    // keyboard: focus is inside the iframe after the click; solve level 1 with number keys + arrows
    ok(await solve(p, f, "keys"), "level solved with the keyboard inside the iframe (number keys + arrows)");
    await p.waitForTimeout(1600);
    ok(await f.evaluate(() => PS.state.status === "won" && PS.progress.unlocked >= 2), "level 1 won, level 2 unlocked");
    ok(await f.evaluate(() => document.activeElement && document.activeElement.id === "btnNext"), "win dialog focuses NEXT inside the frame (stands in for autofocus)");
    await p.screenshot({ path: SHOTS + "/desktop-960x600-level-won.png" });
    // M mutes, Esc closes
    await f.evaluate(() => document.querySelectorAll("dialog[open]").forEach(d => d.close()));
    await p.keyboard.press("m"); await p.waitForTimeout(300); ok(await f.evaluate(() => PS.music.on === false), "M toggles music off by keyboard");
    await p.keyboard.press("m"); await p.waitForTimeout(300);
    // stats popup fits the frame
    await f.evaluate(() => { document.querySelectorAll("dialog[open]").forEach(d => d.close()); document.getElementById("btnBack").click(); }); await p.waitForTimeout(500);
    await f.evaluate(() => { const h = document.getElementById("btnBack"); if (PS.mode !== "home") h.click(); }); await p.waitForTimeout(500);
    await clickEl(p, f, "#btnStats"); await p.waitForTimeout(500);
    const dlg = await f.evaluate(() => { const d = document.querySelector("dialog[open]"); if (!d) return null; const r = d.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), innerHeight]; });
    ok(dlg && dlg[0] >= 0 && dlg[1] <= dlg[2], "Stats popup fits the 600px frame " + JSON.stringify(dlg));
    await p.screenshot({ path: SHOTS + "/desktop-960x600-stats.png" });
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    ok(await f.evaluate(() => !document.querySelector("dialog[open]")), "Esc closes the popup");
    // map scrolls with the mouse wheel even though itch uses scrolling="no"
    await f.evaluate(() => document.getElementById("btnPlay").click()); await p.waitForTimeout(300);
    await f.goto(GAME + "index.html?test=1&tutorial=0&mode=levels"); await p.waitForTimeout(1500);
    const s0 = await f.evaluate(() => document.body.scrollTop); await p.mouse.move(400, 300); await p.mouse.wheel(0, -500); await p.waitForTimeout(500);
    const s1 = await f.evaluate(() => document.body.scrollTop);
    ok(s0 > 0 && s1 < s0, `level map scrolls inside the scrolling="no" frame (${s0} → ${s1})`);
    await p.screenshot({ path: SHOTS + "/desktop-960x600-map.png" });
    // the daily (dates before 30 Oct 2026 use drag rules: this also tests mouse dragging in the iframe)
    await f.goto(GAME + "index.html?test=1&tutorial=0&mode=daily"); await p.waitForTimeout(1500);
    ok(await f.evaluate(() => PS.mode === "daily"), "daily opens (" + await f.evaluate(() => PS.date) + ", " + (await f.evaluate(() => PS.puzzle.glide) ? "glide" : "drag") + " rules)");
    await fits(f, "960x600 daily");
    await p.screenshot({ path: SHOTS + "/desktop-960x600-daily.png" });
    { const sv = await solve(p, f, "swipe"); if (!sv) console.log("   daily state:", await f.evaluate(() => JSON.stringify([PS.mode, PS.state.status, PS.state.pos, PS.puzzle.solution, [...document.querySelectorAll("dialog[open]")].map(d => d.id), document.body.scrollTop, window.__errs]))); ok(sv, "daily solved"); } await p.waitForTimeout(1800);
    ok(await f.evaluate(() => PS.state.status === "won"), "daily won");
    await p.screenshot({ path: SHOTS + "/desktop-960x600-daily-won.png" });
    // the share text copies even though itch's iframe has no clipboard-write permission
    await f.evaluate(() => document.querySelectorAll("dialog[open]").forEach(d => d.close()));
    // archive (local page) -> a past day in practice mode
    await f.goto(GAME + "archive.html?test=1"); await p.waitForTimeout(800);
    await p.screenshot({ path: SHOTS + "/desktop-960x600-archive.png" });
    const days = await f.$$eval("#archive a.arc-day", a => a.map(x => x.getAttribute("href")));
    ok(days.length >= 1 && days.every(h => /^index\.html\?(mode=daily|date=\d{4}-\d\d-\d\d)$/.test(h)), "archive lists " + days.length + " days with local links");
    const as1 = await f.evaluate(() => document.body.scrollTop); await p.mouse.move(400, 400); await p.mouse.wheel(0, 600); await p.waitForTimeout(400);
    ok(await f.evaluate(() => document.body.scrollTop) > as1, "archive page scrolls inside the frame");
    const past = days.find(h => /date=/.test(h));
    if (past) {
      await f.goto(GAME + past + "&test=1&tutorial=0"); await p.waitForTimeout(1500);
      ok(await f.evaluate(() => PS.practice === true && PS.mode === "daily"), "archive day opens in practice mode (" + past + ")");
      ok(await solve(p, f, "swipe"), "archive day solved"); await p.waitForTimeout(1500);
    }
    // progress code: export, copy, import
    await f.goto(GAME + "index.html?test=1&tutorial=0"); await p.waitForTimeout(1000);
    const code = await f.evaluate(() => PS.progressCode());
    await f.evaluate(() => document.getElementById("btnHomeSettings").click()); await p.waitForTimeout(400);
    await clickEl(p, f, "#btnSaveCode"); await p.waitForTimeout(400);
    ok(await f.evaluate(c => document.getElementById("saveCode").value === c && c.length > 20, code), "progress code shown (" + code.length + " chars)");
    await clickEl(p, f, "#btnCopyCode"); await p.waitForTimeout(600);
    const toastTxt = await f.evaluate(() => [...document.querySelectorAll(".toast")].map(t => t.textContent).join("|"));
    ok(/copied/i.test(toastTxt), "Copy button works in the iframe (toast: " + toastTxt + ")");
    const before = await f.evaluate(() => PS.progress.unlocked);
    await f.evaluate(() => localStorage.setItem("ps2:levels", JSON.stringify({ unlocked: 1 }))); // pretend a fresh device
    p.once("dialog", d => d.accept());
    await f.fill("#loadCode", code); await clickEl(p, f, "#btnLoadCode"); await p.waitForTimeout(2200);
    f = await frameOf(p); await p.waitForTimeout(800);
    ok(await f.evaluate(b => JSON.parse(localStorage.getItem("ps2:levels")).unlocked === b && /index\.html$/.test(location.pathname), before), "progress code import restores progress (unlocked " + before + ") and reloads inside the frame");
    await f.goto(GAME + "index.html?test=1&tutorial=0"); await p.waitForTimeout(800);
    // links to content pages open the website in a new tab
    const ext = await f.$$eval("a[href]", a => a.filter(x => /^https?:/.test(x.getAttribute("href"))).map(x => [x.getAttribute("href"), x.target, x.rel]));
    ok(ext.length > 0 && ext.every(x => x[0].startsWith("https://paneslide.com/") && x[1] === "_blank" && /noopener/.test(x[2])), ext.length + " content links point at https://paneslide.com/... with target=_blank rel=noopener");
    await f.evaluate(() => document.getElementById("btnHomeSettings").click()); await p.waitForTimeout(300);
    const [pop] = await Promise.all([ctx.waitForEvent("page"), f.click(".set-links a[href*='/guides/']")]);
    await pop.waitForURL(/paneslide\.com\/guides/, { timeout: 20000 }).catch(() => {});
    ok(/paneslide\.com\/guides/.test(pop.url()), "Guides link opens a new tab: " + pop.url());
    await pop.close();
    ok(await f.evaluate(() => PS.mode === "home"), "the game stays put in the frame");
    const errs = log.errors.concat(await frameErrors(f));
    ok(errs.length === 0, "no console errors/warnings" + (errs.length ? ": " + errs.join(" | ") : ""));
    ok(log.http.filter(u => !/paneslide\.com/.test(u)).length === 0, "no 404s / failed requests" + (log.http.length ? ": " + log.http.join(" | ") : ""));
    await ctx.close();
  }

  // ---------- 2. phone portrait (itch shows mobile games full screen) ----------
  for (const [w, h] of (process.env.ONLY_MOBILE ? [[390, 844]] : [[390, 844], [360, 640]])) {
    console.log(`== mobile ${w}x${h} (full-window iframe, touch)`);
    const { ctx, log } = await newCtx(b, { ctx: { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } }); const p = await ctx.newPage();
    await p.goto(parentUrl("index.html?test=1&tutorial=0", { full: true })); let f = await frameOf(p); await p.waitForTimeout(1200);
    await p.screenshot({ path: SHOTS + `/mobile-${w}x${h}-home.png` });
    // a Playwright screenshot in mobile emulation stops the next tap from turning into a click (harness quirk, not the game) - reload first
    await p.reload(); f = await frameOf(p); await p.waitForTimeout(1200);
    const tapSel = async sel => { const e = await f.waitForSelector(sel, { state: "visible" }); await e.evaluate(el => el.scrollIntoView({ block: "center" })); await p.waitForTimeout(300); const r = await e.boundingBox(); await p.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2); await p.waitForTimeout(800); };
    for (let i = 0; i < 4; i++) { // home -> PLAY -> (map -> current level) -> level
      const mode = await f.evaluate(() => PS.mode); if (mode === "level") break;
      await tapSel(mode === "map" ? ".node.current" : "#btnPlay");
    }
    ok(await f.evaluate(() => PS.mode) === "level", "tap PLAY opens a level");
    let music = false; for (let i = 0; i < 40 && !music; i++) { await p.waitForTimeout(250); music = await f.evaluate(() => PS.music.playing); }
    ok(music, "music starts after the first touch");
    await fits(f, `${w}x${h} level`);
    await p.screenshot({ path: SHOTS + `/mobile-${w}x${h}-level.png` });
    ok(await solve(p, f, "swipe"), "level solved"); await p.waitForTimeout(1600);
    await f.goto(GAME + "index.html?test=1&tutorial=0&mode=daily"); await p.waitForTimeout(1500);
    await fits(f, `${w}x${h} daily`);
    await p.screenshot({ path: SHOTS + `/mobile-${w}x${h}-daily.png` });
    await f.goto(f.url()); await p.waitForTimeout(1500); // same harness quirk: after a mobile screenshot Chrome turns the next drag into a page pan (pointercancel) until the frame reloads
    { const sv = await solve(p, f, "swipe"); if (!sv) console.log("   daily state:", await f.evaluate(() => JSON.stringify([PS.mode, PS.state.status, PS.state.pos, PS.puzzle.solution, [...document.querySelectorAll("dialog[open]")].map(d => d.id), document.body.scrollTop, window.__errs]))); ok(sv, "daily solved"); } await p.waitForTimeout(1600);
    await p.screenshot({ path: SHOTS + `/mobile-${w}x${h}-daily-won.png` });
    const errs = log.errors.concat(await frameErrors(f));
    ok(errs.length === 0, "no console errors/warnings" + (errs.length ? ": " + errs.join(" | ") : ""));
    ok(log.http.length === 0, "no 404s" + (log.http.length ? ": " + log.http.join(" | ") : ""));
    await ctx.close();
  }

  // ---------- 3. itch's fullscreen button (requestFullscreen on the iframe) ----------
  {
    console.log("== fullscreen (1920x1080 screen)");
    const { ctx, log } = await newCtx(b, { ctx: { viewport: { width: 1920, height: 1080 }, screen: { width: 1920, height: 1080 } } }); const p = await ctx.newPage();
    await p.goto(parentUrl("index.html?test=1&tutorial=0")); let f = await frameOf(p); await p.waitForTimeout(800);
    await p.click("#fs"); await p.waitForTimeout(900);
    const fs1 = await p.evaluate(() => !!document.fullscreenElement);
    const size = await f.evaluate(() => [innerWidth, innerHeight]);
    ok(fs1 && size[0] >= 1900, "iframe goes fullscreen, game resizes to " + size.join("x"));
    await clickEl(p, f, "#btnPlay"); await p.waitForTimeout(700);
    if (await f.evaluate(() => PS.mode) !== "level") { await clickEl(p, f, "#btnPlayNext"); await p.waitForTimeout(700); }
    await fits(f, "fullscreen level");
    await p.screenshot({ path: SHOTS + "/fullscreen-1920x1080-level.png" });
    await p.evaluate(() => document.exitFullscreen()); await p.waitForTimeout(800); // = pressing Esc / itch's exit button
    const size2 = await f.evaluate(() => [innerWidth, innerHeight]);
    ok(size2[0] === 960 && size2[1] === 600, "back to 960x600 after leaving fullscreen (" + size2.join("x") + ")");
    await fits(f, "960x600 after fullscreen");
    const errs = log.errors.concat(await frameErrors(f));
    ok(errs.length === 0 && log.http.length === 0, "no errors / 404s" + (errs.length || log.http.length ? ": " + errs.concat(log.http).join(" | ") : ""));
    await ctx.close();
  }

  // ---------- 4. GoatCounter tagging (no test mode, cross-origin frame, requests intercepted) ----------
  {
    console.log("== GoatCounter tagging");
    const { ctx, log } = await newCtx(b); const p = await ctx.newPage();
    await p.goto(parentUrl("index.html?tutorial=0")); const f = await frameOf(p); await p.waitForTimeout(2500);
    await f.evaluate(() => document.getElementById("btnPlay").click()); await p.waitForTimeout(900);
    if (await f.evaluate(() => !document.getElementById("playView").hidden) === false) { await f.evaluate(() => { const b = document.getElementById("btnPlayNext"); (b && b.offsetParent ? b : document.querySelector(".node.current")).click(); }); await p.waitForTimeout(800); }
    await f.evaluate(() => document.getElementById("btnBack").click()); await p.waitForTimeout(600); // leave unsolved -> quit
    await f.evaluate(() => document.getElementById("btnDaily").click()); await p.waitForTimeout(800);
    await p.waitForTimeout(5500); // events are batched for 4 s
    await f.goto(GAME + "archive.html"); await p.waitForTimeout(2500);
    const hits = log.gc.map(u => { const q = new URL(u).searchParams; return { p: q.get("p"), e: q.get("e"), r: q.get("r"), b: q.get("b") }; });
    hits.forEach(h => console.log("   ", h.e === "true" ? "event" : "view ", h.p, h.r ? "ref=" + h.r : ""));
    ok(hits.some(h => h.p === "/itch/" && h.e !== "true"), "game page view counted as /itch/");
    ok(hits.some(h => h.p === "/itch/archive" && h.e !== "true"), "archive page view counted as /itch/archive");
    ok(hits.some(h => /^itch\/level\/\d{3}\/start$/.test(h.p) && h.e === "true") && hits.some(h => /^itch\/level\/\d{3}\/quit$/.test(h.p)) && hits.some(h => h.p === "itch/daily/start"), "events tagged itch/... (level start, quit, daily start)");
    ok(hits.every(h => /^\/?itch\//.test(h.p)), "every hit is tagged itch (none mixed into the website's /, event/...)");
    ok(hits.some(h => (h.r || "").startsWith("http://parent.test")), "referrer is the page that embeds the game (on itch: the itch.io game page)");
    await ctx.close();
  }
  // ---------- 5. GPC / DNT: nothing loads ----------
  {
    console.log("== Global Privacy Control");
    const { ctx, log } = await newCtx(b, { gpc: true }); const p = await ctx.newPage();
    const reqs = []; ctx.on("request", r => { if (/goatcounter|zgo\.at/.test(r.url())) reqs.push(r.url()); });
    await p.goto(parentUrl("index.html?tutorial=0")); const f = await frameOf(p); await p.waitForTimeout(1500);
    await clickEl(p, f, "#btnPlay"); await p.waitForTimeout(5500);
    ok(reqs.length === 0, "GPC on: GoatCounter never loads, nothing sent (" + reqs.length + " requests)");
    await ctx.close();
  }
  // ---------- 6. the real GoatCounter endpoint from a cross-origin iframe ----------
  {
    console.log("== real GoatCounter endpoint (one bot-flagged hit, not counted)");
    const { ctx, log } = await newCtx(b, { realGc: true }); const p = await ctx.newPage();
    const res = []; ctx.on("requestfinished", async r => { if (/goatcounter\.com\/count/.test(r.url())) { const s = await r.response(); res.push([s ? s.status() : "?", r.resourceType(), r.url().slice(0, 110)]); } });
    ctx.on("requestfailed", r => { if (/goatcounter/.test(r.url())) res.push(["failed " + (r.failure() || {}).errorText, r.url().slice(0, 110)]); });
    await p.goto(parentUrl("index.html?tutorial=0")); await frameOf(p); await p.waitForTimeout(4000);
    res.forEach(x => console.log("   ", x.join(" ")));
    ok(res.some(x => typeof x[0] === "number" && x[0] < 300), "count request from the cross-origin iframe is accepted by paneslide.goatcounter.com (bot flag b=153 set, so it is not counted)");
    await ctx.close();
  }
  await b.close();
  console.log(bad ? `FAILED: ${bad} check(s)` : "OK: itch build works in an iframe"); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
