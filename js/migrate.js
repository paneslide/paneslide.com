/* PaneSlide moved from paneslide.github.io to paneslide.com (October 2026).
   The old address is now a bridge page: it packs the player's saved progress into the same
   progress code the Settings > "Move progress" box uses, and sends them here with #import=<code>.
   This file runs BEFORE the game reads its save, on every page:
   - no #import in the address: does nothing;
   - #import and NO save on this device yet: copies the progress in, shows "Your progress moved over"
     and counts one anonymous event, event/migrated;
   - #import but a save already exists here: keeps the existing save (never overwrites it).
   The #import part is always removed from the address bar with history.replaceState. */
(function () {
  var m = /^#import=([^&]*)/.exec(location.hash || ""); if (!m) return;
  try { history.replaceState(history.state, "", location.pathname + location.search); } catch (e) {}
  var result = "bad";
  try {
    var code = decodeURIComponent(m[1]).replace(/\s+/g, ""), o = null;
    if (code.indexOf("PS1.") === 0) o = JSON.parse(decodeURIComponent(escape(atob(code.slice(4)))));
    var keys = o && o.app === "paneslide" && o.data && typeof o.data === "object" ? Object.keys(o.data) : [];
    var valid = keys.length && keys.every(function (k) { return k.indexOf("ps2:") === 0 && typeof o.data[k] === "string"; });
    if (valid) keys.forEach(function (k) { JSON.parse(o.data[k]); });
    if (valid) {
      var has = false; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf("ps2:") === 0) { has = true; break; } }
      if (has) result = "kept";
      else { keys.forEach(function (k) { localStorage.setItem(k, o.data[k]); }); result = "imported"; }
    }
  } catch (e) { result = "bad"; }
  window.PS_MIGRATION = result;
  if (result !== "imported") return;
  (window.psq = window.psq || []).push(["migrated", "Progress moved over from paneslide.github.io"]);
  function show() {
    var S = window.PaneSlideSite;
    if (S && S.toast) { S.toast("✨ Your progress moved over", "OK", function () {}); if (S.flush) S.flush(); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show); else setTimeout(show, 0);
})();
