function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

export function expandToScreen() {
  try {
    window.moveTo(0, 0);
    window.resizeTo(window.screen.availWidth, window.screen.availHeight);
  } catch {
    // O navegador só permite redimensionar janelas abertas via script.
  }
}

export async function requestCinemaFullscreen() {
  expandToScreen();
  if (isFullscreen()) {
    return true;
  }
  const node = document.documentElement;
  const request = node.requestFullscreen || node.webkitRequestFullscreen;
  if (!request) {
    return false;
  }
  try {
    await request.call(node, { navigationUI: "hide" });
    return true;
  } catch {
    return false;
  }
}

export function openCinemaWindow(url) {
  const features = [
    "popup=yes",
    `width=${window.screen.availWidth}`,
    `height=${window.screen.availHeight}`,
    "left=0",
    "top=0",
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no",
    "scrollbars=no",
    "resizable=yes",
  ].join(",");
  const separator = url.includes("?") ? "&" : "?";
  const popup = window.open(`${url}${separator}fs=1`, "projetaba-cinema", features);
  popup?.focus();
  return Boolean(popup);
}
