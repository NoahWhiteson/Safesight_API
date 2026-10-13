import "./nodeCryptoPolyfill.js";
import crypto from "crypto";
import { requireSupabaseUser } from "./supabase.js";

export function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, Buffer.alloc(left.length));
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/** Legacy app secret (iOS ships this until JWT auth ships). */
export function requireApiSecret(apiSecret) {
  return (req, res, next) => {
    if (!apiSecret) {
      return res.status(500).json({ error: "SAFESIGHT_API_SECRET not configured on server" });
    }

    const auth = req.get("authorization") || "";
    const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    const headerKey = (req.get("x-safesight-key") || "").trim();
    const provided = bearer || headerKey;

    if (!provided || !timingSafeEqualString(provided, apiSecret)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return next();
  };
}

/**
 * Accept either Supabase user JWT or legacy SAFESIGHT_API_SECRET bearer.
 * Sets req.supabaseCtx when JWT auth succeeds.
 */
export function requireAppAuth(apiSecret) {
  return async (req, res, next) => {
    const auth = req.get("authorization") || "";
    const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";

    // Supabase access tokens are JWTs (three dot-separated segments).
    if (bearer && bearer.split(".").length === 3) {
      const ctx = await requireSupabaseUser(req, res);
      if (!ctx) return;
      req.supabaseCtx = ctx;
      req.authKind = "supabase_user";
      return next();
    }

    return requireApiSecret(apiSecret)(req, res, next);
  };
}
