import { api } from "./api.js";
import { CHUNK_BYTES, MAX_FILE_BYTES, MAX_FILE_MB } from "./limits.js";

export function rejectOversized(files, maxBytes = MAX_FILE_BYTES) {
  const oversized = Array.from(files || []).filter((file) => file.size > maxBytes);
  if (!oversized.length) {
    return null;
  }
  const names = oversized.map((file) => file.name).join(", ");
  return `Arquivo grande demais (${names}). O limite é ${MAX_FILE_MB} MB por ficheiro.`;
}

function parseError(status, data, text) {
  const blob = `${data?.error || ""} ${text || ""}`;
  if (status === 413 || /file too large/i.test(blob)) {
    return new Error(`Arquivo grande demais. O limite é ${MAX_FILE_MB} MB por ficheiro.`);
  }
  return new Error(data?.error || "Falha no envio do arquivo.");
}

export function uploadForm(url, formData, { headers = {}, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    Object.entries(headers).forEach(([key, value]) => {
      if (value) {
        xhr.setRequestHeader(key, value);
      }
    });
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) {
        return;
      }
      onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      const text = xhr.responseText || "";
      let data = {};
      try {
        data = JSON.parse(text || "{}");
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
        return;
      }
      reject(parseError(xhr.status, data, text));
    };
    xhr.onerror = () => reject(new Error("Falha de rede ao enviar o arquivo."));
    xhr.ontimeout = () => reject(new Error("O envio demorou demais. Tente de novo."));
    xhr.timeout = 15 * 60 * 1000;
    xhr.send(formData);
  });
}

async function uploadChunked(file, { headers, onProgress }) {
  const init = await api("/api/presentations/uploads", {
    method: "POST",
    headers,
    body: JSON.stringify({
      originalName: file.name,
      size: file.size,
      mime: file.type,
    }),
  });
  const chunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
  for (let index = 0; index < chunks; index += 1) {
    const blob = file.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    const body = new FormData();
    body.append("chunk", blob, `${file.name}.part${index}`);
    await uploadForm(`/api/presentations/uploads/${encodeURIComponent(init.uploadId)}/chunk?index=${index}`, body, {
      headers,
      onProgress: (percent) => onProgress(Math.round(((index + percent / 100) / chunks) * 100)),
    });
  }
  return api(`/api/presentations/uploads/${encodeURIComponent(init.uploadId)}/complete`, {
    method: "POST",
    headers,
  });
}

export async function uploadPresentations(files, { headers = {}, onProgress } = {}) {
  const list = Array.from(files || []);
  const oversized = rejectOversized(list);
  if (oversized) {
    throw new Error(oversized);
  }
  const created = [];
  let loaded = 0;
  const total = list.reduce((sum, file) => sum + file.size, 0) || 1;
  for (const file of list) {
    const report = (percent) => {
      const done = loaded + (file.size * percent) / 100;
      onProgress?.(Math.min(100, Math.round((done / total) * 100)));
    };
    let result;
    if (file.size > CHUNK_BYTES) {
      result = await uploadChunked(file, { headers, onProgress: report });
    } else {
      const body = new FormData();
      body.append("file", file);
      result = await uploadForm("/api/presentations", body, { headers, onProgress: report });
    }
    created.push(...(result.presentations || []));
    loaded += file.size;
  }
  onProgress?.(100);
  return { presentations: created };
}
