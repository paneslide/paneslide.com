// Builds the PaneSlide website pages from content/ into static HTML (no server, no build step on GitHub).
// Usage: node tools/build-site.js        Reads site.config.js (the one settings file).
// Writes: about/ how-to-play/ privacy/ terms/ contact/ archive/ guides/ 404.html sitemap.xml robots.txt
//         manifest.webmanifest sw.js, and updates the marked blocks in index.html.
const fs = require("fs"), path = require("path"), vm = require("vm"), crypto = require("crypto"), cp = require("child_process");
const ROOT = path.join(__dirname, "..");
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, "site.config.js"), "utf8"), ctx);
const CFG = ctx.window.PANESLIDE_CONFIG, URL0 = CFG.SITE_URL.replace(/\/$/, "");
const FIG = require("./site/figures.js");
const SHOTS = fs.existsSync(path.join(ROOT, "img/guides/shots.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "img/guides/shots.json"), "utf8")) : {};
const V = "13"; // asset version for css/js links
const TODAY = process.env.BUILD_DATE || "2026-10-29";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const obf = s => s.split("").map(ch => "&#" + ch.charCodeAt(0) + ";").join(""); // light scraper protection, still a normal link
const EMAIL = CFG.CONTACT_EMAIL && CFG.CONTACT_EMAIL.indexOf("@") > 0 ? CFG.CONTACT_EMAIL : "";
const emailLink = () => EMAIL ? `<a href="${obf("mailto:" + EMAIL)}">${obf(EMAIL)}</a>` : "our contact page";

// ---------- tiny markdown (only what our content uses) ----------
function inline(t) {
  return esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, h) => { h = h.replace(/&amp;/g, "&"); const ext = /^https?:/.test(h); return `<a href="${esc(h)}"${ext ? ' rel="noopener"' : ""}>${a}</a>`; })
    .replace(/\{\{EMAIL\}\}/g, emailLink());
}
function slugify(t) { return t.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function md(src, page) {
  const out = [], toc = [], lines = src.replace(/\r/g, "").split("\n"); let i = 0, faq = [];
  while (i < lines.length) {
    let l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^<[a-z!]/i.test(l.trim())) { const buf = []; while (i < lines.length && lines[i].trim()) buf.push(lines[i++]); out.push(buf.join("\n")); continue; }
    let m;
    if ((m = l.match(/^(#{2,3}) (.*)$/))) { const lv = m[1].length, id = slugify(m[2]); if (lv === 2) toc.push([id, m[2]]); out.push(`<h${lv} id="${id}">${inline(m[2])}</h${lv}>`); i++;
      if (page.faq && lv === 3) { const ans = []; while (i < lines.length && !/^#{2,3} /.test(lines[i])) ans.push(lines[i++]); faq.push([m[2], ans.join(" ").replace(/\s+/g, " ").trim()]); out.push(md(ans.join("\n"), {}).html); }
      continue; }
    if ((m = l.match(/^::fig (\S+)/))) { out.push(FIG.render(m[1])); i++; continue; }
    if ((m = l.match(/^::shot (\S+) \| ([^|]+) \| (.+)$/))) { const sh = SHOTS[m[1]] || { w: 360, h: 360 }; out.push(`<figure class="s-fig"><img src="/img/guides/${m[1]}.webp" width="${sh.w}" height="${sh.h}" alt="${esc(m[2].trim())}" loading="lazy" decoding="async"><figcaption>${inline(m[3].trim())}</figcaption></figure>`); i++; continue; }
    if (l.trim() === "::ad") { out.push(adSlot("guide")); i++; continue; }
    if (/^> /.test(l)) { const buf = []; while (i < lines.length && /^> ?/.test(lines[i])) buf.push(lines[i++].replace(/^> ?/, "")); out.push(`<div class="s-tip">${md(buf.join("\n"), {}).html}</div>`); continue; }
    if (/^- /.test(l)) { const buf = []; while (i < lines.length && /^(- |  \S)/.test(lines[i])) { if (/^- /.test(lines[i])) buf.push(lines[i].slice(2)); else buf[buf.length - 1] += " " + lines[i].trim(); i++; } out.push("<ul>" + buf.map(x => `<li>${inline(x)}</li>`).join("") + "</ul>"); continue; }
    if (/^\d+\. /.test(l)) { const buf = []; while (i < lines.length && /^(\d+\. |   \S)/.test(lines[i])) { if (/^\d+\. /.test(lines[i])) buf.push(lines[i].replace(/^\d+\. /, "")); else buf[buf.length - 1] += " " + lines[i].trim(); i++; } out.push("<ol>" + buf.map(x => `<li>${inline(x)}</li>`).join("") + "</ol>"); continue; }
    if (/^\|/.test(l)) { const rows = []; while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]); const cells = r => r.replace(/^\||\|$/g, "").split("|").map(x => x.trim());
      const head = cells(rows[0]), body = rows.slice(2).map(cells);
      out.push(`<div class="s-tablewrap"><table class="s-table"><thead><tr>${head.map(h => `<th scope="col">${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`); continue; }
    const buf = []; while (i < lines.length && lines[i].trim() && !/^(#{2,3} |::|> |- |\d+\. |\||<[a-z])/i.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return { html: out.join("\n"), toc, faq };
}
function readDoc(file) {
  const raw = fs.readFileSync(file, "utf8"), m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const meta = {}; m[1].split("\n").forEach(l => { const k = l.indexOf(":"); if (k > 0) meta[l.slice(0, k).trim()] = l.slice(k + 1).trim(); });
  return { meta, body: m[2] };
}
function words(html) { return html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length; }

// ---------- shared layout ----------
const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#FFFDF8"/><g style="mix-blend-mode:multiply"><rect x="5" y="7" width="17" height="17" rx="5" fill="#3CC8F0"/></g><g style="mix-blend-mode:multiply"><rect x="14" y="7" width="17" height="17" rx="5" fill="#F0509A"/></g><g style="mix-blend-mode:multiply"><rect x="9.5" y="16" width="17" height="17" rx="5" fill="#FFD84A"/></g></svg>`;
const NAV = [["/", "Play", "play"], ["/?mode=daily", "Daily"], ["/archive/", "Archive"], ["/guides/", "Guides"], ["/about/", "About"]];
function header(cur) {
  return `<a class="s-skip" href="#main">Skip to content</a>
<header class="s-head"><a class="s-brand" href="/" aria-label="PaneSlide home, play the game">${LOGO}Pane<span>Slide</span></a>
<nav class="s-nav" aria-label="Main">${NAV.map(n => `<a href="${n[0]}"${n[2] ? ` class="${n[2]}"` : ""}${cur && cur === n[0] ? ' aria-current="page"' : ""}>${n[1]}</a>`).join("")}</nav></header>`;
}
function footer() {
  return `<footer class="s-foot"><nav aria-label="Footer">${[["/", "Play"], ["/?mode=daily", "Daily puzzle"], ["/archive/", "Archive"], ["/guides/", "Guides"], ["/how-to-play/", "How to play"], ["/whats-new/", "What's new"], ["/about/", "About"], ["/privacy/", "Privacy Policy"], ["/terms/", "Terms of Use"], ["/contact/", "Contact"]].map(a => `<a href="${a[0]}">${a[1]}</a>`).join("")}</nav>
<p>PaneSlide is a free colour-glass sliding puzzle. No sign-up, no downloads; your progress stays on your device.</p>
<p>© 2026 PaneSlide · ${EMAIL ? emailLink() : '<a href="/contact/">Contact</a>'}</p>
<button type="button" class="s-btn purple" data-install hidden>📲 Install the app</button></footer>`;
}
function adSlot(name) { return `<div class="ad-slot" data-slot="${name}" hidden></div>`; }
const ORG = { "@type": "Organization", name: "PaneSlide", url: URL0 + "/", logo: { "@type": "ImageObject", url: URL0 + "/icons/icon-512.png", width: 512, height: 512 } };
function headTags(p) {
  const url = URL0 + p.url, img = URL0 + (p.image || "/img/og.png");
  const ld = [{ "@context": "https://schema.org", "@type": "WebSite", name: "PaneSlide", url: URL0 + "/", inLanguage: "en", publisher: ORG }].concat(p.ld || []);
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="only light">
<meta name="darkreader-lock">
<meta name="theme-color" content="#3B1F7A">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.desc)}">
<link rel="canonical" href="${url}">${p.noindex ? '\n<meta name="robots" content="noindex">' : ""}${CFG.GSC_VERIFICATION ? `\n<meta name="google-site-verification" content="${esc(CFG.GSC_VERIFICATION)}">` : ""}
<meta property="og:type" content="${p.ogType || "website"}">
<meta property="og:site_name" content="PaneSlide">
<meta property="og:title" content="${esc(p.ogTitle || p.title)}">
<meta property="og:description" content="${esc(p.desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="PaneSlide: coloured glass panes sliding on a board">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.ogTitle || p.title)}">
<meta name="twitter:description" content="${esc(p.desc)}">
<meta name="twitter:image" content="${img}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/icon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<script type="application/ld+json">${JSON.stringify(ld.length === 1 ? ld[0] : ld).replace(/</g, "\\u003c")}</script>`;
}
function page(p) {
  return `<!doctype html>
<html lang="en" class="site">
<head>
${headTags(p)}
<link rel="preload" href="/fonts/fredoka-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css?v=${V}">
</head>
<body class="site">
${header(p.nav)}
<main id="main" class="s-main">
${p.body}
</main>
${footer()}
<script src="/site.config.js?v=${V}"></script>
<script src="/js/migrate.js?v=${V}"></script>
<script src="/js/site.js?v=${V}" defer></script>${(p.scripts || []).map(s => `\n<script src="${s}?v=${V}" defer></script>`).join("")}
</body>
</html>
`;
}
const written = [];
const OUT = {}; // what this build wrote, by file (for the sitemap dates)
function write(rel, html) { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); written.push(rel); OUT[rel] = html; }
const sitemap = [];
// addMap(url, priority, built file, source files): the sitemap <lastmod> is worked out from git, see lastMod() below
function addMap(url, pri, out, src) { sitemap.push([url, pri, out, src || []]); }

// ---------- guides ----------
const GUIDE_DIR = path.join(ROOT, "content/guides");
const guides = fs.readdirSync(GUIDE_DIR).filter(f => f.endsWith(".md")).sort().map(f => { const d = readDoc(path.join(GUIDE_DIR, f)); return Object.assign({ slug: f.replace(/^\d+-/, "").replace(/\.md$/, ""), file: f }, d); });
const report = [];
const groups = [["Start here", "start"], ["Strategy", "strategy"], ["Every kind of glass", "mechanic"], ["Chapter by chapter", "chapters"], ["Colour and light", "colour"], ["Play anywhere", "device"], ["Puzzle world", "puzzles"], ["Puzzles and you", "life"]];
guides.forEach((g, gi) => {
  const r = md(g.body, { faq: g.meta.faq === "yes" }), url = `/guides/${g.slug}/`, wc = words(r.html);
  report.push([g.slug, wc, g.meta.title]);
  const related = (g.meta.related || "").split(",").map(s => s.trim()).filter(Boolean).map(s => guides.find(x => x.slug === s)).filter(Boolean);
  const ld = [{ "@context": "https://schema.org", "@type": "Article", headline: g.meta.h1 || g.meta.title, description: g.meta.desc, image: [URL0 + (SHOTS[g.meta.image] ? "/img/guides/" + g.meta.image + ".webp" : "/img/og.png")], datePublished: g.meta.date || TODAY, dateModified: g.meta.updated || g.meta.date || TODAY, author: { "@type": "Organization", name: "PaneSlide", url: URL0 + "/about/" }, publisher: ORG, mainEntityOfPage: URL0 + url, inLanguage: "en" },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: URL0 + "/" }, { "@type": "ListItem", position: 2, name: "Guides", item: URL0 + "/guides/" }, { "@type": "ListItem", position: 3, name: g.meta.h1 || g.meta.title, item: URL0 + url }] }];
  if (r.faq.length) ld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: r.faq.map(q => ({ "@type": "Question", name: q[0], acceptedAnswer: { "@type": "Answer", text: q[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*\*?/g, "") } })) });
  const toc = r.toc.length >= 3 ? `<nav class="s-toc" aria-label="On this page"><b>On this page</b><ol>${r.toc.map(t => `<li><a href="#${t[0]}">${inline(t[1])}</a></li>`).join("")}</ol></nav>` : "";
  const body = `<div class="s-hero"><p class="s-crumbs"><a href="/">Home</a> › <a href="/guides/">Guides</a></p><h1>${esc(g.meta.h1 || g.meta.title)}</h1><p>${esc(g.meta.desc)}</p></div>
<div class="s-layout">
<article class="s-card s-prose" aria-labelledby="t">
<p class="s-meta" id="t">${esc(g.meta.kicker || "Guide")} · ${Math.max(1, Math.round(wc / 220))} min read · Updated ${fmtDate(g.meta.updated || g.meta.date || TODAY)}</p>
${toc}
${r.html}
<div class="s-cta"><a class="s-btn" href="${g.meta.cta || "/"}">▶ ${esc(g.meta.ctaText || "Play PaneSlide")}</a><a class="s-btn white" href="/guides/">All guides</a></div>
${related.length ? `<section class="s-related" aria-label="Related guides"><h2>Keep reading</h2><div class="s-grid">${related.map(cardLink).join("")}</div></section>` : ""}
</article>
<aside class="s-side" aria-label="Guide navigation">
${r.toc.length >= 3 ? `<nav class="s-sidebox" aria-label="Sections of this guide"><b>On this page</b><ol>${r.toc.map(t => `<li><a href="#${t[0]}">${inline(t[1])}</a></li>`).join("")}</ol></nav>` : ""}
<nav class="s-sidebox" aria-label="More guides in this section"><b>${esc((groups.find(x => x[1] === (g.meta.group || "start")) || groups[0])[0])}</b><ul>${guides.filter(x => (x.meta.group || "start") === (g.meta.group || "start")).map(x => `<li><a href="/guides/${x.slug}/"${x === g ? ' aria-current="page"' : ""}>${esc(x.meta.h1 || x.meta.title)}</a></li>`).join("")}</ul><a class="s-sideall" href="/guides/">All guides →</a></nav>
</aside>
</div>
${adSlot("guide")}`;
  write(`guides/${g.slug}/index.html`, page({ url, title: `${g.meta.title} · PaneSlide`, ogTitle: g.meta.h1 || g.meta.title, desc: g.meta.desc, body, nav: "/guides/", ogType: "article", ld }));
  addMap(url, "0.7", `guides/${g.slug}/index.html`, [`content/guides/${g.file}`]);
});
function cardLink(g) { return `<a class="s-cardlink" href="/guides/${g.slug}/"><span class="ic" aria-hidden="true">${g.meta.icon || "📘"}</span><h3>${esc(g.meta.h1 || g.meta.title)}</h3><p>${esc(g.meta.desc)}</p></a>`; }
function fmtDate(s) { const d = new Date(s + "T12:00:00Z"); return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); }
write("guides/index.html", page({ url: "/guides/", title: "PaneSlide guides: rules, strategy and every kind of glass", desc: "Free guides to PaneSlide: how gliding and sticking work, how glass colours mix, strategy for perfect solves, every special glass, daily habit tips and the history of sliding puzzles.", nav: "/guides/",
  ld: [{ "@context": "https://schema.org", "@type": "CollectionPage", name: "PaneSlide guides", url: URL0 + "/guides/", hasPart: guides.map(g => ({ "@type": "Article", headline: g.meta.h1 || g.meta.title, url: URL0 + `/guides/${g.slug}/` })) }],
  body: `<div class="s-hero"><span class="s-kicker">Guides</span><h1>Get better at PaneSlide</h1><p>${guides.length} short, original guides written by the PaneSlide team: the rules, the strategy, and every special kind of glass, with diagrams drawn from the real game.</p></div>
${groups.map(gr => { const list = guides.filter(g => (g.meta.group || "start") === gr[1]); return list.length ? `<section class="s-card" aria-labelledby="g-${gr[1]}"><h2 id="g-${gr[1]}" style="font:700 24px/1.2 Fredoka,system-ui,sans-serif;margin:0 0 14px">${gr[0]}</h2><div class="s-grid">${list.map(cardLink).join("")}</div></section>` : ""; }).join("\n")}` }));
addMap("/guides/", "0.8", "guides/index.html", []);

