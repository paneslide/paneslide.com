# PaneSlide

A free daily puzzle. **Swipe the glass to copy the picture. Where glass overlaps, colours mix.**

- **Glide rules (v3, levels and dailies from 2026-10-30):** swipe a pane and it glides along its rail (↔ or ↕). It stops at the board edge, or just before glass that goes the same way, or it **sticks** the moment it slides onto new colour (more overlap with crossing glass). You can't place a pane wherever you like, so the order of your swipes matters and you have to plan.
- Cyan, magenta and yellow glass mix like real filters: C+M = blue, C+Y = green, M+Y = red, all three = black.
- You win the moment the board matches the picture. **Par** is the true shortest number of swipes (found by a full search). Undo is always there. Moves are not refunded, and you get a "Stuck! Undo" tip if a move makes the picture impossible.
- There is one new puzzle a day (#1 = 2026-10-27). Monday is the easiest and the weekend is the hardest. Every puzzle has exactly one solution. Dailies before 2026-10-30 keep the old drag rules, so a daily never changes on the day it is played.
- First-time players get a 20-second 3×3 tutorial. Players from before v3 see it once more for the new rules. Press "?" any time for help.
- The share result is spoiler-free: one coloured square per move.

Static site: no server, no accounts. To host it, publish this folder on GitHub Pages. The game itself has no build step; the website pages (guides, privacy and so on) are generated once by `node tools/build-site.js` and committed, so GitHub Pages just serves files.

## Address: paneslide.com (moved from paneslide.github.io)

- The site lives in the repo **paneslide/paneslide.com** (GitHub Pages, `CNAME` file = `paneslide.com`, HTTPS enforced). The old repo **paneslide/paneslide.github.io** is only a bridge: every old address sends players to the same path on paneslide.com. It is built by `node tools/build-bridge.js <folder>` and has NO custom domain.
- The bridge packs the old save into the usual progress code and adds `#import=<code>` (only when a save exists). `js/migrate.js` (loaded before the game on every page) imports it only if this device has no save yet, removes the `#import` from the address, shows "Your progress moved over" and counts `event/migrated`. An existing save is never overwritten.
- The bridge's `sw.js` deletes the old caches and unregisters itself, so installed apps reach the bridge and move over.
- Test: `PW=$(npm root -g)/playwright-core node tools/test-migration.js` (local copy of both sites, host names mapped to this computer).

## Website layer (v9, AdSense-ready)

Pages (all generated from Markdown in `content/` by `node tools/build-site.js --check`, which also checks guide word counts of 600–1200):

| URL | What |
|---|---|
| `/` | the game, plus a short intro, guide links and footer below the fold |
| `/how-to-play/` | full illustrated rules: glide, stick, mixing, par and stars, all 9 kinds of glass, chapters, daily, hints, shards, settings, keyboard |
| `/guides/` + 39 guides | original articles (600–1200 words each) in 8 groups: Start here, Strategy, Every kind of glass, Chapter by chapter, Colour and light, Play anywhere, Puzzle world, Puzzles and you. Diagrams are drawn from the real board renderer (`tools/site/figures.js`). On screens ≥1100px wide, guides get a ~70ch column plus a sticky side panel ("On this page" + other guides in the same group) |
| `/whats-new/` | changelog, newest first (edit `content/pages/whats-new.md` with every release) |
| `/archive/` | calendar of past dailies; `/?date=YYYY-MM-DD` plays one as practice (no streak or stats change); future days are locked |
| `/about/`, `/contact/`, `/privacy/`, `/terms/` | trust pages; contact is paneslide.game@gmail.com (written as HTML entities to slow scrapers, still a normal mailto link) |
| `/404.html`, `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, `sw.js` | generated |

Every page has a title, description, canonical URL, Open Graph/Twitter card (`img/og.png`), and JSON-LD (WebSite, VideoGame, Article, FAQPage). Settings has **Progress code** (export/import of all `ps2:*` progress as a text code) and **Install app** (PWA; shown only when the browser offers it). The service worker uses a versioned cache (hash of the site files) and shows a "new version is ready · Refresh" toast instead of swapping silently.

### One config file: `site.config.js`

```js
SITE_URL: "https://paneslide.com",   // the live address; change only if the domain changes, then rebuild
CONTACT_EMAIL: "paneslide.game@gmail.com",
ADS_ENABLED: false,  ADSENSE_CLIENT: "",  ADSENSE_SLOTS: {...},   // ads stay OFF until approval
ANALYTICS_ENABLED: true,  GOATCOUNTER_CODE: "paneslide",         // GoatCounter, ON since 29 Oct 2026 (7:42 PM IST)
GSC_VERIFICATION: "7S4GQ…zVE",                                   // Search Console meta tag content (on every page)
```

After any change run `node tools/build-site.js --check`, then commit and push.

- **Ads:** slots are `<div class="ad-slot" data-slot="…">` spaces inside guide articles and in the home intro below the game, never on or over the board. Nothing loads while `ADS_ENABLED` is false (or `ADSENSE_CLIENT` is not a `ca-pub-…` id). A consent hook (`window.PaneSlideConsent`, fed by `googlefc`) is there for Google's certified CMP (Funding Choices), which AdSense offers free for EEA/UK visitors. After AdSense approval, add a file `ads.txt` at the site root containing one line: `google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0` (your own publisher id). `ads.txt` only works at a domain root, which is one reason AdSense needs a custom domain rather than `github.io`.
- **GoatCounter (free, cookie-free analytics): ON.** Dashboard: https://paneslide.goatcounter.com (log in with the owner's GoatCounter account). To switch off, set `ANALYTICS_ENABLED: false`, rebuild, push. It never loads when the browser sends Do Not Track or Global Privacy Control, on localhost/127.*, or with `?test=1`.

### Game events (v10, `js/site.js` + `js/game.js`)

Anonymous GoatCounter *events* (`event:true`, shown in the dashboard as paths starting `event/`). No IDs, no progress, no free text. The game pushes into `window.psq`; `site.js` batches them (sent 4 s after the last one, or at once when the tab is hidden/closed), sends each distinct path **once per browser session** (sessionStorage `ps-ev`), and caps a session at 60 events. With `?test=1` nothing is sent; events are copied to `window.psLog` for tests.

| Event path | When |
|---|---|
| `level/NNN/start` | a level is opened (NNN = 001…) |
| `level/NNN/complete/<s>star/<par\|par+N>/hints<n>/undo<n>/<time>` | solved in exactly par → `complete`; more swipes → `over-par` (`level/NNN/over-par/...`). hints capped at 5, undo at 9. time: under-30s, 30-60s, 1-2min, 2-5min, 5min-plus |
| `level/NNN/quit`, `level/NNN/restart` | left mid-level (back, map, home, closed the tab) or restarted |
| `mechanic/<kind>/first-seen` | first time a player reaches a teach level (locked, duo, pillar, gem, ice, sand, oneway, frost, mystery) |
| `tutorial/start`, `tutorial/skip`, `tutorial/complete` | first-run tutorial funnel |
| `daily/start`, `daily/solve/<par\|par+N>/<time>` | today's daily |
| `archive/play/<age>`, `archive/solve/...` | an archive day (age: 1-day, 2-7-days, 8-30-days, 31-days-plus) |
| `gift/claim/dayN`, `shop/buy/hint`, `shop/buy/skin-<k>`, `shop/buy/mood-<k>` | economy |
| `music/on`, `music/mute` | music switch changed |
| `app/install-button`, `app/installed` | PWA install |
| `guide/<slug>/read-75` | a reader scrolled 75% of a guide |

**Reading the funnel:** in the GoatCounter dashboard, filter paths by `event/level/012/` to see one level: compare `start` with `complete` + `over-par` + `quit`. Levels where `over-par` or `quit` is high are the hardest; `mechanic/*/first-seen` shows how far players get; `daily/start` vs `daily/solve` and `archive/play` show daily habits; `tutorial/start` vs `tutorial/complete`/`skip` shows first-run drop-off. Counts are per session (roughly unique visitors), not raw plays. Privacy Policy lists every event.
- **Shares and return visits:** `share/daily`, `share/archive`, `share/level`, `share/milestone` (share button pressed; every share text ends in a link tagged `?ref=share`), `share/arrival` (a visit with `ref=share`; GoatCounter also shows `share` as the page view's source). On the first game visit of a local calendar day: `returning` (the player has an earlier day) and one `streak/<bucket>` for consecutive visit days: 1 → `day-1`, 2 → `day-2`, 3–6 → `day-3`, 7–13 → `day-7`, 14–29 → `day-14`, 30+ → `day-30plus`. Only dates are stored, in `ps2:days` (`first`, `start`, `last`). Test: `PW=... node tools/test-share-retention.js`.
- **Google Search Console:** add a property for `https://paneslide.com/` (a Domain property via a DNS TXT record, or a URL-prefix property with "HTML tag"), for "HTML tag" copy only the `content="..."` value into `GSC_VERIFICATION`, rebuild, push, press Verify, then submit `sitemap.xml`.

## Roadmap (not built yet)

Twin panes (two panes that move together), portals, paint cells (recolour a pane), cracked glass (breaks after N moves), picture-shaped targets (non-square boards), a music mood per chapter, and shop backgrounds. A custom domain (about $10 a year) comes before AdSense.

## Dark mode

- The board, target picture and colour swatches are painted on `<canvas>`. Auto-dark features recolour CSS backgrounds, but they leave canvas pixels alone. These include Chrome's "darken websites" / Auto Dark Theme, Samsung Internet and Dark Reader-style extensions; Dark Reader is what turned the board nearly black on Firefox Android.
- The page also declares `<meta name="darkreader-lock">`, which tells Dark Reader to leave the page off, plus `color-scheme: only light` and `forced-color-adjust: none`.

## Levels mode (endless)

- From home, **PLAY** opens the level map and **DAILY** opens the puzzle of the day. On the map, the PLAY button sits in a solid bar docked at the bottom. The map is padded by the bar's measured height plus the safe area, so no level node is hidden under it.
- Levels 1–1000 are precomputed in `js/levels.js`. Levels above 1000 are built on the device from a fixed seed (`paneslide:level:v4:N`), so every player gets the same level N.
- Difficulty (v4). The goal is enjoyment and coming back, not walls:
  - Levels 1–3 are quick lessons (glide, stick, order).
  - From level 4, par rises gently: 2.6 + ln(N−2), capped at 7.6. That gives about 4 swipes by level 6, 5 by level 15, 6 by level 40, and about 7 from level 100. Boards are at most 5×5.
  - In every block of 10, levels ending in 1 and 6 are breathers, and levels ending in 9 are a little harder (trophy on the map).
  - Breathers and levels ending in 2 must be solvable by the obvious moves (a "greedy" player), so wins come often.
  - Only the "aha" levels must defeat the greedy player, so the tricky ones are spaced out. These are the levels ending in 4 and 9 (from level 7), and in 7 (from level 40). Other levels come as they are.
  - New kinds of glass (v8). Each one first appears alone on a "teach" level, which is a little easier (par − 1) and has a ✨ tip. Then it keeps coming back:

    | Level | New glass | What it does |
    |---|---|---|
    | 12 | 🔩 Locked glass | can't move; a stopper |
    | 18 | 🎨 Two colours | the picture uses two-colour mixes |
    | 25 | 🧱 Pillars | stone blocks that glass can't pass |
    | 33 | 💎 Gems | slide glass over them for bonus shards (they sit on the best route) |
    | 42 | ❄️ Ice | glass never sticks on ice, it keeps gliding |
    | 52 | 🏖️ Sand | glass stops as soon as it reaches more sand |
    | 64 | ➡️ One-way glass | glides only the way its arrow points |
    | 78 | 🌫️ Frosted glass | hides its colour until you move it |
    | 95 | ❓ Mystery picture | the target shows itself bit by bit as you swipe |

  - Rotation: each chapter of 20 levels features the two kinds that were featured least recently (about 6–7 levels each) and brings every other known kind back once. A level has at most 2 kinds; 3 only on rare challenge levels after 100. Every kind returns in every chapter after it is taught (checked for 1–1000).
  - Chapter bosses: every level 20, 40, 60 … has a golden frame and a 👑 badge. Beating it restores the chapter's stained-glass window (+15 shards).
  - Dailies (glide rules from 2026-10-30) run par 4 on Monday, 5 on Tuesday and Wednesday, 6 on Thursday and Friday, and 7 at the weekend. The weekend dailies (and Friday's) must defeat greedy.
- Stars (generous): 3 stars when you solve within par + 1 (exactly par when par is 1–2). 2 stars when you solve within par + max(3, ⌈par/2⌉+1). Otherwise 1 star. Solving in exactly par shows "✨ Perfect!". Hints never cost stars, and a hint shows the next best swipe.
- Next-gift bar: the level-end card shows a 🎁 bar counting down to the next milestone (level 5, then every 10). Each milestone gives +1 hint and a rank step.
- Coach marks: the first time a player meets something new, a short tip points at it. Each tip has an icon, one sentence, and a pulsing ring, and a tap closes it. Tips cover glide, stick, order, stars/par, undo, hint, stuck, locked glass, two colours, challenge, breather, map, rank, gift, music, and daily. Each shows once (`ps2:prefs.marks`), and **TIPS** in the ? help shows them all again.
- Glass look (v7): everything is drawn on one canvas, so Dark Reader and forced dark can't recolour it. Empty cells are recessed slots. Each pane is a separate piece with a thick light outline around its outer edge, a thin darker line of its own colour, faint grooves between its cells, a small gloss strip on each cell, a drop shadow, and a soft shimmer every few seconds. The colour bodies mix like real filters ("darken" on a separate glass layer); the outlines are drawn on top of all panes, so where glass overlaps you see the mixed colour and both outlines. The arrow sits at the centre of the pane where possible. The target picture uses the same mixed colours with a white inner edge, so it ties to the board. A one-time tip ("🌈 Glass over glass mixes colours") points at the first overlap.
- Help (v7): mostly pictures. Two small looping demos (glide to the edge, stick on colour), the colour-mix chips and the star chips, with a few words each. **TUTORIAL** and **TIPS** go into detail.
- Background music: made in the browser with Web Audio, with no audio files and nothing to license.
  - It is a calm "puzzle café" style at about 70 bpm: soft detuned chord pads wander at random between Cmaj7, Am7, Fmaj7, G6, Dm9, and Em7. On top sit a sparse marimba-like pentatonic melody, an occasional bell, and a reverb.
  - v7 (no crackle): the music is pre-rendered once in the background with an `OfflineAudioContext` (22 050 Hz stereo, 9 bars ≈ 62 s plus a 3.5 s tail). Each take is normalised to −3 dBFS and has an envelope on every note. Two random takes alternate, scheduled on the audio clock, with each tail ringing over the next start. While playing, the live audio graph is just buffer → gain → limiter, so slow phones no longer drop audio (that is what the "short circuit" crackle was). All sound effects and music go through one limiter (DynamicsCompressor). Finished effect nodes are disconnected. The music fades out when the tab is hidden.
  - It is on by default at 18% volume and starts only after the first tap (autoplay rules).
  - Mute it with the ♪ button on the home screen, or use the Music toggle and volume slider in Settings. Music is separate from sound effects (`ps2:prefs.music`, `ps2:prefs.musicVol`).
- Hints: you start with 3 and can hold at most 5. You earn +1 per milestone and +1 for every three 3-star levels.
- Rewards (v8): 💠 **shards** are the one currency.
  - Earned: 2 per new star, 3 for the first perfect solve of a level, 1 per gem, 15 per boss, 5 for each day's first daily solve, 10 per badge, and the daily gift.
  - Existing players get shards back-dated once: 2 × stars already earned + 15 per boss level already passed.
  - **Shop**: +1 hint (15), boards Oak 60 / Mint 80 / Rose 80 / Midnight 120, music moods Rain 60 / Music box 90. Classic and Café are free.
  - **Glass House**: one round stained-glass window per chapter; each level you clear lights a piece (20 per window), and the boss restores it.
  - **Daily gift**: claim once a day from home; days 1–7 pay 5, 5, 10, 10, 15, 15, 30 (+1 hint). Missing a day starts a fresh week. A dot on the 🎁 shows when it is ready.
  - **Badges** (12) and **records** (perfect levels, gems, bosses, shards, best gift streak, best perfect run) in Stats.
  - **Next unlock**: the map bar and the level-end card always say what comes next ("8 levels to Mystery picture" or "5 to the boss · window 15/20").
- Progress is saved in localStorage under the same `ps2:*` keys as before, so old progress stays valid.

## Desktop and keyboard (v10)

- At ≥960×560 (landscape) the game switches to a 3-column layout: target + meter + buttons on the left, a larger board in the centre, a **Controls** panel (`aside.keys` in index.html) on the right. Home: hero left, actions card right. 768×1024 portrait uses a bigger single column. Phones are unchanged.
- Keyboard: Tab / 1–9 pick a pane, arrows or WASD slide it, Enter = next movable pane, Z or Ctrl/⌘+Z undo, H hint, M music, Esc closes a dialog. Shortcuts pause while a dialog is open or a text box has focus.
- Mouse: hover rim on movable panes, grab/grabbing cursors.
- Every dialog wraps its content in `.pscroll`, so the ribbon title and ✕ stay put and only the content scrolls (fixes the clipped Stats header). The Stats "moves over par" chart is a labelled bar list.

## Tests (Node 20)

- `node tools/validate.js 2026-10-28 367` checks every daily and the tutorial: exactly one solution, par = shortest path, and deterministic output. It also reports how many dailies greedy fails.
- `node tools/validate-levels.js 1000` checks every precomputed level:
  - it matches the seeded generator;
  - it has exactly one solution;
  - an independent forward search finds par;
  - the board is at most 5×5;
  - (v8) the mechanic schedule matches, no kind appears before it is taught, teach levels have exactly one kind, at most 2 kinds (3 only on challenge levels after 100), pillars never sit under the answer, frosted panes must move, gems lie on the hint route, and every kind returns in every chapter.
  
  It also prints a per-tier table of par and greedy failures.
- `node tools/build-levels.js 1000` rebuilds `js/levels.js`.
- `PW=$(npm root -g)/playwright-core node tools/screens-game.js` plays the game headless at 390×844 with real swipes along the shortest route:
  - it runs tutorial → daily → map → levels 1, 5, 9, 10, 12, 20 → undo/hint → map bottom;
  - it covers Chromium light, `prefers-color-scheme: dark`, Chrome forced dark, a Dark Reader simulation and Firefox dark (`ONLY=light|dark|darkreader|forcedark|firefox` runs one);
  - `ONLY=sizes` runs at 360×740 and 412×915, plus once with a wide fallback font. It opens home, help, settings, stats, map, levels, the level-end, milestone and daily-end cards, and a coach mark, and fails if any text sticks out of its button, chip or card, or off screen;
  - (v8) it opens every teach level (12, 18, 25, 33, 42, 52, 64, 78, 95) with its tip, plays boss level 40 to the "window restored" card, and checks the map teaser, Glass House, shop (a real purchase), daily gift (a real claim), and badges. At 360×740 and 412×915 it also checks the new dialogs for overflow;
  - it renders a music take (Café, Rain and Music box) and fails if it peaks above −1 dBFS or has a click (a burst of treble far above the frames around it);
  - it fails on any console error or if the PLAY bar covers a map node;
  - it needs `python3 -m http.server 8765` running in this folder, and Firefox via `npx playwright-core install firefox`.
- `node tools/build-site.js --check` rebuilds the website pages and fails if a guide is outside 600–1200 words.
- `PW=$(npm root -g)/playwright-core node tools/test-site.js` opens every sitemap page plus the 404 in Chromium light/dark/forced dark and Firefox dark at 360×740 and 412×915 (`ONLY=` picks one). It fails on console errors, HTTP errors, sideways overflow, broken images, missing alt text, unlabeled SVGs, more than one h1, and duplicate titles/descriptions. It also checks the archive rules (future dates locked, past dates are practice and leave stats alone) and the progress-code round trip.
- `ONLY=desktop` in test-site.js runs every page in Chromium light and dark at 768×1024, 1280×800, 1440×900 and 1920×1080.
- `PW=... node tools/check-popups.js` opens every dialog at phone, tablet and desktop sizes and fails if the ribbon or ✕ is clipped or content overflows (screenshots `screenshots/popup-stats-*.png`).
- `PW=... node tools/test-events.js` plays the tutorial, a level (also by keyboard: 1–9, arrows, Z, H, M), a quit, gift, shop, daily and archive in test mode and checks the event list; then, on a fake host with a stubbed count.js, checks batching, the `event/` prefix, once-per-session dedupe and that GPC sends nothing.
- `node tools/check-links.js [--external]` checks every internal link and #anchor in the built HTML (and optionally the outside links).
- `PW=... node tools/make-icons.js` redraws the app icons and `img/og.png`; `PW=... node tools/screens-site.js` and `tools/capture-guides.js` make the website screenshots.
- `node tools/darkreader-check.js` checks two things: that Dark Reader honours the lock, and that the canvas board keeps its colours even when the lock is removed. It needs `npm i --prefix /tmp/dr darkreader@4`.

All art, colours, icons and sounds (WebAudio) are original and made in code. The one exception is the font, Fredoka, which is self-hosted under the SIL OFL. See credits.txt.
