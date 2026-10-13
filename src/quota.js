import { ensureAppUser, getAppUserById, profileToJSON } from "./appUsers.js";
import { resolvedQuotaLimits } from "./userQuotaLimits.js";

export function enrichProfile(row) {
  return profileToJSON(row);
}

async function loadUserRow(admin, userId, email) {
  let row = await getAppUserById(admin, userId);
  if (!row) {
    row = await ensureAppUser(admin, { userId, email: email || "" });
  }
  return row;
}

export async function assertPhotoQuota(admin, userId, email) {
  const row = await loadUserRow(admin, userId, email);
  const limit = resolvedQuotaLimits(row).photo_quota_limit;
  const used = Number(row.photo_scans_used ?? 0);
  if (used >= limit) {
    return {
      ok: false,
      status: 429,
      error: "Photo scan quota exceeded for this period.",
      profile: enrichProfile(row),
    };
  }
  return { ok: true, profile: enrichProfile(row) };
}

export async function assertVideoQuota(admin, userId, email) {
  const row = await loadUserRow(admin, userId, email);
  const limit = resolvedQuotaLimits(row).video_quota_limit;
  if (limit <= 0) {
    return {
      ok: false,
      status: 403,
      error: "Video scans require Premium.",
      profile: enrichProfile(row),
    };
  }
  const used = Number(row.video_scans_used ?? 0);
  if (used >= limit) {
    return {
      ok: false,
      status: 429,
      error: "Video scan quota exceeded for this period.",
      profile: enrichProfile(row),
    };
  }
  return { ok: true, profile: enrichProfile(row) };
}

async function incrementColumn(admin, userId, column, expectedUsed) {
  const next = expectedUsed + 1;
  const { data, error } = await admin
    .from("app_users")
    .update({
      [column]: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .eq(column, expectedUsed)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function consumePhotoScan(admin, userId, email) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await loadUserRow(admin, userId, email);
    const limit = resolvedQuotaLimits(row).photo_quota_limit;
    const used = Number(row.photo_scans_used ?? 0);
    if (used >= limit) {
      return {
        ok: false,
        status: 429,
        error: "Photo scan quota exceeded for this period.",
        profile: enrichProfile(row),
      };
    }
    const updated = await incrementColumn(admin, userId, "photo_scans_used", used);
    if (updated) {
      return { ok: true, profile: enrichProfile(updated) };
    }
  }
  const row = await loadUserRow(admin, userId, email);
  return {
    ok: false,
    status: 409,
    error: "Could not update scan quota. Try again.",
    profile: enrichProfile(row),
  };
}

export async function consumeVideoScan(admin, userId, email) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await loadUserRow(admin, userId, email);
    const limit = resolvedQuotaLimits(row).video_quota_limit;
    const used = Number(row.video_scans_used ?? 0);
    if (limit <= 0) {
      return {
        ok: false,
        status: 403,
        error: "Video scans require Premium.",
        profile: enrichProfile(row),
      };
    }
    if (used >= limit) {
      return {
        ok: false,
        status: 429,
        error: "Video scan quota exceeded for this period.",
        profile: enrichProfile(row),
      };
    }
    const updated = await incrementColumn(admin, userId, "video_scans_used", used);
    if (updated) {
      return { ok: true, profile: enrichProfile(updated) };
    }
  }
  const row = await loadUserRow(admin, userId, email);
  return {
    ok: false,
    status: 409,
    error: "Could not update video quota. Try again.",
    profile: enrichProfile(row),
  };
}
