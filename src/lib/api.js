export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  let response;
  try {
    response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  } catch (error) {
    if (options.signal?.aborted || error.name === "AbortError") {
      const abort = new Error("AbortError");
      abort.name = "AbortError";
      throw abort;
    }
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Falha na requisição.");
  }
  return data;
}

export function capturePresenterKey(token) {
  return sessionStorage.getItem(`projetaba:${token}`) || "";
}

export function savePresenter(token, presenterKey) {
  if (token && presenterKey) {
    sessionStorage.setItem(`projetaba:${token}`, presenterKey);
  }
}

export function loadPresenter(token) {
  return capturePresenterKey(token);
}

export function presenterShareUrl(token) {
  return `${window.location.origin}/sessao/${token}`;
}
