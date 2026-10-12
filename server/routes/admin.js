import express from "express";
import { adminOverview, getMailSettings, saveMailSettings } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { syncMailbox, testMailConnection } from "../services/mailInbox.js";
import { encryptSecret } from "../util/secret.js";

export const adminRouter = express.Router();

adminRouter.use(requireAuth, requireAdmin);

adminRouter.get("/metrics", async (_req, res, next) => {
  try {
    const data = await adminOverview();
    res.json({
      ...data,
      hours: Math.round((data.seconds / 3600) * 10) / 10,
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/mail", async (_req, res, next) => {
  try {
    res.json({ settings: await getMailSettings() });
  } catch (error) {
    next(error);
  }
});

adminRouter.put("/mail", async (req, res, next) => {
  try {
    const body = req.body || {};
    const current = await getMailSettings();
    const password = String(body.password || "");
    const settings = await saveMailSettings({
      imapHost: body.imapHost,
      imapPort: body.imapPort,
      imapSecure: body.imapSecure,
      smtpHost: body.smtpHost,
      smtpPort: body.smtpPort,
      smtpSecure: body.smtpSecure,
      email: body.email,
      pollSeconds: body.pollSeconds,
      enabled: Boolean(body.enabled),
      passwordEnc: password ? encryptSecret(password) : undefined,
      lastError: current.lastError,
      lastSyncAt: current.lastSyncAt,
    });
    res.json({ settings });
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/mail/test", async (_req, res, next) => {
  try {
    res.json(await testMailConnection());
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/mail/sync", async (_req, res, next) => {
  try {
    res.json(await syncMailbox());
  } catch (error) {
    next(error);
  }
});
