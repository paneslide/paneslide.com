/* PaneSlide site settings: the ONE place to change the contact email, ads, analytics and
   Search Console. After editing, run `node tools/build-site.js` (or ask Grok Bot) so every page is rebuilt.
   Pages also read the flags below at run time through js/site.js. */
window.PANESLIDE_CONFIG = {
  SITE_URL: "https://paneslide.com",            // the live address (no slash at the end)
  CONTACT_EMAIL: "paneslide.game@gmail.com",    // shown on Contact, Privacy, Terms and in the footer

  ADS_ENABLED: false,                           // keep false until AdSense approves the site
  ADSENSE_CLIENT: "",                           // e.g. "ca-pub-1234567890123456" (from AdSense)
  ADSENSE_SLOTS: { guide: "", game: "" },       // ad unit ids from AdSense, optional

  ANALYTICS_ENABLED: true,                      // GoatCounter: cookie-free page counts
  GOATCOUNTER_CODE: "paneslide",                   // e.g. "paneslide" for https://paneslide.goatcounter.com

  GSC_VERIFICATION: "7S4GQYaTbJS-Dnz3o4ANliwa0B3Ipah4RROmUfHCVzE"                       // Google Search Console "HTML tag" content value
};
