// App icons and the social share image, drawn in Chrome from our own SVG art.
//   PW=$(npm root -g)/playwright-core node tools/make-icons.js
const pw = require(process.env.PW || "playwright-core"), fs = require("fs"), path = require("path");
const S = require("./site/board-svg.js"), ROOT = path.join(__dirname, "..");
const font = "data:font/woff2;base64," + fs.readFileSync(path.join(ROOT, "fonts/fredoka-latin.woff2")).toString("base64");
const mark = (s) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="${s}" height="${s}"><g style="isolation:isolate" transform="translate(2 0)"><rect x="5" y="7" width="17" height="17" rx="5" fill="#3CC8F0" style="mix-blend-mode:multiply"/><rect x="14" y="7" width="17" height="17" rx="5" fill="#F0509A" style="mix-blend-mode:multiply"/><rect x="9.5" y="16" width="17" height="17" rx="5" fill="#FFD84A" style="mix-blend-mode:multiply"/></g></svg>`;
const icon = (size, pad, round) => `<div style="width:${size}px;height:${size}px;background:#FFFDF8;border-radius:${round ? size * 0.22 : 0}px;display:flex;align-items:center;justify-content:center"><div style="width:${size * (1 - pad)}px;height:${size * (1 - pad)}px">${mark(size * (1 - pad))}</div></div>`;
const og = () => `<div style="width:1200px;height:630px;background:linear-gradient(135deg,#3B1F7A,#6A2FB8 55%,#E8553D);display:flex;align-items:center;gap:56px;padding:0 80px;box-sizing:border-box;font-family:Fredoka">
  <div style="flex:1;color:#fff">
    <div style="display:flex;align-items:center;gap:18px"><div style="background:#FFFDF8;border-radius:24px;width:96px;height:96px;display:flex;align-items:center;justify-content:center">${mark(84)}</div><div style="font-size:92px;font-weight:700;letter-spacing:-1px">PaneSlide</div></div>
    <div style="font-size:44px;font-weight:600;line-height:1.2;margin-top:28px">Slide the glass.<br>Mix the colours.<br>Match the picture.</div>
    <div style="font-size:28px;font-weight:500;margin-top:26px;opacity:.92">A free daily colour puzzle · paneslide.com</div>
  </div>
  <div style="background:#fff;border-radius:34px;padding:16px;box-shadow:0 10px 0 rgba(0,0,0,.18)">${S.board({ n: 3, size: 380, arrows: false, panes: [{ c: "C", r: 1, col: 0, w: 3, h: 1, axis: "h" }, { c: "M", r: 0, col: 1, w: 1, h: 3, axis: "v" }, { c: "Y", r: 1, col: 2, w: 1, h: 2, axis: "v" }] })}</div>
</div>`;
const page = (body) => `<!doctype html><html><head><style>@font-face{font-family:Fredoka;src:url(${font}) format("woff2");font-weight:500 700}html,body{margin:0;background:transparent}</style></head><body>${body}</body></html>`;
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
  fs.mkdirSync(path.join(ROOT, "icons"), { recursive: true });
  const jobs = [
    ["icons/icon-192.png", 192, icon(192, 0.08, true), true],
    ["icons/icon-512.png", 512, icon(512, 0.08, true), true],
    ["icons/icon-maskable-512.png", 512, icon(512, 0.3, false), false],
    ["icons/apple-touch-icon.png", 180, icon(180, 0.12, false), false],
    ["img/og.png", [1200, 630], og(), false]
  ];
  for (const [file, sz, html, transparent] of jobs) {
    const [w, h] = Array.isArray(sz) ? sz : [sz, sz];
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(page(html)); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150);
    await p.screenshot({ path: path.join(ROOT, file), omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
    await p.close(); console.log("wrote", file);
  }
  await b.close();
})();
