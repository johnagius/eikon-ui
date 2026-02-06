(function () {
  const root = document.getElementById("eikon-root");
  if (!root) return;

  if (!window.EIKON || typeof window.EIKON.start !== "function") {
    root.textContent = "Eikon core not loaded (core.js missing or not executed).";
    return;
  }

  window.EIKON.start(root);
})();
