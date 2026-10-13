export function defaultLimitsForPlan(plan) {
  if (plan === "premium") {
    return { photo_quota_limit: 85, video_quota_limit: 2 };
  }
  return { photo_quota_limit: 2, video_quota_limit: 0 };
}

export function effectivePhotoLimit(row) {
  const n = Number(row?.photo_quota_limit);
  if (Number.isFinite(n) && n >= 0) return n;
  return defaultLimitsForPlan(row?.plan).photo_quota_limit;
}

export function effectiveVideoLimit(row) {
  const n = Number(row?.video_quota_limit);
  if (Number.isFinite(n) && n >= 0) return n;
  return defaultLimitsForPlan(row?.plan).video_quota_limit;
}
