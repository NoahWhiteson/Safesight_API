import { getSupabaseAdmin } from "./supabase.js";
import { getAppUserById } from "./appUsers.js";

export async function requireAdminUser(req, res) {
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
  return { admin, row, userId: req.supabaseCtx.userClaims.id };
}

/** Express middleware — must run after requireAppAuth. */
export function adminOnlyMiddleware() {
  return async (req, res, next) => {
    const gate = await requireAdminUser(req, res);
    if (!gate) return;
    req.adminCtx = gate;
    next();
  };
}

export function requireSignedInScanUser(req, res, next) {
  if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
    return res.status(403).json({
      error: "Sign in required",
      detail: "Photo and video scans must use your Safesight account session.",
    });
  }
  return next();
}
