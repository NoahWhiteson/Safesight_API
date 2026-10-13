import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getSupabaseAdmin } from "./supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** email -> { codeHash, expiresAt, attempts } */
const memory = new Map();

let filePath = null;
let fileReady = false;
let dbCheck = { at: 0, ok: false };
let storeStatus = { memory: true, file: false, database: false };

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function resolveFilePath() {
  const fromEnv = (process.env.SAFESIGHT_OTP_STORE_PATH || "").trim();
  if (fromEnv) return fromEnv;
  return path.join(__dirname, "../.data/login_otp_codes.json");
}

function rowFromRecord(email, record) {
  if (!record?.codeHash || !record?.expiresAt) return null;
  return {
    codeHash: String(record.codeHash),
    expiresAt: Number(record.expiresAt),
    attempts: Number(record.attempts ?? 0),
  };
}

function pickNewestPending(candidates) {
  const now = Date.now();
  let best = null;
  for (const c of candidates) {
    if (!c || c.expiresAt <= now) continue;
    if (!best || c.expiresAt > best.expiresAt) best = c;
  }
  return best;
}

async function readFileStore() {
  if (!filePath) return {};
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn("login_otp file read:", err?.message || err);
    }
    return {};
  }
}

async function writeFileStore(mapObj) {
  if (!filePath) return;
  const now = Date.now();
  const pruned = {};
  for (const [email, record] of Object.entries(mapObj)) {
    if (record?.expiresAt && record.expiresAt > now) {
      pruned[email] = record;
    }
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(pruned), "utf8");
  await fs.rename(tmp, filePath);
  fileReady = true;
  storeStatus.file = true;
}

async function memoryAndFileSnapshot() {
  const fileObj = await readFileStore();
  return { memory, fileObj };
}

async function canUseDbOtp() {
  const now = Date.now();
  if (now - dbCheck.at < 30_000) return dbCheck.ok;

  let ok = false;
  try {
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("login_otp_codes").select("email").limit(1);
    if (error) {
      if (/relation|does not exist|login_otp_codes/i.test(error.message || "")) {
        console.warn(
          "login_otp_codes table missing — run supabase/migrations/20260313000000_login_otp_codes.sql"
        );
      } else {
        console.warn("login_otp_codes probe:", error.message);
      }
    } else {
      ok = true;
      storeStatus.database = true;
    }
  } catch (err) {
    console.warn("login_otp_codes probe failed:", err?.message || err);
  }

  dbCheck = { at: now, ok };
  return ok;
}

async function readDbOtp(email) {
  if (!(await canUseDbOtp())) return null;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("login_otp_codes")
    .select("code_hash, expires_at, attempts")
    .eq("email", email)
    .maybeSingle();
  if (error) {
    console.warn("login_otp_codes read:", error.message);
    return null;
  }
  if (!data) return null;
  return rowFromRecord(email, {
    codeHash: data.code_hash,
    expiresAt: new Date(data.expires_at).getTime(),
    attempts: data.attempts,
  });
}

export function getOtpStoreStatus() {
  return { ...storeStatus };
}

export async function initOtpStore() {
  filePath = resolveFilePath();
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const fileObj = await readFileStore();
    const now = Date.now();
    for (const [email, record] of Object.entries(fileObj)) {
      const row = rowFromRecord(email, record);
      if (row && row.expiresAt > now) {
        memory.set(normalizeEmail(email), row);
      }
    }
    if (Object.keys(fileObj).length) fileReady = true;
    storeStatus.file = fileReady;
  } catch (err) {
    console.warn("OTP file store init:", err?.message || err);
  }
  await canUseDbOtp();
  console.log(
    `OTP store: memory=on file=${storeStatus.file ? "on" : "off"} db=${storeStatus.database ? "on" : "off"}`
  );
}

export async function savePendingOtp(email, { codeHash, expiresAt, attempts = 0 }) {
  const key = normalizeEmail(email);
  const record = {
    codeHash: String(codeHash),
    expiresAt: Number(expiresAt),
    attempts: Number(attempts),
  };
  memory.set(key, record);

  const { fileObj } = await memoryAndFileSnapshot();
  fileObj[key] = record;
  try {
    await writeFileStore(fileObj);
  } catch (err) {
    console.error("login_otp file write failed:", err?.message || err);
  }

  if (!(await canUseDbOtp())) return;

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("login_otp_codes").upsert(
    {
      email: key,
      code_hash: record.codeHash,
      expires_at: new Date(record.expiresAt).toISOString(),
      attempts: record.attempts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" }
  );
  if (error) {
    console.error("login_otp_codes upsert failed:", error.message);
    dbCheck = { at: 0, ok: false };
  }
}

export async function loadPendingOtp(email) {
  const key = normalizeEmail(email);
  const fromMem = memory.get(key) ?? null;

  let fromFile = null;
  const fileObj = await readFileStore();
  if (fileObj[key]) {
    fromFile = rowFromRecord(key, fileObj[key]);
    if (fromFile) memory.set(key, fromFile);
  }

  const fromDb = await readDbOtp(key);

  const pending = pickNewestPending([fromMem, fromFile, fromDb]);
  if (pending) {
    memory.set(key, pending);
  }
  return pending;
}

export async function updateOtpAttempts(email, attempts) {
  const key = normalizeEmail(email);
  const existing = (await loadPendingOtp(key)) ?? memory.get(key);
  if (!existing) return;

  const record = { ...existing, attempts: Number(attempts) };
  memory.set(key, record);

  const fileObj = await readFileStore();
  fileObj[key] = record;
  try {
    await writeFileStore(fileObj);
  } catch (err) {
    console.warn("login_otp file update:", err?.message || err);
  }

  if (!(await canUseDbOtp())) return;

  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("login_otp_codes")
    .update({ attempts: record.attempts, updated_at: new Date().toISOString() })
    .eq("email", key);
  if (error) {
    console.warn("login_otp_codes update attempts:", error.message);
  }
}

export async function deletePendingOtp(email) {
  const key = normalizeEmail(email);
  memory.delete(key);

  const fileObj = await readFileStore();
  delete fileObj[key];
  try {
    await writeFileStore(fileObj);
  } catch (err) {
    console.warn("login_otp file delete:", err?.message || err);
  }

  if (!(await canUseDbOtp())) return;

  const admin = getSupabaseAdmin();
  await admin.from("login_otp_codes").delete().eq("email", key);
}
