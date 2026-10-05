import express from "express";
import { adminOverview } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

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
