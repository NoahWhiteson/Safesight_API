import { adminOnlyMiddleware } from "./adminGate.js";
import { getAppUserById } from "./appUsers.js";
import { getSupabaseAdmin } from "./supabase.js";
import express from "express";

function messageToJSON(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    sender_role: row.sender_role,
    body: row.body,
    created_at: row.created_at,
    read_by_user_at: row.read_by_user_at,
    read_by_admin_at: row.read_by_admin_at,
  };
}

export function mountSupportRoutes(app, { requireAuth }) {
  app.get("/v1/support/messages", requireAuth, async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.status(403).json({ error: "Sign in required", code: "SS-AUTH-002" });
      }
      const userId = req.supabaseCtx.userClaims.id;
      const admin = getSupabaseAdmin();
      const since = String(req.query.since || "").trim();

      let query = admin
        .from("support_messages")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (since) {
        query = query.gt("created_at", since);
      }

      const { data, error } = await query;
      if (error) throw error;

      await admin
        .from("support_messages")
        .update({ read_by_user_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("sender_role", "admin")
        .is("read_by_user_at", null);

      return res.json({ messages: (data || []).map(messageToJSON) });
    } catch (err) {
      console.error("support messages list:", err?.message || err);
      return res.status(502).json({ error: "Could not load support chat", code: "SS-SRV-001" });
    }
  });

  app.post("/v1/support/messages", requireAuth, async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.status(403).json({ error: "Sign in required", code: "SS-AUTH-002" });
      }
      const userId = req.supabaseCtx.userClaims.id;
      const body = String(req.body?.body || "").trim();
      if (!body || body.length > 4000) {
        return res.status(400).json({ error: "Message must be 1–4000 characters." });
      }

      const admin = getSupabaseAdmin();
      const { data, error } = await admin
        .from("support_messages")
        .insert({
          user_id: userId,
          sender_role: "user",
          body,
        })
        .select("*")
        .single();
      if (error) throw error;

      return res.json({ message: messageToJSON(data) });
    } catch (err) {
      console.error("support message send:", err?.message || err);
      return res.status(502).json({ error: "Could not send message", code: "SS-SRV-001" });
    }
  });

  const adminRouter = express.Router();
  adminRouter.use(requireAuth);
  adminRouter.use(adminOnlyMiddleware());

  adminRouter.get("/threads", async (req, res) => {
    try {
      const { admin } = req.adminCtx;
      const { data, error } = await admin
        .from("support_messages")
        .select("user_id, body, created_at, sender_role")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const byUser = new Map();
      for (const row of data || []) {
        const uid = row.user_id;
        if (byUser.has(uid)) continue;
        byUser.set(uid, {
          user_id: uid,
          last_message: row.body,
          last_sender_role: row.sender_role,
          last_at: row.created_at,
        });
      }

      const userIds = [...byUser.keys()];
      if (userIds.length) {
        const { data: users } = await admin
          .from("app_users")
          .select("id, email, plan, is_banned")
          .in("id", userIds);
        for (const u of users || []) {
          const t = byUser.get(u.id);
          if (t) {
            t.email = u.email;
            t.plan = u.plan;
            t.is_banned = Boolean(u.is_banned);
          }
        }
      }

      for (const t of byUser.values()) {
        if (t.email === undefined) t.email = null;
        if (t.plan === undefined) t.plan = "free";
        if (t.is_banned === undefined) t.is_banned = false;
      }

      const threads = [...byUser.values()].sort(
        (a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime()
      );
      return res.json({ threads });
    } catch (err) {
      console.error("admin support threads:", err?.message || err);
      return res.status(502).json({ error: "Could not load support threads" });
    }
  });

  adminRouter.get("/users/:userId/messages", async (req, res) => {
    try {
      const { admin } = req.adminCtx;
      const userId = String(req.params.userId || "").trim();
      if (!userId) return res.status(400).json({ error: "Missing user id" });

      const { data, error } = await admin
        .from("support_messages")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .limit(300);
      if (error) throw error;

      await admin
        .from("support_messages")
        .update({ read_by_admin_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("sender_role", "user")
        .is("read_by_admin_at", null);

      const userRow = await getAppUserById(admin, userId);

      return res.json({
        messages: (data || []).map(messageToJSON),
        user: userRow
          ? { id: userRow.id, email: userRow.email, plan: userRow.plan, is_banned: userRow.is_banned }
          : null,
      });
    } catch (err) {
      console.error("admin support messages:", err?.message || err);
      return res.status(502).json({ error: "Could not load messages" });
    }
  });

  adminRouter.post("/users/:userId/messages", async (req, res) => {
    try {
      const { admin } = req.adminCtx;
      const userId = String(req.params.userId || "").trim();
      const body = String(req.body?.body || "").trim();
      if (!userId) return res.status(400).json({ error: "Missing user id" });
      if (!body || body.length > 4000) {
        return res.status(400).json({ error: "Message must be 1–4000 characters." });
      }

      const { data, error } = await admin
        .from("support_messages")
        .insert({
          user_id: userId,
          sender_role: "admin",
          body,
        })
        .select("*")
        .single();
      if (error) throw error;

      return res.json({ message: messageToJSON(data) });
    } catch (err) {
      console.error("admin support reply:", err?.message || err);
      return res.status(502).json({ error: "Could not send reply" });
    }
  });

  app.use("/v1/admin/support", adminRouter);
}
