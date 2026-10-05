import path from "node:path";
import { MAX_PPTX_SLIDES } from "../config.js";
import { copyZipReplacing, extractZipEntryToFile, listZipEntries, readZipEntry } from "../util/zipEntry.js";

const VIDEO_EXT = /\.(mp4|webm|mov|m4v)$/i;
const DEFAULT_CX = 12192000;
const DEFAULT_CY = 6858000;

function slideCountFromXml(xml, names) {
  const ids = [...String(xml || "").matchAll(/sldId[^>]*r:id="([^"]+)"/g)];
  const count = ids.length || names.filter((name) => /ppt\/slides\/slide\d+\.xml$/i.test(name)).length;
  if (!count) {
    throw Object.assign(new Error("Nenhum slide encontrado no PPTX"), { status: 400 });
  }
  return Math.min(count, MAX_PPTX_SLIDES);
}

export async function countPptxSlides(pptxPath) {
  const entries = await listZipEntries(pptxPath);
  const xml = await readZipEntry(pptxPath, "ppt/presentation.xml");
  if (!xml) {
    throw Object.assign(new Error("PPTX sem apresentação"), { status: 400 });
  }
  return slideCountFromXml(xml.toString("utf8"), entries.map((item) => item.name));
}

function relsFor(xml) {
  const map = new Map();
  const text = String(xml || "");
  for (const match of text.matchAll(/Id="([^"]+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"/gi)) {
    map.set(match[1], { type: match[2], target: match[3].replaceAll("\\", "/") });
  }
  for (const match of text.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*Type="([^"]+)"/gi)) {
    if (!map.has(match[1])) {
      map.set(match[1], { type: match[3], target: match[2].replaceAll("\\", "/") });
    }
  }
  return map;
}

function resolveMedia(slideIndex, target) {
  const base = `ppt/slides/slide${slideIndex}.xml`;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(base), target));
  return joined.replace(/^\/+/, "");
}

function boxForRid(slideXml, rid, cx, cy) {
  const needle = slideXml.includes(`r:link="${rid}"`) ? `r:link="${rid}"` : `r:embed="${rid}"`;
  const at = slideXml.indexOf(needle);
  if (at < 0) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  const start = slideXml.lastIndexOf("<p:pic", at);
  const end = slideXml.indexOf("</p:pic>", at);
  const chunk = start >= 0 && end > start ? slideXml.slice(start, end) : slideXml;
  const off = chunk.match(/<a:off[^>]*x="(\d+)"[^>]*y="(\d+)"/);
  const ext = chunk.match(/<a:ext[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  if (!off || !ext) {
    return { left: 0, top: 0, width: 1, height: 1 };
  }
  return {
    left: Number(off[1]) / cx,
    top: Number(off[2]) / cy,
    width: Number(ext[1]) / cx,
    height: Number(ext[2]) / cy,
  };
}

export async function extractPptxVideos(pptxPath, destDir) {
  const entries = await listZipEntries(pptxPath);
  const presentation = await readZipEntry(pptxPath, "ppt/presentation.xml");
  if (!presentation) {
    return { pageCount: 0, videos: [] };
  }
  const xml = presentation.toString("utf8");
  const pageCount = slideCountFromXml(xml, entries.map((item) => item.name));
  const size = xml.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
  const cx = Number(size?.[1] || DEFAULT_CX);
  const cy = Number(size?.[2] || DEFAULT_CY);
  const videos = [];
  const copied = new Map();

  for (let index = 0; index < pageCount; index += 1) {
    const slideNo = index + 1;
    const rels = await readZipEntry(pptxPath, `ppt/slides/_rels/slide${slideNo}.xml.rels`);
    const slide = await readZipEntry(pptxPath, `ppt/slides/slide${slideNo}.xml`);
    if (!rels || !slide) {
      continue;
    }
    const slideXml = slide.toString("utf8");
    for (const [rid, meta] of relsFor(rels.toString("utf8"))) {
      const target = resolveMedia(slideNo, meta.target);
      if (!VIDEO_EXT.test(target) && !/video|media/i.test(meta.type || "")) {
        continue;
      }
      if (!VIDEO_EXT.test(target)) {
        continue;
      }
      const fileName = path.posix.basename(target);
      if (!copied.has(target)) {
        const entry = entries.find((item) => item.name === target);
        if (!entry) {
          continue;
        }
        await extractZipEntryToFile(pptxPath, entry, path.join(destDir, fileName));
        copied.set(target, fileName);
      }
      videos.push({
        index,
        file: copied.get(target),
        ...boxForRid(slideXml, rid, cx, cy),
      });
    }
  }
  return { pageCount, videos };
}

export async function writeSlimPptx(srcPath, destPath) {
  await copyZipReplacing(srcPath, destPath, (entry) => VIDEO_EXT.test(entry.name));
}

export async function extractPptxSlides(pptxPath) {
  const pageCount = await countPptxSlides(pptxPath);
  return { pageCount, slides: Array.from({ length: pageCount }, (_, index) => ({ index })) };
}
