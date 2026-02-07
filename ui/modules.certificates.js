(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.certificates.js)");

  function dbg() {
    try {
      if (E && typeof E.dbg === "function") E.dbg.apply(null, arguments);
      else console.log.apply(console, arguments);
    } catch (e) {}
  }

  function err() {
    try {
      if (E && typeof E.error === "function") E.error.apply(null, arguments);
      else console.error.apply(console, arguments);
    } catch (e) {}
  }

  function esc(s) { return E.escapeHtml(s); }

  function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }

  function fmtDmyFromYmd(s) {
    var v = String(s || "").trim();
    if (!isYmd(v)) return v;
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }

  function fmtDmyFromIsoOrSqlite(s) {
    var v = String(s || "").trim();
    if (!v) return "";
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(v)) return fmtDmyFromYmd(v.slice(0, 10));
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDmyFromYmd(v.slice(0, 10));
    if (isYmd(v)) return fmtDmyFromYmd(v);
    return v;
  }

  function fileToBase64Payload(file) {
    return new Promise(function (resolve, reject) {
      try {
        var r = new FileReader();
        r.onerror = function () { reject(r.error || new Error("File read error")); };
        r.onload = function () {
          var res = String(r.result || "");
          var idx = res.indexOf(",");
          var b64 = idx >= 0 ? res.slice(idx + 1) : res;
          resolve({
            file_name: file && file.name ? String(file.name) : "upload.bin",
            file_mime: file && file.type ? String(file.type) : "application/octet-stream",
            file_b64: b64
          });
        };
        r.readAsDataURL(file);
      } catch (e) { reject(e); }
    });
  }

  function getAuthTokenBestEffort() {
    try {
      if (E && E.auth) {
        if (typeof E.auth.getToken === "function") {
          var t1 = String(E.auth.getToken() || "").trim();
          if (t1) return t1;
        }
        if (E.auth.token) {
          var t2 = String(E.auth.token || "").trim();
          if (t2) return t2;
        }
      }
    } catch (e) {}

    try {
      var keys = ["eikon_token", "EIKON_TOKEN", "token", "auth_token", "eikon.auth.token"];
      for (var i = 0; i < keys.length; i++) {
        var v = localStorage.getItem(keys[i]);
        if (v && String(v).trim()) return String(v).trim();
      }
    } catch (e2) {}

    return "";
  }

  function parseFilenameFromContentDisposition(cd) {
    var s = String(cd || "");
    if (!s) return "";

    // filename*=UTF-8''...
    var m1 = s.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (m1 && m1[1]) {
      try { return decodeURIComponent(m1[1].trim().replace(/^\"|\"$/g, "")); } catch (e) {}
    }

    // filename="..."
    var m2 = s.match(/filename\s*=\s*\"([^\"]+)\"/i);
    if (m2 && m2[1]) return m2[1];

    // filename=...
    var m3 = s.match(/filename\s*=\s*([^;]+)/i);
    if (m3 && m3[1]) return m3[1].trim().replace(/^\"|\"$/g, "");

    return "";
  }

  async function fetchBlobWithAuth(path) {
    var token = getAuthTokenBestEffort();
    var headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;

    var url = path;
    if (String(url || "").indexOf("http") !== 0) {
      url = new URL(String(path || ""), window.location.origin).toString();
    }

    var res = await fetch(url, { method: "GET", headers: headers });
    if (!res.ok) {
      var tx = "";
      try { tx = await res.text(); } catch (e) {}
      throw new Error("Download failed (" + res.status + "): " + (tx || res.statusText || "Error"));
    }

    var cd = res.headers.get("Content-Disposition") || "";
    var ct = res.headers.get("Content-Type") || "";
    var filename = parseFilenameFromContentDisposition(cd) || "";
    var blob = await res.blob();

    return { blob: blob, filename: filename, contentType: ct || blob.type || "" };
  }

  function isProbablyEmbedded() {
    try {
      return window.top && window.top !== window.self;
    } catch (e) {
      // cross-origin top access throws => you're embedded
      return true;
    }
  }

  function writePopupShell(w) {
    try {
      w.document.open();
      w.document.write(
        "<!doctype html><html><head><meta charset=\"utf-8\"/>" +
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>" +
        "<title>Certificate Download</title>" +
        "<style>" +
        "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:22px;color:#111;}" +
        ".card{border:1px solid #ddd;border-radius:14px;padding:14px;max-width:680px;}" +
        ".t{font-weight:900;font-size:16px;margin-bottom:6px;}" +
        ".s{opacity:.8;}" +
        ".row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px;}" +
        "a.btn,button.btn{display:inline-block;padding:10px 12px;border-radius:12px;border:1px solid #111;background:#111;color:#fff;font-weight:900;text-decoration:none;cursor:pointer;}" +
        "a.btn.secondary{background:#fff;color:#111;}" +
        ".small{font-size:12px;opacity:.75;margin-top:10px;line-height:1.35;}" +
        "code{background:#f2f2f2;border-radius:8px;padding:2px 6px;}" +
        "</style></head><body>" +
        "<div class=\"card\">" +
        "<div class=\"t\">Preparing download…</div>" +
        "<div class=\"s\" id=\"st\">Fetching file from server</div>" +
        "<div class=\"row\" id=\"actions\" style=\"display:none;\"></div>" +
        "<div class=\"small\" id=\"hint\"></div>" +
        "</div>" +
        "</body></html>"
      );
      w.document.close();
    } catch (e) {}
  }

  function popupSetText(w, id, text) {
    try {
      var el = w.document.getElementById(id);
      if (el) el.textContent = String(text || "");
    } catch (e) {}
  }

  function popupSetHtml(w, id, html) {
    try {
      var el = w.document.getElementById(id);
      if (el) el.innerHTML = String(html || "");
    } catch (e) {}
  }

  function popupShowActions(w) {
    try {
      var el = w.document.getElementById("actions");
      if (el) el.style.display = "flex";
    } catch (e) {}
  }

  function popupClearActions(w) {
    try {
      var el = w.document.getElementById("actions");
      if (el) el.innerHTML = "";
    } catch (e) {}
  }

  function popupAddActionLink(w, opts) {
    try {
      var actions = w.document.getElementById("actions");
      if (!actions) return null;
      var a = w.document.createElement("a");
      a.className = "btn" + (opts && opts.secondary ? " secondary" : "");
      a.href = opts && opts.href ? opts.href : "#";
      if (opts && opts.download) a.setAttribute("download", opts.download);
      if (opts && opts.target) a.setAttribute("target", opts.target);
      if (opts && opts.rel) a.setAttribute("rel", opts.rel);
      a.textContent = opts && opts.label ? opts.label : "Action";
      actions.appendChild(a);
      return a;
    } catch (e) {
      return null;
    }
  }

  function popupAddActionButton(w, opts) {
    try {
      var actions = w.document.getElementById("actions");
      if (!actions) return null;
      var b = w.document.createElement("button");
      b.className = "btn" + (opts && opts.secondary ? " secondary" : "");
      b.type = "button";
      b.textContent = opts && opts.label ? opts.label : "Button";
      if (opts && typeof opts.onClick === "function") b.addEventListener("click", opts.onClick);
      actions.appendChild(b);
      return b;
    } catch (e) {
      return null;
    }
  }

  async function triggerDownloadForItem(item) {
    if (!item || !item.id) throw new Error("Missing item");
    if (!item.file_name) throw new Error("No file uploaded");

    // IMPORTANT: open popup immediately during user click
    var w = null;
    try {
      // try to reduce opener coupling; not guaranteed
      w = window.open("", "_blank");
      if (w) {
        try { w.opener = null; } catch (eop) {}
      }
    } catch (e) {}

    if (!w) {
      throw new Error("Popup blocked. Please allow popups for this site to download files.");
    }

    writePopupShell(w);

    var dlPath = "/certificates/items/" + encodeURIComponent(String(item.id)) + "/download";

    try {
      popupSetText(w, "st", "Fetching: " + String(item.file_name || "file"));

      var out = await fetchBlobWithAuth(dlPath);
      var filename = out.filename || item.file_name || "download.bin";
      var ctLower = String(out.contentType || "").toLowerCase();

      // Create blob URL in the popup's origin
      var blobUrl = null;
      try {
        blobUrl = w.URL.createObjectURL(out.blob);
      } catch (eurl) {
        // fallback: create in current window (still ok for blob)
        blobUrl = URL.createObjectURL(out.blob);
      }

      popupSetText(w, "st", "Ready: " + filename);
      popupShowActions(w);
      popupClearActions(w);

      // Primary: user-click download link (most reliable in Chrome)
      var dlLink = popupAddActionLink(w, {
        label: "CLICK TO DOWNLOAD",
        href: blobUrl,
        download: filename,
        rel: "noopener"
      });

      // Secondary: open in viewer (useful for PDFs/images if download is blocked by policy)
      var openLink = popupAddActionLink(w, {
        label: (ctLower.indexOf("pdf") >= 0 ? "Open PDF" : "Open file"),
        href: blobUrl,
        target: "_blank",
        rel: "noopener",
        secondary: true
      });

      popupSetHtml(
        w,
        "hint",
        "If Chrome blocks the download, click <b>Open file</b> and then use the browser viewer’s download button.<br/>" +
        "File type: <code>" + esc(out.contentType || out.blob.type || "unknown") + "</code>"
      );

      // Convenience: auto-click ONLY when not embedded (direct UI), because embedded contexts are where Chrome is strictest.
      // Even then, keep it best-effort.
      if (!isProbablyEmbedded() && dlLink) {
        setTimeout(function () {
          try { dlLink.click(); } catch (eauto) {}
        }, 50);
      }

      // Cleanup when popup is closed; also revoke after a while to prevent memory leaks
      var revoked = false;
      function revokeLater() {
        if (revoked) return;
        revoked = true;
        try { w.URL.revokeObjectURL(blobUrl); } catch (e1) {}
        try { URL.revokeObjectURL(blobUrl); } catch (e2) {}
      }

      // Revoke after 10 minutes (user might need time)
      setTimeout(revokeLater, 10 * 60 * 1000);

      // Add a close button
      popupAddActionButton(w, {
        label: "Close",
        secondary: true,
        onClick: function () {
          try { revokeLater(); } catch (e3) {}
          try { w.close(); } catch (e4) {}
        }
      });

      // If popup unloads, revoke too
      try {
        w.addEventListener("beforeunload", function () {
          try { revokeLater(); } catch (e5) {}
        });
      } catch (e6) {}

    } catch (e) {
      popupSetText(w, "st", "Download failed: " + String(e && (e.message || e)));
      popupShowActions(w);
      popupClearActions(w);

      popupAddActionButton(w, {
        label: "Close",
        onClick: function () { try { w.close(); } catch (e2) {} }
      });

      throw e;
    }
  }

  var state = {
    items: [],
    mounted: false
  };

  async function loadItems() {
    dbg("[certificates] loadItems() start");
    var resp = await E.apiFetch("/certificates/items", { method: "GET" });
    dbg("[certificates] loadItems() resp=", resp);

    if (!resp || !resp.ok) {
      throw new Error((resp && resp.error) ? resp.error : "Failed to load certificates");
    }

    state.items = resp.items || [];
    dbg("[certificates] items loaded count=", state.items.length, state.items);
    return state.items;
  }

  async function updateItem(itemId, payload) {
    dbg("[certificates] updateItem() id=", itemId, "payload=", payload);
    var resp = await E.apiFetch("/certificates/items/" + encodeURIComponent(String(itemId)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {})
    });
    dbg("[certificates] updateItem() resp=", resp);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) ? resp.error : "Update failed");
    return resp;
  }

  async function uploadFile(itemId, file) {
    dbg("[certificates] uploadFile() start itemId=", itemId, "file=", file && file.name, file && file.type, file && file.size);
    if (!file) throw new Error("No file selected");

    try {
      var fd = new FormData();
      fd.append("file", file, file.name);

      var resp = await E.apiFetch("/certificates/items/" + encodeURIComponent(String(itemId)) + "/upload", {
        method: "POST",
        body: fd
      });

      dbg("[certificates] upload multipart resp=", resp);
      if (resp && resp.ok) return resp;

      throw new Error((resp && resp.error) ? resp.error : "Upload failed");
    } catch (e) {
      dbg("[certificates] multipart upload failed, fallback to base64 json. err=", e);

      var payload = await fileToBase64Payload(file);

      var resp2 = await E.apiFetch("/certificates/items/" + encodeURIComponent(String(itemId)) + "/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      dbg("[certificates] upload base64 resp=", resp2);
      if (!resp2 || !resp2.ok) throw new Error((resp2 && resp2.error) ? resp2.error : (e && e.message ? e.message : "Upload failed"));
      return resp2;
    }
  }

  function buildCard(item, onEdit, onUpload, onDownload) {
    var card = document.createElement("div");
    card.className = "eikon-card";
    card.style.flex = "1";
    card.style.minWidth = "340px";

    var head = document.createElement("div");
    head.style.display = "flex";
    head.style.alignItems = "flex-start";
    head.style.justifyContent = "space-between";
    head.style.gap = "10px";

    var titleWrap = document.createElement("div");

    var title = document.createElement("div");
    title.style.fontWeight = "900";
    title.style.fontSize = "16px";
    title.textContent = item.title || "";

    var sub = document.createElement("div");
    sub.style.color = "#666";
    sub.style.fontSize = "12px";
    sub.style.marginTop = "2px";
    sub.textContent = item.subtitle || "";

    titleWrap.appendChild(title);
    titleWrap.appendChild(sub);

    var actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";
    actions.style.justifyContent = "flex-end";

    var editBtn = document.createElement("button");
    editBtn.className = "eikon-btn";
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", function () { onEdit(item); });

    var uploadBtn = document.createElement("button");
    uploadBtn.className = "eikon-btn";
    uploadBtn.type = "button";
    uploadBtn.textContent = "Upload";
    uploadBtn.addEventListener("click", function () { onUpload(item); });

    actions.appendChild(editBtn);
    actions.appendChild(uploadBtn);

    if (item.file_name) {
      var downloadBtn = document.createElement("button");
      downloadBtn.className = "eikon-btn";
      downloadBtn.type = "button";
      downloadBtn.textContent = "Download";
      downloadBtn.addEventListener("click", function () { onDownload(item); });
      actions.appendChild(downloadBtn);
    }

    head.appendChild(titleWrap);
    head.appendChild(actions);

    var body = document.createElement("div");
    body.style.marginTop = "12px";

    var lastLabel = document.createElement("div");
    lastLabel.style.fontWeight = "800";
    lastLabel.style.fontSize = "12px";
    lastLabel.style.color = "#444";
    lastLabel.textContent = item.last_label || "Last";

    var lastVal = document.createElement("div");
    lastVal.style.marginTop = "2px";
    lastVal.style.fontSize = "14px";
    lastVal.style.fontWeight = "800";
    lastVal.textContent = item.last_date ? fmtDmyFromYmd(item.last_date) : "-";

    var nextLabel = document.createElement("div");
    nextLabel.style.marginTop = "10px";
    nextLabel.style.fontWeight = "800";
    nextLabel.style.fontSize = "12px";
    nextLabel.style.color = "#444";
    nextLabel.textContent = item.next_label || "Next Due";

    var nextVal = document.createElement("div");
    nextVal.style.marginTop = "2px";
    nextVal.style.fontSize = "14px";
    nextVal.style.fontWeight = "900";
    nextVal.style.color = "#1a57c6";
    nextVal.textContent = item.next_due ? fmtDmyFromYmd(item.next_due) : "-";

    body.appendChild(lastLabel);
    body.appendChild(lastVal);
    body.appendChild(nextLabel);
    body.appendChild(nextVal);

    if (item.requires_person) {
      var pLabel = document.createElement("div");
      pLabel.style.marginTop = "10px";
      pLabel.style.fontWeight = "800";
      pLabel.style.fontSize = "12px";
      pLabel.style.color = "#444";
      pLabel.textContent = "Certified Person";

      var pVal = document.createElement("div");
      pVal.style.marginTop = "2px";
      pVal.style.fontSize = "13px";
      pVal.textContent = item.certified_person ? item.certified_person : "-";

      body.appendChild(pLabel);
      body.appendChild(pVal);
    }

    var fileInfo = document.createElement("div");
    fileInfo.style.marginTop = "12px";
    fileInfo.style.fontSize = "12px";
    fileInfo.style.color = "#444";

    if (item.file_name) {
      fileInfo.innerHTML =
        "<div><b>File:</b> " + esc(item.file_name) + "</div>" +
        "<div><b>Uploaded:</b> " + esc(fmtDmyFromIsoOrSqlite(item.file_uploaded_at || "")) + "</div>";
    } else {
      fileInfo.textContent = "File: -";
    }

    body.appendChild(fileInfo);

    card.appendChild(head);
    card.appendChild(body);

    return card;
  }

  function openEditModal(item, afterSave) {
    dbg("[certificates] openEditModal()", item);

    var last = item.last_date || "";
    var person = item.certified_person || "";

    var body =
      '<div class="eikon-row">' +
      '  <div class="eikon-field" style="min-width:220px;">' +
      '    <div class="eikon-label">' + esc(item.last_label || "Last") + "</div>" +
      '    <input class="eikon-input" id="cert-last-date" type="date" value="' + esc(last) + '"/>' +
      "  </div>" +
      '  <div class="eikon-field" style="min-width:160px;">' +
      '    <div class="eikon-label">Interval (months)</div>' +
      '    <input class="eikon-input" id="cert-interval" type="number" min="1" max="120" value="' + esc(String(item.interval_months || 12)) + '"/>' +
      "  </div>" +
      "</div>";

    if (item.requires_person) {
      body +=
        '<div class="eikon-row" style="margin-top:10px;">' +
        '  <div class="eikon-field" style="flex:1;min-width:260px;">' +
        '    <div class="eikon-label">Certified Person</div>' +
        '    <input class="eikon-input" id="cert-person" type="text" value="' + esc(person) + '"/>' +
        "  </div>" +
        "</div>";
    }

    E.modal.show("Edit Certificate", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: async function () {
          try {
            var lastDate = String(E.q("#cert-last-date").value || "").trim();
            var interval = parseInt(String(E.q("#cert-interval").value || "").trim(), 10);
            var personVal = item.requires_person ? String(E.q("#cert-person").value || "").trim() : "";

            if (lastDate && !isYmd(lastDate)) {
              throw new Error("Invalid date (YYYY-MM-DD)");
            }
            if (!interval || !Number.isFinite(interval) || interval < 1 || interval > 120) {
              throw new Error("Invalid interval (1..120 months)");
            }

            var payload = {
              last_date: lastDate || null,
              interval_months: interval
            };
            if (item.requires_person) payload.certified_person = personVal;

            dbg("[certificates] save payload=", payload);

            await updateItem(item.id, payload);

            E.modal.hide();
            if (typeof afterSave === "function") afterSave();
          } catch (e) {
            err("[certificates] save failed:", e);
            E.modal.show("Save failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
              { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
            ]);
          }
        }
      }
    ]);
  }

  function openUploadPicker(item, afterUpload) {
    dbg("[certificates] openUploadPicker()", item);

    var input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/*,.pdf,.jpg,.jpeg,.png,.webp";
    input.style.display = "none";

    input.addEventListener("change", async function () {
      try {
        var file = input.files && input.files[0] ? input.files[0] : null;
        if (!file) return;

        await uploadFile(item.id, file);

        if (typeof afterUpload === "function") afterUpload();
      } catch (e) {
        err("[certificates] upload failed:", e);
        E.modal.show("Upload failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
      } finally {
        try { input.remove(); } catch (e2) {}
      }
    });

    document.body.appendChild(input);
    input.click();
  }

  function openPrintAllWindow(items) {
    var list = Array.isArray(items) ? items.slice() : [];
    window.__EIKON_CERT_PRINT_DATA = { items: list };

    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show("Print", '<div class="eikon-alert">Popup blocked. Allow popups and try again.</div>', [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }

    var html =
      "<!doctype html>" +
      "<html><head><meta charset=\"utf-8\"/>" +
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>" +
      "<title>Certificates</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:22px;color:#111;}" +
      "h1{margin:0 0 6px 0;font-size:20px;}" +
      ".meta{color:#444;margin:0 0 16px 0;font-size:13px;}" +
      ".no-print{margin-bottom:10px;display:flex;gap:10px;align-items:center;}" +
      "button{padding:8px 12px;font-weight:800;border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer;}" +
      "table{width:100%;border-collapse:collapse;margin-top:8px;}" +
      "th,td{border:1px solid #bbb;padding:6px 8px;font-size:12px;vertical-align:top;}" +
      "th{background:#f2f2f2;}" +
      ".doc{margin-top:10px;border:1px solid #ddd;border-radius:12px;padding:10px;}" +
      ".doc h3{margin:0 0 6px 0;font-size:13px;}" +
      ".doc .small{font-size:11px;color:#444;}" +
      ".doc img{max-width:100%;height:auto;border-radius:10px;}" +
      ".doc embed{width:100%;height:680px;border:0;}" +
      "@media print{.no-print{display:none;}body{margin:0;}}" +
      "</style>" +
      "</head><body>" +
      "<div class=\"no-print\">" +
      "<button id=\"btnPrint\">Print</button>" +
      "<div id=\"status\" style=\"font-weight:800;color:#444;\">Loading documents…</div>" +
      "</div>" +
      "<div id=\"root\"></div>" +
      "<script>" +
      "(function(){" +
      "function esc(s){return String(s||'').replace(/[&<>\"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]);});}" +
      "function isYmd(s){return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(s||'').trim());}" +
      "function fmtDmy(ymd){var v=String(ymd||'').trim();if(!isYmd(v))return v;return v.slice(8,10)+'/'+v.slice(5,7)+'/'+v.slice(0,4);}" +
      "function getToken(){try{var keys=['eikon_token','EIKON_TOKEN','token','auth_token','eikon.auth.token'];for(var i=0;i<keys.length;i++){var v=localStorage.getItem(keys[i]);if(v&&String(v).trim())return String(v).trim();}}catch(e){}return '';}" +
      "function parseCdFilename(cd){cd=String(cd||'');var m1=cd.match(/filename\\*\\s*=\\s*UTF-8''([^;]+)/i);if(m1&&m1[1]){try{return decodeURIComponent(m1[1].trim().replace(/^\\\"|\\\"$/g,''));}catch(e){}}var m2=cd.match(/filename\\s*=\\s*\\\"([^\\\"]+)\\\"/i);if(m2&&m2[1])return m2[1];var m3=cd.match(/filename\\s*=\\s*([^;]+)/i);if(m3&&m3[1])return m3[1].trim().replace(/^\\\"|\\\"$/g,'');return '';}" +
      "var data=(window.opener&&window.opener.__EIKON_CERT_PRINT_DATA)?window.opener.__EIKON_CERT_PRINT_DATA:null;" +
      "var root=document.getElementById('root');" +
      "var statusEl=document.getElementById('status');" +
      "document.getElementById('btnPrint').addEventListener('click',function(){window.print();});" +
      "if(!data){statusEl.textContent='Missing print data';return;}" +
      "var items=Array.isArray(data.items)?data.items:[];" +
      "var html='';" +
      "html+='<h1>Certificates</h1>';" +
      "html+='<p class=\"meta\">Printed: '+esc(new Date().toLocaleString())+'</p>';" +
      "html+='<table><thead><tr>';" +
      "html+='<th>Certificate</th><th>Last</th><th>Next Due</th><th>Interval (months)</th><th>Person</th><th>File</th>';" +
      "html+='</tr></thead><tbody>';" +
      "for(var i=0;i<items.length;i++){" +
      "var it=items[i]||{};" +
      "html+='<tr>';" +
      "html+='<td><b>'+esc(it.title||'')+'</b><div class=\"small\">'+esc(it.subtitle||'')+'</div></td>';" +
      "html+='<td>'+esc(it.last_date?fmtDmy(it.last_date):'-')+'</td>';" +
      "html+='<td><b>'+esc(it.next_due?fmtDmy(it.next_due):'-')+'</b></td>';" +
      "html+='<td>'+esc(String(it.interval_months||''))+'</td>';" +
      "html+='<td>'+esc(it.requires_person?(it.certified_person||'-'):'-')+'</td>';" +
      "html+='<td>'+esc(it.file_name?it.file_name:'-')+'</td>';" +
      "html+='</tr>';" +
      "}" +
      "html+='</tbody></table>';" +
      "html+='<div style=\"margin-top:16px;\">';" +
      "for(var j=0;j<items.length;j++){" +
      "var it2=items[j]||{};" +
      "if(!it2.file_name) continue;" +
      "html+='<div class=\"doc\" id=\"doc_'+j+'\">'+" +
      "'<h3>'+esc(it2.title||'')+' — Document</h3>'+" +
      "'<div class=\"small\">'+esc(it2.file_name||'')+'</div>'+" +
      "'<div class=\"small\" id=\"doc_status_'+j+'\">Fetching…</div>'+" +
      "'<div id=\"doc_body_'+j+'\" style=\"margin-top:8px;\"></div>'+" +
      "'</div>';" +
      "}" +
      "html+='</div>';" +
      "root.innerHTML=html;" +
      "var token=getToken();" +
      "var headers={}; if(token) headers['Authorization']='Bearer '+token;" +
      "var tasks=[];" +
      "for(let k=0;k<items.length;k++){" +
      "let it3=items[k]||{};" +
      "if(!it3.file_name) continue;" +
      "let id=it3.id;" +
      "let docStatus=document.getElementById('doc_status_'+k);" +
      "let docBody=document.getElementById('doc_body_'+k);" +
      "let p=(function(idx,itemId){" +
      "return fetch('/certificates/items/'+encodeURIComponent(String(itemId))+'/download?inline=1',{method:'GET',headers:headers})" +
      ".then(function(res){if(!res.ok){return res.text().then(function(t){throw new Error('HTTP '+res.status+': '+(t||res.statusText));});}" +
      "var ct=res.headers.get('Content-Type')||'';" +
      "var cd=res.headers.get('Content-Disposition')||'';" +
      "var fn=parseCdFilename(cd)||'';" +
      "return res.blob().then(function(b){return {blob:b,ct:ct||b.type||'',fn:fn};});})" +
      ".then(function(obj){" +
      "docStatus.textContent='Loaded '+(obj.fn?('('+obj.fn+')'):'');" +
      "var ct2=String(obj.ct||'').toLowerCase();" +
      "var url=URL.createObjectURL(obj.blob);" +
      "if(ct2.indexOf('image/')===0){" +
      "var im=document.createElement('img'); im.src=url; docBody.appendChild(im);" +
      "} else if(ct2.indexOf('pdf')>=0){" +
      "var em=document.createElement('embed'); em.src=url; em.type='application/pdf'; docBody.appendChild(em);" +
      "} else {" +
      "var a=document.createElement('a'); a.href=url; a.textContent='Open file'; a.target='_blank'; a.rel='noopener'; docBody.appendChild(a);" +
      "}" +
      "})" +
      ".catch(function(e){docStatus.textContent='Failed: '+String(e&&(e.message||e));});" +
      "})(k,id);" +
      "tasks.push(p);" +
      "}" +
      "Promise.allSettled(tasks).then(function(){" +
      "statusEl.textContent='Ready';" +
      "setTimeout(function(){try{window.print();}catch(e){}}, 300);" +
      "});" +
      "})();" +
      "</script>" +
      "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function render(ctx) {
    var mount = ctx.mount;
    dbg("[certificates] render() start", ctx);

    mount.innerHTML =
      '<div class="eikon-card">' +
      '  <div class="eikon-row" style="align-items:flex-end;justify-content:space-between;">' +
      '    <div>' +
      '      <div style="font-weight:900;font-size:18px;">Certificates</div>' +
      '      <div style="color:#666;font-size:12px;margin-top:2px;">Upload a document/photo for each item. New uploads overwrite the old file.</div>' +
      "    </div>" +
      '    <div class="eikon-row" style="gap:10px;flex-wrap:wrap;justify-content:flex-end;">' +
      '      <button class="eikon-btn" id="cert-print">Print All</button>' +
      '      <button class="eikon-btn" id="cert-refresh">Refresh</button>' +
      "    </div>" +
      "  </div>" +
      "</div>" +
      '<div id="cert-grid" class="eikon-row" style="gap:14px;flex-wrap:wrap;align-items:stretch;"></div>';

    var grid = E.q("#cert-grid", mount);
    var refreshBtn = E.q("#cert-refresh", mount);
    var printBtn = E.q("#cert-print", mount);

    if (!grid || !refreshBtn || !printBtn) {
      err("[certificates] DOM missing", { grid: !!grid, refreshBtn: !!refreshBtn, printBtn: !!printBtn });
      throw new Error("Certificates DOM incomplete (see console)");
    }

    async function refresh() {
      dbg("[certificates] refresh() start");
      var items = await loadItems();
      dbg("[certificates] refresh() got items", items);

      grid.innerHTML = "";
      for (var i = 0; i < items.length; i++) {
        (function (it) {
          var card = buildCard(
            it,
            function () { openEditModal(it, refresh); },
            function () { openUploadPicker(it, refresh); },
            function () {
              triggerDownloadForItem(it).catch(function (e) {
                err("[certificates] download failed:", e);
                E.modal.show("Download failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
                  { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
                ]);
              });
            }
          );
          grid.appendChild(card);
        })(items[i]);
      }
      dbg("[certificates] refresh() done");
    }

    refreshBtn.addEventListener("click", function () {
      refresh().catch(function (e) { err("[certificates] refresh click failed", e); });
    });

    printBtn.addEventListener("click", function () {
      try {
        openPrintAllWindow(state.items || []);
      } catch (e) {
        err("[certificates] print failed", e);
      }
    });

    await refresh();

    state.mounted = true;
    dbg("[certificates] render() done");
  }

  E.registerModule({
    id: "certificates",
    title: "Certificates",
    order: 18,
    icon: "📄",
    render: render
  });

})();
