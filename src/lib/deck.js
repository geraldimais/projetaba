export function isUrlDeck(file) {
  if (!file || file.kind !== "url") {
    return false;
  }
  const url = String(file.sourceUrl || file.history?.[0] || "");
  return /^https?:\/\//i.test(url);
}

export function activeDeck(session) {
  const files = session?.files || [];
  if (!files.length) {
    return null;
  }
  const match = files.find((item) => item.fileId === session.activeFileId);
  if (match) {
    return match;
  }
  return files.find((item) => item.kind !== "url") || files[0];
}
