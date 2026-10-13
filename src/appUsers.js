import { getSupabaseAdmin } from "./supabase.js";
import { defaultLimitsForPlan, effectivePhotoLimit, effectiveVideoLimit } from "./userQuotaLimits.js";

function currentQuotaMonthKey() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function profileToJSON(row) {
  if (!row) return null;
  const photoLimit = effectivePhotoLimit(row);
  const videoLimit = effectiveVideoLimit(row);
  const photoUsed = Number(row.photo_scans_used ?? 0);
  const videoUsed = Number(row.video_scans_used ?? 0);
  return {
    id: row.id,
    email: row.email,
    plan: row.plan,
    is_admin: Boolean(row.is_admin),
    onboarding_complete: Boolean(row.onboarding_complete),
    name: row.name,
    dwelling_raw: row.dwelling_raw,
    hazard_raws: Array.isArray(row.hazard_raws) ? row.hazard_raws : [],
    scan_aggressiveness: Number(row.scan_aggressiveness ?? 0.55),
    photo_scans_used: photoUsed,
    video_scans_used: videoUsed,
    quota_month_key: row.quota_month_key,
    photo_quota_limit: photoLimit,
    video_quota_limit: videoLimit,
    photo_scans_remaining: Math.max(0, photoLimit - photoUsed),
    video_scans_remaining: Math.max(0, videoLimit - videoUsed),
  };
}

async function maybeRollQuotaMonth(admin, row) {
  const month = currentQuotaMonthKey();
  if (row.quota_month_key === month) return row;

  const { data, error } = await admin
    .from("app_users")
    .update({
      quota_month_key: month,
      photo_scans_used: 0,
      video_scans_used: 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select("*")
    .single();

  if (error) {
    console.warn("quota month rollover failed:", error.message);
    return row;
  }
  return data;
}

export async function ensureAppUser(admin, { userId, email }) {
  const normalized = String(email || "").trim().toLowerCase();
  const { data: existing, error: readErr } = await admin
    .from("app_users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (readErr) {
    throw readErr;
  }
  if (existing) {
    return maybeRollQuotaMonth(admin, existing);
  }

  const plan = "free";
  const limits = defaultLimitsForPlan(plan);
  const insertRow = {
    id: userId,
    email: normalized,
    plan,
    photo_scans_used: 0,
    video_scans_used: 0,
    photo_quota_limit: limits.photo_quota_limit,
    video_quota_limit: limits.video_quota_limit,
    quota_month_key: currentQuotaMonthKey(),
    hazard_raws: [],
    scan_aggressiveness: 0.55,
    onboarding_complete: false,
    is_admin: false,
  };

  const { data, error } = await admin.from("app_users").insert(insertRow).select("*").single();
  if (error) {
    throw error;
  }
  return data;
}

export async function getAppUserById(admin, userId) {
  const { data, error } = await admin.from("app_users").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return maybeRollQuotaMonth(admin, data);
}

export async function updateAppUserProfile(admin, userId, patch) {
  const allowed = {};
  if (patch.name !== undefined) allowed.name = patch.name?.trim() || null;
  if (patch.dwelling_raw !== undefined) allowed.dwelling_raw = patch.dwelling_raw || null;
  if (patch.hazard_raws !== undefined) {
    allowed.hazard_raws = Array.isArray(patch.hazard_raws) ? patch.hazard_raws : [];
  }
  if (patch.scan_aggressiveness !== undefined) {
    const v = Number(patch.scan_aggressiveness);
    allowed.scan_aggressiveness = Math.min(1, Math.max(0.1, Number.isFinite(v) ? v : 0.55));
  }
  if (patch.onboarding_complete !== undefined) {
    allowed.onboarding_complete = Boolean(patch.onboarding_complete);
  }
  allowed.updated_at = new Date().toISOString();

  const { data, error } = await admin
    .from("app_users")
    .update(allowed)
    .eq("id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export function mountAppUserRoutes(app, { requireAuth }) {
  app.get("/v1/me", requireAuth, async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.json({ auth: "legacy_app_secret" });
      }

      const userId = req.supabaseCtx.userClaims.id;
      const admin = getSupabaseAdmin();
      let row = await getAppUserById(admin, userId);
      if (!row) {
        const email = req.supabaseCtx.userClaims.email || "";
        row = await ensureAppUser(admin, { userId, email });
      }

      const { id, email, role } = req.supabaseCtx.userClaims;
      return res.json({
        id,
        email,
        role,
        auth: "supabase_user",
        profile: profileToJSON(row),
      });
    } catch (err) {
      console.error("GET /v1/me failed:", err?.message || err);
      return res.status(502).json({ error: "Could not load profile" });
    }
  });

  app.post("/v1/me/subscription-sync", requireAuth, async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.status(403).json({ error: "Sign in required" });
      }

      const userId = req.supabaseCtx.userClaims.id;
      const premium = Boolean(req.body?.premium);
      const plan = premium ? "premium" : "free";
      const limits = defaultLimitsForPlan(plan);
      const admin = getSupabaseAdmin();
      await ensureAppUser(admin, {
        userId,
        email: req.supabaseCtx.userClaims.email || "",
      });

      const { data, error } = await admin
        .from("app_users")
        .update({
          plan,
          photo_quota_limit: limits.photo_quota_limit,
          video_quota_limit: limits.video_quota_limit,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .select("*")
        .single();
      if (error) throw error;

      return res.json({ profile: profileToJSON(data) });
    } catch (err) {
      console.error("subscription-sync failed:", err?.message || err);
      return res.status(502).json({ error: "Could not sync subscription" });
    }
  });

  app.patch("/v1/me/profile", requireAuth, async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.status(403).json({ error: "Sign in required" });
      }

      const userId = req.supabaseCtx.userClaims.id;
      const admin = getSupabaseAdmin();
      await ensureAppUser(admin, {
        userId,
        email: req.supabaseCtx.userClaims.email || "",
      });

      const row = await updateAppUserProfile(admin, userId, req.body || {});
      return res.json({ profile: profileToJSON(row) });
    } catch (err) {
      console.error("PATCH /v1/me/profile failed:", err?.message || err);
      return res.status(502).json({ error: "Could not update profile" });
    }
  });
}
