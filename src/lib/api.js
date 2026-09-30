export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Falha na requisição.");
  }
  return data;
}

export function savePresenter(token, presenterKey) {
  sessionStorage.setItem(`projetaba:${token}`, presenterKey);
}

export function loadPresenter(token) {
  return sessionStorage.getItem(`projetaba:${token}`) || "";
}
