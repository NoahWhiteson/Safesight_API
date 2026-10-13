import { getSupabaseAdmin } from "./supabase.js";
import { adminOnlyMiddleware } from "./adminGate.js";
import express from "express";

const SETTINGS_ID = 1;

export async function getGlobalSettings(admin = getSupabaseAdmin()) {
  const { data, error } = await admin
    .from("app_global_settings")
    .select("*")
    .eq("id", SETTINGS_ID)
    .maybeSingle();

  if (error && /relation|app_global_settings|schema cache/i.test(error.message || "")) {
    return defaultGlobalSettings();
  }
  if (error) throw error;
  if (!data) return defaultGlobalSettings();
  return settingsToJSON(data);
}

function defaultGlobalSettings() {
  return {
    maintenance_mode: false,
    maintenance_message: "Safesight is temporarily unavailable for maintenance.",
    profile_diagnostics_enabled: false,
    announcements: "",
    updated_at: null,
  };
}

function settingsToJSON(row) {
  return {
    maintenance_mode: Boolean(row.maintenance_mode),
    maintenance_message: String(row.maintenance_message || ""),
    profile_diagnostics_enabled: Boolean(row.profile_diagnostics_enabled),
    announcements: String(row.announcements || ""),
    updated_at: row.updated_at ?? null,
  };
}

export async function updateGlobalSettings(admin, patch) {
  const allowed = { updated_at: new Date().toISOString() };
  if (patch.maintenance_mode !== undefined) allowed.maintenance_mode = Boolean(patch.maintenance_mode);
  if (patch.maintenance_message !== undefined) {
    allowed.maintenance_message = String(patch.maintenance_message || "").slice(0, 2000);
  }
  if (patch.profile_diagnostics_enabled !== undefined) {
    allowed.profile_diagnostics_enabled = Boolean(patch.profile_diagnostics_enabled);
  }
  if (patch.announcements !== undefined) {
    allowed.announcements = String(patch.announcements || "").slice(0, 4000);
  }

  const { data, error } = await admin
    .from("app_global_settings")
    .upsert({ id: SETTINGS_ID, ...allowed }, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return settingsToJSON(data);
}

export function mountAppSettingsRoutes(app, { requireAuth }) {
  app.get("/v1/app-config", async (_req, res) => {
    try {
      const settings = await getGlobalSettings();
      return res.json({ settings });
    } catch (err) {
      console.error("GET /v1/app-config:", err?.message || err);
      return res.json({ settings: defaultGlobalSettings() });
    }
  });

  const adminRouter = express.Router();
  adminRouter.use(requireAuth);
  adminRouter.use(adminOnlyMiddleware());

  adminRouter.get("/settings", async (req, res) => {
    try {
      const settings = await getGlobalSettings();
      return res.json({ settings });
    } catch (err) {
      return res.status(502).json({ error: "Could not load settings" });
    }
  });

  adminRouter.patch("/settings", async (req, res) => {
    try {
      const settings = await updateGlobalSettings(req.adminCtx.admin, req.body || {});
      return res.json({ settings });
    } catch (err) {
      console.error("PATCH /v1/admin/settings:", err?.message || err);
      return res.status(502).json({ error: "Could not update settings", detail: err?.message });
    }
  });

  app.use("/v1/admin", adminRouter);
}