// ---------- trust pages ----------
const PAGE_DIR = path.join(ROOT, "content/pages");
fs.readdirSync(PAGE_DIR).filter(f => f.endsWith(".md")).forEach(f => {
  const d = readDoc(path.join(PAGE_DIR, f)), slug = f.replace(/\.md$/, ""), url = `/${slug}/`;
  let body = d.body.replace(/\{\{ADS_STATUS\}\}/g, CFG.ADS_ENABLED ? "PaneSlide **shows ads** from Google AdSense." : "**Right now PaneSlide shows no ads.** We plan to apply to Google AdSense; this section explains what will happen when ads are switched on, and we will update the date at the top when they are.")
    .replace(/\{\{ANALYTICS_STATUS\}\}/g, CFG.ANALYTICS_ENABLED ? "We use **GoatCounter**, a privacy-friendly analytics service that uses no cookies, to count page views and a short list of anonymous game events (listed below). It never receives your name, email or game progress." : "**Right now PaneSlide uses no analytics at all.** If we switch it on, we will use **GoatCounter**, a privacy-friendly service, only to count page views and the anonymous game events listed below.")
    .replace(/\{\{UPDATED\}\}/g, fmtDate(d.meta.updated || TODAY));
  const r = md(body, {});
  const ld = [{ "@context": "https://schema.org", "@type": d.meta.type || "WebPage", name: d.meta.h1, url: URL0 + url, description: d.meta.desc, inLanguage: "en", isPartOf: { "@type": "WebSite", name: "PaneSlide", url: URL0 + "/" } }];
  write(`${slug}/index.html`, page({ url, title: d.meta.title, desc: d.meta.desc, nav: url, ld, scripts: d.meta.scripts ? d.meta.scripts.split(",").map(s => s.trim()) : [],
    body: `<div class="s-hero"><span class="s-kicker">${esc(d.meta.kicker || "PaneSlide")}</span><h1>${esc(d.meta.h1)}</h1>${d.meta.lead ? `<p>${esc(d.meta.lead)}</p>` : ""}</div>
<div class="s-card s-prose">
${r.html}
${d.meta.cta === "no" ? "" : `<div class="s-cta"><a class="s-btn" href="/">▶ Play PaneSlide</a></div>`}
</div>` }));
  addMap(url, d.meta.priority || "0.5", `${slug}/index.html`, [`content/pages/${f}`]);
});

