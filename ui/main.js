/* ui/main.js
   Loads core + modules (scripts) then boots the app.
   Served via Worker at /ui/main.js
*/

(function () {
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  function ensureCss(href) {
    const links = Array.from(document.querySelectorAll("link[rel='stylesheet']"));
    if (links.some((l) => l.href === href)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  async function boot() {
    const me = document.currentScript;
    const mainUrl = new URL(me.src);
    const origin = mainUrl.origin;           // https://eikon-api.labrint.workers.dev
    const uiBase = origin + "/ui/";

    // Ensure CSS is present (even if GoDaddy snippet forgot it)
    ensureCss(uiBase + "app.css");

    // Ensure #eikonRoot exists
    if (!document.getElementById("eikonRoot") && !document.getElementById("eikon-root")) {
      const d = document.createElement("div");
      d.id = "eikonRoot";
      document.body.appendChild(d);
    }

    // Load core if missing
    if (!window.EIKON) {
      await loadScript(uiBase + "core.js");
    }

    // Load modules (temperature already exists, cleaning new)
    // If you add modules later, add them here.
    await loadScript(uiBase + "modules.temperature.js");
    await loadScript(uiBase + "modules.cleaning.js");

    // Boot app
    await window.EIKON.boot({
      apiBase: origin
    });
  }

  boot().catch((e) => {
    document.body.innerHTML = "";
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.padding = "14px";
    pre.style.fontFamily = "monospace";
    pre.textContent = "Eikon UI failed to load:\n\n" + (e && (e.stack || e.message) ? (e.stack || e.message) : String(e));
    document.body.appendChild(pre);
  });
})();
