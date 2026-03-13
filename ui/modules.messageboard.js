/* ============================================================
   EIKON — Chat Board Module  (modules.messageboard.js)
   - Organisation & All scope messaging
   - @mention autocomplete
   - #suggestion extraction
   - Pinned messages (max 30)
   - 6-month auto-cleanup (server-side)
   - Suggestion table with priority + CSV export (superadmin)
   ============================================================ */
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ----------------------------
  // Helpers
  // ----------------------------
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") n.className = String(v || "");
      else if (k === "text") n.textContent = String(v == null ? "" : v);
      else if (k === "html") n.innerHTML = String(v == null ? "" : v);
      else if (k === "style") n.setAttribute("style", String(v || ""));
      else if (k === "value") { n.value = String(v == null ? "" : v); }
      else if (k === "type") n.type = String(v || "");
      else if (k === "placeholder") n.placeholder = String(v || "");
      else if (k === "disabled") n.disabled = !!v;
      else if (k === "checked") n.checked = !!v;
      else n.setAttribute(k, String(v));
    });
    if (Array.isArray(kids)) {
      kids.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") n.appendChild(document.createTextNode(c));
        else n.appendChild(c);
      });
    }
    return n;
  }
  function pad2(n) { var v = String(n); return v.length === 1 ? "0" + v : v; }

  // Toast (local, same as alerts module)
  var _toastWrap = null;
  function toast(title, message, kind, ms) {
    if (!_toastWrap) {
      _toastWrap = document.getElementById("eikon-toast-wrap");
      if (!_toastWrap) {
        _toastWrap = el("div", { id: "eikon-toast-wrap", style: "position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));" });
        document.body.appendChild(_toastWrap);
      }
    }
    var t = el("div", { class: "eikon-toast " + (kind || ""), style: "border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);" });
    if (kind === "good") t.style.borderColor = "rgba(67,209,122,.35)";
    else if (kind === "bad") t.style.borderColor = "rgba(255,90,122,.35)";
    else if (kind === "warn") t.style.borderColor = "rgba(255,200,90,.35)";
    t.innerHTML = '<div style="font-weight:900;margin:0 0 4px 0;font-size:13px;">' + esc(title) + '</div><div style="margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;">' + esc(message) + '</div>';
    _toastWrap.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, ms || 4000);
  }

  function timeAgo(isoStr) {
    if (!isoStr) return "";
    var d;
    try { d = new Date(isoStr); } catch (e) { return ""; }
    var diff = Math.max(0, Date.now() - d.getTime());
    var s = Math.floor(diff / 1000);
    if (s < 60) return "just now";
    var m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    var days = Math.floor(h / 24);
    if (days < 30) return days + "d ago";
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function fmtDate(isoStr) {
    if (!isoStr) return "";
    var d;
    try { d = new Date(isoStr); } catch (e) { return ""; }
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear();
  }

  function initial(name) {
    var s = String(name || "").trim();
    if (!s) return "?";
    var parts = s.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return s[0].toUpperCase();
  }

  // Avatar colour from name
  function avatarColor(name) {
    var hash = 0;
    var s = String(name || "");
    for (var i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
    var colors = ["#5B8DEF","#E8596E","#43D17A","#F5A623","#9B59B6","#1ABC9C","#E67E22","#3498DB","#E74C3C","#2ECC71"];
    return colors[Math.abs(hash) % colors.length];
  }

  var SUPERADMIN_EMAIL = "labrint@gmail.com";

  // Clean display name: if full_name looks like an email, extract a readable name
  function cleanDisplayName(name) {
    if (!name) return "";
    var s = String(name).trim();
    // Check if name looks like an email (contains @ with domain-like suffix)
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      // Extract the local part before @, replace dots/underscores with spaces, capitalize words
      var local = s.split("@")[0];
      local = local.replace(/[._\-]+/g, " ");
      return local.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }
    return s;
  }

  // ----------------------------
  // State
  // ----------------------------
  var state = {
    mount: null,
    scope: "org",         // 'org' or 'all'
    messages: [],
    pinnedMessages: [],
    suggestions: [],
    pollTimer: null,
    loading: false,
    hasOlder: true,
    pinnedCollapsed: false,
    mentionDropdownVisible: false,
    mentionQuery: "",
    mentionUsers: [],
    mentionDebounceTimer: null,
    mentionCaretPos: 0
  };

  // ----------------------------
  // CSS
  // ----------------------------
  var cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    cssInjected = true;
    var st = document.createElement("style");
    st.id = "eikon-board-style";
    st.textContent =
      /* Layout */
      ".board-wrap{display:flex;flex-direction:column;height:calc(100vh - 80px);max-height:calc(100vh - 80px);}" +
      ".board-header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}" +
      ".board-title{font-weight:950;font-size:17px;letter-spacing:.2px}" +
      ".board-toggle{display:flex;gap:0;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,.12)}" +
      ".board-toggle-btn{padding:7px 16px;font-size:12px;font-weight:800;cursor:pointer;border:none;background:rgba(255,255,255,.04);color:rgba(255,255,255,.6);transition:all .15s}" +
      ".board-toggle-btn.active{background:rgba(58,160,255,.18);color:#5BA2FF;border-color:rgba(58,160,255,.3)}" +
      ".board-toggle-btn:hover:not(.active){background:rgba(255,255,255,.08)}" +

      /* Info banner */
      ".board-info{font-size:11.5px;color:var(--muted,rgba(255,255,255,.5));padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);margin-bottom:10px;line-height:1.45}" +
      ".board-info b{color:rgba(255,255,255,.75)}" +

      /* Pinned section */
      ".board-pinned{border:1px solid rgba(255,196,0,.18);background:rgba(255,196,0,.03);border-radius:14px;padding:10px 12px;margin-bottom:10px}" +
      ".board-pinned-header{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer}" +
      ".board-pinned-title{font-weight:900;font-size:13px;display:flex;align-items:center;gap:6px}" +
      ".board-pinned-badge{background:rgba(255,196,0,.2);color:rgba(255,196,0,.9);font-size:11px;padding:1px 7px;border-radius:6px;font-weight:900}" +
      ".board-pinned-toggle{font-size:11px;color:var(--muted,rgba(255,255,255,.5));cursor:pointer}" +
      ".board-pinned-list{margin-top:8px;display:flex;flex-direction:column;gap:6px}" +
      ".board-pinned-msg{padding:8px 10px;border-radius:10px;border:1px solid rgba(255,196,0,.12);background:rgba(0,0,0,.15);border-left:3px solid rgba(255,196,0,.4)}" +
      ".board-pinned-msg .msg-meta{font-size:11px;color:var(--muted,rgba(255,255,255,.5));margin-bottom:3px}" +
      ".board-pinned-msg .msg-body{font-size:12.5px;line-height:1.35;word-break:break-word}" +
      ".board-pinned-msg .msg-actions{margin-top:4px;display:flex;gap:6px}" +

      /* Feed container */
      ".board-feed-wrap{flex:1;min-height:0;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(0,0,0,.10);overflow:hidden}" +
      ".board-feed{flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}" +
      ".board-feed-empty{text-align:center;padding:40px 20px;color:var(--muted,rgba(255,255,255,.4));font-size:13px}" +
      ".board-load-older{text-align:center;padding:8px}" +
      ".board-load-older button{font-size:11px;padding:5px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:rgba(255,255,255,.6);cursor:pointer}" +
      ".board-load-older button:hover{background:rgba(255,255,255,.08)}" +

      /* Message bubble */
      ".board-msg{display:flex;gap:8px;max-width:85%}" +
      ".board-msg-own{align-self:flex-end;flex-direction:row-reverse}" +
      ".board-msg-other{align-self:flex-start}" +
      ".board-msg-avatar{width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:#fff;flex:0 0 auto}" +
      ".board-msg-content{min-width:0}" +
      ".board-msg-bubble{padding:8px 12px;border-radius:14px;font-size:13px;line-height:1.4;word-break:break-word}" +
      ".board-msg-other .board-msg-bubble{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08)}" +
      ".board-msg-own .board-msg-bubble{background:rgba(58,160,255,.10);border:1px solid rgba(58,160,255,.15)}" +
      ".board-msg-meta{font-size:10.5px;color:var(--muted,rgba(255,255,255,.45));margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}" +
      ".board-msg-own .board-msg-meta{justify-content:flex-end}" +
      ".board-msg-name{font-weight:900;font-size:11.5px;color:rgba(255,255,255,.75)}" +
      ".board-msg-loc{font-size:10.5px;color:var(--muted,rgba(255,255,255,.4))}" +
      ".board-msg-pin-btn{font-size:10px;cursor:pointer;opacity:.5;transition:opacity .15s;background:none;border:none;color:inherit;padding:0}" +
      ".board-msg-pin-btn:hover{opacity:1}" +
      ".board-msg-del-btn{font-size:10px;cursor:pointer;opacity:.55;transition:opacity .15s;background:none;border:none;color:rgba(255,90,122,.8);padding:2px 4px}" +
      ".board-msg-del-btn:hover{opacity:1}" +
      ".board-msg-scope{font-size:9px;padding:1px 5px;border-radius:4px;font-weight:800}" +
      ".board-msg-scope-org{background:rgba(155,89,182,.15);color:rgba(155,89,182,.8)}" +
      ".board-msg-scope-all{background:rgba(58,160,255,.1);color:rgba(58,160,255,.7)}" +

      /* Highlight @mentions and #suggestion in message body */
      ".msg-mention{color:#5BA2FF;font-weight:700}" +
      ".msg-hashtag{color:#43D17A;font-weight:700}" +

      /* Compose bar */
      ".board-compose{display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.08);align-items:flex-end;position:relative}" +
      ".board-compose-input{flex:1;resize:none;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.04);color:#e9eef7;padding:10px 12px;font-size:13px;font-family:inherit;min-height:20px;max-height:100px;line-height:1.35;outline:none;transition:border-color .15s}" +
      ".board-compose-input:focus{border-color:rgba(58,160,255,.4)}" +
      ".board-compose-input::placeholder{color:rgba(255,255,255,.3)}" +
      ".board-send-btn{padding:8px 18px;border-radius:10px;border:none;background:#5BA2FF;color:#fff;font-weight:900;font-size:13px;cursor:pointer;transition:opacity .15s;white-space:nowrap}" +
      ".board-send-btn:disabled{opacity:.35;cursor:default}" +
      ".board-send-btn:hover:not(:disabled){opacity:.85}" +

      /* @mention autocomplete dropdown */
      ".board-mention-drop{position:absolute;bottom:100%;left:12px;right:80px;max-height:180px;overflow-y:auto;background:rgba(15,22,34,.97);border:1px solid rgba(255,255,255,.14);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.45);z-index:100;display:none}" +
      ".board-mention-drop.visible{display:block}" +
      ".board-mention-item{padding:8px 12px;cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:8px;transition:background .1s}" +
      ".board-mention-item:hover,.board-mention-item.selected{background:rgba(58,160,255,.12)}" +
      ".board-mention-item-name{font-weight:800}" +
      ".board-mention-item-loc{font-size:11px;color:var(--muted,rgba(255,255,255,.4))}" +
      ".board-mention-empty{padding:10px 12px;font-size:12px;color:var(--muted,rgba(255,255,255,.4));text-align:center}" +

      /* Suggestions section */
      ".board-sug{margin-top:14px;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:12px;background:rgba(0,0,0,.08)}" +
      ".board-sug-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;flex-wrap:wrap}" +
      ".board-sug-title{font-weight:950;font-size:14px}" +
      ".board-sug-actions{display:flex;gap:8px;flex-wrap:wrap}" +
      ".board-sug-btn{padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:rgba(255,255,255,.7);font-size:11.5px;font-weight:800;cursor:pointer;transition:all .15s}" +
      ".board-sug-btn:hover{background:rgba(255,255,255,.08)}" +
      ".board-sug-btn-primary{background:rgba(58,160,255,.12);border-color:rgba(58,160,255,.25);color:#5BA2FF}" +
      ".board-sug-table{width:100%;border-collapse:collapse}" +
      ".board-sug-table th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;color:var(--muted,rgba(255,255,255,.4));padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.08)}" +
      ".board-sug-table td{padding:8px 8px;border-bottom:1px solid rgba(255,255,255,.05);font-size:12.5px;vertical-align:top}" +
      ".board-sug-table tr:hover td{background:rgba(255,255,255,.02)}" +

      /* Priority pills */
      ".board-pri{display:inline-block;padding:2px 8px;border-radius:6px;font-size:10.5px;font-weight:900;cursor:pointer}" +
      ".board-pri-low{background:rgba(255,255,255,.06);color:rgba(255,255,255,.5)}" +
      ".board-pri-medium{background:rgba(58,160,255,.12);color:#5BA2FF}" +
      ".board-pri-high{background:rgba(255,90,122,.15);color:#FF5A7A}" +

      /* Status pills */
      ".board-status{display:inline-block;padding:2px 8px;border-radius:6px;font-size:10.5px;font-weight:800}" +
      ".board-status-open{background:rgba(58,160,255,.1);color:rgba(58,160,255,.8)}" +
      ".board-status-in_progress{background:rgba(255,196,0,.1);color:rgba(255,196,0,.8)}" +
      ".board-status-resolved{background:rgba(67,209,122,.1);color:rgba(67,209,122,.8)}" +

      /* Suggestion action buttons */
      ".board-sug-act{font-size:10px;cursor:pointer;opacity:.55;transition:opacity .15s;background:none;border:none;color:rgba(255,255,255,.6);padding:2px 4px}" +
      ".board-sug-act:hover{opacity:1}" +
      ".board-sug-act-del{color:rgba(255,90,122,.8)}" +
      ".board-sug-comment-count{font-size:10px;color:var(--muted,rgba(255,255,255,.4));cursor:pointer}" +
      ".board-sug-comment-count:hover{color:rgba(255,255,255,.7)}" +

      /* Empty state */
      ".board-sug-empty{text-align:center;padding:18px;color:var(--muted,rgba(255,255,255,.35));font-size:12.5px}" +

      /* Responsive */
      "@media(max-width:640px){.board-msg{max-width:95%}.board-header{flex-direction:column;align-items:flex-start;gap:8px}}";
    document.head.appendChild(st);
  }

  // ----------------------------
  // API helpers
  // ----------------------------
  async function api(path, opts) {
    return E.apiFetch(path, opts || { method: "GET" });
  }

  // ----------------------------
  // Render helpers
  // ----------------------------
  function highlightBody(body) {
    // Clean email-based @mentions in body before escaping (e.g. @marcie@domain.com -> @Marcie)
    var cleaned = body.replace(/@([^\s@]+@[^\s@]+\.[^\s@]+)/g, function (match, email) {
      return "@" + cleanDisplayName(email);
    });
    // Escape first, then add highlights
    var s = esc(cleaned);
    // Highlight @mentions
    s = s.replace(/@([A-Za-z][\w .&#39;\-]{1,50})/g, '<span class="msg-mention">@$1</span>');
    // Highlight #suggestion
    s = s.replace(/#suggestion/gi, '<span class="msg-hashtag">#suggestion</span>');
    // Newlines
    s = s.replace(/\n/g, "<br>");
    return s;
  }

  function renderMessage(msg, isOwn) {
    var cls = "board-msg " + (isOwn ? "board-msg-own" : "board-msg-other");
    var scopeLabel = msg.scope === "org"
      ? '<span class="board-msg-scope board-msg-scope-org">ORG</span>'
      : '<span class="board-msg-scope board-msg-scope-all">ALL</span>';

    var pinBtn = '<button class="board-msg-pin-btn" data-action="pin" data-id="' + msg.id + '" title="' + (msg.is_pinned ? "Unpin" : "Pin") + '">' + (msg.is_pinned ? "Unpin" : "Pin") + '</button>';
    var delBtn = isOwn ? '<button class="board-msg-del-btn" data-action="delete-msg" data-id="' + msg.id + '" title="Delete">Delete</button>' : "";

    var locName = msg.location_name || "";
    return '<div class="' + cls + '" data-msg-id="' + msg.id + '">' +
      '<div class="board-msg-avatar" style="background:' + avatarColor(locName) + '">' + esc(initial(locName)) + '</div>' +
      '<div class="board-msg-content">' +
        (!isOwn ? '<div><span class="board-msg-name">' + esc(locName) + '</span></div>' : '') +
        '<div class="board-msg-bubble">' + highlightBody(msg.body) + '</div>' +
        '<div class="board-msg-meta">' +
          scopeLabel + ' ' +
          '<span>' + esc(timeAgo(msg.created_at)) + '</span> ' +
          pinBtn + ' ' + delBtn +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderPinnedMessage(msg) {
    return '<div class="board-pinned-msg" data-msg-id="' + msg.id + '">' +
      '<div class="msg-meta"><b>' + esc(msg.location_name || "") + '</b> \u00B7 ' + esc(timeAgo(msg.created_at)) + '</div>' +
      '<div class="msg-body">' + highlightBody(msg.body) + '</div>' +
      '<div class="msg-actions"><button class="board-msg-pin-btn" data-action="pin" data-id="' + msg.id + '" title="Unpin">Unpin</button></div>' +
    '</div>';
  }

  function renderSuggestionRow(sug, idx) {
    var user = E.state.user || {};
    var isSuperadmin = String(user.email || "").toLowerCase() === SUPERADMIN_EMAIL;
    var isOwner = sug.created_by === (user.user_id || user.id);
    var priCls = "board-pri board-pri-" + sug.priority;
    var statusCls = "board-status board-status-" + sug.status;
    var statusLabel = sug.status === "in_progress" ? "in progress" : sug.status;
    var commentBadge = (sug.comment_count > 0) ? '<span class="board-sug-comment-count" data-action="view-suggestion" data-id="' + sug.id + '">' + sug.comment_count + ' comment' + (sug.comment_count > 1 ? 's' : '') + '</span>' : '';
    var actions = '';
    if (isOwner || isSuperadmin) {
      actions += '<button class="board-sug-act" data-action="edit-suggestion" data-id="' + sug.id + '" title="Edit">Edit</button>';
      actions += '<button class="board-sug-act board-sug-act-del" data-action="delete-suggestion" data-id="' + sug.id + '" title="Delete">Del</button>';
    }
    if (isSuperadmin) {
      actions += '<button class="board-sug-act" data-action="view-suggestion" data-id="' + sug.id + '" title="View / Comment">View</button>';
    }
    return '<tr data-sug-id="' + sug.id + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td>' + esc(sug.title) + ' ' + commentBadge + '</td>' +
      '<td>' + esc(cleanDisplayName(sug.created_by_name)) + '</td>' +
      '<td><span class="' + priCls + '" data-action="cycle-priority" data-id="' + sug.id + '" title="Click to change">' + esc(sug.priority) + '</span></td>' +
      '<td><span class="' + statusCls + '"' + (isSuperadmin ? ' data-action="cycle-status" data-id="' + sug.id + '" title="Click to change" style="cursor:pointer"' : '') + '>' + esc(statusLabel) + '</span></td>' +
      '<td>' + esc(fmtDate(sug.created_at)) + '</td>' +
      '<td>' + actions + '</td>' +
    '</tr>';
  }

  // ----------------------------
  // Full render
  // ----------------------------
  function renderUI() {
    var m = state.mount;
    if (!m || E.state.activeModuleId !== "messageboard") return;

    var user = E.state.user || {};
    var isSuperadmin = String(user.email || "").toLowerCase() === SUPERADMIN_EMAIL;

    // --- Pinned section ---
    var pinnedHtml = "";
    if (state.pinnedMessages.length > 0) {
      var pinnedList = "";
      if (!state.pinnedCollapsed) {
        pinnedList = '<div class="board-pinned-list">';
        for (var p = 0; p < state.pinnedMessages.length; p++) {
          pinnedList += renderPinnedMessage(state.pinnedMessages[p]);
        }
        pinnedList += '</div>';
      }
      pinnedHtml = '<div class="board-pinned">' +
        '<div class="board-pinned-header" data-action="toggle-pinned">' +
          '<div class="board-pinned-title">Pinned <span class="board-pinned-badge">' + state.pinnedMessages.length + '</span></div>' +
          '<span class="board-pinned-toggle">' + (state.pinnedCollapsed ? "Show" : "Hide") + '</span>' +
        '</div>' +
        pinnedList +
      '</div>';
    }

    // --- Message feed ---
    var feedHtml = "";
    if (state.messages.length === 0 && !state.loading) {
      feedHtml = '<div class="board-feed-empty">No messages yet. Be the first to post!</div>';
    } else {
      // Load older button
      if (state.hasOlder && state.messages.length > 0) {
        feedHtml += '<div class="board-load-older"><button data-action="load-older">Load older messages</button></div>';
      }
      for (var i = 0; i < state.messages.length; i++) {
        var msg = state.messages[i];
        var isOwn = msg.user_id === (user.user_id || user.id);
        feedHtml += renderMessage(msg, isOwn);
      }
    }

    // --- Suggestions ---
    var sugRows = "";
    if (state.suggestions.length === 0) {
      sugRows = '<tr><td colspan="7" class="board-sug-empty">No suggestions yet</td></tr>';
    } else {
      for (var s = 0; s < state.suggestions.length; s++) {
        sugRows += renderSuggestionRow(state.suggestions[s], s);
      }
    }

    var exportBtn = isSuperadmin
      ? '<button class="board-sug-btn" data-action="export-suggestions">Export CSV</button>'
      : '';

    // --- Full layout ---
    var wrapper = m.querySelector(".board-wrap");
    if (!wrapper) {
      m.innerHTML =
        '<div class="board-wrap">' +
          '<div class="board-header">' +
            '<div class="board-title">Chat Board</div>' +
            '<div class="board-toggle">' +
              '<button class="board-toggle-btn' + (state.scope === "org" ? " active" : "") + '" data-action="scope-org">Organisation</button>' +
              '<button class="board-toggle-btn' + (state.scope === "all" ? " active" : "") + '" data-action="scope-all">All</button>' +
            '</div>' +
          '</div>' +
          '<div class="board-info">' +
            'Messages are kept for <b>6 months</b>. <b>Pin</b> important messages to keep them permanently (max 30). ' +
            'Use <b>#suggestion</b> in your message to save it as a suggestion. Use <b>@location</b> to mention a pharmacy.' +
          '</div>' +
          '<div id="board-pinned-section">' + pinnedHtml + '</div>' +
          '<div class="board-feed-wrap">' +
            '<div class="board-feed" id="board-feed">' + feedHtml + '</div>' +
            '<div class="board-compose">' +
              '<div class="board-mention-drop" id="board-mention-drop"></div>' +
              '<textarea class="board-compose-input" id="board-input" placeholder="Type a message... @location #suggestion" rows="1" maxlength="2000"></textarea>' +
              '<button class="board-send-btn" id="board-send-btn" disabled data-action="send">Send</button>' +
            '</div>' +
          '</div>' +
          '<div class="board-sug" id="board-sug-section">' +
            '<div class="board-sug-header">' +
              '<div class="board-sug-title">Suggestions</div>' +
              '<div class="board-sug-actions">' +
                '<button class="board-sug-btn board-sug-btn-primary" data-action="new-suggestion">+ New Suggestion</button>' +
                exportBtn +
              '</div>' +
            '</div>' +
            '<table class="board-sug-table">' +
              '<thead><tr><th>#</th><th>Suggestion</th><th>By</th><th>Priority</th><th>Status</th><th>Date</th><th></th></tr></thead>' +
              '<tbody id="board-sug-body">' + sugRows + '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
      return;
    }

    // Incremental updates for pinned, feed, suggestions
    var pinnedEl = m.querySelector("#board-pinned-section");
    if (pinnedEl) pinnedEl.innerHTML = pinnedHtml;

    var feedEl = m.querySelector("#board-feed");
    if (feedEl) {
      var wasAtBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 60;
      feedEl.innerHTML = feedHtml;
      if (wasAtBottom) feedEl.scrollTop = feedEl.scrollHeight;
    }

    var sugBody = m.querySelector("#board-sug-body");
    if (sugBody) sugBody.innerHTML = sugRows;

    // Toggle buttons
    var orgBtn = m.querySelector('[data-action="scope-org"]');
    var allBtn = m.querySelector('[data-action="scope-all"]');
    if (orgBtn) orgBtn.className = "board-toggle-btn" + (state.scope === "org" ? " active" : "");
    if (allBtn) allBtn.className = "board-toggle-btn" + (state.scope === "all" ? " active" : "");

    // Export btn visibility
    var sugHeader = m.querySelector(".board-sug-actions");
    if (sugHeader) {
      var existingExport = sugHeader.querySelector('[data-action="export-suggestions"]');
      if (isSuperadmin && !existingExport) {
        sugHeader.insertAdjacentHTML("beforeend", '<button class="board-sug-btn" data-action="export-suggestions">Export CSV</button>');
      }
    }
  }

  // ----------------------------
  // Data loading
  // ----------------------------
  async function loadMessages(opts) {
    opts = opts || {};
    try {
      var params = "?scope=" + state.scope + "&limit=50";
      if (opts.before) params += "&before=" + opts.before;
      if (opts.after) params += "&after=" + opts.after;

      var res = await api("/board/messages" + params);
      if (!res.ok) return;

      var msgs = res.messages || [];

      if (opts.before) {
        // Prepend older
        if (msgs.length < 50) state.hasOlder = false;
        state.messages = msgs.concat(state.messages);
      } else if (opts.after) {
        // Append newer (polling)
        if (msgs.length > 0) {
          state.messages = state.messages.concat(msgs);
        }
      } else {
        // Fresh load
        state.messages = msgs;
        state.hasOlder = msgs.length >= 50;
      }
    } catch (e) {
      console.warn("[board] loadMessages error", e);
    }
  }

  async function loadPinned() {
    try {
      var res = await api("/board/messages?pinned=1&limit=30");
      if (res.ok) state.pinnedMessages = res.messages || [];
    } catch (e) {
      console.warn("[board] loadPinned error", e);
    }
  }

  async function loadSuggestions() {
    try {
      var res = await api("/board/suggestions");
      if (res.ok) state.suggestions = res.suggestions || [];
    } catch (e) {
      console.warn("[board] loadSuggestions error", e);
    }
  }

  async function initialLoad() {
    state.loading = true;
    renderUI();
    // Fire all in parallel, render progressively as each completes
    var msgDone = loadMessages().then(function () {
      state.loading = false;
      renderUI();
      var feedEl = state.mount && state.mount.querySelector("#board-feed");
      if (feedEl) feedEl.scrollTop = feedEl.scrollHeight;
    });
    var pinDone = loadPinned().then(function () { renderUI(); });
    var sugDone = loadSuggestions().then(function () { renderUI(); });
    await Promise.all([msgDone, pinDone, sugDone]);
  }

  async function pollNewMessages() {
    if (!state.mount || !state.mount.isConnected || E.state.activeModuleId !== "messageboard") {
      stopPolling();
      return;
    }
    var lastId = 0;
    if (state.messages.length > 0) {
      lastId = state.messages[state.messages.length - 1].id;
    }
    if (lastId) {
      await loadMessages({ after: lastId });
    } else {
      await loadMessages();
    }
    // Also refresh pinned (lightweight)
    await loadPinned();
    renderUI();
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(function () {
      pollNewMessages();
    }, 12000);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // ----------------------------
  // Actions
  // ----------------------------
  async function sendMessage() {
    var input = state.mount && state.mount.querySelector("#board-input");
    if (!input) return;
    var body = input.value.trim();
    if (!body) return;

    var sendBtn = state.mount.querySelector("#board-send-btn");
    if (sendBtn) sendBtn.disabled = true;

    try {
      var res = await api("/board/messages", {
        method: "POST",
        body: JSON.stringify({ body: body, scope: state.scope })
      });
      if (res.ok) {
        input.value = "";
        input.style.height = "auto";
        // Add message to list immediately
        if (res.message) {
          state.messages.push(res.message);
        }
        // Check if suggestion was created
        if (/#suggestion/i.test(body)) {
          await loadSuggestions();
        }
        renderUI();
        var feedEl = state.mount.querySelector("#board-feed");
        if (feedEl) feedEl.scrollTop = feedEl.scrollHeight;
      } else {
        toast("Error", res.error || "Failed to send", "bad");
      }
    } catch (e) {
      toast("Error", e.message || "Failed to send", "bad");
    }

    if (sendBtn) sendBtn.disabled = !input.value.trim();
  }

  async function pinMessage(msgId) {
    try {
      var res = await api("/board/messages/" + msgId + "/pin", { method: "PUT", body: "{}" });
      if (res.ok) {
        await Promise.all([loadMessages(), loadPinned()]);
        renderUI();
        toast("Done", res.is_pinned ? "Message pinned" : "Message unpinned", "good", 2000);
      } else {
        toast("Error", res.error || "Failed", "bad");
      }
    } catch (e) {
      toast("Error", e.message || "Failed to pin", "bad");
    }
  }

  function deleteMessage(msgId) {
    msgId = Number(msgId);
    if (!msgId) { console.error("[board] invalid msgId", msgId); return; }
    E.modal.show("Delete Message", "Are you sure you want to delete this message?", [
      { label: "Delete", danger: true, onClick: async function () {
        E.modal.hide();
        try {
          await E.apiFetch("/board/messages/" + msgId, { method: "DELETE" });
          state.messages = state.messages.filter(function (m) { return Number(m.id) !== msgId; });
          state.pinnedMessages = state.pinnedMessages.filter(function (m) { return Number(m.id) !== msgId; });
          renderUI();
          toast("Deleted", "Message removed", "good", 2000);
        } catch (e) {
          console.error("[board] delete error", e);
          toast("Error", e.message || "Failed to delete", "bad");
        }
      }},
      { label: "Cancel", onClick: function () { E.modal.hide(); } }
    ]);
  }

  async function cyclePriority(sugId) {
    var sug = state.suggestions.find(function (s) { return s.id === sugId; });
    if (!sug) return;
    var order = ["low", "medium", "high"];
    var idx = order.indexOf(sug.priority);
    var next = order[(idx + 1) % order.length];
    try {
      await api("/board/suggestions/" + sugId, { method: "PUT", body: JSON.stringify({ priority: next }) });
      sug.priority = next;
      renderUI();
    } catch (e) {
      toast("Error", "Failed to update priority", "bad");
    }
  }

  async function cycleStatus(sugId) {
    var user = E.state.user || {};
    if (String(user.email || "").toLowerCase() !== SUPERADMIN_EMAIL) return;
    var sug = state.suggestions.find(function (s) { return s.id === sugId; });
    if (!sug) return;
    var order = ["open", "in_progress", "resolved"];
    var idx = order.indexOf(sug.status);
    var next = order[(idx + 1) % order.length];
    try {
      await api("/board/suggestions/" + sugId, { method: "PUT", body: JSON.stringify({ status: next }) });
      sug.status = next;
      renderUI();
    } catch (e) {
      toast("Error", "Failed to update status", "bad");
    }
  }

  function deleteSuggestion(sugId) {
    sugId = Number(sugId);
    if (!sugId) return;
    E.modal.show("Delete Suggestion", "Are you sure you want to delete this suggestion?", [
      { label: "Delete", danger: true, onClick: async function () {
        E.modal.hide();
        try {
          await E.apiFetch("/board/suggestions/" + sugId, { method: "DELETE" });
          state.suggestions = state.suggestions.filter(function (s) { return Number(s.id) !== sugId; });
          renderUI();
          toast("Deleted", "Suggestion removed", "good", 2000);
        } catch (e) {
          toast("Error", e.message || "Failed to delete", "bad");
        }
      }},
      { label: "Cancel", onClick: function () { E.modal.hide(); } }
    ]);
  }

  function editSuggestion(sugId) {
    sugId = Number(sugId);
    var sug = state.suggestions.find(function (s) { return Number(s.id) === sugId; });
    if (!sug) return;
    var bodyHtml =
      '<div style="min-width:320px;max-width:500px;">' +
        '<label style="display:block;font-size:12px;margin-bottom:4px;color:rgba(255,255,255,.6);">Suggestion</label>' +
        '<textarea id="board-sug-edit-title" rows="3" style="width:100%;padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.04);color:#e9eef7;font-size:13px;font-family:inherit;resize:vertical;">' + esc(sug.title) + '</textarea>' +
      '</div>';
    E.modal.show("Edit Suggestion", bodyHtml, [
      { label: "Save", primary: true, onClick: async function () {
        var titleEl = document.getElementById("board-sug-edit-title");
        var title = titleEl ? titleEl.value.trim() : "";
        if (!title) { toast("Required", "Please enter a suggestion", "warn"); return; }
        try {
          await api("/board/suggestions/" + sugId, { method: "PUT", body: JSON.stringify({ title: title }) });
          sug.title = title;
          E.modal.hide();
          renderUI();
          toast("Saved", "Suggestion updated", "good", 2000);
        } catch (e) {
          toast("Error", e.message || "Failed", "bad");
        }
      }},
      { label: "Cancel", onClick: function () { E.modal.hide(); } }
    ]);
  }

  async function viewSuggestion(sugId) {
    sugId = Number(sugId);
    var sug = state.suggestions.find(function (s) { return Number(s.id) === sugId; });
    if (!sug) return;
    var user = E.state.user || {};
    var isSuperadmin = String(user.email || "").toLowerCase() === SUPERADMIN_EMAIL;

    // Fetch comments
    var comments = [];
    try {
      var res = await api("/board/suggestions/" + sugId + "/comments");
      if (res.ok) comments = res.comments || [];
    } catch (e) {}

    var statusLabel = sug.status === "in_progress" ? "in progress" : sug.status;
    var bodyHtml =
      '<div style="min-width:360px;max-width:560px;">' +
        '<div style="margin-bottom:10px;font-size:13px;line-height:1.45;word-break:break-word;">' + esc(sug.title) + '</div>' +
        '<div style="margin-bottom:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
          '<span class="board-pri board-pri-' + sug.priority + '">' + esc(sug.priority) + '</span>' +
          '<span class="board-status board-status-' + sug.status + '">' + esc(statusLabel) + '</span>' +
          '<span style="font-size:11px;color:var(--muted,rgba(255,255,255,.4));">by ' + esc(sug.created_by_name) + ' \u00B7 ' + esc(fmtDate(sug.created_at)) + '</span>' +
        '</div>';

    if (comments.length > 0) {
      bodyHtml += '<div style="border-top:1px solid rgba(255,255,255,.08);padding-top:10px;margin-top:8px;">';
      bodyHtml += '<div style="font-weight:900;font-size:12px;margin-bottom:8px;">Comments</div>';
      for (var i = 0; i < comments.length; i++) {
        var c = comments[i];
        bodyHtml += '<div style="margin-bottom:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);">' +
          '<div style="font-size:11px;color:var(--muted,rgba(255,255,255,.5));margin-bottom:3px;"><b>' + esc(c.user_name) + '</b> \u00B7 ' + esc(timeAgo(c.created_at)) + '</div>' +
          '<div style="font-size:12.5px;line-height:1.4;word-break:break-word;">' + esc(c.body) + '</div>' +
        '</div>';
      }
      bodyHtml += '</div>';
    }

    if (isSuperadmin) {
      bodyHtml += '<div style="border-top:1px solid rgba(255,255,255,.08);padding-top:10px;margin-top:8px;">' +
        '<textarea id="board-sug-comment-input" rows="2" style="width:100%;padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.04);color:#e9eef7;font-size:13px;font-family:inherit;resize:vertical;" placeholder="Add a comment..."></textarea>' +
      '</div>';
    }

    bodyHtml += '</div>';

    var actions = [];
    if (isSuperadmin) {
      actions.push({ label: "Add Comment", primary: true, onClick: async function () {
        var inp = document.getElementById("board-sug-comment-input");
        var body = inp ? inp.value.trim() : "";
        if (!body) { toast("Required", "Please enter a comment", "warn"); return; }
        try {
          await api("/board/suggestions/" + sugId + "/comments", { method: "POST", body: JSON.stringify({ body: body }) });
          toast("Saved", "Comment added", "good", 2000);
          E.modal.hide();
          viewSuggestion(sugId); // Re-open to show new comment
        } catch (e) {
          toast("Error", e.message || "Failed", "bad");
        }
      }});
      if (sug.status !== "in_progress") {
        actions.push({ label: "Mark In Progress", onClick: async function () {
          try {
            await api("/board/suggestions/" + sugId, { method: "PUT", body: JSON.stringify({ status: "in_progress" }) });
            sug.status = "in_progress";
            renderUI();
            E.modal.hide();
            toast("Updated", "Marked as in progress", "good", 2000);
          } catch (e) { toast("Error", e.message || "Failed", "bad"); }
        }});
      }
      if (sug.status !== "resolved") {
        actions.push({ label: "Mark Resolved", onClick: async function () {
          try {
            await api("/board/suggestions/" + sugId, { method: "PUT", body: JSON.stringify({ status: "resolved" }) });
            sug.status = "resolved";
            renderUI();
            E.modal.hide();
            toast("Updated", "Marked as resolved", "good", 2000);
          } catch (e) { toast("Error", e.message || "Failed", "bad"); }
        }});
      }
    }
    actions.push({ label: "Close", onClick: function () { E.modal.hide(); } });

    E.modal.show("Suggestion #" + sug.id, bodyHtml, actions);
  }

  function openNewSuggestionModal() {
    var bodyHtml =
      '<div style="min-width:320px;max-width:500px;">' +
        '<label style="display:block;font-size:12px;margin-bottom:4px;color:rgba(255,255,255,.6);">Suggestion</label>' +
        '<textarea id="board-sug-modal-title" rows="3" style="width:100%;padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.04);color:#e9eef7;font-size:13px;font-family:inherit;resize:vertical;" placeholder="Describe your suggestion..."></textarea>' +
        '<label style="display:block;font-size:12px;margin:10px 0 4px;color:rgba(255,255,255,.6);">Priority</label>' +
        '<select id="board-sug-modal-pri" style="width:100%;padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(15,22,34,.95);color:#e9eef7;font-size:13px;">' +
          '<option value="low">Low</option>' +
          '<option value="medium" selected>Medium</option>' +
          '<option value="high">High</option>' +
        '</select>' +
      '</div>';

    E.modal.show("New Suggestion", bodyHtml, [
      { label: "Save", primary: true, onClick: async function () {
        var titleEl = document.getElementById("board-sug-modal-title");
        var priEl = document.getElementById("board-sug-modal-pri");
        var title = titleEl ? titleEl.value.trim() : "";
        var priority = priEl ? priEl.value : "medium";
        if (!title) { toast("Required", "Please enter a suggestion", "warn"); return; }
        try {
          var res = await api("/board/suggestions", { method: "POST", body: JSON.stringify({ title: title, priority: priority }) });
          if (res.ok) {
            E.modal.hide();
            await loadSuggestions();
            renderUI();
            toast("Saved", "Suggestion added", "good", 2000);
          } else {
            toast("Error", res.error || "Failed", "bad");
          }
        } catch (e) {
          toast("Error", e.message || "Failed", "bad");
        }
      }},
      { label: "Cancel", onClick: function () { E.modal.hide(); } }
    ]);
  }

  async function exportSuggestions() {
    try {
      var token = E.getToken();
      var res = await fetch((E.apiBase || "") + "/board/suggestions/export", {
        method: "GET",
        headers: { "Authorization": "Bearer " + token }
      });
      if (!res.ok) {
        var j = null;
        try { j = await res.json(); } catch (e) {}
        toast("Error", (j && j.error) || "Export failed", "bad");
        return;
      }
      var text = await res.text();
      // Sandbox may block blob downloads, so show in modal with copy option
      E.modal.show("Export Suggestions — CSV", '<textarea readonly style="width:100%;min-height:260px;padding:10px;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.04);color:#e9eef7;font-size:12px;font-family:monospace;resize:vertical;white-space:pre;" id="board-csv-text">' + esc(text) + '</textarea>', [
        { label: "Copy to clipboard", primary: true, onClick: function () {
          var ta = document.getElementById("board-csv-text");
          if (ta) { ta.select(); try { document.execCommand("copy"); toast("Copied", "CSV copied to clipboard", "good", 2000); } catch (e) { toast("Error", "Copy failed", "bad"); } }
        }},
        { label: "Close", onClick: function () { E.modal.hide(); } }
      ]);
    } catch (e) {
      toast("Error", e.message || "Export failed", "bad");
    }
  }

  // ----------------------------
  // @mention autocomplete
  // ----------------------------
  function getMentionContext(input) {
    var val = input.value;
    var pos = input.selectionStart;
    // Find the @ before cursor
    var before = val.substring(0, pos);
    var atIdx = before.lastIndexOf("@");
    if (atIdx < 0) return null;
    // Make sure @ is at start or preceded by whitespace/newline
    if (atIdx > 0 && !/\s/.test(before[atIdx - 1])) return null;
    var query = before.substring(atIdx + 1);
    // No spaces in query beyond 2 words
    if (query.length > 40) return null;
    return { atIdx: atIdx, query: query };
  }

  async function searchMentionUsers(query) {
    try {
      var res = await api("/board/users/search?q=" + encodeURIComponent(query) + "&scope=" + state.scope);
      if (res.ok) return res.users || [];
    } catch (e) {}
    return [];
  }

  function showMentionDropdown(users) {
    var drop = state.mount && state.mount.querySelector("#board-mention-drop");
    if (!drop) return;
    if (!users || users.length === 0) {
      drop.innerHTML = '<div class="board-mention-empty">No users found</div>';
      drop.classList.add("visible");
      return;
    }
    var html = "";
    var seen = {};
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var locName = u.location_name || "";
      if (!locName || seen[locName.toLowerCase()]) continue;
      seen[locName.toLowerCase()] = true;
      html += '<div class="board-mention-item" data-action="select-mention" data-user-name="' + esc(locName) + '" data-idx="' + i + '">' +
        '<span class="board-mention-item-name">' + esc(locName) + '</span>' +
      '</div>';
    }
    drop.innerHTML = html;
    drop.classList.add("visible");
    state.mentionUsers = users;
  }

  function hideMentionDropdown() {
    var drop = state.mount && state.mount.querySelector("#board-mention-drop");
    if (drop) {
      drop.classList.remove("visible");
      drop.innerHTML = "";
    }
    state.mentionUsers = [];
  }

  function selectMention(userName) {
    var input = state.mount && state.mount.querySelector("#board-input");
    if (!input) return;
    var ctx = getMentionContext(input);
    if (!ctx) return;
    var before = input.value.substring(0, ctx.atIdx);
    var after = input.value.substring(input.selectionStart);
    input.value = before + "@" + userName + " " + after;
    input.focus();
    var newPos = before.length + 1 + userName.length + 1;
    input.setSelectionRange(newPos, newPos);
    hideMentionDropdown();
  }

  function handleInputForMention(input) {
    var ctx = getMentionContext(input);
    if (!ctx) {
      hideMentionDropdown();
      return;
    }

    clearTimeout(state.mentionDebounceTimer);
    state.mentionDebounceTimer = setTimeout(async function () {
      var users = await searchMentionUsers(ctx.query);
      // Re-check context in case user typed more
      var ctx2 = getMentionContext(input);
      if (!ctx2) { hideMentionDropdown(); return; }
      showMentionDropdown(users);
    }, 300);
  }

  // ----------------------------
  // Event handler
  // ----------------------------
  function handleClick(e) {
    var t = e.target;
    if (!t) return;

    var actionEl = t.closest ? t.closest("[data-action]") : t;
    if (!actionEl) return;
    var act = actionEl.getAttribute("data-action");
    if (!act) return;

    if (act === "scope-org") {
      state.scope = "org";
      state.messages = [];
      state.hasOlder = true;
      initialLoad();
      return;
    }
    if (act === "scope-all") {
      state.scope = "all";
      state.messages = [];
      state.hasOlder = true;
      initialLoad();
      return;
    }
    if (act === "toggle-pinned") {
      state.pinnedCollapsed = !state.pinnedCollapsed;
      renderUI();
      return;
    }
    if (act === "load-older") {
      if (state.messages.length > 0) {
        var oldest = state.messages[0].id;
        loadMessages({ before: oldest }).then(function () { renderUI(); });
      }
      return;
    }
    if (act === "send") {
      sendMessage();
      return;
    }
    if (act === "pin") {
      var msgId = parseInt(actionEl.getAttribute("data-id"));
      if (msgId) pinMessage(msgId);
      return;
    }
    if (act === "delete-msg") {
      var delId = parseInt(actionEl.getAttribute("data-id"));
      if (delId) deleteMessage(delId);
      return;
    }
    if (act === "cycle-priority") {
      var sugId = parseInt(actionEl.getAttribute("data-id"));
      if (sugId) cyclePriority(sugId);
      return;
    }
    if (act === "cycle-status") {
      var statusId = parseInt(actionEl.getAttribute("data-id"));
      if (statusId) cycleStatus(statusId);
      return;
    }
    if (act === "new-suggestion") {
      openNewSuggestionModal();
      return;
    }
    if (act === "export-suggestions") {
      exportSuggestions();
      return;
    }
    if (act === "delete-suggestion") {
      var dSugId = parseInt(actionEl.getAttribute("data-id"));
      if (dSugId) deleteSuggestion(dSugId);
      return;
    }
    if (act === "edit-suggestion") {
      var eSugId = parseInt(actionEl.getAttribute("data-id"));
      if (eSugId) editSuggestion(eSugId);
      return;
    }
    if (act === "view-suggestion") {
      var vSugId = parseInt(actionEl.getAttribute("data-id"));
      if (vSugId) viewSuggestion(vSugId);
      return;
    }
    if (act === "select-mention") {
      var uname = actionEl.getAttribute("data-user-name");
      if (uname) selectMention(uname);
      return;
    }
  }

  // ----------------------------
  // Main render
  // ----------------------------
  async function render(ctx) {
    injectCss();

    var mount = ctx && ctx.mount ? ctx.mount : null;
    if (!mount) return;

    // Clean up previous instance
    if (state.mount && state.mount !== mount) {
      stopPolling();
    }
    state.mount = mount;
    state.messages = [];
    state.pinnedMessages = [];
    state.suggestions = [];
    state.hasOlder = true;

    renderUI();

    // Bind events once
    if (!mount.__boardBound) {
      mount.addEventListener("click", handleClick);

      // Compose textarea events
      mount.addEventListener("input", function (e) {
        var input = e.target;
        if (!input || input.id !== "board-input") return;

        // Auto-grow textarea
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 100) + "px";

        // Toggle send button
        var sendBtn = mount.querySelector("#board-send-btn");
        if (sendBtn) sendBtn.disabled = !input.value.trim();

        // @mention
        handleInputForMention(input);
      });

      mount.addEventListener("keydown", function (e) {
        var input = e.target;
        if (!input || input.id !== "board-input") return;

        // Enter to send (without shift)
        if (e.key === "Enter" && !e.shiftKey) {
          // If mention dropdown is visible, select first
          var drop = mount.querySelector("#board-mention-drop.visible");
          if (drop) {
            var first = drop.querySelector(".board-mention-item");
            if (first) {
              e.preventDefault();
              var uname = first.getAttribute("data-user-name");
              if (uname) selectMention(uname);
              return;
            }
          }
          e.preventDefault();
          sendMessage();
        }

        // Escape to close mention dropdown
        if (e.key === "Escape") {
          hideMentionDropdown();
        }
      });

      // Close mention dropdown on click outside
      document.addEventListener("click", function (e) {
        var drop = mount.querySelector("#board-mention-drop.visible");
        if (!drop) return;
        if (!drop.contains(e.target) && e.target.id !== "board-input") {
          hideMentionDropdown();
        }
      });

      mount.__boardBound = true;
    }

    await initialLoad();
    startPolling();
  }

  // Register module
  E.registerModule({
    id: "messageboard",
    title: "Chat Board",
    order: 105,
    icon: "\uD83D\uDCAC",
    render: render
  });

})();
