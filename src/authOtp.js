import { createClient } from "@supabase/supabase-js";
import { resolveEnv } from "@supabase/server/core";
import { ensureAppUser, profileToJSON } from "./appUsers.js";
import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase.js";
import { isResendConfigured, otpExpiresMinutes, sendLoginCodeEmail } from "./resendOtpEmail.js";

const OTP_SEND_WINDOW_MS = 15 * 60 * 1000;
const OTP_SEND_MAX_PER_EMAIL = 3;
const OTP_SEND_MAX_PER_IP = 12;
const OTP_CODE_TTL_MS = otpExpiresMinutes() * 60 * 1000;

/** email -> { verificationType, expiresAt } */
const pendingVerification = new Map();

const sendBucketsEmail = new Map();
const sendBucketsIp = new Map();

function normalizeEmail(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

function bumpBucket(map, key, windowMs, max) {
  const now = Date.now();
  let bucket = map.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    map.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

function getSupabasePublishableClient() {
  const { data: env, error } = resolveEnv();
  if (error) {
    throw error;
  }
  const keys = env.publishableKeys ?? {};
  const apiKey = keys.default ?? Object.values(keys)[0];
  if (!apiKey) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY not configured");
  }
  return createClient(env.url, apiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function otpTypesToTry(storedType) {
  const ordered = [];
  if (storedType) ordered.push(storedType);
  for (const t of ["email", "magiclink", "signup"]) {
    if (!ordered.includes(t)) ordered.push(t);
  }
  return ordered;
}

export function mountAuthOtpRoutes(app, { clientIp }) {
  app.post("/v1/auth/otp/send", async (req, res) => {
    try {
      if (!isSupabaseConfigured()) {
        return res.status(503).json({ error: "Supabase not configured on server" });
      }
      if (!isResendConfigured()) {
        return res.status(503).json({ error: "RESEND_API_KEY not configured on server" });
      }

      const email = normalizeEmail(req.body?.email);
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Invalid email" });
      }

      const ip = clientIp(req);
      if (!bumpBucket(sendBucketsEmail, email, OTP_SEND_WINDOW_MS, OTP_SEND_MAX_PER_EMAIL)) {
        return res.status(429).json({ error: "Too many codes sent to this email. Try again later." });
      }
      if (!bumpBucket(sendBucketsIp, ip, OTP_SEND_WINDOW_MS, OTP_SEND_MAX_PER_IP)) {
        return res.status(429).json({ error: "Too many requests. Try again later." });
      }

      const admin = getSupabaseAdmin();
      const { data, error } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

      if (error) {
        console.error("generateLink failed:", error.message || error);
        return res.status(502).json({ error: "Could not start sign-in. Try again." });
      }

      const code = data?.properties?.email_otp;
      const verificationType = data?.properties?.verification_type || "email";
      if (!code) {
        console.error("generateLink missing email_otp");
        return res.status(502).json({ error: "Could not start sign-in. Try again." });
      }

      pendingVerification.set(email, {
        verificationType,
        expiresAt: Date.now() + OTP_CODE_TTL_MS,
      });

      await sendLoginCodeEmail({ to: email, code: String(code) });

      return res.json({ ok: true });
    } catch (err) {
      console.error("otp send failed:", err?.message || err, err?.detail || "");
      return res.status(502).json({
        error: "Could not send sign-in code",
        detail: err?.message || "unknown",
      });
    }
  });

  app.post("/v1/auth/otp/verify", async (req, res) => {
    try {
      if (!isSupabaseConfigured()) {
        return res.status(503).json({ error: "Supabase not configured on server" });
      }

      const email = normalizeEmail(req.body?.email);
      const token = String(req.body?.code ?? req.body?.token ?? "").trim();
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Invalid email" });
      }
      if (!/^\d{6}$/.test(token)) {
        return res.status(400).json({ error: "Invalid code" });
      }

      const pending = pendingVerification.get(email);
      if (pending && Date.now() > pending.expiresAt) {
        pendingVerification.delete(email);
        return res.status(400).json({ error: "Code expired. Request a new one." });
      }

      const client = getSupabasePublishableClient();
      const types = otpTypesToTry(pending?.verificationType);
      let session = null;
      let lastError = null;

      for (const type of types) {
        const { data, error } = await client.auth.verifyOtp({
          email,
          token,
          type,
        });
        if (!error && data?.session) {
          session = data.session;
          break;
        }
        lastError = error;
      }

      pendingVerification.delete(email);

      if (!session) {
        console.warn("verifyOtp failed:", lastError?.message || lastError);
        return res.status(401).json({ error: "Invalid or expired code" });
      }

      const user = session.user;
      const admin = getSupabaseAdmin();
      const appUser = await ensureAppUser(admin, {
        userId: user.id,
        email: user.email || email,
      });

      return res.json({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        expires_at: session.expires_at,
        token_type: session.token_type,
        user: {
          id: user.id,
          email: user.email,
        },
        profile: profileToJSON(appUser),
      });
    } catch (err) {
      console.error("otp verify failed:", err?.message || err);
      return res.status(502).json({
        error: "Could not verify code",
        detail: err?.message || "unknown",
      });
    }
  });
}
