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

  function ymdTodayUtc() {
    return new Date().toISOString().slice(0, 10);
  }

  function daysBetweenYmd(a, b) {
    // b - a in days
    if (!isYmd(a) || !isYmd(b)) return null;
    var da = new Date(a + "T00:00:00Z");
    var db = new Date(b + "T00:00:00Z");
    var ms = db.getTime() - da.getTime();
    return Math.round(ms / 86400000);
  }

  function statusFromNextDue(nextDue) {
    if (!isYmd(nextDue)) return { label: "-", days: null };
    var today = ymdTodayUtc();
    var d = daysBetweenYmd(today, nextDue);
    if (d === null) return { label: "-", days: null };
    if (d < 0) return { label: "EXPIRED", days: d };
    if (d === 0) return { label: "DUE TODAY", days: d };
    if (d <= 14) return { label: "DUE SOON", days: d };
    return { label: "VALID", days: d };
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

  function guessAuthToken() {
    try {
      if (E && typeof E.getToken === "function") {
        var t0 = E.getToken();
        if (t0) return String(t0);
      }
    } catch (e0) {}

    try {
      if (E && E.token) return String(E.token);
    } catch (e1) {}

    try {
      if (E && E.state && E.state.token) return String(E.state.token);
    } catch (e2) {}

    try {
      if (E && E.auth && E.auth.token) return String(E.auth.token);
    } catch (e3) {}

    // common storage keys (best-effort)
    var keys = [
      "eikon_token",
      "EIKON_TOKEN",
      "token",
      "auth_token",
      "eikon.auth.token"
    ];

    for (var i = 0; i < keys.length; i++) {
      try {
        var v = localStorage.getItem(keys[i]);
        if (v) return String(v);
      } catch (e4) {}
      try {
        var v2 = sessionStorage.getItem(keys[i]);
        if (v2) return String(v2);
      } catch (e5) {}
    }

    return "";
  }

  function parseFilenameFromContentDisposition(cd) {
    var v = String(cd || "");
    if (!v) return "";
    // filename*=UTF-8''...
    var m1 = v.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (m1 && m1[1]) {
      try { return decodeURIComponent(m1[1].trim()); } catch (e) { return m1[1].trim(); }
    }
    // filename="..."
    var m2 = v.match(/filename\s*=\s*"([^"]+)"/i);
    if (m2 && m2[1]) return m2[1].trim();
    // filename=...
    var m3 = v.match(/filename\s*=\s*([^;]+)/i);
    if (m3 && m3[1]) return m3[1].trim().replace(/^"+|"+$/g, "");
    return "";
  }

  async function fetchBlobWithAuth(path) {
    var token = guessAuthToken();
    if (!token) throw new Error("Missing auth token (please log in again)");

    var headers = new Headers();
    headers.set("Authorization", "Bearer " + token);

    var res = await fetch(path, {
      method: "GET",
      headers: headers,
      cache: "no-store",
      credentials: "omit"
    });

    var ct = res.headers.get("Content-Type") || "";
    var cd = res.headers.get("Content-Disposition") || "";

    if (!res.ok) {
      var txt = "";
      try { txt = await res.text(); } catch (e) {}
      // try to parse JSON error
      try {
        var j = JSON.parse(txt);
        if (j && j.error) throw new Error(String(j.error));
      } catch (e2) {}
      throw new Error("Download failed (" + res.status + "): " + (txt || res.statusText || "Error"));
    }

    var blob = await res.blob();
    return {
      blob: blob,
      contentType: ct || (blob && blob.type ? blob.type : ""),
      contentDisposition: cd
    };
  }

  async function downloadItemFile(item) {
    if (!item || !item.id) throw new Error("Missing item");
    if (!item.file_name) throw new Error("No file uploaded for this item");

    var url = "/certificates/items/" + encodeURIComponent(String(item.id)) + "/download";
    dbg("[certificates] downloadItemFile()", url, item.file_name);

    var out = await fetchBlobWithAuth(url);

    var fileName = parseFilenameFromContentDisposition(out.contentDisposition) || String(item.file_name || "download.bin");
    fileName = String(fileName).replace(/[\r\n]/g, "_");

    var a = document.createElement("a");
    var objectUrl = URL.createObjectURL(out.blob);
    a.href = objectUrl;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      try { URL.revokeObjectURL(objectUrl); } catch (e) {}
      try { a.remove(); } catch (e2) {}
    }, 2000);
  }

  async function loadItemAttachmentForPreview(item) {
    if (!item || !item.id || !item.file_name) return null;
    var url = "/certificates/items/" + encodeURIComponent(String(item.id)) + "/download";
    var out = await fetchBlobWithAuth(url);
    var objectUrl = URL.createObjectURL(out.blob);
    var ct = String(out.contentType || "").toLowerCase();
    return {
      objectUrl: objectUrl,
      contentType: ct,
      fileName: parseFilenameFromContentDisposition(out.contentDisposition) || String(item.file_name || "")
    };
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

    // 1) Try multipart first
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

      // 2) Fallback: JSON base64 (correct keys for Worker)
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

    var downloadBtn = document.createElement("button");
    downloadBtn.className = "eikon-btn";
    downloadBtn.type = "button";
    downloadBtn.textContent = "Download";
    downloadBtn.disabled = !item.file_name;
    downloadBtn.style.opacity = item.file_name ? "1" : "0.5";
    downloadBtn.addEventListener("click", function () { onDownload(item); });

    actions.appendChild(editBtn);
    actions.appendChild(uploadBtn);
    actions.appendChild(downloadBtn);

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

    var st = statusFromNextDue(item.next_due);
    var statusLine = document.createElement("div");
    statusLine.style.marginTop = "8px";
    statusLine.style.fontSize = "12px";
    statusLine.style.fontWeight = "800";
    statusLine.style.color = (st.label === "EXPIRED" || st.label === "DUE TODAY") ? "#b00020" : (st.label === "DUE SOON" ? "#a05a00" : "#1b6b1b");
    if (st.days === null) statusLine.textContent = "Status: -";
    else {
      if (st.label === "EXPIRED") statusLine.textContent = "Status: EXPIRED (" + Math.abs(st.days) + " day(s) ago)";
      else if (st.label === "DUE TODAY") statusLine.textContent = "Status: DUE TODAY";
      else statusLine.textContent = "Status: " + st.label + " (" + st.days + " day(s) remaining)";
    }

    body.appendChild(lastLabel);
    body.appendChild(lastVal);
    body.appendChild(nextLabel);
    body.appendChild(nextVal);
    body.appendChild(statusLine);

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
      '    <input class="eikon-input" id="cert-interval" type="number" min="1" max="240" value="' + esc(String(item.interval_months || 12)) + '"/>' +
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
            if (!interval || !Number.isFinite(interval) || interval < 1 || interval > 240) {
              throw new Error("Invalid interval (1..240 months)");
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

  function openPrintAll(items) {
    var list = items || [];
    if (!list.length) {
      E.modal.show("Print", '<div class="eikon-alert">No certificates to print.</div>', [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }

    var token = guessAuthToken();
    if (!token) {
      E.modal.show("Print", '<div class="eikon-alert">Missing auth token (please log in again).</div>', [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }

    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show("Print", '<div class="eikon-alert">Popup blocked. Allow popups and try again.</div>', [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }

    var html = ""
      + "<!doctype html>"
      + "<html><head><meta charset=\"utf-8\"/>"
      + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>"
      + "<title>Certificates</title>"
      + "<style>"
      + "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}"
      + "h1{margin:0 0 6px 0;font-size:20px;}"
      + ".meta{color:#444;margin:0 0 16px 0;font-size:13px;}"
      + ".bar{display:flex;gap:10px;align-items:center;justify-content:space-between;margin:0 0 10px 0;}"
      + ".btn{padding:8px 12px;font-weight:800;border:0;border-radius:10px;background:#111;color:#fff;cursor:pointer;}"
      + ".small{font-size:12px;color:#444;}"
      + "table{width:100%;border-collapse:collapse;margin-top:10px;}"
      + "th,td{border:1px solid #bbb;padding:6px 8px;font-size:12px;vertical-align:top;}"
      + "th{background:#f2f2f2;}"
      + ".section{margin-top:18px;page-break-inside:avoid;}"
      + ".doc{margin-top:8px;border:1px solid #ddd;border-radius:12px;padding:10px;}"
      + ".doc img{max-width:100%;height:auto;display:block;}"
      + ".doc iframe,.doc embed{width:100%;height:640px;border:0;}"
      + ".tag{display:inline-block;padding:2px 8px;border-radius:999px;font-weight:900;font-size:11px;}"
      + ".tag.valid{background:#e8f5e8;color:#1b6b1b;}"
      + ".tag.soon{background:#fff2d9;color:#a05a00;}"
      + ".tag.expired{background:#fde7ea;color:#b00020;}"
      + "@media print{.no-print{display:none;} body{margin:0;} .doc iframe,.doc embed{height:520px;}}"
      + "</style>"
      + "</head><body>"
      + "<div class=\"bar no-print\">"
      + "  <div><b>Certificates</b> <span class=\"small\">(with attachments)</span></div>"
      + "  <div style=\"display:flex;gap:10px;align-items:center;\">"
      + "    <div id=\"status\" class=\"small\">Loading attachments…</div>"
      + "    <button class=\"btn\" id=\"printBtn\" type=\"button\">Print</button>"
      + "  </div>"
      + "</div>"
      + "<h1>Certificates Register</h1>"
      + "<p class=\"meta\">Generated: " + esc(nowIso()) + "</p>"
      + "<table><thead><tr>"
      + "<th>Certificate</th><th>Last</th><th>Next Due</th><th>Interval</th><th>Person</th><th>Status</th><th>File</th>"
      + "</tr></thead><tbody id=\"rows\"></tbody></table>"
      + "<div id=\"attachments\"></div>"
      + "<script>"
      + "(function(){"
      + "  function esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]);});}"
      + "  function isYmd(s){return /^\\d{4}-\\d{2}-\\d{2}$/.test(String(s||'').trim());}"
      + "  function ymdTodayUtc(){return new Date().toISOString().slice(0,10);}"
      + "  function daysBetweenYmd(a,b){if(!isYmd(a)||!isYmd(b)) return null; var da=new Date(a+'T00:00:00Z'); var db=new Date(b+'T00:00:00Z'); return Math.round((db.getTime()-da.getTime())/86400000);}"
      + "  function statusFromNextDue(nextDue){if(!isYmd(nextDue)) return {label:'-',days:null,cls:'valid'}; var today=ymdTodayUtc(); var d=daysBetweenYmd(today,nextDue); if(d===null) return {label:'-',days:null,cls:'valid'}; if(d<0) return {label:'EXPIRED',days:d,cls:'expired'}; if(d===0) return {label:'DUE TODAY',days:d,cls:'expired'}; if(d<=14) return {label:'DUE SOON',days:d,cls:'soon'}; return {label:'VALID',days:d,cls:'valid'};}"
      + "  function fmtDmyFromYmd(s){var v=String(s||'').trim(); if(!isYmd(v)) return v; return v.slice(8,10)+'/'+v.slice(5,7)+'/'+v.slice(0,4);}"
      + "  function parseFilenameFromCd(cd){var v=String(cd||''); if(!v) return ''; var m1=v.match(/filename\\*\\s*=\\s*UTF-8''([^;]+)/i); if(m1&&m1[1]){try{return decodeURIComponent(m1[1].trim());}catch(e){return m1[1].trim();}} var m2=v.match(/filename\\s*=\\s*\"([^\"]+)\"/i); if(m2&&m2[1]) return m2[1].trim(); var m3=v.match(/filename\\s*=\\s*([^;]+)/i); if(m3&&m3[1]) return m3[1].trim().replace(/^\"+|\"+$/g,''); return '';}"
      + "  var items=[]; var token='';"
      + "  var rowsEl=document.getElementById('rows');"
      + "  var attEl=document.getElementById('attachments');"
      + "  var statusEl=document.getElementById('status');"
      + "  var printBtn=document.getElementById('printBtn');"
      + "  printBtn.addEventListener('click', function(){ window.print(); });"
      + "  function addRow(it){"
      + "    var st=statusFromNextDue(it.next_due);"
      + "    var person=it.requires_person ? (it.certified_person||'-') : '-';"
      + "    var file=it.file_name ? it.file_name : '-';"
      + "    var statusText='-';"
      + "    if(st.days===null) statusText=st.label;"
      + "    else if(st.label==='EXPIRED') statusText=st.label+' ('+Math.abs(st.days)+' day(s) ago)';"
      + "    else if(st.label==='DUE TODAY') statusText=st.label;"
      + "    else statusText=st.label+' ('+st.days+' day(s) remaining)';"
      + "    var tr=document.createElement('tr');"
      + "    tr.innerHTML="
      + "      '<td><b>'+esc(it.title||'')+'</b><div class=\"small\">'+esc(it.subtitle||'')+'</div></td>'"
      + "    + '<td>'+esc(it.last_date?fmtDmyFromYmd(it.last_date):'-')+'</td>'"
      + "    + '<td>'+esc(it.next_due?fmtDmyFromYmd(it.next_due):'-')+'</td>'"
      + "    + '<td>'+esc(String(it.interval_months||''))+' month(s)</td>'"
      + "    + '<td>'+esc(person)+'</td>'"
      + "    + '<td><span class=\"tag '+esc(st.cls)+'\">'+esc(st.label)+'</span><div class=\"small\">'+esc(statusText)+'</div></td>'"
      + "    + '<td>'+esc(file)+'</td>';"
      + "    rowsEl.appendChild(tr);"
      + "  }"
      + "  async function fetchBlob(path){"
      + "    var h=new Headers();"
      + "    h.set('Authorization', 'Bearer '+token);"
      + "    var res=await fetch(path,{method:'GET',headers:h,cache:'no-store',credentials:'omit'});"
      + "    var ct=res.headers.get('Content-Type')||'';"
      + "    var cd=res.headers.get('Content-Disposition')||'';"
      + "    if(!res.ok){"
      + "      var txt=''; try{txt=await res.text();}catch(e){}"
      + "      throw new Error('Fetch failed ('+res.status+'): '+(txt||res.statusText||'Error'));"
      + "    }"
      + "    var blob=await res.blob();"
      + "    return {blob:blob, ct:(ct||blob.type||''), cd:cd};"
      + "  }"
      + "  function buildAttachmentSection(it){"
      + "    var wrap=document.createElement('div');"
      + "    wrap.className='section';"
      + "    wrap.id='att_'+String(it.id);"
      + "    var head=document.createElement('div');"
      + "    head.innerHTML='<b>'+esc(it.title||'')+'</b> <span class=\"small\">('+esc(it.file_name||'')+')</span>';"
      + "    var box=document.createElement('div');"
      + "    box.className='doc';"
      + "    box.innerHTML='<div class=\"small\">Loading attachment…</div>';"
      + "    wrap.appendChild(head);"
      + "    wrap.appendChild(box);"
      + "    attEl.appendChild(wrap);"
      + "    return box;"
      + "  }"
      + "  async function loadAttachments(){"
      + "    var withFiles=items.filter(function(it){return !!it.file_name;});"
      + "    if(!withFiles.length){ statusEl.textContent='No attachments.'; return; }"
      + "    var done=0;"
      + "    for(var i=0;i<withFiles.length;i++){"
      + "      (function(it){"
      + "        var box=buildAttachmentSection(it);"
      + "        var p='/certificates/items/'+encodeURIComponent(String(it.id))+'/download';"
      + "        fetchBlob(p).then(function(out){"
      + "          var ct=String(out.ct||'').toLowerCase();"
      + "          var name=parseFilenameFromCd(out.cd)||String(it.file_name||'');"
      + "          var objUrl=URL.createObjectURL(out.blob);"
      + "          if(ct.indexOf('image/')===0){"
      + "            box.innerHTML='<img src=\"'+objUrl+'\" alt=\"'+esc(name)+'\"/>';"
      + "          } else if(ct.indexOf('application/pdf')===0){"
      + "            // Many browsers render this; printing embedded PDFs can vary, but it will at least be included as an embedded doc + link."
      + "            box.innerHTML="
      + "              '<div class=\"small\" style=\"margin-bottom:8px;\">PDF attachment: '+esc(name)+'</div>'"
      + "            + '<embed src=\"'+objUrl+'\" type=\"application/pdf\" />'"
      + "            + '<div class=\"small\" style=\"margin-top:8px;\">If the PDF does not appear in print, use the download option in the app.</div>';"
      + "          } else {"
      + "            box.innerHTML='<div class=\"small\">Attachment: '+esc(name)+'</div><a href=\"'+objUrl+'\" target=\"_blank\" rel=\"noopener\">Open</a>';"
      + "          }"
      + "        }).catch(function(e){"
      + "          box.innerHTML='<div class=\"small\" style=\"color:#b00020; font-weight:800;\">Failed to load attachment: '+esc(String(e&&e.message?e.message:e))+'</div>';"
      + "        }).finally(function(){"
      + "          done++;"
      + "          statusEl.textContent='Attachments: '+done+' / '+withFiles.length+' loaded';"
      + "          if(done===withFiles.length){"
      + "            statusEl.textContent='Attachments loaded.';"
      + "            // Auto-print once everything is loaded:
      + "            setTimeout(function(){ try{ window.print(); }catch(e){} }, 300);"
      + "          }"
      + "        });"
      + "      })(withFiles[i]);"
      + "    }"
      + "  }"
      + "  window.addEventListener('message', function(ev){"
      + "    try{"
      + "      var d=ev.data||{};"
      + "      if(!d || d.type!=='EIKON_CERT_PRINT') return;"
      + "      items = d.items || [];"
      + "      token = String(d.token||'');"
      + "      rowsEl.innerHTML='';"
      + "      for(var i=0;i<items.length;i++) addRow(items[i]);"
      + "      loadAttachments();"
      + "    }catch(e){"
      + "      statusEl.textContent='Error: '+String(e&&e.message?e.message:e);"
      + "    }"
      + "  });"
      + "})();"
      + "</script>"
      + "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();

    // Send items + token to print window
    try {
      w.postMessage({ type: "EIKON_CERT_PRINT", items: list, token: token }, window.location.origin);
    } catch (e) {
      try {
        // fallback (some browsers allow "*" here)
        w.postMessage({ type: "EIKON_CERT_PRINT", items: list, token: token }, "*");
      } catch (e2) {}
    }
  }

  async function render(ctx) {
    var mount = ctx.mount;
    dbg("[certificates] render() start", ctx);

    mount.innerHTML =
      '<div class="eikon-card">' +
      '  <div class="eikon-row" style="align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
      '    <div>' +
      '      <div style="font-weight:900;font-size:18px;">Certificates</div>' +
      '      <div style="color:#666;font-size:12px;margin-top:2px;">Upload a document/photo for each item. New uploads overwrite the old file. Use Download for the current attachment. Use Print to generate a full register including attachments.</div>' +
      "    </div>" +
      '    <div class="eikon-row" style="gap:10px;flex-wrap:wrap;">' +
      '      <button class="eikon-btn" id="cert-refresh">Refresh</button>' +
      '      <button class="eikon-btn" id="cert-print">Print All</button>' +
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
            async function () {
              try {
                await downloadItemFile(it);
              } catch (e) {
                err("[certificates] download failed:", e);
                E.modal.show("Download failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
                  { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
                ]);
              }
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
        openPrintAll(state.items || []);
      } catch (e) {
        err("[certificates] print failed", e);
        E.modal.show("Print failed", '<div class="eikon-alert">' + esc(String(e && (e.message || e.bodyText || e))) + "</div>", [
          { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
        ]);
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
