(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  E.registerModule({
    id: "supplier-dashboard",
    title: "Supplier Dashboard",
    icon: "\uD83D\uDE9A",
    order: 1,
    section: "supplier",
    render: async function (ctx) {
      ctx.mount.innerHTML =
        '<div class="eikon-card" style="max-width:600px;margin:40px auto;text-align:center;">' +
        '  <div style="font-size:48px;margin-bottom:16px;">\uD83D\uDE9A</div>' +
        '  <div style="font-weight:900;font-size:20px;margin-bottom:8px;">Supplier Portal</div>' +
        '  <div style="color:var(--muted);line-height:1.5;">This section is under development.<br>Modules for supply chain and distribution will appear here soon.</div>' +
        '</div>';
    }
  });
})();
