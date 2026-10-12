import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import { countPresentations, getMailInboxItem, listMailInbox, savePresentation, updateMailInbox } from "../db.js";
import { MAX_LIBRARY } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { describeUpload } from "../services/fileProcessor.js";
import { loadInboxFile, syncMailbox } from "../services/mailInbox.js";

export const inboxRouter = express.Router();

inboxRouter.use(requireAuth);

inboxRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ items: await listMailInbox("pending") });
  } catch (error) {
    next(error);
  }
});

inboxRouter.post("/sync", async (_req, res, next) => {
  try {
    const result = await syncMailbox();
    res.json({ ...result, items: await listMailInbox("pending") });
  } catch (error) {
    next(error);
  }
});

inboxRouter.post("/:id/import", async (req, res, next) => {
  try {
    const loaded = await loadInboxFile(req.params.id);
    if (!loaded || (loaded.row.status || "pending") !== "pending") {
      res.status(404).json({ error: "Item de e-mail não encontrado." });
      return;
    }
    const current = await countPresentations(req.user.id);
    if (current + 1 > MAX_LIBRARY) {
      res.status(400).json({ error: `Limite de ${MAX_LIBRARY} apresentações na biblioteca.` });
      return;
    }
    const described = await describeUpload({
      path: loaded.diskPath,
      originalname: loaded.row.filename,
      mimetype: loaded.row.mime,
    });
    const created = await savePresentation({
      id: described.id,
      userId: req.user.id,
      title: path.parse(described.originalName || "arquivo").name.slice(0, 180),
      originalName: described.originalName,
      mime: described.mime,
      kind: described.kind,
      pageCount: described.pageCount,
      sizeBytes: described.sizeBytes,
      buffer: await fs.readFile(loaded.diskPath),
    });
    await updateMailInbox(req.params.id, { status: "imported", presentationId: created.id });
    res.status(201).json({ presentation: created, items: await listMailInbox("pending") });
  } catch (error) {
    next(error);
  }
});

inboxRouter.post("/:id/ignore", async (req, res, next) => {
  try {
    const row = await getMailInboxItem(req.params.id);
    if (!row) {
      res.status(404).json({ error: "Item de e-mail não encontrado." });
      return;
    }
    await updateMailInbox(req.params.id, { status: "ignored" });
    res.json({ items: await listMailInbox("pending") });
  } catch (error) {
    next(error);
  }
});
