import { useEffect, useMemo, useRef, useState } from "react";
import { getPptxDeck } from "../lib/pptxDeck.js";
import UrlFrame from "./UrlFrame.jsx";
import VideoLayer from "./VideoLayer.jsx";

function PptxSlide({ token, fileId, index, fillViewport, clips, isPresenter, emitMedia, follow, audible }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [error, setError] = useState("");
  const clipKey = (clips || []).map((clip) => clip.src || clip.file || "").join("|");

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    let drawTimer = 0;

    async function draw() {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) {
        return;
      }
      const width = Math.max(
        wrap.clientWidth || (fillViewport ? window.innerWidth : 0),
        fillViewport ? 640 : 320
      );
      const height = Math.max(
        wrap.clientHeight || (fillViewport ? window.innerHeight : 0),
        fillViewport ? 360 : Math.round((width * 9) / 16)
      );
      try {
        const url = `/api/sessions/${encodeURIComponent(token)}/files/${fileId}`;
        const deck = await getPptxDeck(url);
        if (cancelled) {
          return;
        }
        await deck.prepare(index);
        await deck.render(index, canvas, { width, height, fit: "contain" });
        if (deck.pendingAssetCount() > 0) {
          unsubscribe();
          unsubscribe = deck.onAssetsReady(() => {
            deck.render(index, canvas, { width, height, fit: "contain" });
          });
        }
        setError("");
      } catch (err) {
        console.error("PPTX render", err);
        if (!cancelled && !clipKey) {
          setError("Não foi possível desenhar este PPTX como no PowerPoint.");
        }
      }
    }

    function scheduleDraw() {
      window.clearTimeout(drawTimer);
      drawTimer = window.setTimeout(draw, 160);
    }

    const wrap = wrapRef.current;
    const observer = wrap ? new ResizeObserver(scheduleDraw) : null;
    observer?.observe(wrap);
    window.addEventListener("resize", scheduleDraw);
    draw();
    return () => {
      cancelled = true;
      window.clearTimeout(drawTimer);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleDraw);
      unsubscribe();
    };
  }, [token, fileId, index, fillViewport, clipKey]);

  if (error) {
    return <p className="wait">{error}</p>;
  }

  return (
    <div className="pptx-frame" ref={wrapRef}>
      <canvas ref={canvasRef} className="pptx-canvas" />
      <VideoLayer
        token={token}
        fileId={fileId}
        clips={clips}
        isPresenter={isPresenter}
        emitMedia={emitMedia}
        follow={follow}
        audible={audible}
      />
    </div>
  );
}

export default function SlideStage({
  session,
  className = "stage",
  slideIndex,
  fileId,
  label,
  fillViewport = false,
  interactive = false,
  onNavigate,
  isPresenter = false,
  emitMedia,
  follow,
  audible = false,
  showMedia = true,
}) {
  const canvasRef = useRef(null);
  const file =
    session?.files?.find((item) => item.fileId === (fileId || session.activeFileId)) ||
    session?.files?.find((item) => item.kind !== "url") ||
    session?.files?.[0];
  const index = slideIndex ?? session?.currentIndex ?? 0;
  const pastEnd = Boolean(file && file.kind !== "url" && index >= (file.pageCount || 0));
  const currentUrl =
    file?.kind === "url" ? file.history?.[index] || session?.currentUrl || file.sourceUrl : null;
  const imageSrc =
    file && !pastEnd && file.kind !== "url" && file.kind !== "pdf" && file.kind !== "pptx" && file.kind !== "video"
      ? `/api/sessions/${encodeURIComponent(session.token)}/slides/${file.fileId}/${index}`
      : "";
  const clips = useMemo(() => {
    if (!showMedia) {
      return [];
    }
    if (file?.kind === "video") {
      return [
        {
          index,
          file: "video",
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          src: `/api/sessions/${encodeURIComponent(session.token)}/files/${file.fileId}`,
        },
      ];
    }
    return (file?.videos || []).filter((clip) => clip.index === index);
  }, [file, index, session?.token, showMedia]);

  useEffect(() => {
    let cancelled = false;
    let renderTask;
    let doc;
    async function renderPdf() {
      if (!file || file.kind !== "pdf" || pastEnd) {
        return;
      }
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const url = `/api/sessions/${encodeURIComponent(session.token)}/files/${file.fileId}`;
      doc = await pdfjs.getDocument(url).promise;
      if (cancelled) {
        await doc.destroy();
        return;
      }
      const page = await doc.getPage(index + 1);
      const canvas = canvasRef.current;
      if (!canvas || cancelled) {
        return;
      }
      const parent = canvas.parentElement;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(
        1,
        Math.min(
          (parent?.clientWidth || window.innerWidth) / base.width,
          (parent?.clientHeight || window.innerHeight) / base.height
        ) * (window.devicePixelRatio || 1)
      );
      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTask = page.render({ canvasContext: canvas.getContext("2d"), viewport });
      await renderTask.promise;
    }

    if (file?.kind === "pdf") {
      renderPdf();
    }
    return () => {
      cancelled = true;
      renderTask?.cancel();
      doc?.destroy();
    };
  }, [file, index, session?.token, pastEnd]);

  if (!file) {
    return (
      <div className={className}>
        {label ? <span className="stage-label">{label}</span> : null}
        <p className="wait">Aguardando o apresentador…</p>
      </div>
    );
  }

  if (pastEnd) {
    return (
      <div className={className}>
        {label ? <span className="stage-label">{label}</span> : null}
        <p className="wait">Fim do deck</p>
      </div>
    );
  }

  const stageLabel = `${label || "Slide"} ${index + 1} de ${file.pageCount}`;
  const interactiveStage = file.kind === "url" || file.kind === "video" || (file.kind === "pptx" && clips.length);

  return (
    <div className={className} aria-label={interactiveStage ? undefined : stageLabel} role={interactiveStage ? undefined : "img"}>
      {label ? <span className="stage-label">{label}</span> : null}
      {file.kind === "url" ? (
        <UrlFrame url={currentUrl} interactive={interactive} fillViewport={fillViewport} onNavigate={onNavigate} />
      ) : file.kind === "pdf" ? (
        <canvas ref={canvasRef} aria-label={stageLabel} />
      ) : file.kind === "video" ? (
        showMedia ? (
          <VideoLayer
            token={session.token}
            fileId={file.fileId}
            clips={clips}
            isPresenter={isPresenter}
            emitMedia={emitMedia}
            follow={follow}
            audible={audible}
          />
        ) : (
          <p className="wait">Próximo: vídeo</p>
        )
      ) : file.kind === "pptx" ? (
        <PptxSlide
          token={session.token}
          fileId={file.fileId}
          index={index}
          fillViewport={fillViewport}
          clips={clips}
          isPresenter={isPresenter}
          emitMedia={emitMedia}
          follow={follow}
          audible={audible}
        />
      ) : (
        <img src={imageSrc} alt={stageLabel} />
      )}
    </div>
  );
}