// ---------- 404 ----------
write("404.html", page({ url: "/404.html", title: "Page not found · PaneSlide", desc: "This page does not exist. Play today's PaneSlide puzzle or read the guides.", noindex: true,
  body: `<div class="s-hero"><span class="s-kicker">Error 404</span><h1>This pane slid away</h1><p>We couldn't find that page. It may have moved, or the link may have a typo.</p></div>
<div class="s-card s-prose" style="text-align:center">${FIG.render("lost", true)}<p>Try one of these instead:</p><div class="s-cta"><a class="s-btn" href="/">▶ Play</a><a class="s-btn blue" href="/?mode=daily">Today's daily</a><a class="s-btn white" href="/guides/">Guides</a></div></div>` }));

// ---------- the game page (index.html): head tags and the intro/footer block ----------
let idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const gameLd = { "@context": "https://schema.org", "@type": "VideoGame", name: "PaneSlide", url: URL0 + "/", description: "A free colour-glass sliding puzzle for the web browser. Slide glass panes so the window matches the picture; where glass overlaps, colours mix. A new daily puzzle plus endless levels.", genre: ["Puzzle"], gamePlatform: "Web browser", applicationCategory: "Game", operatingSystem: "Any", playMode: "SinglePlayer", inLanguage: "en", isAccessibleForFree: true, image: URL0 + "/img/og.png", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, publisher: ORG };
const gameHead = headTags({ url: "/", title: "PaneSlide · slide the glass, copy the picture", desc: "PaneSlide is a free colour-glass sliding puzzle game. Slide glass panes so the window matches the picture. Where glass overlaps, colours mix. A new daily puzzle plus endless levels.", ld: [gameLd] })
  .replace(/^<meta charset="utf-8">\n<meta name="viewport"[^\n]*\n/, "");
