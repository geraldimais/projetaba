(function (root) {
  var apiWaiters = [];

  function startFromSearch(url) {
    var raw = url.searchParams.get("t") || url.searchParams.get("start") || "0";
    if (/^\d+$/.test(raw)) {
      return Number(raw);
    }
    var hours = /([0-9]+)h/i.exec(raw);
    var mins = /([0-9]+)m/i.exec(raw);
    var secs = /([0-9]+)s/i.exec(raw);
    return (
      (hours ? Number(hours[1]) * 3600 : 0) +
      (mins ? Number(mins[1]) * 60 : 0) +
      (secs ? Number(secs[1]) : 0)
    );
  }

  function parse(raw) {
    try {
      var url = new URL(raw);
      var host = url.hostname.replace(/^www\./i, "").toLowerCase();
      var id = "";
      if (host === "youtu.be") {
        id = (url.pathname.split("/")[1] || "").slice(0, 11);
      } else if (
        host === "youtube.com" ||
        host === "m.youtube.com" ||
        host === "music.youtube.com" ||
        host === "youtube-nocookie.com"
      ) {
        id = url.searchParams.get("v") || "";
        if (!id) {
          var parts = url.pathname.split("/").filter(Boolean);
          if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live" || parts[0] === "v") {
            id = parts[1] || "";
          }
        }
      }
      id = String(id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11);
      if (id.length < 11) {
        return { videoId: "", start: 0 };
      }
      return { videoId: id, start: startFromSearch(url) };
    } catch (error) {
      return { videoId: "", start: 0 };
    }
  }

  function embedSrc(id, start, muted) {
    return (
      "https://www.youtube-nocookie.com/embed/" +
      encodeURIComponent(id) +
      "?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&controls=1&fs=1&mute=" +
      (muted ? "1" : "0") +
      "&start=" +
      (start || 0)
    );
  }

  function loadApi() {
    return new Promise(function (resolve) {
      if (root.YT && root.YT.Player) {
        resolve();
        return;
      }
      apiWaiters.push(resolve);
      if (document.getElementById("projetaba-yt-api")) {
        return;
      }
      var previous = root.onYouTubeIframeAPIReady;
      root.onYouTubeIframeAPIReady = function () {
        if (typeof previous === "function") {
          previous();
        }
        apiWaiters.splice(0).forEach(function (fn) {
          fn();
        });
      };
      var script = document.createElement("script");
      script.id = "projetaba-yt-api";
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
      window.setTimeout(function () {
        if (!(root.YT && root.YT.Player) && apiWaiters.length) {
          apiWaiters.splice(0).forEach(function (fn) {
            fn();
          });
        }
      }, 4000);
    });
  }

  function mount(container, options) {
    options = options || {};
    var player = null;
    var frame = null;
    var lastId = "";
    var applying = false;
    var muted = Boolean(options.muted);

    function snapshot() {
      if (player && typeof player.getCurrentTime === "function") {
        var state = player.getPlayerState();
        return {
          videoId: lastId,
          time: player.getCurrentTime() || 0,
          playing: state === 1,
          rate: player.getPlaybackRate ? player.getPlaybackRate() : 1,
        };
      }
      return lastId ? { videoId: lastId, time: 0, playing: true, rate: 1 } : null;
    }

    function size() {
      var rect = container.getBoundingClientRect();
      return {
        w: Math.max(320, Math.round(rect.width) || window.innerWidth),
        h: Math.max(180, Math.round(rect.height) || Math.round(window.innerHeight * 0.7)),
      };
    }

    function paintIframe(id, start) {
      container.setAttribute("data-on", "1");
      container.innerHTML = "";
      frame = document.createElement("iframe");
      frame.setAttribute("allowfullscreen", "true");
      frame.setAttribute(
        "allow",
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      );
      frame.setAttribute("title", "YouTube");
      frame.src = embedSrc(id, start, muted);
      container.appendChild(frame);
      var box = size();
      frame.width = String(box.w);
      frame.height = String(box.h);
    }

    function bindPlayer() {
      if (!frame || !root.YT || !root.YT.Player || player) {
        return;
      }
      try {
        player = new root.YT.Player(frame, {
          host: "https://www.youtube-nocookie.com",
          events: {
            onReady: function () {
              var box = size();
              if (player.setSize) {
                player.setSize(box.w, box.h);
              }
              if (muted) {
                player.mute();
              } else {
                player.unMute();
                player.setVolume(100);
              }
              if (typeof options.onReady === "function") {
                options.onReady(snapshot());
              }
            },
            onStateChange: function () {
              if (applying || typeof options.onState !== "function") {
                return;
              }
              options.onState(snapshot());
            },
            onError: function () {
              paintIframe(lastId, 0);
            },
          },
        });
      } catch (error) {}
    }

    async function load(url) {
      var parsed = parse(url);
      if (!parsed.videoId || !container) {
        return null;
      }
      lastId = parsed.videoId;
      paintIframe(parsed.videoId, parsed.start);
      loadApi().then(bindPlayer);
      return player;
    }

    function apply(payload) {
      if (!payload || !payload.videoId) {
        return;
      }
      if (payload.videoId !== lastId) {
        load("https://www.youtube.com/watch?v=" + payload.videoId);
        return;
      }
      if (!player) {
        return;
      }
      applying = true;
      var now = player.getCurrentTime ? player.getCurrentTime() : 0;
      if (Math.abs(now - (payload.time || 0)) > 0.8) {
        player.seekTo(payload.time || 0, true);
      }
      if (payload.playing) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
      window.setTimeout(function () {
        applying = false;
      }, 250);
    }

    function sound(on) {
      muted = !on;
      if (player) {
        if (on) {
          player.unMute();
          player.setVolume(100);
        } else {
          player.mute();
        }
      }
    }

    function destroy() {
      if (player && player.destroy) {
        try {
          player.destroy();
        } catch (error) {}
      }
      player = null;
      frame = null;
      lastId = "";
      if (container) {
        container.innerHTML = "";
        container.removeAttribute("data-on");
      }
    }

    if (typeof ResizeObserver === "function") {
      new ResizeObserver(function () {
        if (player && player.setSize) {
          var box = size();
          player.setSize(box.w, box.h);
        }
      }).observe(container);
    }
    window.addEventListener("resize", function () {
      if (player && player.setSize) {
        var box = size();
        player.setSize(box.w, box.h);
      }
    });

    return { load: load, apply: apply, snapshot: snapshot, destroy: destroy, sound: sound };
  }

  root.ProjetabaYouTube = {
    parse: parse,
    is: function (url) {
      return Boolean(parse(url).videoId);
    },
    loadApi: loadApi,
    mount: mount,
  };
})(window);
