(function () {
  var cfg = window.__PROJETABA__;
  if (!cfg || !cfg.token || typeof io !== "function") {
    return;
  }

  var token = cfg.token;
  var field = document.getElementById("projetaba-url");
  var openBtn = document.getElementById("projetaba-open");
  var mirrorBtn = document.getElementById("projetaba-mirror");
  var preview = document.getElementById("projetaba-preview");
  var hint = document.getElementById("projetaba-hint");
  var canvas = document.createElement("canvas");
  var ctx = canvas.getContext("2d", { alpha: false });
  var stream = null;
  var siteWin = null;
  var ytBox = document.getElementById("projetaba-yt");
  var ytCtl = null;
  var ytTimer = 0;
  var sending = false;
  var peers = new Map();
  var ice = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

  var socket = io({
    path: "/socket.io",
    auth: { token: token, role: "presenter" },
    transports: ["polling", "websocket"],
    withCredentials: true,
  });

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

  function currentUrl() {
    return String((field && field.value) || cfg.url || "").trim();
  }

  function openSite() {
    var url = currentUrl();
    if (!url) {
      return;
    }
    try {
      url = new URL(url).href;
    } catch (error) {
      window.alert("URL inválida.");
      return;
    }
    socket.emit("presenter:browse", { url: url });
    if (window.ProjetabaYouTube && ProjetabaYouTube.is(url)) {
      startYouTube(url);
      return;
    }
    stopYouTube();
    if (siteWin && !siteWin.closed) {
      try {
        siteWin.location.href = url;
        siteWin.focus();
        return;
      } catch (error) {
        siteWin = null;
      }
    }
    siteWin = window.open(url, "projetaba-site");
    if (!siteWin) {
      window.alert("O navegador bloqueou a janela. Permita pop-ups para o PROJET-ABA e clique de novo em Abrir site.");
    }
  }

  function setMirrorUi(on) {
    if (mirrorBtn) {
      mirrorBtn.setAttribute("data-on", on ? "1" : "0");
      mirrorBtn.textContent = on ? "Espelhando" : "Espelhar na projeção";
    }
    if (preview) {
      preview.setAttribute("data-on", on && stream ? "1" : "0");
    }
    if (ytBox) {
      ytBox.setAttribute("data-on", on && ytCtl ? "1" : "0");
    }
    if (hint) {
      hint.style.display = on ? "none" : "block";
    }
  }

  function closePeers() {
    peers.forEach(function (pc) {
      try {
        pc.close();
      } catch (error) {}
    });
    peers.clear();
  }

  function stopYouTube() {
    window.clearInterval(ytTimer);
    ytTimer = 0;
    if (ytCtl) {
      ytCtl.destroy();
      ytCtl = null;
    }
    if (ytBox) {
      ytBox.removeAttribute("data-on");
    }
  }

  function emitYt(payload) {
    if (!payload || !payload.videoId) {
      return;
    }
    socket.emit("presenter:yt", payload);
  }

  async function startYouTube(url) {
    if (!window.ProjetabaYouTube || !ytBox) {
      return;
    }
    ytBox.setAttribute("data-on", "1");
    stopCapture();
    if (!ytCtl) {
      ytCtl = ProjetabaYouTube.mount(ytBox, {
        muted: true,
        onReady: emitYt,
        onState: emitYt,
      });
    }
    await ytCtl.load(url);
    socket.emit("presenter:mirror", { active: true });
    setMirrorUi(true);
    window.clearInterval(ytTimer);
    ytTimer = window.setInterval(function () {
      emitYt(ytCtl && ytCtl.snapshot());
    }, 400);
  }

  function stopCapture() {
    window.clearInterval(timer);
    timer = 0;
    closePeers();
    if (stream) {
      stream.getTracks().forEach(function (track) {
        track.stop();
      });
      stream = null;
    }
    if (preview) {
      preview.srcObject = null;
    }
  }

  function stopMirror() {
    stopCapture();
    stopYouTube();
    socket.emit("presenter:mirror", { active: false });
    setMirrorUi(false);
  }

  async function createPeer(viewerId) {
    if (!stream || !viewerId) {
      return;
    }
    var previous = peers.get(viewerId);
    if (previous) {
      try {
        previous.close();
      } catch (error) {}
    }
    var pc = new RTCPeerConnection(ice);
    peers.set(viewerId, pc);
    stream.getTracks().forEach(function (track) {
      pc.addTrack(track, stream);
    });
    pc.onicecandidate = function (event) {
      if (event.candidate) {
        socket.emit("webrtc:signal", { to: viewerId, type: "ice", candidate: event.candidate });
      }
    };
    try {
      var offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:signal", { to: viewerId, type: "offer", sdp: pc.localDescription });
    } catch (error) {
      try {
        pc.close();
      } catch (err) {}
      peers.delete(viewerId);
    }
  }

  function sendFrame() {
    if (!stream || sending || !preview || !preview.videoWidth || ytCtl) {
      return;
    }
    var width = Math.min(960, preview.videoWidth);
    var height = Math.max(1, Math.round(width * (preview.videoHeight / preview.videoWidth)));
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    ctx.drawImage(preview, 0, 0, width, height);
    sending = true;
    canvas.toBlob(
      function (blob) {
        if (!blob) {
          sending = false;
          return;
        }
        blob.arrayBuffer().then(function (buffer) {
          socket.volatile.emit("presenter:frame", buffer);
          sending = false;
        }).catch(function () {
          sending = false;
        });
      },
      "image/jpeg",
      0.45
    );
  }

  async function startMirror() {
    if (window.ProjetabaYouTube && ProjetabaYouTube.is(currentUrl())) {
      startYouTube(currentUrl());
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      window.alert("Este navegador não consegue espelhar a tela. Use Chrome ou Edge no computador.");
      return;
    }
    openSite();
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 24, max: 30 },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          displaySurface: "browser",
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
        suppressLocalAudioPlayback: true,
      });
      preview.srcObject = stream;
      preview.muted = true;
      await preview.play();
      if (!stream.getAudioTracks().length) {
        window.alert("O som da aba não veio. Espelhe de novo e, no Chrome, marque “Compartilhar áudio da aba”.");
      }
      socket.emit("presenter:mirror", { active: true });
      socket.emit("webrtc:signal", { type: "ready" });
      setMirrorUi(true);
      window.clearInterval(timer);
      timer = window.setInterval(sendFrame, 250);
      stream.getTracks().forEach(function (track) {
        track.addEventListener("ended", stopMirror);
      });
    } catch (error) {
      stopMirror();
    }
  }

  if (window.ProjetabaYouTube && ProjetabaYouTube.is(currentUrl())) {
    startYouTube(currentUrl());
  } else {
    setMirrorUi(false);
  }

  socket.on("webrtc:signal", function (msg) {
    if (!msg) {
      return;
    }
    if (msg.type === "hello") {
      createPeer(msg.from);
      return;
    }
    var pc = peers.get(msg.from);
    if (!pc) {
      return;
    }
    if (msg.type === "answer" && msg.sdp) {
      pc.setRemoteDescription(msg.sdp).catch(function () {});
    }
    if (msg.type === "ice" && msg.candidate) {
      pc.addIceCandidate(msg.candidate).catch(function () {});
    }
  });

  socket.on("session:state", function (session) {
    if (isUrlDeck(activeDeck(session))) {
      return;
    }
    stopMirror();
    if (siteWin && !siteWin.closed) {
      try {
        siteWin.close();
      } catch (error) {}
    }
    window.location.replace("/sessao/" + encodeURIComponent(token) + "?painel=1");
  });

  if (openBtn) {
    openBtn.addEventListener("click", function (event) {
      event.preventDefault();
      openSite();
    });
  }
  if (field) {
    field.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        openSite();
      }
    });
  }
  var prev = document.getElementById("projetaba-prev");
  var next = document.getElementById("projetaba-next");
  if (prev) {
    prev.addEventListener("click", function () {
      socket.emit("presenter:prev");
    });
  }
  if (next) {
    next.addEventListener("click", function () {
      socket.emit("presenter:next");
    });
  }
  if (mirrorBtn) {
    mirrorBtn.addEventListener("click", function () {
      if (stream || ytCtl) {
        stopMirror();
        return;
      }
      startMirror();
    });
  }
})();
