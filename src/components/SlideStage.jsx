import { useEffect, useRef, useState } from "react";

export default function SlideStage({ session, className = "stage" }) {
  const canvasRef = useRef(null);
  const [src, setSrc] = useState("");
  const file = session?.files?.find((item) => item.fileId === session.activeFileId) || session?.files?.[0];

  useEffect(() => {
    let cancelled = false;
    async function renderPdf() {
      if (!file || file.kind !== "pdf") {
        return;
      }
      const pdfjs = await import("pdfjs-dist");
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const url = `/api/sessions/${encodeURIComponent(session.token)}/files/${file.fileId}`;
      const doc = await pdfjs.getDocument(url).promise;
      const page = await doc.getPage((session.currentIndex || 0) + 1);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = canvasRef.current;
      if (!canvas || cancelled) {
        return;
      }
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    }

    if (!file) {
      setSrc("");
      return undefined;
    }
    if (file.kind === "pdf") {
      setSrc("");
      renderPdf();
    } else {
      setSrc(
        `/api/sessions/${encodeURIComponent(session.token)}/slides/${file.fileId}/${session.currentIndex || 0}`
      );
    }
    return () => {
      cancelled = true;
    };
  }, [file, session?.currentIndex, session?.token]);

  if (!file) {
    return (
      <div className={className}>
        <p className="wait">Aguardando o apresentador…</p>
      </div>
    );
  }

  return (
    <div
      className={className}
      role="img"
      aria-label={`Slide ${(session.currentIndex || 0) + 1} de ${file.pageCount}`}
    >
      {file.kind === "pdf" ? <canvas ref={canvasRef} /> : <img src={src} alt="" />}
    </div>
  );
}
