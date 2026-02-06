(function () {
  function start() {
    const E = window.EIKON;
    if (!E || typeof E.boot !== "function") {
      const root = document.getElementById("eikon-root");
      if (root) root.textContent = "EIKON core failed to load.";
      return;
    }

    // If hash changes (user pasted #temperature etc), navigate
    window.addEventListener("hashchange", () => {
      try {
        const k = decodeURIComponent((location.hash || "").replace(/^#/, "")).trim();
        if (k && E.modules && E.modules[k] && E.state && E.state.user) {
          E.navigate(k);
        }
      } catch {}
    });

    E.boot("#eikon-root");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
