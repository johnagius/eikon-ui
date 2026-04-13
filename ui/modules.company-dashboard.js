(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  E.registerModule({
    id: "company-dashboard",
    title: "Company Dashboard",
    icon: "\uD83C\uDFE2",
    order: 1,
    section: "company_admin",
    render: async function (ctx) {
      ctx.mount.innerHTML =
        '<div class="eikon-card" style="max-width:600px;margin:40px auto;text-align:center;">' +
        '  <div style="font-size:48px;margin-bottom:16px;">\uD83C\uDFE2</div>' +
        '  <div style="font-weight:900;font-size:20px;margin-bottom:8px;">Company Administration</div>' +
        '  <div style="color:var(--muted);line-height:1.5;">Welcome to company admin.<br>Use the <strong>Pharmacy Overview</strong> module in the sidebar to view inspection compliance across all your pharmacies.</div>' +
        '</div>';
    }
  });
})();
