import crypto from "crypto";

const TTL_MS = 3 * 60 * 60 * 1000;
const MAX_ROOM_CAP = 8;
const sessions = new Map();

function purgeExpired() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(id);
  }
}

export function createVideoScanSession(userId, maxRooms) {
  purgeExpired();
  const id = crypto.randomUUID();
  const cap = Math.min(MAX_ROOM_CAP, Math.max(1, Math.floor(Number(maxRooms) || 1)));
  const session = {
    userId: String(userId),
    maxRooms: cap,
    usedRooms: 0,
    expiresAt: Date.now() + TTL_MS,
  };
  sessions.set(id, session);
  return { id, maxRooms: cap };
}

/**
 * Validates session and increments room analyze count (photo quota skipped).
 * Returns false if invalid or exhausted.
 */
export function consumeVideoRoomAnalyze(sessionId, userId) {
  purgeExpired();
  const id = String(sessionId || "").trim();
  if (!id) return { ok: false, reason: "missing_session" };
  const session = sessions.get(id);
  if (!session) return { ok: false, reason: "invalid_session" };
  if (session.userId !== String(userId)) return { ok: false, reason: "session_user_mismatch" };
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return { ok: false, reason: "session_expired" };
  }
  if (session.usedRooms >= session.maxRooms) {
    return { ok: false, reason: "session_room_limit" };
  }
  session.usedRooms += 1;
  return { ok: true, remaining: session.maxRooms - session.usedRooms };
}
