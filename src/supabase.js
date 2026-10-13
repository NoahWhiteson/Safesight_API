import { createSupabaseContext } from "@supabase/server";
import { createClient } from "@supabase/supabase-js";
import { resolveEnv } from "@supabase/server/core";
import ws from "ws";
import { getSupabaseSecretKey, getSupabaseUrl, hasSupabaseAdminConfig } from "./supabaseKeys.js";

/** Node 18–21: supabase-js needs an explicit WebSocket transport for Realtime init. */
export function createServiceSupabaseClient(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: ws },
  });
}

export function isSupabaseConfigured() {
  const { data } = resolveEnv();
  return Boolean(data?.url) && hasSupabaseAdminConfig();
}

/** Admin client for server-only DB (bypasses RLS). */
export function getSupabaseAdmin() {
  const url = getSupabaseUrl();
  const secret = getSupabaseSecretKey();
  if (!url || !secret) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY (or SERVICE_ROLE) required");
  }
  return createServiceSupabaseClient(url, secret);
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
