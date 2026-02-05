(function(){
  "use strict";

  function boot(){
    const root = document.getElementById("eikon-root");
    if (!root){
      console.warn("Missing #eikon-root");
      return;
    }
    const EIKON = window.EIKON;
    if (!EIKON || !EIKON.modules || !EIKON.modules.temperature){
      root.textContent = "Eikon UI loaded, but module not found.";
      return;
    }
    EIKON.modules.temperature.render(root);
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
