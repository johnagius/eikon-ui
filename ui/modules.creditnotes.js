(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // ----------------------------
  // Helpers
  // ----------------------------
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  function ymd(d) {
    if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d.getTime())) return "";
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function fmtDmy(s) {
    var x = String(s || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x)) return x || "—";
    return x.slice(8, 10) + "/" + x.slice(5, 7) + "/" + x.slice(0, 4);
  }

  function fmtDateTime(s) {
    if (!s) return "—";
    try {
      var d = new Date(s);
      if (isNaN(d.getTime())) return String(s);
      return fmtDmy(ymd(d)) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    } catch (e) { return String(s); }
  }

  function fmtEuro(v) {
    var n = parseFloat(v);
    if (isNaN(n)) return "€0.00";
    return "€" + n.toFixed(2);
  }

  function to01(v) { return v ? 1 : 0; }

  function ensureStyles() {
    if (document.getElementById("cn-style")) return;
    var st = document.createElement("style");
    st.id = "cn-style";
    st.textContent =
      ".cn-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(520px,calc(100vw - 28px));}" +
      ".cn-toast{border:1px solid rgba(255,255,255,.12);background:rgba(12,16,24,.92);backdrop-filter:blur(10px);border-radius:14px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.35);}" +
      ".cn-toast .t-title{font-weight:900;margin:0 0 2px 0;font-size:13px;}" +
      ".cn-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".cn-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".cn-toast.bad{border-color:rgba(255,90,122,.35);}" +
      ".cn-toast.warn{border-color:rgba(255,200,90,.35);}" +
      ".cn-row-selected{background:rgba(58,160,255,.10)!important;}" +
      ".cn-row-selected td{border-bottom-color:rgba(58,160,255,.22)!important;}" +
      ".cn-mini{font-size:12px;opacity:.85;}" +
      ".cn-split{display:grid;grid-template-columns:1fr 1fr;gap:14px;}" +
      ".cn-split3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;}" +
      ".cn-panel{border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:14px;padding:14px;}" +
      ".cn-badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;}" +
      ".cn-badge.open{background:rgba(67,209,122,.15);color:#43d17a;border:1px solid rgba(67,209,122,.3);}" +
      ".cn-badge.closed{background:rgba(255,90,122,.12);color:#ff5a7a;border:1px solid rgba(255,90,122,.25);}" +
      ".cn-stat-box{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px 16px;background:rgba(255,255,255,.03);min-width:140px;}" +
      ".cn-stat-box .label{font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}" +
      ".cn-stat-box .value{font-size:22px;font-weight:900;}" +
      ".cn-stat-box .sub{font-size:12px;opacity:.7;margin-top:2px;}" +
      ".cn-entry-row{border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:rgba(255,255,255,.02);}" +
      ".cn-entry-row:last-child{margin-bottom:0;}" +
      ".cn-note-row{border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:8px 12px;margin-bottom:6px;background:rgba(255,255,255,.02);}" +
      ".cn-check{display:flex;gap:8px;align-items:center;}" +
      ".cn-check input{transform:scale(1.1);opacity:.5;cursor:not-allowed;}" +
      "@media(max-width:860px){.cn-split{grid-template-columns:1fr;}.cn-split3{grid-template-columns:1fr 1fr;}}";
    document.head.appendChild(st);
  }

  function toast(kind, title, msg) {
    var wrap = document.getElementById("cn-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "cn-toast-wrap";
      wrap.className = "cn-toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = document.createElement("div");
    t.className = "cn-toast " + (kind || "");
    t.innerHTML = "<div class='t-title'>" + esc(title || "") + "</div><div class='t-msg'>" + esc(msg || "") + "</div>";
    wrap.appendChild(t);
    setTimeout(function () {
      try { wrap.removeChild(t); } catch (e) {}
      if (wrap.childNodes.length === 0) { try { wrap.parentNode.removeChild(wrap); } catch (e2) {} }
    }, 3600);
  }

  function api(method, path, body) {
    return E.apiFetch(path, { method: method, body: body ? JSON.stringify(body) : undefined });
  }

  function modalError(title, err) {
    var msg = (err && (err.message || err.error)) ? (err.message || err.error) : String(err || "Error");
    E.modal.show(title || "Error", "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>", [
      { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
    ]);
  }

  // ----------------------------
  // State
  // ----------------------------
  var state = {
    q: "",
    rows: [],
    filtered: [],
    selectedId: null,
    selected: null,
    busy: false,
    showAll: false  // show all vs only open
  };

  function calcIsOpen(cn) {
    // A credit note is closed if:
    // 1. total purchases >= credit note amount, OR
    // 2. it has expired (and is not set to never-expire)
    var amount = parseFloat(cn.amount) || 0;
    var entries = Array.isArray(cn.purchase_entries) ? cn.purchase_entries : [];
    var totalPurchases = 0;
    for (var i = 0; i < entries.length; i++) {
      totalPurchases += parseFloat(entries[i].amount) || 0;
    }
    var remaining = amount - totalPurchases;

    if (remaining <= 0) return false;

    if (cn.no_expiry) return true;
    if (cn.expiry_date) {
      var exp = new Date(cn.expiry_date);
      exp.setHours(23, 59, 59, 999);
      if (exp < new Date()) return false;
    }
    return true;
  }

  function calcRemaining(cn) {
    var amount = parseFloat(cn.amount) || 0;
    var entries = Array.isArray(cn.purchase_entries) ? cn.purchase_entries : [];
    var totalPurchases = 0;
    for (var i = 0; i < entries.length; i++) {
      totalPurchases += parseFloat(entries[i].amount) || 0;
    }
    return amount - totalPurchases;
  }

  function normalizeRow(r) {
    r = r || {};
    var cn = {
      id: r.id,
      issue_date: String(r.issue_date || ""),
      client_name: String(r.client_name || ""),
      client_surname: String(r.client_surname || ""),
      telephone: String(r.telephone || ""),
      email: String(r.email || ""),
      receipt_number: String(r.receipt_number || ""),
      amount: parseFloat(r.amount) || 0,
      expiry_date: String(r.expiry_date || ""),
      no_expiry: !!(r.no_expiry || r.no_expiry === 1),
      notes: Array.isArray(r.notes) ? r.notes : (r.notes ? JSON.parse(r.notes) : []),
      purchase_entries: Array.isArray(r.purchase_entries) ? r.purchase_entries : (r.purchase_entries ? JSON.parse(r.purchase_entries) : [])
    };
    cn.is_open = calcIsOpen(cn);
    cn.remaining = calcRemaining(cn);
    return cn;
  }

  function applyFilter() {
    var q = String(state.q || "").trim().toLowerCase();
    var list = state.rows.slice();

    if (!state.showAll) {
      list = list.filter(function (r) { return r.is_open; });
    }

    if (!q) {
      state.filtered = list;
      return;
    }
    state.filtered = list.filter(function (r) {
      var blob = [r.client_name, r.client_surname, r.telephone, r.email, r.receipt_number, String(r.id || "")].join(" ").toLowerCase();
      return blob.indexOf(q) !== -1;
    });
  }

  function setSelected(row) {
    if (!row) { state.selectedId = null; state.selected = null; return; }
    state.selectedId = row.id || null;
    state.selected = normalizeRow(row);
  }

  // ----------------------------
  // API calls
  // ----------------------------
  async function doRefresh() {
    state.busy = true;
    setBusyUI(true);
    try {
      var res = await api("GET", "/creditnotes/list");
      if (!res || !res.ok) throw new Error((res && res.error) || "Load failed");
      state.rows = (res.entries || []).map(normalizeRow);
      applyFilter();

      // Preserve selection
      var sel = null;
      if (state.selectedId) {
        for (var i = 0; i < state.rows.length; i++) {
          if (String(state.rows[i].id) === String(state.selectedId)) { sel = state.rows[i]; break; }
        }
      }
      if (sel) setSelected(sel); else { state.selectedId = null; state.selected = null; }
      renderTable();
      renderSelection();
      renderStats();
    } catch (e) {
      modalError("Refresh failed", e);
    } finally {
      state.busy = false;
      setBusyUI(false);
    }
  }

  function setBusyUI(on) {
    var b = document.getElementById("cn-busy");
    if (b) b.textContent = on ? "Working…" : "";
    ["cn-refresh", "cn-new", "cn-save", "cn-delete", "cn-print-list", "cn-add-entry", "cn-add-note", "cn-print-cn"].forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.disabled = !!on;
    });
  }

  function readMainForm() {
    function v(id) { var n = document.getElementById(id); return n ? String(n.value || "").trim() : ""; }
    function c(id) { var n = document.getElementById(id); return !!(n && n.checked); }
    return {
      issue_date: v("cn-issue-date"),
      client_name: v("cn-client-name"),
      client_surname: v("cn-client-surname"),
      telephone: v("cn-telephone"),
      email: v("cn-email"),
      receipt_number: v("cn-receipt-number"),
      amount: v("cn-amount"),
      expiry_date: c("cn-no-expiry") ? "" : v("cn-expiry-date"),
      no_expiry: to01(c("cn-no-expiry"))
    };
  }

  async function doSave() {
    var body = readMainForm();
    if (!body.issue_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.issue_date)) { toast("warn", "Check date", "Please enter a valid issue date."); return; }
    if (!body.client_name.trim()) { toast("warn", "Name required", "Please enter a client name."); return; }
    if (!body.client_surname.trim()) { toast("warn", "Surname required", "Please enter a client surname."); return; }
    if (!body.telephone.trim()) { toast("warn", "Telephone required", "Please enter a telephone number."); return; }
    var amt = parseFloat(body.amount);
    if (isNaN(amt) || amt <= 0) { toast("warn", "Amount required", "Please enter a valid credit note amount."); return; }
    if (!body.no_expiry && body.expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.expiry_date)) { toast("warn", "Check expiry", "Please enter a valid expiry date."); return; }

    state.busy = true; setBusyUI(true);
    try {
      if (state.selectedId) {
        var upd = await api("PUT", "/creditnotes/entries/" + encodeURIComponent(state.selectedId), body);
        if (!upd || !upd.ok) throw new Error((upd && upd.error) || "Update failed");
        toast("good", "Saved", "Credit note updated.");
      } else {
        var crt = await api("POST", "/creditnotes/entries", body);
        if (!crt || !crt.ok) throw new Error((crt && crt.error) || "Create failed");
        state.selectedId = crt.id || null;
        toast("good", "Saved", "Credit note created.");
      }
      await doRefresh();
    } catch (e) { modalError("Save failed", e); }
    finally { state.busy = false; setBusyUI(false); }
  }

  function doDelete() {
    if (!state.selectedId) { toast("warn", "No selection", "Select a credit note to delete."); return; }
    var sel = state.selected;
    var name = sel ? (sel.client_name + " " + sel.client_surname) : "";
    E.modal.show("Delete Credit Note",
      "<div>Are you sure you want to delete the credit note for <b>" + esc(name) + "</b>? This cannot be undone.</div>",
      [
        { label: "Cancel", onClick: function () { E.modal.hide(); } },
        {
          label: "Delete", primary: true, onClick: async function () {
            E.modal.hide();
            state.busy = true; setBusyUI(true);
            try {
              var res = await api("DELETE", "/creditnotes/entries/" + encodeURIComponent(state.selectedId));
              if (!res || !res.ok) throw new Error((res && res.error) || "Delete failed");
              toast("good", "Deleted", "Credit note deleted.");
              state.selectedId = null; state.selected = null;
              await doRefresh();
            } catch (e) { modalError("Delete failed", e); }
            finally { state.busy = false; setBusyUI(false); }
          }
        }
      ]);
  }

  async function doAddPurchaseEntry() {
    if (!state.selectedId) { toast("warn", "No selection", "Select a credit note first."); return; }
    var amtEl = document.getElementById("cn-pe-amount");
    var recEl = document.getElementById("cn-pe-receipt");
    var amt = parseFloat(amtEl ? amtEl.value : "") || 0;
    var rec = recEl ? String(recEl.value || "").trim() : "";
    if (!amt || amt <= 0) { toast("warn", "Amount required", "Enter a purchase amount."); return; }

    state.busy = true; setBusyUI(true);
    try {
      var res = await api("POST", "/creditnotes/entries/" + encodeURIComponent(state.selectedId) + "/purchases", {
        amount: amt,
        receipt_number: rec
      });
      if (!res || !res.ok) throw new Error((res && res.error) || "Failed to add entry");
      if (amtEl) amtEl.value = "";
      if (recEl) recEl.value = "";
      toast("good", "Entry Added", fmtEuro(amt) + " purchase recorded.");
      await doRefresh();
    } catch (e) { modalError("Add entry failed", e); }
    finally { state.busy = false; setBusyUI(false); }
  }

  async function doDeletePurchaseEntry(purchaseId) {
    if (!state.selectedId) return;
    state.busy = true; setBusyUI(true);
    try {
      var res = await api("DELETE", "/creditnotes/entries/" + encodeURIComponent(state.selectedId) + "/purchases/" + encodeURIComponent(purchaseId));
      if (!res || !res.ok) throw new Error((res && res.error) || "Failed to delete entry");
      toast("good", "Removed", "Purchase entry removed.");
      await doRefresh();
    } catch (e) { modalError("Remove entry failed", e); }
    finally { state.busy = false; setBusyUI(false); }
  }

  async function doAddNote() {
    if (!state.selectedId) { toast("warn", "No selection", "Select a credit note first."); return; }
    var noteEl = document.getElementById("cn-note-text");
    var text = noteEl ? String(noteEl.value || "").trim() : "";
    if (!text) { toast("warn", "Note empty", "Enter a note before adding."); return; }

    state.busy = true; setBusyUI(true);
    try {
      var res = await api("POST", "/creditnotes/entries/" + encodeURIComponent(state.selectedId) + "/notes", { text: text });
      if (!res || !res.ok) throw new Error((res && res.error) || "Failed to add note");
      if (noteEl) noteEl.value = "";
      toast("good", "Note Added", "Note saved.");
      await doRefresh();
    } catch (e) { modalError("Add note failed", e); }
    finally { state.busy = false; setBusyUI(false); }
  }

  async function doDeleteNote(noteId) {
    if (!state.selectedId) return;
    state.busy = true; setBusyUI(true);
    try {
      var res = await api("DELETE", "/creditnotes/entries/" + encodeURIComponent(state.selectedId) + "/notes/" + encodeURIComponent(noteId));
      if (!res || !res.ok) throw new Error((res && res.error) || "Failed to delete note");
      toast("good", "Removed", "Note removed.");
      await doRefresh();
    } catch (e) { modalError("Remove note failed", e); }
    finally { state.busy = false; setBusyUI(false); }
  }

  // ----------------------------
  // Print
  // ----------------------------
  function safe(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function printCreditNote(cn) {
    if (!cn) { toast("warn", "No selection", "Select a credit note to print."); return; }
    var w = window.open("", "_blank");
    if (!w) { E.modal.show("Print", "<div>Popup blocked. Allow popups and try again.</div>", [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]); return; }

    var isOpen = cn.is_open;
    var remaining = cn.remaining;
    var entries = Array.isArray(cn.purchase_entries) ? cn.purchase_entries : [];
    var notes = Array.isArray(cn.notes) ? cn.notes : [];

    var entriesHtml = "";
    if (entries.length) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        entriesHtml += "<tr><td>" + safe(fmtDateTime(e.timestamp)) + "</td><td>" + safe(e.receipt_number || "—") + "</td><td style='text-align:right'>" + safe(fmtEuro(e.amount)) + "</td></tr>";
      }
    } else {
      entriesHtml = "<tr><td colspan='3' style='opacity:.6;font-style:italic'>No purchase entries yet.</td></tr>";
    }

    var notesHtml = "";
    if (notes.length) {
      for (var j = 0; j < notes.length; j++) {
        var n = notes[j];
        notesHtml += "<div style='border-bottom:1px solid #eee;padding:6px 0;font-size:12px'><span style='opacity:.6'>" + safe(fmtDateTime(n.timestamp)) + "</span> — " + safe(n.text) + "</div>";
      }
    }

    var expiry = cn.no_expiry ? "Does not expire" : (cn.expiry_date ? fmtDmy(cn.expiry_date) : "—");
    var status = isOpen ? "OPEN" : "CLOSED";
    var statusColor = isOpen ? "#067647" : "#b42318";

    var html =
      "<!doctype html><html><head><meta charset='utf-8'/><title>Credit Note #" + safe(cn.id) + "</title>" +
      "<style>" +
        "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18mm 18mm 18mm 18mm;color:#111;}" +
        "h1{font-size:22px;font-weight:900;margin:0 0 2px 0;}" +
        ".meta{font-size:12px;opacity:.7;margin:0 0 18px 0;}" +
        ".grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:18px;}" +
        ".field label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#666;margin-bottom:2px;}" +
        ".field .val{font-size:14px;font-weight:600;}" +
        ".amount-box{border:2px solid #111;border-radius:8px;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;}" +
        ".amount-box .lbl{font-size:13px;font-weight:700;}" +
        ".amount-box .val{font-size:20px;font-weight:900;}" +
        "table{width:100%;border-collapse:collapse;margin-bottom:18px;}" +
        "th,td{border:1px solid #ddd;padding:7px 10px;text-align:left;font-size:12px;}" +
        "th{background:#f5f5f5;font-size:11px;text-transform:uppercase;letter-spacing:.3px;}" +
        ".status-badge{display:inline-block;padding:4px 14px;border-radius:999px;font-weight:900;font-size:13px;color:" + statusColor + ";border:2px solid " + statusColor + ";}" +
        ".balance{border:1px solid #eee;border-radius:8px;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;}" +
        ".balance .lbl{font-size:12px;color:#555;}" +
        ".balance .val{font-size:18px;font-weight:900;}" +
        "@media print{body{margin:10mm;} .no-print{display:none!important;}}" +
      "</style></head><body>" +
      "<div style='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;'>" +
        "<div><h1>Credit Note</h1><div class='meta'>#" + safe(cn.id) + " • Issued: " + safe(fmtDmy(cn.issue_date)) + " • Printed: " + safe(new Date().toLocaleString()) + "</div></div>" +
        "<div class='status-badge'>" + safe(status) + "</div>" +
      "</div>" +
      "<div class='grid'>" +
        "<div class='field'><label>Client</label><div class='val'>" + safe(cn.client_name + " " + cn.client_surname) + "</div></div>" +
        "<div class='field'><label>Telephone</label><div class='val'>" + safe(cn.telephone) + "</div></div>" +
        (cn.email ? "<div class='field'><label>Email</label><div class='val'>" + safe(cn.email) + "</div></div>" : "") +
        (cn.receipt_number ? "<div class='field'><label>Receipt #</label><div class='val'>" + safe(cn.receipt_number) + "</div></div>" : "") +
        "<div class='field'><label>Expiry</label><div class='val'>" + safe(expiry) + "</div></div>" +
      "</div>" +
      "<div class='amount-box'><div class='lbl'>Credit Note Amount</div><div class='val'>" + safe(fmtEuro(cn.amount)) + "</div></div>" +
      "<div style='font-weight:900;margin:0 0 8px 0;font-size:13px;'>Purchase History</div>" +
      "<table><thead><tr><th>Date / Time</th><th>Receipt #</th><th style='text-align:right'>Amount</th></tr></thead><tbody>" + entriesHtml + "</tbody></table>" +
      "<div class='balance'><div class='lbl'>Remaining Balance</div><div class='val' style='color:" + (remaining > 0 ? "#067647" : "#b42318") + "'>" + safe(fmtEuro(remaining)) + "</div></div>" +
      (notesHtml ? "<div style='margin-top:18px'><div style='font-weight:900;margin-bottom:6px;font-size:13px;'>Notes</div>" + notesHtml + "</div>" : "") +
      "<script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script>" +
      "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function printList() {
    var list = state.filtered || [];
    var w = window.open("", "_blank");
    if (!w) { E.modal.show("Print", "<div>Popup blocked. Allow popups and try again.</div>", [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]); return; }

    var rowsHtml = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var status = r.is_open ? "Open" : "Closed";
      var statusColor = r.is_open ? "#067647" : "#b42318";
      rowsHtml += "<tr>" +
        "<td>" + safe(fmtDmy(r.issue_date)) + "</td>" +
        "<td>" + safe(r.client_name + " " + r.client_surname) + "</td>" +
        "<td>" + safe(r.telephone) + "</td>" +
        "<td style='text-align:right'>" + safe(fmtEuro(r.remaining)) + " / " + safe(fmtEuro(r.amount)) + "</td>" +
        "<td style='color:" + statusColor + ";font-weight:700'>" + safe(status) + "</td>" +
        "</tr>";
    }

    var html =
      "<!doctype html><html><head><meta charset='utf-8'/><title>Credit Notes</title>" +
      "<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}h1{font-size:18px;margin:0 0 4px 0;}.sub{font-size:12px;opacity:.7;margin:0 0 14px 0;}table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:7px 10px;text-align:left;font-size:12px;}th{background:#f5f5f5;font-size:11px;text-transform:uppercase;letter-spacing:.3px;}@media print{body{margin:10mm;}}</style>" +
      "</head><body>" +
      "<h1>Credit Notes</h1><div class='sub'>Printed: " + safe(new Date().toLocaleString()) + " • " + safe(list.length) + " entries</div>" +
      "<table><thead><tr><th>Date</th><th>Client</th><th>Telephone</th><th style='text-align:right'>Balance / Total</th><th>Status</th></tr></thead><tbody>" + rowsHtml + "</tbody></table>" +
      "<script>window.onload=function(){setTimeout(function(){window.print();},150);};<\/script>" +
      "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // ----------------------------
  // Render
  // ----------------------------
  function renderStats() {
    var allRows = state.rows || [];
    var openCount = 0;
    var openTotal = 0;
    for (var i = 0; i < allRows.length; i++) {
      if (allRows[i].is_open) {
        openCount++;
        openTotal += allRows[i].remaining;
      }
    }
    var countEl = document.getElementById("cn-stat-count");
    var totalEl = document.getElementById("cn-stat-total");
    if (countEl) countEl.textContent = String(openCount);
    if (totalEl) totalEl.textContent = fmtEuro(openTotal);
  }

  function renderTable() {
    var tbody = document.getElementById("cn-tbody");
    var countEl = document.getElementById("cn-table-count");
    if (!tbody) return;
    applyFilter();
    var list = state.filtered || [];
    if (countEl) countEl.textContent = String(list.length);
    tbody.innerHTML = "";
    if (!list.length) {
      var tr0 = document.createElement("tr");
      tr0.innerHTML = "<td colspan='4' style='opacity:.6;font-style:italic'>No credit notes found.</td>";
      tbody.appendChild(tr0);
      return;
    }
    for (var i = 0; i < list.length; i++) {
      (function () {
        var r = list[i];
        var tr = document.createElement("tr");
        tr.style.cursor = "pointer";
        if (state.selectedId && String(r.id) === String(state.selectedId)) tr.classList.add("cn-row-selected");
        tr.addEventListener("click", function () {
          setSelected(r);
          renderSelection();
          renderTable();
        });
        var statusHtml = r.is_open
          ? "<span class='cn-badge open'>Open</span>"
          : "<span class='cn-badge closed'>Closed</span>";
        tr.innerHTML =
          "<td style='white-space:nowrap'>" + esc(fmtDmy(r.issue_date)) + "</td>" +
          "<td><b>" + esc(r.client_name + " " + r.client_surname) + "</b></td>" +
          "<td>" + esc(r.telephone) + "</td>" +
          "<td style='white-space:nowrap;text-align:right'>" + esc(fmtEuro(r.remaining)) + "</td>";
        tbody.appendChild(tr);
      })();
    }
  }

  function fillMainForm(cn) {
    cn = cn || {};
    var map = {
      "cn-issue-date": cn.issue_date || ymd(new Date()),
      "cn-client-name": cn.client_name || "",
      "cn-client-surname": cn.client_surname || "",
      "cn-telephone": cn.telephone || "",
      "cn-email": cn.email || "",
      "cn-receipt-number": cn.receipt_number || "",
      "cn-amount": cn.amount ? String(parseFloat(cn.amount).toFixed(2)) : "",
      "cn-expiry-date": cn.expiry_date || ""
    };
    Object.keys(map).forEach(function (id) {
      var n = document.getElementById(id);
      if (n) n.value = map[id];
    });
    var noExpEl = document.getElementById("cn-no-expiry");
    if (noExpEl) {
      noExpEl.checked = !!(cn.no_expiry);
      var expDateField = document.getElementById("cn-expiry-date-wrap");
      if (expDateField) expDateField.style.opacity = noExpEl.checked ? "0.4" : "1";
    }
  }

  function renderSelection() {
    var panel = document.getElementById("cn-detail-panel");
    if (!panel) return;
    var cn = state.selected;
    if (!cn) {
      panel.innerHTML =
        "<div class='cn-panel' style='opacity:.7;text-align:center;padding:24px;'>" +
        "<div style='font-size:28px;margin-bottom:8px;'>🗒️</div>" +
        "<div>Select a row from the table below to view details, or press <b>New</b> to create a credit note.</div>" +
        "</div>";
      return;
    }

    var entries = Array.isArray(cn.purchase_entries) ? cn.purchase_entries : [];
    var notes = Array.isArray(cn.notes) ? cn.notes : [];
    var isOpen = cn.is_open;
    var remaining = cn.remaining;

    var entriesHtml = "";
    if (entries.length) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        entriesHtml +=
          "<div class='cn-entry-row'>" +
          "<div style='display:flex;justify-content:space-between;align-items:center;'>" +
            "<div>" +
              "<span style='font-weight:700;'>" + esc(fmtEuro(e.amount)) + "</span>" +
              (e.receipt_number ? "<span class='cn-mini' style='margin-left:8px;'>Receipt: " + esc(e.receipt_number) + "</span>" : "") +
            "</div>" +
            "<div style='display:flex;align-items:center;gap:10px;'>" +
              "<span class='cn-mini'>" + esc(fmtDateTime(e.timestamp)) + "</span>" +
              "<button onclick=\"window._cnDelPurchase(" + esc(e.id) + ")\" style='background:rgba(255,90,122,.15);border:1px solid rgba(255,90,122,.3);color:#ff5a7a;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;'>✕</button>" +
            "</div>" +
          "</div>" +
          "</div>";
      }
    } else {
      entriesHtml = "<div class='cn-mini' style='opacity:.6;padding:8px 0;'>No purchase entries yet.</div>";
    }

    var notesHtml = "";
    if (notes.length) {
      for (var j = 0; j < notes.length; j++) {
        var n = notes[j];
        notesHtml +=
          "<div class='cn-note-row'>" +
          "<div style='display:flex;justify-content:space-between;align-items:flex-start;'>" +
            "<div>" +
              "<div style='font-size:13px;'>" + esc(n.text) + "</div>" +
              "<div class='cn-mini' style='margin-top:3px;'>" + esc(fmtDateTime(n.timestamp)) + "</div>" +
            "</div>" +
            "<button onclick=\"window._cnDelNote(" + esc(n.id) + ")\" style='background:rgba(255,90,122,.1);border:1px solid rgba(255,90,122,.25);color:#ff5a7a;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;flex-shrink:0;margin-left:10px;'>✕</button>" +
          "</div>" +
          "</div>";
      }
    } else {
      notesHtml = "<div class='cn-mini' style='opacity:.6;padding:4px 0;'>No notes yet.</div>";
    }

    var expiryLine = cn.no_expiry
      ? "<span style='color:#43d17a;font-size:12px;'>✔ Does not expire</span>"
      : (cn.expiry_date ? fmtDmy(cn.expiry_date) : "—");

    var statusBadge = isOpen
      ? "<span class='cn-badge open'>● Open</span>"
      : "<span class='cn-badge closed'>● Closed</span>";

    var remainingColor = remaining > 0 ? "#43d17a" : "#ff5a7a";

    panel.innerHTML =
      "<div class='cn-panel'>" +
        // Header row
        "<div style='display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;'>" +
          "<div>" +
            "<div style='font-weight:900;font-size:16px;'>" + esc(cn.client_name + " " + cn.client_surname) + " <span class='cn-mini'>#" + esc(cn.id) + "</span></div>" +
            "<div class='cn-mini' style='margin-top:3px;'>" + esc(cn.telephone) + (cn.email ? " • " + esc(cn.email) : "") + (cn.receipt_number ? " • Receipt: " + esc(cn.receipt_number) : "") + "</div>" +
          "</div>" +
          "<div style='display:flex;align-items:center;gap:10px;'>" +
            statusBadge +
            "<button id='cn-print-cn' class='eikon-btn'>🖨 Print</button>" +
          "</div>" +
        "</div>" +
        // Key stats
        "<div style='display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;'>" +
          "<div class='cn-stat-box'><div class='label'>Issued</div><div class='value' style='font-size:16px;'>" + esc(fmtDmy(cn.issue_date)) + "</div></div>" +
          "<div class='cn-stat-box'><div class='label'>Credit Amount</div><div class='value'>" + esc(fmtEuro(cn.amount)) + "</div></div>" +
          "<div class='cn-stat-box'><div class='label'>Remaining</div><div class='value' style='color:" + remainingColor + ";'>" + esc(fmtEuro(remaining)) + "</div></div>" +
          "<div class='cn-stat-box'><div class='label'>Expiry</div><div class='value' style='font-size:14px;'>" + expiryLine + "</div></div>" +
        "</div>" +
        // Edit form
        "<div style='font-weight:700;margin-bottom:8px;font-size:13px;'>Edit Details</div>" +
        "<div class='cn-split' style='margin-bottom:12px;'>" +
          "<div class='eikon-row' style='gap:10px;flex-wrap:wrap;'>" +
            "<div class='eikon-field' style='min-width:140px;'><div class='eikon-label'>Issue Date</div><input id='cn-issue-date' class='eikon-input' type='date' value='" + esc(cn.issue_date || ymd(new Date())) + "'></div>" +
            "<div class='eikon-field' style='flex:1;min-width:140px;'><div class='eikon-label'>First Name</div><input id='cn-client-name' class='eikon-input' placeholder='First Name' value='" + esc(cn.client_name) + "'></div>" +
            "<div class='eikon-field' style='flex:1;min-width:140px;'><div class='eikon-label'>Surname</div><input id='cn-client-surname' class='eikon-input' placeholder='Surname' value='" + esc(cn.client_surname) + "'></div>" +
          "</div>" +
          "<div class='eikon-row' style='gap:10px;flex-wrap:wrap;'>" +
            "<div class='eikon-field' style='min-width:160px;'><div class='eikon-label'>Telephone</div><input id='cn-telephone' class='eikon-input' placeholder='Telephone' value='" + esc(cn.telephone) + "'></div>" +
            "<div class='eikon-field' style='flex:1;min-width:200px;'><div class='eikon-label'>Email (optional)</div><input id='cn-email' class='eikon-input' type='email' placeholder='Email' value='" + esc(cn.email) + "'></div>" +
          "</div>" +
        "</div>" +
        "<div class='eikon-row' style='gap:10px;flex-wrap:wrap;margin-bottom:12px;'>" +
          "<div class='eikon-field' style='min-width:160px;'><div class='eikon-label'>Receipt # (optional)</div><input id='cn-receipt-number' class='eikon-input' placeholder='Receipt #' value='" + esc(cn.receipt_number) + "'></div>" +
          "<div class='eikon-field' style='min-width:130px;'><div class='eikon-label'>Amount (€)</div><input id='cn-amount' class='eikon-input' type='number' step='0.01' min='0.01' placeholder='0.00' value='" + esc(cn.amount ? parseFloat(cn.amount).toFixed(2) : "") + "'></div>" +
          "<div class='eikon-field' id='cn-expiry-date-wrap' style='min-width:170px;" + (cn.no_expiry ? "opacity:.4;" : "") + "'><div class='eikon-label'>Expiry Date</div><input id='cn-expiry-date' class='eikon-input' type='date' value='" + esc(cn.expiry_date || "") + "'" + (cn.no_expiry ? " disabled" : "") + "></div>" +
          "<div class='eikon-field' style='min-width:180px;align-self:flex-end;'><label style='display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;'><input type='checkbox' id='cn-no-expiry'" + (cn.no_expiry ? " checked" : "") + "> <span class='cn-mini'>Does not expire</span></label></div>" +
        "</div>" +
        "<div class='eikon-row' style='gap:10px;flex-wrap:wrap;margin-bottom:16px;'>" +
          "<button id='cn-save' class='eikon-btn primary'>Save Changes</button>" +
          "<button id='cn-delete' class='eikon-btn danger'>Delete</button>" +
        "</div>" +
        // Purchase entries
        "<div style='font-weight:700;margin-bottom:8px;font-size:13px;'>Purchase Entries</div>" +
        "<div style='margin-bottom:12px;'>" + entriesHtml + "</div>" +
        "<div class='eikon-row' style='gap:10px;flex-wrap:wrap;margin-bottom:16px;'>" +
          "<div class='eikon-field' style='min-width:120px;'><div class='eikon-label'>Amount (€)</div><input id='cn-pe-amount' class='eikon-input' type='number' step='0.01' min='0.01' placeholder='0.00'></div>" +
          "<div class='eikon-field' style='flex:1;min-width:160px;'><div class='eikon-label'>Receipt # (optional)</div><input id='cn-pe-receipt' class='eikon-input' placeholder='Receipt #'></div>" +
          "<div class='eikon-field' style='align-self:flex-end;'><button id='cn-add-entry' class='eikon-btn primary'>+ Add Entry</button></div>" +
        "</div>" +
        // Notes
        "<div style='font-weight:700;margin-bottom:8px;font-size:13px;'>Notes</div>" +
        "<div style='margin-bottom:10px;'>" + notesHtml + "</div>" +
        "<div class='eikon-row' style='gap:10px;flex-wrap:wrap;margin-bottom:0;'>" +
          "<div class='eikon-field' style='flex:1;min-width:260px;'><div class='eikon-label'>Add Note</div><input id='cn-note-text' class='eikon-input' placeholder='Write a note…'></div>" +
          "<div class='eikon-field' style='align-self:flex-end;'><button id='cn-add-note' class='eikon-btn'>+ Add Note</button></div>" +
        "</div>" +
      "</div>";

    // Wire buttons in the detail panel
    var btnSave = document.getElementById("cn-save");
    if (btnSave) btnSave.addEventListener("click", function () { doSave(); });

    var btnDelete = document.getElementById("cn-delete");
    if (btnDelete) btnDelete.addEventListener("click", function () { doDelete(); });

    var btnAddEntry = document.getElementById("cn-add-entry");
    if (btnAddEntry) btnAddEntry.addEventListener("click", function () { doAddPurchaseEntry(); });

    var btnAddNote = document.getElementById("cn-add-note");
    if (btnAddNote) btnAddNote.addEventListener("click", function () { doAddNote(); });

    var btnPrintCn = document.getElementById("cn-print-cn");
    if (btnPrintCn) btnPrintCn.addEventListener("click", function () { printCreditNote(state.selected); });

    var noExpiry = document.getElementById("cn-no-expiry");
    if (noExpiry) {
      noExpiry.addEventListener("change", function () {
        var wrap = document.getElementById("cn-expiry-date-wrap");
        var expInput = document.getElementById("cn-expiry-date");
        if (wrap) wrap.style.opacity = noExpiry.checked ? "0.4" : "1";
        if (expInput) expInput.disabled = noExpiry.checked;
      });
    }

    // Enter key on note input
    var noteInput = document.getElementById("cn-note-text");
    if (noteInput) {
      noteInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); doAddNote(); }
      });
    }

    // Enter key on purchase entry
    var peAmount = document.getElementById("cn-pe-amount");
    if (peAmount) {
      peAmount.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); doAddPurchaseEntry(); }
      });
    }
  }

  function renderNewForm() {
    var panel = document.getElementById("cn-detail-panel");
    if (!panel) return;

    panel.innerHTML =
      "<div class='cn-panel'>" +
        "<div style='font-weight:900;font-size:15px;margin-bottom:14px;'>🆕 New Credit Note</div>" +
        "<div class='cn-split' style='margin-bottom:12px;'>" +
          "<div class='eikon-row' style='gap:10px;flex-wrap:wrap;'>" +
            "<div class='eikon-field' style='min-width:140px;'><div class='eikon-label'>Issue Date</div><input id='cn-issue-date' class='eikon-input' type='date' value='" + esc(ymd(new Date())) + "'></div>" +
            "<div class='eikon-field' style='flex:1;min-width:140px;'><div class='eikon-label'>First Name</div><input id='cn-client-name' class='eikon-input' placeholder='First Name'></div>" +
            "<div class='eikon-field' style='flex:1;min-width:140px;'><div class='eikon-label'>Surname</div><input id='cn-client-surname' class='eikon-input' placeholder='Surname'></div>" +
          "</div>" +
          "<div class='eikon-row' style='gap:10px;flex-wrap:wrap;'>" +
            "<div class='eikon-field' style='min-width:160px;'><div class='eikon-label'>Telephone</div><input id='cn-telephone' class='eikon-input' placeholder='Telephone'></div>" +
            "<div class='eikon-field' style='flex:1;min-width:200px;'><div class='eikon-label'>Email (optional)</div><input id='cn-email' class='eikon-input' type='email' placeholder='Email'></div>" +
          "</div>" +
        "</div>" +
        "<div class='eikon-row' style='gap:10px;flex-wrap:wrap;margin-bottom:12px;'>" +
          "<div class='eikon-field' style='min-width:160px;'><div class='eikon-label'>Receipt # (optional)</div><input id='cn-receipt-number' class='eikon-input' placeholder='Receipt #'></div>" +
          "<div class='eikon-field' style='min-width:130px;'><div class='eikon-label'>Amount (€)</div><input id='cn-amount' class='eikon-input' type='number' step='0.01' min='0.01' placeholder='0.00'></div>" +
          "<div class='eikon-field' id='cn-expiry-date-wrap' style='min-width:170px;'><div class='eikon-label'>Expiry Date</div><input id='cn-expiry-date' class='eikon-input' type='date'></div>" +
          "<div class='eikon-field' style='min-width:180px;align-self:flex-end;'><label style='display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;'><input type='checkbox' id='cn-no-expiry'> <span class='cn-mini'>Does not expire</span></label></div>" +
        "</div>" +
        "<div class='eikon-row' style='gap:10px;'>" +
          "<button id='cn-save' class='eikon-btn primary'>Create Credit Note</button>" +
        "</div>" +
      "</div>";

    var btnSave = document.getElementById("cn-save");
    if (btnSave) btnSave.addEventListener("click", function () { doSave(); });

    var noExpiry = document.getElementById("cn-no-expiry");
    if (noExpiry) {
      noExpiry.addEventListener("change", function () {
        var wrap = document.getElementById("cn-expiry-date-wrap");
        var expInput = document.getElementById("cn-expiry-date");
        if (wrap) wrap.style.opacity = noExpiry.checked ? "0.4" : "1";
        if (expInput) expInput.disabled = noExpiry.checked;
      });
    }

    // Focus first name
    setTimeout(function () {
      var n = document.getElementById("cn-client-name");
      if (n) n.focus();
    }, 80);
  }

  function render(ctx) {
    var mount = ctx.mount;
    ensureStyles();

    // Global delegate for purchase/note delete buttons inside innerHTML
    window._cnDelPurchase = function (id) { doDeletePurchaseEntry(id); };
    window._cnDelNote = function (id) { doDeleteNote(id); };

    mount.innerHTML =
      // Stats bar
      "<div class='eikon-card'>" +
        "<div class='eikon-row' style='align-items:center;gap:12px;flex-wrap:wrap;'>" +
          "<span class='eikon-pill' style='font-weight:900;'>🗒️ Credit Notes</span>" +
          "<div style='display:flex;gap:12px;flex-wrap:wrap;margin-left:4px;'>" +
            "<div class='cn-stat-box'><div class='label'>Open Notes</div><div class='value' id='cn-stat-count'>—</div></div>" +
            "<div class='cn-stat-box'><div class='label'>Total Outstanding</div><div class='value' id='cn-stat-total'>—</div></div>" +
          "</div>" +
          "<div style='margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center;'>" +
            "<div class='eikon-field' style='min-width:220px;'><div class='eikon-label'>Search</div><input id='cn-search' class='eikon-input' placeholder='Name, phone, receipt…' value=''></div>" +
            "<div style='display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;'>" +
              "<label style='display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;padding-bottom:2px;'><input type='checkbox' id='cn-show-all'> Show closed</label>" +
              "<button id='cn-refresh' class='eikon-btn'>Refresh</button>" +
              "<button id='cn-print-list' class='eikon-btn'>🖨 Print List</button>" +
              "<button id='cn-new' class='eikon-btn primary'>+ New</button>" +
            "</div>" +
          "</div>" +
        "</div>" +
        "<div id='cn-busy' class='cn-mini' style='min-height:16px;margin-top:6px;'></div>" +
      "</div>" +

      // Detail panel
      "<div class='eikon-card' id='cn-detail-panel'></div>" +

      // Table
      "<div class='eikon-card'>" +
        "<div class='eikon-row' style='align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;'>" +
          "<div style='font-weight:900;'>Credit Notes</div>" +
          "<div class='eikon-pill' style='margin-left:auto;'>Shown: <span id='cn-table-count'>0</span></div>" +
        "</div>" +
        "<div class='eikon-table-wrap'>" +
          "<table class='eikon-table' style='min-width:520px;'>" +
            "<thead><tr><th style='width:110px;'>Date</th><th>Client</th><th>Telephone</th><th style='text-align:right;width:120px;'>Balance</th></tr></thead>" +
            "<tbody id='cn-tbody'></tbody>" +
          "</table>" +
        "</div>" +
      "</div>";

    // Wire controls
    document.getElementById("cn-refresh").addEventListener("click", function () { doRefresh(); });
    document.getElementById("cn-new").addEventListener("click", function () {
      state.selectedId = null; state.selected = null;
      renderNewForm();
      renderTable();
    });
    document.getElementById("cn-print-list").addEventListener("click", function () { printList(); });
    document.getElementById("cn-search").addEventListener("input", function () {
      state.q = this.value;
      applyFilter();
      renderTable();
    });
    document.getElementById("cn-show-all").addEventListener("change", function () {
      state.showAll = this.checked;
      applyFilter();
      renderTable();
    });

    renderSelection();
    renderTable();
    renderStats();
    doRefresh();
  }

  E.registerModule({
    id: "creditnotes",
    title: "Credit Notes",
    order: 20,
    icon: "🗒️",
    render: render
  });

})();
