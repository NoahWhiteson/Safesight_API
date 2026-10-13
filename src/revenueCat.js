const ENTITLEMENT_ID = (process.env.REVENUECAT_ENTITLEMENT_ID || "safesight_pro").trim();

export function isRevenueCatConfigured() {
  return Boolean((process.env.REVENUECAT_SECRET_API_KEY || "").trim());
}

export async function fetchRevenueCatSubscriber(appUserId) {
  const secret = (process.env.REVENUECAT_SECRET_API_KEY || "").trim();
  if (!secret) {
    return { configured: false, premium: null };
  }
  const id = encodeURIComponent(String(appUserId || "").trim());
  if (!id) return { configured: true, premium: false, error: "missing_user_id" };

  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${id}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      configured: true,
      premium: false,
      error: `revenuecat_http_${res.status}`,
      detail: text.slice(0, 200),
    };
  }

  const data = await res.json();
  return { configured: true, premium: isPremiumFromSubscriberPayload(data), raw: data };
}

function isPremiumFromSubscriberPayload(payload) {
  const ent =
    payload?.subscriber?.entitlements?.[ENTITLEMENT_ID] ??
    payload?.subscriber?.entitlements?.[ENTITLEMENT_ID.toLowerCase()];
  if (!ent || typeof ent !== "object") return false;
  const expires = ent.expires_date;
  if (expires == null || expires === "") return true;
  const t = Date.parse(String(expires));
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
}
