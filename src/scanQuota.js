import {
  assertPhotoQuota,
  assertVideoQuota,
  consumePhotoScan,
  consumeVideoScan,
} from "./quota.js";
import { consumeVideoRoomAnalyze } from "./videoScanSessions.js";

export function scanUserFromRequest(req) {
  if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
    return null;
  }
  return {
    userId: req.supabaseCtx.userClaims.id,
    email: req.supabaseCtx.userClaims.email || "",
  };
}

export function videoSessionIdFromAnalyzeRequest(req, meta) {
  const header = String(req.get("x-video-scan-session") || "").trim();
  const fromMeta = String(meta?.video_scan_session_id || meta?.videoScanSessionId || "").trim();
  return header || fromMeta;
}

export async function beginPhotoScan(admin, user) {
  return consumePhotoScan(admin, user.userId, user.email);
}

export async function beginVideoScan(admin, user) {
  return consumeVideoScan(admin, user.userId, user.email);
}

export async function guardPhotoScan(admin, user) {
  return assertPhotoQuota(admin, user.userId, user.email);
}

export async function guardVideoScan(admin, user) {
  return assertVideoQuota(admin, user.userId, user.email);
}

export function tryConsumeVideoRoomSession(sessionId, userId) {
  const result = consumeVideoRoomAnalyze(sessionId, userId);
  if (!result.ok) {
    const messages = {
      missing_session: "Video room session required.",
      invalid_session: "Invalid or expired video session.",
      session_user_mismatch: "Video session does not match this account.",
      session_expired: "Video session expired. Record a new walkthrough.",
      session_room_limit: "This video walkthrough has no room analyzes left.",
    };
    return {
      ok: false,
      status: 403,
      error: messages[result.reason] || "Video room not allowed.",
    };
  }
  return { ok: true };
}
