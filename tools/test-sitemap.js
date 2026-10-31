// Checks sitemap.xml <lastmod>: one W3C date (YYYY-MM-DD) per page, never before the page's source file's last
// commit (IST), never in the future, and a rebuild gives the same sitemap.   node tools/test-sitemap.js
const fs = require("fs"), path = require("path"), cp = require("child_process");
const ROOT = path.join(__dirname, ".."); let bad = 0, n = 0; const ok = (c, m) => { n++; if (!c) bad++; console.log((c ? "✓ " : "✗ ") + m); };
const git = (...a) => cp.execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();
const ist = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), today = ist(Date.now());
const sm = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
const rows = [...sm.matchAll(/<url><loc>https:\/\/paneslide\.com(\/[^<]*)<\/loc><lastmod>([^<]*)<\/lastmod>/g)].map(m => [m[1], m[2]]);
ok(rows.length === (sm.match(/<url>/g) || []).length && rows.length >= 40, rows.length + " URLs, each with a <lastmod>");
ok(rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r[1]) && !isNaN(Date.parse(r[1]))), "every lastmod is a W3C date (YYYY-MM-DD)");
ok(rows.every(r => r[1] <= today), "no lastmod in the future (today " + today + " IST)");
const src = u => { const g = /^\/guides\/([^/]+)\/$/.exec(u), p = /^\/([^/]+)\/$/.exec(u);
  if (g) return "content/guides/" + fs.readdirSync(path.join(ROOT, "content/guides")).find(f => f.replace(/^\d+-/, "") === g[1] + ".md");
  if (p && fs.existsSync(path.join(ROOT, "content/pages", p[1] + ".md"))) return "content/pages/" + p[1] + ".md"; return null; };
const late = rows.filter(r => { const f = src(r[0]); if (!f) return false; const dirty = git("status", "--porcelain", "--", f); const d = dirty ? today : ist(git("log", "-1", "--format=%cI", "--", f)); return r[1] < d; });
ok(late.length === 0, "no page is dated before its source file's last change" + (late.length ? ": " + late.map(r => r[0]).join(", ") : ""));
ok(new Set(rows.map(r => r[1])).size > 1, "pages have their own dates (" + [...new Set(rows.map(r => r[1]))].sort().join(", ") + ")");
cp.execFileSync("node", [path.join(__dirname, "build-site.js")], { stdio: "ignore" });
ok(fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8") === sm, "a rebuild gives the same sitemap");
console.log(bad ? `FAIL: ${bad} of ${n}` : `OK: ${n} sitemap checks`); process.exit(bad ? 1 : 0);
