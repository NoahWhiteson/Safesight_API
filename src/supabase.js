import { createSupabaseContext } from "@supabase/server";
import { createAdminClient, resolveEnv } from "@supabase/server/core";

export function isSupabaseConfigured() {
  const { data } = resolveEnv();
  return Boolean(data?.url);
}

/** Admin client for server-only DB (bypasses RLS). Requires SUPABASE_URL + SUPABASE_SECRET_KEY. */
export function getSupabaseAdmin() {
  const { data: env, error } = resolveEnv();
  if (error) {
    throw error;
  }
  return createAdminClient({ env });
}

/**
 * Build a Web Request from Express (auth headers only — fine for JWT / apikey verification).
 */
export function webRequestFromExpress(req) {
  const host = req.get("host") || "localhost";
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const url = `${proto}://${host}${req.originalUrl || req.url || "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    } else {
      headers.set(key, value);
    }
  }
  return new Request(url, { method: req.method, headers });
}

/**
 * Verify Supabase user JWT (Authorization: Bearer <access_token>).
 * Returns SupabaseContext or sends 401 via res.
 */
export async function requireSupabaseUser(req, res) {
  const request = webRequestFromExpress(req);
  const { data: ctx, error } = await createSupabaseContext(request, {
    auth: "user",
  });

  if (error) {
    res.status(error.status || 401).json({
      error: error.message,
      code: error.code,
    });
    return null;
  }

  return ctx;
}
