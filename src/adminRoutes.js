import { currentQuotaMonthKey, profileToJSON } from "./appUsers.js";
import { planQuotaPatch } from "./userQuotaLimits.js";
import { adminOnlyMiddleware } from "./adminGate.js";
import express from "express";

function quotaResetPatch() {
  return {
    photo_scans_used: 0,
    video_scans_used: 0,
    quota_month_key: currentQuotaMonthKey(),
    updated_at: new Date().toISOString(),
  };
}

function adminPatchFromBody(body) {
  const patch = {};
  const src = body || {};
  if (src.plan !== undefined && ["free", "premium"].includes(src.plan)) {
    Object.assign(patch, planQuotaPatch(src.plan));
  }
  for (const key of ["photo_quota_limit", "video_quota_limit", "photo_scans_used", "video_scans_used"]) {
    if (src[key] !== undefined) {
      const n = Number(src[key]);
      if (Number.isFinite(n) && n >= 0) patch[key] = Math.floor(n);
    }
  }
  if (src.is_admin !== undefined) patch.is_admin = Boolean(src.is_admin);
  if (src.is_banned !== undefined) {
    patch.is_banned = Boolean(src.is_banned);
    if (patch.is_banned) {
      patch.banned_at = new Date().toISOString();
      if (src.ban_reason !== undefined) {
        patch.ban_reason = String(src.ban_reason || "").trim().slice(0, 500) || null;
      }
    } else {
      patch.banned_at = null;
      patch.ban_reason = null;
    }
  } else if (src.ban_reason !== undefined) {
    patch.ban_reason = String(src.ban_reason || "").trim().slice(0, 500) || null;
  }
  patch.updated_at = new Date().toISOString();
  return patch;
}

export function mountAdminRoutes(app, { requireAuth }) {
  const router = express.Router();
  router.use(requireAuth);
  router.use(adminOnlyMiddleware());

  router.get("/analytics", async (req, res) => {
    try {
      const { admin } = req.adminCtx;

      const { count: userCount, error: countErr } = await admin
        .from("app_users")
        .select("*", { count: "exact", head: true });
      if (countErr) throw countErr;

      let rows;
      const { data: rowsWithBan, error: banSelectErr } = await admin
        .from("app_users")
        .select("plan, photo_scans_used, video_scans_used, is_admin, is_banned");
      if (banSelectErr && /is_banned/i.test(String(banSelectErr.message || ""))) {
        const { data: rowsBasic, error: basicErr } = await admin
          .from("app_users")
          .select("plan, photo_scans_used, video_scans_used, is_admin");
        if (basicErr) throw basicErr;
        rows = rowsBasic;
      } else {
        if (banSelectErr) throw banSelectErr;
        rows = rowsWithBan;
      }

      let premiumUsers = 0;
      let photoScans = 0;
      let videoScans = 0;
      let adminUsers = 0;
      let bannedUsers = 0;
      for (const r of rows || []) {
        if (r.plan === "premium") premiumUsers += 1;
        if (r.is_admin) adminUsers += 1;
        if (r.is_banned) bannedUsers += 1;
        photoScans += Number(r.photo_scans_used ?? 0);
        videoScans += Number(r.video_scans_used ?? 0);
      }

      return res.json({
        total_users: userCount ?? rows?.length ?? 0,
        premium_users: premiumUsers,
        admin_users: adminUsers,
        banned_users: bannedUsers,
        photo_scans_used_sum: photoScans,
        video_scans_used_sum: videoScans,
      });
    } catch (err) {
      console.error("admin analytics:", err?.message || err);
      return res.status(502).json({ error: "Could not load analytics" });
    }
  });

  router.get("/users", async (req, res) => {
    try {
      const { admin } = req.adminCtx;

      const q = String(req.query.q || "")
        .trim()
        .toLowerCase();
      let query = admin.from("app_users").select("*").order("updated_at", { ascending: false }).limit(25);
      if (q.length >= 2) {
        query = query.ilike("email", `%${q}%`);
      }

      const { data, error } = await query;
      if (error) throw error;

      return res.json({
        users: (data || []).map((row) => profileToJSON(row)),
      });
    } catch (err) {
      console.error("admin users search:", err?.message || err);
      return res.status(502).json({ error: "Could not search users" });
    }
  });

  router.patch("/users/:userId", async (req, res) => {
    try {
      const { admin } = req.adminCtx;

      const userId = String(req.params.userId || "").trim();
      if (!userId) return res.status(400).json({ error: "Missing user id" });

      const patch = adminPatchFromBody(req.body);
      if (Object.keys(patch).length <= 1) {
        return res.status(400).json({ error: "No valid fields to update" });
      }

      const { data, error } = await admin
        .from("app_users")
        .update(patch)
        .eq("id", userId)
        .select("*")
        .single();
      if (error) throw error;

      return res.json({ profile: profileToJSON(data) });
    } catch (err) {
      console.error("admin user patch:", err?.message || err);
      return res.status(502).json({ error: "Could not update user" });
    }
  });

  router.post("/users/:userId/reset-quota", async (req, res) => {
    try {
      const { admin } = req.adminCtx;
      const userId = String(req.params.userId || "").trim();
      if (!userId) return res.status(400).json({ error: "Missing user id" });

      const { data, error } = await admin
        .from("app_users")
        .update(quotaResetPatch())
        .eq("id", userId)
        .select("*")
        .single();
      if (error) throw error;

      return res.json({ profile: profileToJSON(data), reset: true });
    } catch (err) {
      console.error("admin reset user quota:", err?.message || err);
      return res.status(502).json({ error: "Could not reset user quota" });
    }
  });

  router.post("/quota/reset-all", async (req, res) => {
    try {
      if (req.body?.confirm !== "RESET_ALL") {
        return res.status(400).json({
          error: 'Send { "confirm": "RESET_ALL" } to reset every user’s monthly scan counters.',
        });
      }
      const { admin } = req.adminCtx;
      const patch = quotaResetPatch();
      const { data, error } = await admin.from("app_users").update(patch).neq("id", "00000000-0000-0000-0000-000000000000").select("id");
      if (error) throw error;
      return res.json({ reset_count: data?.length ?? 0 });
    } catch (err) {
      console.error("admin reset all quota:", err?.message || err);
      return res.status(502).json({ error: "Could not reset quotas for all users" });
    }
  });

  router.post("/quota/reset-premium", async (req, res) => {
    try {
      if (req.body?.confirm !== "RESET_PREMIUM") {
        return res.status(400).json({
          error: 'Send { "confirm": "RESET_PREMIUM" } to reset premium users’ scan counters.',
        });
      }
      const { admin } = req.adminCtx;
      const patch = quotaResetPatch();
      const { data, error } = await admin
        .from("app_users")
        .update(patch)
        .eq("plan", "premium")
        .select("id");
      if (error) throw error;
      return res.json({ reset_count: data?.length ?? 0 });
    } catch (err) {
      console.error("admin reset premium quota:", err?.message || err);
      return res.status(502).json({ error: "Could not reset premium quotas" });
    }
  });

  app.use("/v1/admin", router);
}
