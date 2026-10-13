import crypto from "crypto";
import { timingSafeEqualString } from "./authMiddleware.js";
import { ensureAppUser, profileToJSON } from "./appUsers.js";
import { isResendConfigured, otpExpiresMinutes, sendLoginCodeEmail } from "./resendOtpEmail.js";
import { issueSupabaseSessionForEmail } from "./supabaseAuthApi.js";
import { hasSupabaseAdminConfig, hasSupabasePublishableConfig } from "./supabaseKeys.js";
import { isSupabaseConfigured } from "./supabase.js";

const OTP_SEND_WINDOW_MS = 15 * 60 * 1000;
const OTP_SEND_MAX_PER_EMAIL = 3;
const OTP_SEND_MAX_PER_IP = 12;
const OTP_CODE_TTL_MS = otpExpiresMinutes() * 60 * 1000;
const OTP_MAX_ATTEMPTS = 8;

/** email -> { codeHash, expiresAt, attempts } */
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

function otpPepper() {
  return (
    process.env.SAFESIGHT_OTP_PEPPER ||
    process.env.SAFESIGHT_API_SECRET ||
    "safesight-otp-pepper"
  );
}

function hashOtpCode(code) {
  return crypto.createHash("sha256").update(`${code}:${otpPepper()}`).digest("hex");
}

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
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

export function mountAuthOtpRoutes(app, { clientIp }) {
  app.post("/v1/auth/otp/send", (req, res) => {
    void handleOtpSend(req, res, { clientIp }).catch((err) => {
      console.error("otp send unhandled:", err?.message || err);
      if (!res.headersSent) {
        res.status(502).json({
          error: "Could not send sign-in code",
          detail: err?.message || "unknown",
        });
      }
    });
  });

  app.post("/v1/auth/otp/verify", (req, res) => {
    void handleOtpVerify(req, res).catch((err) => {
      console.error("otp verify unhandled:", err?.message || err);
      if (!res.headersSent) {
        res.status(502).json({
          error: "Could not verify code",
          detail: err?.message || "unknown",
        });
      }
    });
  });
}

async function handleOtpSend(req, res, { clientIp }) {
  try {
    if (!isSupabaseConfigured() || !hasSupabaseAdminConfig()) {
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

    const code = generateSixDigitCode();
    pendingVerification.set(email, {
      codeHash: hashOtpCode(code),
      expiresAt: Date.now() + OTP_CODE_TTL_MS,
      attempts: 0,
    });

    await sendLoginCodeEmail({ to: email, code });

    return res.json({ ok: true });
  } catch (err) {
    console.error("otp send failed:", err?.message || err, err?.detail || "");
    return res.status(502).json({
      error: "Could not send sign-in code",
      detail: err?.message || "unknown",
    });
  }
}

async function handleOtpVerify(req, res) {
  try {
    if (!isSupabaseConfigured() || !hasSupabasePublishableConfig()) {
      return res.status(503).json({ error: "Supabase not configured on server" });
    }

    const email = normalizeEmail(req.body?.email);
    const token = String(req.body?.code ?? req.body?.token ?? "")
      .replace(/\D/g, "")
      .trim();
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email" });
    }
    if (!/^\d{6}$/.test(token)) {
      return res.status(400).json({ error: "Invalid code" });
    }

    const pending = pendingVerification.get(email);
    if (!pending) {
      return res.status(400).json({ error: "Code expired. Request a new one." });
    }
    if (Date.now() > pending.expiresAt) {
      pendingVerification.delete(email);
      return res.status(400).json({ error: "Code expired. Request a new one." });
    }

    pending.attempts += 1;
    if (pending.attempts > OTP_MAX_ATTEMPTS) {
      pendingVerification.delete(email);
      return res.status(429).json({ error: "Too many attempts. Request a new code." });
    }

    const expectedHash = pending.codeHash;
    const providedHash = hashOtpCode(token);
    if (!timingSafeEqualString(expectedHash, providedHash)) {
      return res.status(401).json({ error: "Invalid or expired code" });
    }

    pendingVerification.delete(email);

    const verified = await issueSupabaseSessionForEmail(email);
    if (!verified.ok || !verified.session) {
      return res.status(502).json({
        error: verified.error || "Could not complete sign-in. Try again.",
      });
    }

    const session = verified.session;
    const user = session.user;
    const { getSupabaseAdmin } = await import("./supabase.js");
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
}
