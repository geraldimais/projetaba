import { Presentation, initWasm } from "pptx-wasm";
import wasmUrl from "pptx-wasm/wasm?url";

let wasmReady;
const decks = new Map();

function ensureWasm() {
  if (!wasmReady) {
    wasmReady = initWasm(wasmUrl).catch(() => initWasm("/pptx_bg.wasm"));
  }
  return wasmReady;
}

export async function getPptxDeck(url) {
  await ensureWasm();
  if (!decks.has(url)) {
    decks.set(
      url,
      (async () => {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) {
          throw new Error("Não foi possível abrir o PPTX.");
        }
        const bytes = await response.arrayBuffer();
        return Presentation.open(bytes);
      })()
    );
  }
  return decks.get(url);
}
