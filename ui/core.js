(function(){
  window.EIKON = window.EIKON || {};
  window.EIKON.getConfig = function(){
    return window.EIKON_CONFIG || { apiBase: "" };
  };
})();
