(function () {
  var cfg = window.__PROJETABA__;
  if (!cfg || !cfg.token || typeof io !== "function") {
    return;
  }

  var image = document.getElementById("mirror");
  var live = document.getElementById("live");
  var wait = document.getElementById("wait");
  var ytBox = document.getElementById("yt");
  var currentUrl = "";
  var token = cfg.token;
  var pc = null;
  var ytCtl = null;
  var ice = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

  function isUrlDeck(file) {
    if (!file || file.kind !== "url") {
      return false;
    }
    var url = String(file.sourceUrl || (file.history && file.history[0]) || "");
    return /^https?:\/\//i.test(url);
  }

  function activeDeck(session) {
    var files = (session && session.files) || [];
    if (!files.length) {
      return null;
    }
    var match = files.find(function (item) {
      return item.fileId === session.activeFileId;
    });
    if (match) {
      return match;
    }
    return (
      files.find(function (item) {
        return item.kind !== "url";
      }) || files[0]
    );
  }

  function hideWait() {
    if (wait) {
      wait.setAttribute("data-hide", "1");
    }
  }

  function stopYt() {
    if (ytCtl) {
      ytCtl.destroy();
      ytCtl = null;
    }
    if (ytBox) {
      ytBox.removeAttribute("data-on");
    }
  }

  async function ensureYt(url, payload) {
    if (!window.ProjetabaYouTube || !ytBox) {
      return;
    }
    var parsed = url ? ProjetabaYouTube.parse(url) : { videoId: payload && payload.videoId };
    if (!parsed.videoId && !(payload && payload.videoId)) {
      stopYt();
      return;
    }
    if (!ytCtl) {
      ytBox.setAttribute("data-on", "1");
      ytCtl = ProjetabaYouTube.mount(ytBox, { muted: true });
    }
    if (url) {
      await ytCtl.load(url);
    } else if (payload && payload.videoId) {
      await ytCtl.load("https://www.youtube.com/watch?v=" + payload.videoId);
    }
    if (payload) {
      ytCtl.apply(payload);
    }
    ytBox.setAttribute("data-on", "1");
    hideWait();
  }

  function followSession(session) {
    if (!session) {
      return;
    }
    if (!isUrlDeck(activeDeck(session))) {
      window.location.replace("/telao/" + encodeURIComponent(token));
      return;
    }
    var url = session.currentUrl || activeDeck(session).sourceUrl || "";
    if (window.ProjetabaYouTube && ProjetabaYouTube.is(url)) {
      ensureYt(url);
    } else {
      stopYt();
    }
  }

  function closePeer() {
    if (pc) {
      try {
        pc.close();
      } catch (error) {}
      pc = null;
    }
    if (live) {
      live.srcObject = null;
      live.removeAttribute("data-on");
    }
  }

  function sayHello() {
    socket.emit("webrtc:signal", { type: "hello" });
  }

  var socket = io({
    path: "/socket.io",
    auth: { token: token, role: "viewer" },
    transports: ["polling", "websocket"],
    withCredentials: true,
  });

  function showFrame(data) {
    if ((live && live.srcObject) || (ytBox && ytBox.getAttribute("data-on") === "1")) {
      return;
    }
    var blob = data instanceof Blob ? data : new Blob([data], { type: "image/jpeg" });
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
    }
    currentUrl = URL.createObjectURL(blob);
    image.src = currentUrl;
    hideWait();
  }

  async function takeOffer(msg) {
    closePeer();
    pc = new RTCPeerConnection(ice);
    pc.ontrack = function (event) {
      if (!live) {
        return;
      }
      live.srcObject = event.streams[0] || new MediaStream([event.track]);
      live.setAttribute("data-on", "1");
      live.muted = false;
      live.play().catch(function () {});
      hideWait();
    };
    pc.onicecandidate = function (event) {
      if (event.candidate) {
        socket.emit("webrtc:signal", { to: msg.from, type: "ice", candidate: event.candidate });
      }
    };
    try {
      await pc.setRemoteDescription(msg.sdp);
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:signal", { to: msg.from, type: "answer", sdp: pc.localDescription });
    } catch (error) {
      closePeer();
    }
  }

  socket.on("session:state", followSession);
  socket.on("view:frame", showFrame);
  socket.on("view:yt", function (payload) {
    ensureYt(payload && payload.videoId ? "https://www.youtube.com/watch?v=" + payload.videoId : "", payload);
  });
  socket.on("view:mirror", function (payload) {
    if (payload && payload.active === false) {
      closePeer();
      if (!ytCtl && wait) {
        wait.setAttribute("data-hide", "0");
      }
      return;
    }
    if (payload && payload.active) {
      sayHello();
    }
  });
  socket.on("webrtc:signal", function (msg) {
    if (!msg) {
      return;
    }
    if (msg.type === "ready") {
      sayHello();
      return;
    }
    if (msg.type === "offer" && msg.sdp) {
      takeOffer(msg);
      return;
    }
    if (msg.type === "ice" && msg.candidate && pc) {
      pc.addIceCandidate(msg.candidate).catch(function () {});
    }
  });
  socket.on("session:ended", function () {
    window.location.replace("/");
  });

  sayHello();

  function goFull() {
    var node = document.documentElement;
    var req = node.requestFullscreen || node.webkitRequestFullscreen;
    if (req) {
      req.call(node).catch(function () {});
    }
    if (live) {
      live.muted = false;
      live.play().catch(function () {});
    }
    if (ytCtl && ytCtl.sound) {
      ytCtl.sound(true);
    }
  }
  document.addEventListener("click", goFull);
  document.addEventListener("keydown", goFull);
})();
