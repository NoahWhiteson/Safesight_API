import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "./supabase.js";
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

/** After the user proves they received our 6-digit email, mint a Supabase session server-side. */
export async function issueSupabaseSessionForEmail(email) {
  const url = getSupabaseUrl();
  const publishable = getSupabasePublishableKey();
  if (!url || !publishable) {
    return { ok: false, error: "Supabase publishable key not configured on server" };
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return { ok: false, error: err?.message || "Supabase admin not configured on server" };
  }

  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr && !/already|registered|exists/i.test(createErr.message || "")) {
    console.warn("createUser before session:", createErr.message);
  }

  const authClient = createClient(url, publishable, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  function sessionFromVerifyData(data) {
    const session = data?.session;
    if (!session?.access_token) return null;
    return {
      ok: true,
      session: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        token_type: session.token_type,
        user: session.user ?? data?.user,
      },
    };
  }

  const linkTypes = ["magiclink", "signup"];
  let otp = null;
  let tokenHash = null;
  let verificationType = "magiclink";
  let lastLinkError = null;

  for (const type of linkTypes) {
    const { data, error } = await admin.auth.admin.generateLink({ type, email });
    if (error) {
      lastLinkError = error.message;
      continue;
    }
    const props = data?.properties ?? data;
    tokenHash = props?.hashed_token ?? data?.hashed_token ?? null;
    otp = props?.email_otp ?? data?.email_otp ?? null;
    verificationType =
      props?.verification_type ??
      data?.verification_type ??
      (type === "signup" ? "signup" : "magiclink");

    if (tokenHash || otp) break;
  }

  if (tokenHash) {
    const hashTypes = [verificationType, "magiclink", "signup", "email"];
    const seenHash = new Set();
    for (const otpType of hashTypes) {
      if (seenHash.has(otpType)) continue;
      seenHash.add(otpType);
      const { data, error } = await authClient.auth.verifyOtp({
        type: otpType,
        token_hash: String(tokenHash),
      });
      if (error) {
        lastLinkError = error.message;
        continue;
      }
      const packed = sessionFromVerifyData(data);
      if (packed) return packed;
    }
  }

  if (!otp) {
    const fallback = await adminGenerateEmailOtp(email);
    if (!fallback.ok) {
      return {
        ok: false,
        error: lastLinkError || fallback.error || "Could not complete sign-in",
      };
    }
    otp = fallback.code;
    verificationType = fallback.verificationType;
  }

  const otpTypes = [verificationType, "email", "magiclink", "signup"];
  const seen = new Set();
  let lastVerifyError = lastLinkError;

  for (const otpType of otpTypes) {
    if (seen.has(otpType)) continue;
    seen.add(otpType);

    const { data, error } = await authClient.auth.verifyOtp({
      email,
      token: String(otp),
      type: otpType,
    });
    if (error) {
      lastVerifyError = error.message;
      continue;
    }
    const packed = sessionFromVerifyData(data);
    if (packed) return packed;
    lastVerifyError = "No session returned from Supabase";
  }

  const rawVerify = await verifyEmailOtp({
    email,
    token: String(otp),
    type: verificationType,
  });
  if (rawVerify.ok) return rawVerify;

  return {
    ok: false,
    error: lastVerifyError || rawVerify.error || "Could not complete sign-in",
  };
}
