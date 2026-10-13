import {
  getSupabasePublishableKey,
  getSupabaseSecretKey,
  getSupabaseUrl,
} from "./supabaseKeys.js";

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export async function adminGenerateEmailOtp(email) {
  const url = getSupabaseUrl();
  const secret = getSupabaseSecretKey();
  if (!url || !secret) {
    return { ok: false, error: "Supabase admin keys not configured on server" };
  }

  let lastError = null;
  for (const type of ["magiclink", "signup"]) {
    let res;
    try {
      res = await fetch(`${url}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        apikey: secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type, email }),
      });
    } catch (networkErr) {
      return { ok: false, error: networkErr?.message || "Could not reach Supabase Auth" };
    }
    const body = await readJson(res);
    if (!res.ok) {
      lastError = body?.msg || body?.message || body?.error_description || `Supabase ${res.status}`;
      continue;
    }

    const otp =
      body?.properties?.email_otp ??
      body?.email_otp ??
      body?.data?.properties?.email_otp;
    const verificationType =
      body?.properties?.verification_type ??
      body?.verification_type ??
      "email";

    if (!otp) {
      lastError = "Supabase did not return an email OTP (check Auth email settings)";
      continue;
    }

    return {
      ok: true,
      code: String(otp),
      verificationType: String(verificationType),
    };
  }

  return {
    ok: false,
    error: lastError || "Could not generate sign-in code",
  };
}

export async function verifyEmailOtp({ email, token, type }) {
  const url = getSupabaseUrl();
  const apikey = getSupabasePublishableKey();
  if (!url || !apikey) {
    return { ok: false, error: "Supabase publishable key not configured on server" };
  }

  const types = type ? [type, "email", "magiclink", "signup"] : ["email", "magiclink", "signup"];
  const seen = new Set();
  let lastError = null;

  for (const otpType of types) {
    if (seen.has(otpType)) continue;
    seen.add(otpType);

    const res = await fetch(`${url}/auth/v1/verify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apikey}`,
        apikey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: otpType,
        email,
        token,
      }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      lastError = body?.msg || body?.message || body?.error_description || `Verify failed (${res.status})`;
      continue;
    }

    const session = body?.session ?? body;
    if (session?.access_token) {
      return {
        ok: true,
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: session.expires_at,
          token_type: session.token_type,
          user: session.user ?? body?.user,
        },
      };
    }
    lastError = "No session returned from Supabase";
  }

  return { ok: false, error: lastError || "Invalid or expired code" };
}
