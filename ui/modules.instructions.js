(function () {
  "use strict";

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      try {
        var s = document.createElement("script");
        s.src = src;
        s.async = false;
        s.onload = function () { resolve(true); };
        s.onerror = function () { reject(new Error("Failed to load " + src)); };
        document.head.appendChild(s);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function bootAsync() {
    try {
      if (!window.EIKON || typeof window.EIKON.start !== "function") {
        console.error("[EIKON][main] core not loaded or start() missing");
        return;
      }

      // Ensure Instructions module is available in nav BEFORE start()
      try {
        var E = window.EIKON;
        var hasModule = !!(E.modules && E.modules.instructions);
        if (!hasModule) {
          var v = encodeURIComponent(String(E.VERSION || ""));
          await loadScript("modules.instructions.js" + (v ? ("?v=" + v) : ""));
        }
      } catch (eMod) {
        console.warn("[EIKON][main] could not preload modules.instructions.js:", eMod);
        // continue anyway
      }

      console.log("[EIKON][main] boot start, dbg=", window.EIKON.DEBUG);
      window.EIKON.start();
    } catch (e) {
      console.error("[EIKON][main] boot error:", e);
      try {
        window.EIKON && window.EIKON.showFatalOverlay("main.js crash", e && (e.stack || e.message || String(e)));
      } catch (e2) {}
    }
  }

  function boot() {
    bootAsync();
  }

  // IMPORTANT: This works even when scripts are dynamically injected AFTER DOMContentLoaded.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
