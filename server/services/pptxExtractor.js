import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { MAX_PPTX_SLIDES } from "../config.js";

function localName(value) {
  return String(value || "").replace(/^.*:/, "");
}

function attr(nodeXml, name) {
  const match = String(nodeXml).match(new RegExp(`${name}="([^"]+)"`));
  return match ? match[1] : "";
}

export async function extractPptxSlides(pptxPath, outDir) {
  const buffer = await fs.readFile(pptxPath);
  const zip = await JSZip.loadAsync(buffer, { createFolders: false });
  const names = Object.keys(zip.files);
  if (names.length > 4000) {
    throw Object.assign(new Error("PPTX inválido"), { status: 400 });
  }

  const presentation = zip.file("ppt/presentation.xml");
  if (!presentation) {
    throw Object.assign(new Error("PPTX sem apresentação"), { status: 400 });
  }
  const presentationXml = await presentation.async("string");
  const sldIds = [...presentationXml.matchAll(/sldId[^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
  const presRelsFile = zip.file("ppt/_rels/presentation.xml.rels");
  const presRels = presRelsFile ? await presRelsFile.async("string") : "";
  const relMap = {};
  for (const match of presRels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    relMap[match[1]] = match[2].replace(/^\//, "");
  }

  await fs.mkdir(outDir, { recursive: true });
  const slides = [];
  const count = Math.min(sldIds.length || names.filter((n) => /ppt\/slides\/slide\d+\.xml$/i.test(n)).length, MAX_PPTX_SLIDES);

  for (let i = 0; i < count; i += 1) {
    const target = sldIds[i] ? relMap[sldIds[i]] : `slides/slide${i + 1}.xml`;
    const slidePath = target.startsWith("ppt/") ? target : `ppt/${target.replace(/^\.\//, "")}`;
    const slideFile = zip.file(slidePath);
    if (!slideFile) {
      continue;
    }
    const relsPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const relsFile = zip.file(relsPath);
    const relsXml = relsFile ? await relsFile.async("string") : "";
    const mediaTargets = [...relsXml.matchAll(/Target="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((t) => /media\//i.test(t));

    let saved = null;
    for (const media of mediaTargets) {
      const mediaPath = path.posix.normalize(`ppt/slides/${media}`).replace(/\\/g, "/");
      const alt = media.replace(/^\.\.\//, "ppt/");
      const file = zip.file(mediaPath) || zip.file(alt) || zip.file(`ppt/media/${path.posix.basename(media)}`);
      if (!file) {
        continue;
      }
      const ext = path.extname(file.name).toLowerCase() || ".png";
      if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
        continue;
      }
      const bytes = await file.async("nodebuffer");
      const outName = `${i}${ext === ".jpeg" ? ".jpg" : ext}`;
      await fs.writeFile(path.join(outDir, outName), bytes);
      saved = outName;
      break;
    }
    slides.push({ index: i, file: saved });
  }

  if (!slides.length) {
    throw Object.assign(new Error("Nenhum slide encontrado no PPTX"), { status: 400 });
  }

  return { pageCount: slides.length, slides };
}

export { localName, attr };
