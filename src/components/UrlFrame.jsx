import { useEffect, useRef } from "react";
import { isPublicHttpUrl } from "../lib/httpUrl.js";

export function browseSrc(url) {
  if (!isPublicHttpUrl(url)) {
    return "";
  }
  return `/api/browse?url=${encodeURIComponent(url)}`;
}

export default function UrlFrame({ url, interactive = false, fillViewport = false, onNavigate }) {
  const frameRef = useRef(null);
  const lastSent = useRef("");

  useEffect(() => {
    function onMessage(event) {
      if (!interactive || typeof onNavigate !== "function") {
        return;
      }
      if (event.origin !== window.location.origin) {
        return;
      }
      const data = event.data || {};
      if (data.type !== "projetaba-nav" || !data.url) {
        return;
      }
      if (data.url === lastSent.current) {
        return;
      }
      lastSent.current = data.url;
      onNavigate(data.url);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [interactive, onNavigate]);

  useEffect(() => {
    lastSent.current = url || "";
  }, [url]);

  if (!isPublicHttpUrl(url)) {
    return <p className="wait">Indique uma URL http ou https para projetar.</p>;
  }

  return (
    <div className={`url-frame ${fillViewport ? "fill" : ""} ${interactive ? "interactive" : "locked"}`}>
      <iframe
        ref={frameRef}
        title="Site projetado"
        src={browseSrc(url)}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        referrerPolicy="no-referrer"
        allow="fullscreen"
      />
    </div>
  );
}
