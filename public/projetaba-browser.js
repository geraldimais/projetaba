(function () {
  var cfg = window.__PROJETABA__;
  if (!cfg || !cfg.token || typeof io !== "function") {
    return;
  }

  var token = cfg.token;
  var pageUrl = cfg.url || "";

  function pagePath(url) {
    return "/navegar/" + encodeURIComponent(token) + "/page?u=" + encodeURIComponent(url);
  }

  function sameUrl(left, right) {
    try {
      return new URL(left).href === new URL(right).href;
    } catch (error) {
      return left === right;
    }
  }

  function absUrl(href) {
    try {
      return new URL(href, document.baseURI).href;
    } catch (error) {
      return href;
    }
  }

  function notifyParent(url) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ projetaba: "url", url: url || pageUrl }, window.location.origin);
    }
  }

  var socket = io({
    path: "/socket.io",
    auth: { token: token, role: "presenter" },
    transports: ["polling", "websocket"],
    withCredentials: true,
  });

  if (pageUrl) {
    socket.emit("presenter:browse", { url: pageUrl });
    notifyParent(pageUrl);
  }

  socket.on("session:state", function (session) {
    var files = session.files || [];
    var file =
      files.find(function (item) {
        return item.fileId === session.activeFileId;
      }) ||
      files.find(function (item) {
        return item.kind !== "url";
      }) ||
      files[0];
    if (!file || file.kind !== "url") {
      window.top.location.replace("/palestrante/" + encodeURIComponent(token));
      return;
    }
    var nextUrl = session.currentUrl || file.sourceUrl;
    if (nextUrl && !sameUrl(nextUrl, pageUrl)) {
      window.location.replace(pagePath(nextUrl));
    }
  });

  socket.on("slide:changed", function (payload) {
    if (payload && payload.currentUrl && !sameUrl(payload.currentUrl, pageUrl)) {
      window.location.replace(pagePath(payload.currentUrl));
    }
  });

  socket.on("session:ended", function () {
    window.top.location.replace("/");
  });

  document.addEventListener(
    "click",
    function (event) {
      var link = event.target && event.target.closest && event.target.closest("a[href]");
      if (!link) {
        return;
      }
      var href = link.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#" || /^(javascript|mailto|tel):/i.test(href)) {
        return;
      }
      event.preventDefault();
      var next = absUrl(link.href || href);
      socket.emit("presenter:browse", { url: next });
      notifyParent(next);
      window.location.assign(pagePath(next));
    },
    true
  );

  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!form || String(form.method || "get").toLowerCase() !== "get") {
        return;
      }
      event.preventDefault();
      try {
        var next = new URL(form.action || pageUrl, document.baseURI);
        new FormData(form).forEach(function (value, key) {
          next.searchParams.set(key, value);
        });
        socket.emit("presenter:browse", { url: next.href });
        notifyParent(next.href);
        window.location.assign(pagePath(next.href));
      } catch (error) {}
    },
    true
  );
})();
