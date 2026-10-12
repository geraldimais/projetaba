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

export function zoomStyle(zoom) {
  const value = clampZoom(zoom);
  return {
    "--zs": String(value.scale),
    "--zx": `${value.x * 100}%`,
    "--zy": `${value.y * 100}%`,
  };
}

export function nudgeZoom(zoom, dx, dy) {
  const current = clampZoom(zoom);
  const step = Math.max(0.08, (current.scale - 1) / 6);
  return clampZoom({
    scale: current.scale,
    x: current.x - dx * step,
    y: current.y - dy * step,
  });
}
