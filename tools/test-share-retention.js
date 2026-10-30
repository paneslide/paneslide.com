// Checks share links (?ref=share), share / share-arrival events and the anonymous return-visit events
// (returning + streak buckets) with simulated dates. Test mode reads window.psLog (nothing is sent);
// the last part loads the game under a fake host with a stub GoatCounter to check what would be sent.
//  PW=... node tools/test-share-retention.js [base]     (base: the repo served over http, default :8765)
const pw = require(process.env.PW || "playwright-core");
const BASE = process.argv[2] || "http://127.0.0.1:8765";
const PREFS = JSON.stringify({ sound: false, music: false, tutDone: true, glideTut: true, mixSeen: ["C", "M", "Y"], marks: ["glide","stick","order","stars","undo","hint","stuck","map","rank","shard","gift","house","shop","music","daily","everyone","mix","new","boss"] });
let bad = 0, n = 0; const ok = (c, m) => { n++; console.log(c ? "✓" : "✗", m); if (!c) bad++; };
const BUCKET = k => k >= 30 ? "day-30plus" : k >= 14 ? "day-14" : k >= 7 ? "day-7" : k >= 3 ? "day-3" : k >= 2 ? "day-2" : "day-1";
async function solve(p) {
  for (let k = 0; k < 40; k++) {
    if (await p.evaluate(() => PS.state.status) !== "playing") return;
    if (!(await p.evaluate(() => PS.puzzle.glide))) { // classic drag-rule dailies: move each pane to its solution cell
      const todo = await p.evaluate(() => PS.puzzle.panes.map((q, i) => i).filter(i => !PS.puzzle.panes[i].locked && PS.state.pos[i] !== PS.puzzle.solution[i]));
      for (const i of todo) {
        const g = await p.evaluate(i => PS.grabPoint(i), i), from = await p.evaluate(i => PS.state.pos[i], i), to = await p.evaluate(i => PS.puzzle.solution[i], i);
        let dx = 0, dy = 0; if (g.axis === "b") { const w = g.mc + 1; dx = (to % w - from % w) * g.step; dy = (Math.floor(to / w) - Math.floor(from / w)) * g.step; } else if (g.axis === "h") dx = (to - from) * g.step; else dy = (to - from) * g.step;
        await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x + dx, g.y + dy, { steps: 12 }); await p.mouse.up(); await p.waitForTimeout(420);
      }
      continue;
    }
    const m = await p.evaluate(() => PS.E.nextMove(PS.puzzle, PS.state.pos)); if (!m) return;
    await p.evaluate(m => PS.swipe(m.pane, m.dir), m); await p.waitForFunction(() => !PS.busy); await p.waitForTimeout(60);
  }
}
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox", "--host-resolver-rules=MAP paneslide.test 127.0.0.1"] });
  const errs = [];
  const watch = p => { p.on("pageerror", e => errs.push(e.message)); p.on("console", m => { if (m.type() === "error") errs.push(m.text()); }); p.on("response", r => { if (r.status() >= 400) errs.push(r.status() + " " + r.url()); }); };
  const log = p => p.evaluate(() => (window.psLog || []).map(e => e[0]));
  const ret = l => l.filter(x => x === "returning" || /^streak\//.test(x));

  // ---- 1. return visits with simulated local dates (Asia/Kolkata) ----
  let ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript(p => { if (!localStorage.getItem("ps2:prefs")) localStorage.setItem("ps2:prefs", p); }, PREFS);
  let p = await ctx.newPage(); watch(p);
  const visit = async (iso, url) => { await ctx.clock.setFixedTime(new Date(iso)); await p.goto(url || BASE + "/?test=1&tutorial=0"); await p.waitForFunction(() => window.PS && PS.days); await p.waitForTimeout(150); return ret(await log(p)); };
  const day = k => { const d = new Date(Date.UTC(2026, 10, 1 + k)); return d.toISOString().slice(0, 10); };
  let l = await visit(day(0) + "T10:00:00+05:30");
  ok(l.join() === "streak/day-1", "first-ever day: streak/day-1 and no 'returning' (" + l.join() + ")");
  const d0 = await p.evaluate(() => JSON.parse(localStorage.getItem("ps2:days")));
  ok(JSON.stringify(d0) === JSON.stringify({ first: day(0), start: day(0), last: day(0) }) && Object.values(d0).every(v => /^\d{4}-\d\d-\d\d$/.test(v)), "only dates are stored: " + JSON.stringify(d0));
  l = await visit(day(0) + "T21:00:00+05:30"); ok(l.length === 0, "second visit the same day: no events (" + l.join() + ")");
  let allGood = true, seen = [];
  for (let k = 1; k <= 31; k++) {
    l = await visit(day(k) + "T09:00:00+05:30");
    const want = ["returning", "streak/" + BUCKET(k + 1)];
    if (l.join() !== want.join()) { allGood = false; console.log("   day", k + 1, "got", l.join(), "want", want.join()); }
    seen.push((k + 1) + ":" + l[1].slice(7));
  }
  ok(allGood, "32 days in a row: 'returning' + the right bucket each day (" + seen.filter((s, i, a) => i === 0 || s.split(":")[1] !== a[i - 1].split(":")[1]).join(" ") + ")");
  l = await visit(day(31) + "T23:30:00+05:30"); ok(l.length === 0, "later the same day: nothing");
  l = await visit(day(33) + "T08:00:00+05:30"); ok(l.join() === "returning,streak/day-1", "after a missed day the streak restarts: " + l.join());
  l = await visit(day(34) + "T00:05:00+05:30"); ok(l.join() === "returning,streak/day-2", "just after local midnight counts as a new day: " + l.join());
  l = await visit(day(30) + "T12:00:00+05:30"); ok(l.length === 0, "clock set back: nothing counted");
  l = await visit(day(35) + "T12:00:00+05:30", BASE + "/?test=1&tutorial=0&mode=daily"); ok(l.join() === "returning,streak/day-3", "the daily page counts the same way: " + l.join());
  await ctx.close();
  // an existing player from before this update (gift opened 3 days ago, no ps2:days yet)
  ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: "Asia/Kolkata" });
  await ctx.addInitScript(p => { if (!localStorage.getItem("ps2:prefs")) { localStorage.setItem("ps2:prefs", p); localStorage.setItem("ps2:levels", JSON.stringify({ unlocked: 6, stars: {}, best: {}, hints: 3, perf: 0, bestPerf: 0, mile: [], threeSince: 0, tips: [], v: 8, login: { last: "2026-11-07", day: 2, streak: 2, best: 2 } })); } }, PREFS);
  p = await ctx.newPage(); watch(p);
  l = await visit("2026-11-10T10:00:00+05:30");
  ok(l.join() === "returning,streak/day-1", "existing player (no ps2:days yet) counts as returning: " + l.join());
  ok(await p.evaluate(() => JSON.parse(localStorage.getItem("ps2:days")).first) === "2026-11-07", "their first day is taken from the gift date");
  await ctx.close();

  // ---- 2. share texts and events ----
  ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(p => { if (!localStorage.getItem("ps2:prefs")) localStorage.setItem("ps2:prefs", p);
    navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; }, PREFS);
  p = await ctx.newPage(); watch(p);
  const linkOf = t => (String(t).trim().split("\n").pop());
  const checkLink = (label, t, want) => { const u = linkOf(t); let parsed = null; try { parsed = new URL(u); } catch (e) {}
    ok(u === want && parsed && parsed.searchParams.get("ref") === "share" && (u.match(/\?/g) || []).length === 1, label + " share text ends with " + u); };
  // daily
  await p.goto(BASE + "/?test=1&tutorial=0&mode=daily"); await p.waitForFunction(() => window.PS && PS.state); await p.waitForTimeout(600);
  await solve(p); await p.waitForSelector("#dlgEnd[open] #btnShare", { timeout: 6000 }); await p.waitForTimeout(400);
  await p.click("#btnShare"); await p.waitForTimeout(300);
  checkLink("daily", await p.evaluate(() => window.__copied), "https://paneslide.com/?ref=share");
  ok((await log(p)).includes("share/daily") && (await log(p)).some(x => /^daily\/solve\//.test(x)), "daily: share/daily and the daily win (daily/solve/...) are counted");
  // past day (practice): the link keeps its date and adds &ref=share
  await p.goto(BASE + "/?test=1&tutorial=0&date=2026-10-28"); await p.waitForFunction(() => window.PS && PS.state); await p.waitForTimeout(600);
  await solve(p); await p.waitForSelector("#dlgEnd[open] #btnShare", { timeout: 6000 }); await p.waitForTimeout(400);
  await p.click("#btnShare"); await p.waitForTimeout(300);
  checkLink("past day", await p.evaluate(() => window.__copied), "https://paneslide.com/?date=2026-10-28&ref=share");
  ok((await log(p)).includes("share/archive") && (await log(p)).some(x => /^archive\/solve\//.test(x)), "past day: share/archive and archive/solve/... are counted");
  // level
  await p.goto(BASE + "/?test=1&tutorial=0&level=3"); await p.waitForFunction(() => window.PS && PS.state); await p.waitForTimeout(600);
  await solve(p); await p.waitForSelector("dialog[open] #btnLvShare", { timeout: 6000 }); await p.waitForTimeout(300);
  await p.click("#btnLvShare"); await p.waitForTimeout(300);
  checkLink("level", await p.evaluate(() => window.__copied), "https://paneslide.com/?mode=levels&ref=share");
  ok((await log(p)).includes("share/level") && (await log(p)).some(x => /^level\/003\/complete\//.test(x)), "level: share/level and level/003/complete/... are counted");
  // milestone (the share button of the rank popup)
  await p.evaluate(() => document.getElementById("btnMileShare").click()); await p.waitForTimeout(300);
  const mt = await p.evaluate(() => window.__copied);
  checkLink("milestone", mt, "https://paneslide.com/?mode=levels&ref=share");
  ok((await log(p)).includes("share/milestone") && /^PaneSlide Levels/.test(mt), "milestone: share/milestone is counted");
  ok(await p.evaluate(() => PS.shareLink({ a: "1 2", ref: "x" })) === "https://paneslide.com/?a=1+2&ref=share", "shareLink merges into an existing query and replaces any other ref");
  // arrivals
  for (const [u, want] of [["/?ref=share&test=1&tutorial=0", true], ["/?mode=levels&ref=share&test=1&tutorial=0", true], ["/?date=2026-10-28&ref=share&test=1&tutorial=0", true], ["/guides/?ref=share&test=1", true], ["/?test=1&tutorial=0", false], ["/?ref=shared&test=1&tutorial=0", false]]) {
    await p.goto(BASE + u); await p.waitForTimeout(700);
    const l2 = await log(p), canon = await p.evaluate(() => (document.querySelector("link[rel=canonical]") || {}).href);
    ok(l2.includes("share/arrival") === want && /^https:\/\/paneslide\.com\/[a-z\/]*$/.test(canon || ""), `${u}: share/arrival ${want ? "counted" : "not counted"}, canonical stays ${canon}`);
  }
  await ctx.close();

  // ---- 3. what would be sent (stub GoatCounter on a fake host), and GPC ----
  const STUB = "window.__gc=[];window.goatcounter={count:function(o){window.__gc.push(o)}};";
  const port = new URL(BASE).port || 80;
  for (const gpc of [false, true]) {
    ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
    await ctx.route("https://gc.zgo.at/count.js", r => r.fulfill({ contentType: "text/javascript", body: STUB }));
    await ctx.addInitScript(([p, gpc]) => { localStorage.setItem("ps2:prefs", p); localStorage.setItem("ps2:days", JSON.stringify({ first: "2026-10-01", start: "2026-10-01", last: "2026-10-02" }));
      if (gpc) Object.defineProperty(Navigator.prototype, "globalPrivacyControl", { get: () => true }); }, [PREFS, gpc]);
    p = await ctx.newPage(); watch(p);
    await p.goto(`http://paneslide.test:${port}/?ref=share&tutorial=0`); await p.waitForTimeout(5800);
    const sent = await p.evaluate(() => window.__gc ? window.__gc.map(o => o.path) : null);
    if (!gpc) ok(sent && ["event/share/arrival", "event/returning", "event/streak/day-1"].every(x => sent.includes(x)) && !sent.some(x => /ref=|\?/.test(x)), "sent: " + (sent || []).join(", "));
    else ok(sent === null, "Global Privacy Control: GoatCounter never loads, no share/return events sent");
    await ctx.close();
  }
  ok(!errs.length, "no console errors, page errors or failed requests " + errs.slice(0, 5).join(" | "));
  await b.close(); console.log(bad ? `FAIL: ${bad} of ${n}` : `OK: ${n} checks (share links, share events, return visits)`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
