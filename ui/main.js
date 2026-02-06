(function () {
  "use strict";

  function boot() {
    try {
      if (!window.EIKON || typeof window.EIKON.start !== "function") {
        console.error("[EIKON][main] core not loaded or start() missing");
        return;
      }
      console.log("[EIKON][main] boot start, dbg=", window.EIKON.DEBUG);
      window.EIKON.start();
    } catch (e) {
      console.error("[EIKON][main] boot error:", e);
      try { window.EIKON && window.EIKON.showFatalOverlay("main.js crash", e && (e.stack || e.message || String(e))); } catch (e2) {}
    }
  }

  // IMPORTANT: This works even when scripts are dynamically injected AFTER DOMContentLoaded.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
