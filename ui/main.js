(function(){
  const root = document.getElementById("eikon-root");
  if (!root) return;

  const mod = window.EIKON && window.EIKON.modules && window.EIKON.modules.temperature;
  if (mod && typeof mod.render === "function") {
    mod.render(root);
  } else {
    root.textContent = "Eikon UI loaded, but module not found.";
  }
})();
