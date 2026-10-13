import { profileToJSON } from "./appUsers.js";
import { resolvedQuotaLimits } from "./userQuotaLimits.js";

export const SUPPORT_PRESETS = [
  { id: "account_status", label: "What is my account status?" },
  { id: "photo_quota", label: "Photo scan quota" },
  { id: "video_quota", label: "Video walkthrough quota" },
  { id: "premium_help", label: "Premium not working" },
  { id: "session_help", label: "Sign-in / session help" },
  { id: "ban_appeal", label: "Why is my account suspended?" },
  { id: "talk_to_agent", label: "Talk to a person" },
];

export function presetsForUser(row) {
  const all = SUPPORT_PRESETS.filter((p) => {
    if (p.id === "ban_appeal") return Boolean(row?.is_banned);
    return true;
  });
  return all;
}

export function automatedReply(presetId, row) {
  const profile = profileToJSON(row);
  const limits = resolvedQuotaLimits(row);
  const photoUsed = Number(row.photo_scans_used ?? 0);
  const videoUsed = Number(row.video_scans_used ?? 0);
  const photoRem = Math.max(0, limits.photo_quota_limit - photoUsed);
  const videoRem = Math.max(0, limits.video_quota_limit - videoUsed);

  switch (presetId) {
    case "account_status":
      return [
        `Account status (automated)`,
        `Email: ${profile.email || "—"}`,
        `Plan: ${String(profile.plan || "free").toUpperCase()}${profile.is_admin ? " · Admin" : ""}`,
        profile.is_banned
          ? `Status: SUSPENDED${profile.ban_reason ? ` — ${profile.ban_reason}` : ""}`
          : "Status: Active — scans allowed if you have quota.",
        `Photo: ${photoUsed} used · ${photoRem} remaining (${limits.photo_quota_limit}/month)`,
        `Video: ${videoUsed} used · ${videoRem} remaining (${limits.video_quota_limit}/month)`,
        `Quota month: ${row.quota_month_key || "current"}`,
        profile.is_banned
          ? "Code SS-ACC-001 — only an admin can lift a suspension."
          : "Need more detail? Send a message below and an agent will follow up.",
      ].join("\n");

    case "photo_quota":
      return [
        "Photo scans (automated)",
        `You’ve used ${photoUsed} of ${limits.photo_quota_limit} photo scans this month.`,
        photoRem > 0
          ? `${photoRem} scan${photoRem === 1 ? "" : "s"} left before the limit.`
          : "You’re out of photo scans for this month. They reset on the 1st.",
        "Code SS-QTA-001 — open Help & error codes on the You tab for fixes.",
      ].join("\n");

    case "video_quota":
      if (limits.video_quota_limit <= 0) {
        return [
          "Video walkthroughs (automated)",
          "Your plan doesn’t include video scans (Free tier).",
          "Upgrade to Premium for monthly video walkthroughs.",
          "Code SS-QTA-003",
        ].join("\n");
      }
      return [
        "Video walkthroughs (automated)",
        `You’ve used ${videoUsed} of ${limits.video_quota_limit} video scan${limits.video_quota_limit === 1 ? "" : "s"} this month.`,
        videoRem > 0
          ? `${videoRem} walkthrough${videoRem === 1 ? "" : "s"} left.`
          : "No video scans left this month — resets on the 1st.",
        "Code SS-QTA-002",
      ].join("\n");

    case "premium_help":
      return [
        "Premium sync (automated)",
        `Server plan: ${profile.plan}`,
        `RevenueCat premium on device may differ until sync completes.`,
        "Try: You tab → pull to refresh → Restore purchases → log out and back in once.",
        "Codes SS-PRM-001, SS-PRM-003 — search them under Support.",
        "Still stuck? Message below with your Apple ID email used for purchase.",
      ].join("\n");

    case "session_help":
      return [
        "Sign-in help (automated)",
        "Safesight uses email codes — sessions expire about every hour.",
        "The app refreshes automatically when the API is up to date.",
        "If you see Invalid JWT: pull to refresh on You, or log out and request a new code.",
        "Code SS-AUTH-001",
      ].join("\n");

    case "ban_appeal":
      return [
        "Suspension (automated)",
        profile.is_banned
          ? profile.ban_reason || "Your account is suspended from scanning."
          : "Your account is not suspended on our records.",
        "Suspensions block photo and video scans only — you can still sign in.",
        "Reply below with any context; an admin will review this thread.",
        "Code SS-ACC-001",
      ].join("\n");

    case "talk_to_agent":
      return [
        "We’ve notified the queue (automated)",
        "A support agent will reply in this chat when available.",
        "Include error codes (SS-…) from Support → Error codes if you have them.",
        "Urgent safety issues: use local emergency services — Safesight is not emergency response.",
      ].join("\n");

    default:
      return "Thanks for reaching out. An agent will follow up shortly.";
  }
}

export function presetUserMessage(presetId) {
  const preset = SUPPORT_PRESETS.find((p) => p.id === presetId);
  return preset?.label || "Support request";
}