idx = idx.replace(/<!--site-head-->[\s\S]*?<!--\/site-head-->/, `<!--site-head-->\n${gameHead}\n<link rel="stylesheet" href="css/site.css?v=${V}">\n<!--/site-head-->`);
const intro = `<!--site-intro-->
<div class="home-site">
 <section class="s-card" aria-labelledby="aboutGame">
  <h2 id="aboutGame">A calm colour puzzle, new every day</h2>
  <p>PaneSlide is a free sliding puzzle made of coloured glass. Swipe the panes along their rails until the board matches the small picture. Cyan, magenta and yellow glass mix where they overlap, just like real colour filters, so blue, green, red and black only appear where panes cross.</p>
  <p>There is one new <a class="s-link" href="/?mode=daily">daily puzzle</a> for everyone, an <a class="s-link" href="/archive/">archive</a> of past days, and endless levels that teach nine kinds of special glass one at a time. New here? Read <a class="s-link" href="/how-to-play/">how to play</a> or browse the <a class="s-link" href="/guides/">guides</a>.</p>
 </section>
 ${adSlot("game")}
 ${footer()}
</div>
<!--/site-intro-->`;
idx = idx.replace(/<!--site-intro-->[\s\S]*?<!--\/site-intro-->/, intro);
idx = idx.replace(/<!--site-js-->[\s\S]*?<!--\/site-js-->/, `<!--site-js--><script src="site.config.js?v=${V}"></script>\n<script src="js/migrate.js?v=${V}"></script>\n<script src="js/site.js?v=${V}" defer></script><!--/site-js-->`);
fs.writeFileSync(path.join(ROOT, "index.html"), idx); written.push("index.html"); OUT["index.html"] = idx;
addMap("/", "1.0", "index.html", []);

