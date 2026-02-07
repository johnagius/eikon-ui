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
    // sqlite datetime('now') yields "YYYY-MM-DD HH:MM:SS"
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(v)) return fmtDmyFromYmd(v.slice(0, 10));
    // ISO "YYYY-MM-DDTHH:MM:SSZ"
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDmyFromYmd(v.slice(0, 10));
    // fallback
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
            mime: file && file.type ? String(file.type) : "application/octet-stream",
            b64: b64
          });
        };
        r.readAsDataURL(file);
      } catch (e) { reject(e); }
    });
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

      // 2) Fallback: JSON base64
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

  function buildCard(item, onEdit, onUpload) {
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

  async function render(ctx) {
    var mount = ctx.mount;
    dbg("[certificates] render() start", ctx);

    mount.innerHTML =
      '<div class="eikon-card">' +
      '  <div class="eikon-row" style="align-items:flex-end;justify-content:space-between;">' +
      '    <div>' +
      '      <div style="font-weight:900;font-size:18px;">Certificates</div>' +
      '      <div style="color:#666;font-size:12px;margin-top:2px;">Upload a document/photo for each item. New uploads overwrite the old file. No preview is shown.</div>' +
      "    </div>" +
      '    <div class="eikon-row" style="gap:10px;">' +
      '      <button class="eikon-btn" id="cert-refresh">Refresh</button>' +
      "    </div>" +
      "  </div>" +
      "</div>" +
      '<div id="cert-grid" class="eikon-row" style="gap:14px;flex-wrap:wrap;align-items:stretch;"></div>';

    var grid = E.q("#cert-grid", mount);
    var refreshBtn = E.q("#cert-refresh", mount);

    if (!grid || !refreshBtn) {
      err("[certificates] DOM missing", { grid: !!grid, refreshBtn: !!refreshBtn });
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
            function () { openUploadPicker(it, refresh); }
          );
          grid.appendChild(card);
        })(items[i]);
      }
      dbg("[certificates] refresh() done");
    }

    refreshBtn.addEventListener("click", function () {
      refresh().catch(function (e) { err("[certificates] refresh click failed", e); });
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
