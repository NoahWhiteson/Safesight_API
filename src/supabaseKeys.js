/** Resolve Supabase URL + keys (supports legacy env names). */
export function getSupabaseUrl() {
  return (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
}

export function getSupabaseSecretKey() {
  const direct = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "")
    .trim()
    .replace(/^['"]|['"]$/g, "");
  if (direct) return direct;
  const raw = (process.env.SUPABASE_SECRET_KEYS || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return String(parsed.default || Object.values(parsed)[0] || "").trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function getSupabasePublishableKey() {
  const direct = (process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (direct) return direct;
  const anon = (process.env.SUPABASE_ANON_KEY || "").trim();
  if (anon) return anon;
  const raw = (process.env.SUPABASE_PUBLISHABLE_KEYS || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return String(parsed.default || Object.values(parsed)[0] || "").trim();
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function hasSupabaseAdminConfig() {
  return Boolean(getSupabaseUrl() && getSupabaseSecretKey());
}

export function hasSupabasePublishableConfig() {
  return Boolean(getSupabaseUrl() && getSupabasePublishableKey());
}