// ---------- sitemap, robots, manifest ----------
// <lastmod> for each page = the newer of
//   (a) the last git commit of the page's source file (content/guides/*.md, content/pages/*.md), and
//   (b) the last commit in which the page's own content changed because of the template (build-site.js, figures,
//       shared blocks): found by walking the git history of the BUILT file and comparing only its content
//       (<main> for site pages; for the game page everything outside the head tags), with ?v= asset versions removed,
//       so version bumps, header/footer and head-tag changes do not count.
// A file with uncommitted changes counts as changed today. Dates are W3C dates (YYYY-MM-DD) in IST, the site's time zone.
// BUILD_DATE=YYYY-MM-DD overrides "today"; without git every page gets today.
const git = (...a) => { try { return cp.execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }); } catch (e) { return null; } };
const istDay = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const NOW_DAY = process.env.BUILD_DATE || istDay(Date.now());
const HAS_GIT = git("rev-parse", "--is-inside-work-tree") !== null && git("rev-parse", "--is-shallow-repository") !== "true\n";
const contentOf = (rel, html) => (rel === "index.html" ? html.replace(/<!--site-head-->[\s\S]*?<!--\/site-head-->/, "") : ((/<main[\s\S]*?<\/main>/.exec(html) || [html])[0])).replace(/\?v=[\w.-]+/g, "");
function sourceDay(files) {
  if (!files.length) return null;
  if ((git("status", "--porcelain", "--", ...files) || "").trim()) return NOW_DAY;
  const d = (git("log", "-1", "--format=%cI", "--", ...files) || "").trim(); return d ? istDay(d) : NOW_DAY;
}
function contentDay(rel) {
  const now = contentOf(rel, OUT[rel]), log = (git("log", "--format=%H %cI", "--", rel) || "").trim().split("\n").filter(Boolean).map(l => l.split(" "));
  let day = NOW_DAY;
  for (const [h, d] of log) { const old = git("show", `${h}:${rel}`); if (old === null || contentOf(rel, old) !== now) break; day = istDay(d); }
  return day; // the oldest commit in the latest run of commits with this same content (today if it differs from every commit)
}
function lastMod(s) { if (!HAS_GIT) return NOW_DAY; return [sourceDay(s[3]), contentDay(s[2])].filter(Boolean).sort().pop(); }
sitemap.forEach(s => { s[4] = lastMod(s); if (!/^\d{4}-\d{2}-\d{2}$/.test(s[4])) throw new Error("bad lastmod for " + s[0]); });
write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.sort((a, b) => b[1] - a[1]).map(s => `  <url><loc>${URL0}${s[0]}</loc><lastmod>${s[4]}</lastmod><priority>${s[1]}</priority></url>`).join("\n")}\n</urlset>\n`);
write("robots.txt", `User-agent: *\nAllow: /\nDisallow: /tools/\nDisallow: /content/\n\nSitemap: ${URL0}/sitemap.xml\n`);
write("manifest.webmanifest", JSON.stringify({ name: "PaneSlide: colour glass puzzle", short_name: "PaneSlide", description: "Slide the glass, copy the picture. A calm daily colour puzzle.", id: "/", start_url: "/", scope: "/", display: "standalone", orientation: "portrait", background_color: "#2B1466", theme_color: "#3B1F7A", categories: ["games", "puzzle"],
  icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }],
  screenshots: fs.existsSync(path.join(ROOT, "img/app-home.png")) ? [{ src: "/img/app-home.png", sizes: "390x844", type: "image/png", form_factor: "narrow", label: "PaneSlide home screen" }] : [] }, null, 2) + "\n");

// ---------- service worker: versioned cache, precache the game and guides ----------
const PRE = ["/", "/index.html", "/css/style.css?v=" + V, "/css/site.css?v=" + V, "/js/engine.js?v=" + V, "/js/game.js?v=" + V, "/js/levels.js?v=" + V, "/js/site.js?v=" + V, "/js/archive.js?v=" + V, "/js/migrate.js?v=" + V, "/site.config.js?v=" + V,
  "/fonts/fredoka-latin.woff2", "/favicon.svg", "/manifest.webmanifest", "/icons/icon-192.png", "/404.html"].concat(sitemap.map(s => s[0]).filter(u => u !== "/"));
const hash = crypto.createHash("sha1"); ["index.html", "css/style.css", "css/site.css", "js/engine.js", "js/game.js", "js/levels.js", "js/site.js", "js/archive.js", "js/migrate.js", "site.config.js"].concat(written.filter(w => /\.html$/.test(w))).forEach(f => hash.update(fs.readFileSync(path.join(ROOT, f))));
const VER = "psc-" + hash.digest("hex").slice(0, 10);
write("sw.js", fs.readFileSync(path.join(__dirname, "site/sw-template.js"), "utf8").replace("__VERSION__", VER).replace("__PRECACHE__", JSON.stringify(PRE, null, 1)));

// ---------- report ----------
console.log("Guides (" + guides.length + "):"); report.forEach(r => console.log(String(r[1]).padStart(5), "words ", r[0]));
console.log("Wrote", written.length, "files; cache", VER);
if (process.argv.includes("--check")) { const bad = report.filter(r => r[1] < 600 || r[1] > 1200); if (bad.length) { console.log("Word count out of range:", bad.map(b => b[0] + "=" + b[1]).join(", ")); process.exit(1); } }
