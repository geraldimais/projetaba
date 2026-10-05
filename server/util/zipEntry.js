import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createInflateRaw, inflateRaw } from "node:zlib";

const inflateRawAsync = promisify(inflateRaw);
const MAX_INFLATE = 32 * 1024 * 1024;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

async function readExact(fh, offset, length) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  if (bytesRead < length) {
    throw new Error("ZIP truncado.");
  }
  return buf;
}

export async function listZipEntries(filePath) {
  const fh = await fsp.open(filePath, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65535 + 22);
    const tail = await readExact(fh, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) {
      throw Object.assign(new Error("Arquivo PPTX/ZIP inválido."), { status: 400 });
    }
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = await readExact(fh, cdOffset, cdSize);
    const entries = [];
    let cursor = 0;
    while (cursor + 46 <= cd.length) {
      if (cd.readUInt32LE(cursor) !== CENTRAL) {
        break;
      }
      const nameLen = cd.readUInt16LE(cursor + 28);
      const extraLen = cd.readUInt16LE(cursor + 30);
      const commentLen = cd.readUInt16LE(cursor + 32);
      entries.push({
        name: cd.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8").replaceAll("\\", "/"),
        method: cd.readUInt16LE(cursor + 10),
        crc: cd.readUInt32LE(cursor + 16),
        compressedSize: cd.readUInt32LE(cursor + 20),
        uncompressedSize: cd.readUInt32LE(cursor + 24),
        localOffset: cd.readUInt32LE(cursor + 42),
      });
      cursor += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    await fh.close();
  }
}

async function dataOffset(fh, localOffset) {
  const header = await readExact(fh, localOffset, 30);
  if (header.readUInt32LE(0) !== LOCAL) {
    throw new Error("Cabeçalho ZIP inválido.");
  }
  const nameLen = header.readUInt16LE(26);
  const extraLen = header.readUInt16LE(28);
  return { header, start: localOffset + 30 + nameLen + extraLen, nameLen, extraLen };
}

export async function readZipEntry(filePath, entryName) {
  const entries = await listZipEntries(filePath);
  const entry = entries.find((item) => item.name === entryName);
  if (!entry) {
    return null;
  }
  const fh = await fsp.open(filePath, "r");
  try {
    const { start } = await dataOffset(fh, entry.localOffset);
    const data = await readExact(fh, start, entry.compressedSize);
    if (entry.method === 0) {
      return data;
    }
    if (entry.method === 8) {
      return inflateRawAsync(data, { maxOutputLength: MAX_INFLATE });
    }
    throw new Error("Compressão ZIP não suportada.");
  } finally {
    await fh.close();
  }
}

export async function extractZipEntryToFile(zipPath, entry, destPath) {
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const fh = await fsp.open(zipPath, "r");
  let start;
  try {
    ({ start } = await dataOffset(fh, entry.localOffset));
  } finally {
    await fh.close();
  }
  const input = fs.createReadStream(zipPath, {
    start,
    end: start + Math.max(0, entry.compressedSize) - 1,
  });
  const output = fs.createWriteStream(destPath);
  if (entry.method === 0) {
    await pipeline(input, output);
    return;
  }
  if (entry.method === 8) {
    await pipeline(input, createInflateRaw({ maxOutputLength: MAX_INFLATE }), output);
    return;
  }
  throw new Error("Compressão ZIP não suportada.");
}

function dosTime() {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  return { time, date };
}

export async function copyZipReplacing(zipPath, destPath, replace) {
  const entries = await listZipEntries(zipPath);
  const fh = await fsp.open(zipPath, "r");
  const chunks = [];
  const centrals = [];
  let offset = 0;
  const { time, date } = dosTime();
  try {
    for (const entry of entries) {
      const swapped = replace(entry);
      if (swapped) {
        const name = Buffer.from(entry.name, "utf8");
        const local = Buffer.alloc(30 + name.length);
        local.writeUInt32LE(LOCAL, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(0, 14);
        local.writeUInt32LE(0, 18);
        local.writeUInt32LE(0, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        name.copy(local, 30);
        chunks.push(local);
        const central = Buffer.alloc(46 + name.length);
        central.writeUInt32LE(CENTRAL, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(date, 14);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt32LE(offset, 42);
        name.copy(central, 46);
        centrals.push(central);
        offset += local.length;
        continue;
      }
      const { header, start, nameLen, extraLen } = await dataOffset(fh, entry.localOffset);
      const nameExtra = await readExact(fh, entry.localOffset + 30, nameLen + extraLen);
      const data = await readExact(fh, start, entry.compressedSize);
      chunks.push(header, nameExtra, data);
      const name = nameExtra.subarray(0, nameLen);
      const central = Buffer.alloc(46 + name.length);
      central.writeUInt32LE(CENTRAL, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(header.readUInt16LE(4), 6);
      central.writeUInt16LE(header.readUInt16LE(6), 8);
      central.writeUInt16LE(header.readUInt16LE(8), 10);
      header.copy(central, 12, 10, 26);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt32LE(offset, 42);
      name.copy(central, 46);
      centrals.push(central);
      offset += header.length + nameExtra.length + data.length;
    }
  } finally {
    await fh.close();
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await fsp.writeFile(destPath, Buffer.concat([...chunks, cd, eocd]));
}
