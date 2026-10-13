export async function ensureSupportThread(admin, userId) {
  const { data: existing } = await admin
    .from("support_threads")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) return existing;

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("support_threads")
    .insert({
      user_id: userId,
      status: "open",
      created_at: now,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getSupportThread(admin, userId) {
  const { data, error } = await admin
    .from("support_threads")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function reopenThreadIfNeeded(admin, userId) {
  const thread = await ensureSupportThread(admin, userId);
  if (thread.status === "open") return thread;

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("support_threads")
    .update({
      status: "open",
      closed_at: null,
      updated_at: now,
    })
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export function threadToJSON(row) {
  if (!row) {
    return { status: "open", closed_at: null, updated_at: null };
  }
  return {
    status: row.status,
    closed_at: row.closed_at,
    updated_at: row.updated_at,
  };
}
