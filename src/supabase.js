import "./nodeCryptoPolyfill.js";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import {
  getSupabasePublishableKey,
  getSupabaseSecretKey,
  getSupabaseUrl,
  hasSupabaseAdminConfig,
} from "./supabaseKeys.js";

export const AUTH_VERIFIER = "auth-v1-user-fetch";

/** Node 18–21: supabase-js needs an explicit WebSocket transport for Realtime init. */
export function createServiceSupabaseClient(url, key) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: ws },
  });
}

export function isSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && hasSupabaseAdminConfig());
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
 * Verify Supabase user JWT via Auth API (avoids JWKS/crypto issues on Node 18).
 * Returns { userClaims } or sends 401 via res.
 */
async function readJsonSafe(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/** Validates user JWT via GoTrue HTTP API (no JWKS / @supabase/server). */
export async function verifySupabaseUserJwt(accessToken) {
  const url = getSupabaseUrl();
  const apikey = getSupabasePublishableKey() || getSupabaseSecretKey();
  if (!url || !apikey) {
    return { ok: false, status: 503, error: "Supabase URL/keys not configured on server" };
  }

  let response;
  try {
    response = await fetch(`${url}/auth/v1/user`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey,
      },
    });
  } catch (err) {
    return { ok: false, status: 502, error: err?.message || "Could not reach Supabase Auth" };
  }

  const body = await readJsonSafe(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: body?.msg || body?.message || body?.error_description || `Auth failed (${response.status})`,
      code: body?.code || body?.error_code,
    };
  }

  const user = body?.user ?? body;
  if (!user?.id) {
    return { ok: false, status: 401, error: "Invalid session (no user in Auth response)" };
  }

  return {
    ok: true,
    userClaims: {
      id: user.id,
      email: user.email ?? "",
      role: user.role ?? "authenticated",
    },
  };
}

export async function requireSupabaseUser(req, res) {
  const auth = req.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!bearer) {
    res.status(401).json({ error: "Missing bearer token" });
    return null;
  }

  const verified = await verifySupabaseUserJwt(bearer);
  if (!verified.ok) {
    const status = verified.status === 503 ? 503 : verified.status === 502 ? 502 : 401;
    res.status(status).json({
      error: verified.error || "Invalid or expired session",
      code: verified.code,
      auth_verifier: AUTH_VERIFIER,
    });
    return null;
  }

  return { userClaims: verified.userClaims };
}
