// Checks every internal link, image and #anchor in the built HTML:  node tools/check-links.js [--external]
const fs = require("fs"), path = require("path"), ROOT = path.join(__dirname, "..");
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { if (/^(node_modules|\.git|tools|content|screenshots)$/.test(f)) continue; const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith(".html")) files.push(p); } })(ROOT);
const ids = f => new Set([...fs.readFileSync(f, "utf8").matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const target = (from, u) => { let p = u.startsWith("/") ? path.join(ROOT, u) : path.join(path.dirname(from), u); if (u.endsWith("/") || (fs.existsSync(p) && fs.statSync(p).isDirectory())) p = path.join(p, "index.html"); return p; };
let bad = 0, n = 0; const ext = new Set();
for (const f of files) {
  const html = fs.readFileSync(f, "utf8");
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    let u = m[1].replace(/&amp;/g, "&");
    if (/^(mailto:|tel:|data:|javascript:)/.test(u) || u.startsWith("&#")) continue;
    if (/^https?:/.test(u)) { if (/^https:\/\/(paneslide\.com|paneslide\.github\.io)(\/|$)/.test(u)) u = u.replace(/^https:\/\/[^\/]+/, "") || "/"; else { ext.add(u); continue; } }
    n++;
    const [p0, hash] = u.split("#"); const p1 = p0.split("?")[0];
    const t = p1 ? target(f, p1) : f;
    if (!fs.existsSync(t)) { bad++; console.log("✗", path.relative(ROOT, f), "→", u); continue; }
    if (hash && t.endsWith(".html") && !ids(t).has(hash)) { bad++; console.log("✗ anchor", path.relative(ROOT, f), "→", u); }
  }
}
console.log(`${files.length} pages, ${n} internal links, ${bad} broken, ${ext.size} external`);
(async () => {
  if (process.argv.includes("--external")) for (const u of ext) {
    try { const r = await fetch(u, { method: "GET", redirect: "follow", headers: { "user-agent": "Mozilla/5.0 link-check" } }); const soft = r.status === 429 || r.status === 403; console.log(r.status < 400 ? "✓" : soft ? "? (rate-limited/blocked bot, check by hand)" : "✗", r.status, u); if (r.status >= 400 && !soft) bad++; } catch (e) { console.log("? ", e.message, u); }
  }
  process.exit(bad ? 1 : 0);
})();
