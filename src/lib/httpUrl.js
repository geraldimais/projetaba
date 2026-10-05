export function isPublicHttpUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
