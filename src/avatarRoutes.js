import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase.js";
import { ensureAppUser, getAppUserById, profileToJSON } from "./appUsers.js";
import {
  AVATAR_BUCKET,
  AVATAR_MAX_UPLOAD_BYTES,
  avatarObjectPath,
  optimizeAvatarBuffer,
  publicAvatarUrl,
} from "./avatarImage.js";

export function mountAvatarRoutes(app, { requireAuth, uploadAvatar }) {
  app.post("/v1/me/avatar", requireAuth, uploadAvatar.single("photo"), async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.status(403).json({ error: "Sign in required" });
      }
      if (!isSupabaseConfigured()) {
        return res.status(503).json({ error: "Storage not configured" });
      }
      if (!req.file?.buffer?.length) {
        return res.status(400).json({ error: "Photo required (field: photo)" });
      }
      if (req.file.size > AVATAR_MAX_UPLOAD_BYTES) {
        return res.status(413).json({ error: "Photo must be 10 MB or smaller" });
      }

      const userId = req.supabaseCtx.userClaims.id;
      const admin = getSupabaseAdmin();
      await ensureAppUser(admin, {
        userId,
        email: req.supabaseCtx.userClaims.email || "",
      });

      const optimized = await optimizeAvatarBuffer(req.file.buffer);
      const objectPath = avatarObjectPath(userId);

      const { error: uploadErr } = await admin.storage.from(AVATAR_BUCKET).upload(objectPath, optimized, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "public, max-age=3600",
      });
      if (uploadErr) {
        console.error("avatar upload:", uploadErr.message);
        return res.status(502).json({
          error: "Could not save photo",
          detail: uploadErr.message,
        });
      }

      const version = Date.now();
      const avatarUrl = publicAvatarUrl(process.env.SUPABASE_URL, userId, version);

      const { data, error } = await admin
        .from("app_users")
        .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq("id", userId)
        .select("*")
        .single();
      if (error) throw error;

      return res.json({
        profile: profileToJSON(data),
        bytes: optimized.length,
      });
    } catch (err) {
      console.error("POST /v1/me/avatar:", err?.message || err);
      return res.status(502).json({
        error: "Could not upload photo",
        detail: err?.message || String(err),
      });
    }
  });

  app.delete("/v1/me/avatar", requireAuth, async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.status(403).json({ error: "Sign in required" });
      }
      const userId = req.supabaseCtx.userClaims.id;
      const admin = getSupabaseAdmin();

      await admin.storage.from(AVATAR_BUCKET).remove([avatarObjectPath(userId)]);

      const { data, error } = await admin
        .from("app_users")
        .update({ avatar_url: null, updated_at: new Date().toISOString() })
        .eq("id", userId)
        .select("*")
        .single();
      if (error) throw error;

      return res.json({ profile: profileToJSON(data) });
    } catch (err) {
      console.error("DELETE /v1/me/avatar:", err?.message || err);
      return res.status(502).json({ error: "Could not remove photo" });
    }
  });
}
