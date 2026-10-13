import {
  ensureSupportThread,
  getSupportThread,
  reopenThreadIfNeeded,
} from "./supportThreadStore.js";

export function isSupportSchemaError(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return (
    /support_threads|support_messages|relation.*does not exist|schema cache|could not find the table/i.test(
      m
    ) || /is_banned/.test(m)
  );
}

export function isSenderRoleError(err) {
  const m = String(err?.message || err || "").toLowerCase();
  return /sender_role|check constraint/.test(m);
}

const syntheticOpenThread = (userId) => ({
  user_id: userId,
  status: "open",
  closed_at: null,
  updated_at: null,
});

export async function safeGetSupportThread(admin, userId) {
  try {
    return await getSupportThread(admin, userId);
  } catch (err) {
    if (isSupportSchemaError(err)) return null;
    throw err;
  }
}

export async function safeEnsureSupportThread(admin, userId) {
  try {
    return await ensureSupportThread(admin, userId);
  } catch (err) {
    if (isSupportSchemaError(err)) return syntheticOpenThread(userId);
    throw err;
  }
}

export async function safeReopenThreadIfNeeded(admin, userId) {
  try {
    return await reopenThreadIfNeeded(admin, userId);
  } catch (err) {
    if (isSupportSchemaError(err)) return syntheticOpenThread(userId);
    throw err;
  }
}

export async function touchSupportThreadUpdatedAt(admin, userId) {
  try {
    await admin
      .from("support_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  } catch {
    /* optional table */
  }
}

export async function insertSupportMessage(admin, { userId, senderRole, body }) {
  await safeEnsureSupportThread(admin, userId);

  const insertOnce = async (role, text) => {
    const { data, error } = await admin
      .from("support_messages")
      .insert({
        user_id: userId,
        sender_role: role,
        body: text,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  };

  try {
    const data = await insertOnce(senderRole, body);
    await touchSupportThreadUpdatedAt(admin, userId);
    return data;
  } catch (err) {
    if (senderRole === "system" && isSenderRoleError(err)) {
      const data = await insertOnce("admin", `Safesight (automated)\n${body}`);
      await touchSupportThreadUpdatedAt(admin, userId);
      return data;
    }
    if (isSupportSchemaError(err)) {
      const e = new Error(
        "Support chat is not set up on the server database yet. Run the support SQL migration in Supabase."
      );
      e.code = "SUPPORT_DB";
      throw e;
    }
    throw err;
  }
}

export async function listSupportMessages(admin, userId, { since, limit = 200 } = {}) {
  let query = admin
    .from("support_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (since) query = query.gt("created_at", since);

  const { data, error } = await query;
  if (error) {
    if (isSupportSchemaError(error)) return [];
    throw error;
  }
  return data || [];
}
