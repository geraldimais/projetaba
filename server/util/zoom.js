export function clampZoom(next = {}) {
  const scale = Math.min(4, Math.max(1, Number(next.scale) || 1));
  const max = Math.max(0, (scale - 1) / 2);
  if (scale <= 1) {
    return { scale: 1, x: 0, y: 0 };
  }
  return {
    scale,
    x: Math.min(max, Math.max(-max, Number(next.x) || 0)),
    y: Math.min(max, Math.max(-max, Number(next.y) || 0)),
  };
}
