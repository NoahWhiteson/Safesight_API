import { defaultLimitsForPlan } from "./userQuotaLimits.js";

/** Premium plan with free-tier quota columns → fix in DB. */
export async function healPremiumQuotaLimits(admin, row) {
  if (!row || row.plan !== "premium") return row;
  const limits = defaultLimitsForPlan("premium");
  const needsPhoto = Number(row.photo_quota_limit ?? 0) < 10;
  const needsVideo = Number(row.video_quota_limit ?? 0) < 1;
  if (!needsPhoto && !needsVideo) return row;

  const { data, error } = await admin
    .from("app_users")
    .update({
      photo_quota_limit: needsPhoto ? limits.photo_quota_limit : row.photo_quota_limit,
      video_quota_limit: needsVideo ? limits.video_quota_limit : row.video_quota_limit,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) {
    console.warn("healPremiumQuotaLimits:", error.message);
    return row;
  }
  return data;
}
