import { getSupabaseAdmin } from "./supabase.js";
import { getAppUserById, profileToJSON } from "./appUsers.js";
import { defaultLimitsForPlan } from "./userQuotaLimits.js";

async function requireAdmin(req, res) {
  if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
    res.status(403).json({ error: "Sign in required" });
    return null;
  }
  const admin = getSupabaseAdmin();
  const row = await getAppUserById(admin, req.supabaseCtx.userClaims.id);
  if (!row?.is_admin) {
    res.status(403).json({ error: "Admin access required" });
    return null;
  }
  return { admin, row };
}

function adminPatchFromBody(body) {
  const patch = {};
  const src = body || {};
  if (src.plan !== undefined && ["free", "premium"].includes(src.plan)) {
    patch.plan = src.plan;
    const limits = defaultLimitsForPlan(src.plan);
    patch.photo_quota_limit = limits.photo_quota_limit;
    patch.video_quota_limit = limits.video_quota_limit;
  }
  for (const key of ["photo_quota_limit", "video_quota_limit", "photo_scans_used", "video_scans_used"]) {
    if (src[key] !== undefined) {
      const n = Number(src[key]);
      if (Number.isFinite(n) && n >= 0) patch[key] = Math.floor(n);
    }
  }
  if (src.is_admin !== undefined) patch.is_admin = Boolean(src.is_admin);
  patch.updated_at = new Date().toISOString();
  return patch;
}

export function mountAdminRoutes(app, { requireAuth }) {
  app.get("/v1/admin/analytics", requireAuth, async (req, res) => {
    try {
      const gate = await requireAdmin(req, res);
      if (!gate) return;
      const { admin } = gate;

      const { count: userCount, error: countErr } = await admin
        .from("app_users")
        .select("*", { count: "exact", head: true });
      if (countErr) throw countErr;

      const { data: rows, error } = await admin
        .from("app_users")
        .select("plan, photo_scans_used, video_scans_used, is_admin");
      if (error) throw error;

      let premiumUsers = 0;
      let photoScans = 0;
      let videoScans = 0;
      let adminUsers = 0;
      for (const r of rows || []) {
        if (r.plan === "premium") premiumUsers += 1;
        if (r.is_admin) adminUsers += 1;
        photoScans += Number(r.photo_scans_used ?? 0);
        videoScans += Number(r.video_scans_used ?? 0);
      }

      return res.json({
        total_users: userCount ?? rows?.length ?? 0,
        premium_users: premiumUsers,
        admin_users: adminUsers,
        photo_scans_used_sum: photoScans,
        video_scans_used_sum: videoScans,
      });
    } catch (err) {
      console.error("admin analytics:", err?.message || err);
      return res.status(502).json({ error: "Could not load analytics" });
    }
  });

  app.get("/v1/admin/users", requireAuth, async (req, res) => {
    try {
      const gate = await requireAdmin(req, res);
      if (!gate) return;
      const { admin } = gate;

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

  app.patch("/v1/admin/users/:userId", requireAuth, async (req, res) => {
    try {
      const gate = await requireAdmin(req, res);
      if (!gate) return;
      const { admin } = gate;

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
}
