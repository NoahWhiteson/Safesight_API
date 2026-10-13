import { adminOnlyMiddleware } from "./adminGate.js";
import { getAppUserById, profileToJSON } from "./appUsers.js";
import { getSupabaseAdmin } from "./supabase.js";
import {
  automatedReply,
  presetUserMessage,
  presetsForUser,
} from "./supportAutomations.js";
import {
  insertSupportMessage,
  isSupportSchemaError,
  listSupportMessages,
  safeEnsureSupportThread,
  safeGetSupportThread,
  safeReopenThreadIfNeeded,
} from "./supportDb.js";
import { threadToJSON } from "./supportThreadStore.js";
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

function supportDbErrorResponse(res, err) {
  if (err?.code === "SUPPORT_DB" || isSupportSchemaError(err)) {
    return res.status(503).json({
      error: "Support chat isn’t available yet. Please try again later.",
      code: "SS-SRV-001",
      detail: err?.message,
    });
  }
  return null;
}

export function mountSupportRoutes(app, { requireAuth }) {
  app.get("/v1/support/context", requireAuth, async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.status(403).json({ error: "Sign in required", code: "SS-AUTH-002" });
      }
      const userId = req.supabaseCtx.userClaims.id;
      const admin = getSupabaseAdmin();
      const row = await getAppUserById(admin, userId);
      if (!row) {
        return res.status(404).json({ error: "Profile not found" });
      }
      const thread =
        (await safeGetSupportThread(admin, userId)) ||
        (await safeEnsureSupportThread(admin, userId));
      return res.json({
        thread: threadToJSON(thread),
        presets: presetsForUser(row),
        profile: profileToJSON(row),
      });
    } catch (err) {
      console.error("support context:", err?.message || err);
      const db = supportDbErrorResponse(res, err);
      if (db) return db;
      return res.status(502).json({ error: "Could not load support", code: "SS-SRV-001" });
    }
  });

  app.get("/v1/support/messages", requireAuth, async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.status(403).json({ error: "Sign in required", code: "SS-AUTH-002" });
      }
      const userId = req.supabaseCtx.userClaims.id;
      const admin = getSupabaseAdmin();
      const since = String(req.query.since || "").trim();

      const data = await listSupportMessages(admin, userId, { since, limit: 200 });

      try {
        await admin
          .from("support_messages")
          .update({ read_by_user_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("sender_role", "admin")
          .is("read_by_user_at", null);
      } catch {
        /* ignore */
      }

      const thread =
        (await safeGetSupportThread(admin, userId)) ||
        (await safeEnsureSupportThread(admin, userId));

      return res.json({
        messages: data.map(messageToJSON),
        thread: threadToJSON(thread),
      });
    } catch (err) {
      console.error("support messages list:", err?.message || err);
      const db = supportDbErrorResponse(res, err);
      if (db) return db;
      return res.status(502).json({ error: "Could not load support chat", code: "SS-SRV-001" });
    }
  });

  app.post("/v1/support/preset", requireAuth, async (req, res) => {
    try {
      if (req.authKind !== "supabase_user" || !req.supabaseCtx?.userClaims?.id) {
        return res.status(403).json({ error: "Sign in required", code: "SS-AUTH-002" });
      }
      const userId = req.supabaseCtx.userClaims.id;
      const presetId = String(req.body?.preset_id || "").trim();
      if (!presetId) {
        return res.status(400).json({ error: "Missing preset_id" });
      }

      const admin = getSupabaseAdmin();
      const row = await getAppUserById(admin, userId);
      if (!row) return res.status(404).json({ error: "Profile not found" });

      const allowed = presetsForUser(row).some((p) => p.id === presetId);
      if (!allowed) {
        return res.status(400).json({ error: "Unknown preset for your account" });
      }

      await safeReopenThreadIfNeeded(admin, userId);

      const userMsg = await insertSupportMessage(admin, {
        userId,
        senderRole: "user",
        body: presetUserMessage(presetId),
      });

      const systemBody = automatedReply(presetId, row);
      const systemMsg = await insertSupportMessage(admin, {
        userId,
        senderRole: "system",
        body: systemBody,
      });

      const thread = await safeGetSupportThread(admin, userId);

      return res.json({
        messages: [messageToJSON(userMsg), messageToJSON(systemMsg)],
        thread: threadToJSON(thread),
      });
    } catch (err) {
      console.error("support preset:", err?.message || err);
      const db = supportDbErrorResponse(res, err);
      if (db) return db;
      return res.status(502).json({ error: "Could not run preset", code: "SS-SRV-001" });
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
      await safeReopenThreadIfNeeded(admin, userId);

      const data = await insertSupportMessage(admin, {
        userId,
        senderRole: "user",
        body,
      });

      const thread = await safeGetSupportThread(admin, userId);

      return res.json({
        message: messageToJSON(data),
        thread: threadToJSON(thread),
      });
    } catch (err) {
      console.error("support message send:", err?.message || err);
      const db = supportDbErrorResponse(res, err);
      if (db) return db;
      return res.status(502).json({ error: "Could not send message", code: "SS-SRV-001" });
    }
  });

  const adminRouter = express.Router();
  adminRouter.use(requireAuth);
  adminRouter.use(adminOnlyMiddleware());

  adminRouter.get("/threads", async (req, res) => {
    try {
      const { admin } = req.adminCtx;
      const statusFilter = String(req.query.status || "all").trim();

      let threadsRows = [];
      const { data: tr, error: threadErr } = await admin
        .from("support_threads")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (threadErr && !isSupportSchemaError(threadErr)) throw threadErr;
      if (tr) threadsRows = tr;

      let recentMsgs = [];
      const { data: msgs, error } = await admin
        .from("support_messages")
        .select("user_id, body, created_at, sender_role")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error && !isSupportSchemaError(error)) throw error;
      if (msgs) recentMsgs = msgs;

      const lastByUser = new Map();
      for (const row of recentMsgs) {
        if (!lastByUser.has(row.user_id)) {
          lastByUser.set(row.user_id, row);
        }
      }

      const userIds = new Set([
        ...(threadsRows || []).map((t) => t.user_id),
        ...lastByUser.keys(),
      ]);

      let usersById = new Map();
      if (userIds.size) {
        let users = [];
        const { data: u1, error: uErr } = await admin
          .from("app_users")
          .select("id, email, plan, is_banned")
          .in("id", [...userIds]);
        if (uErr && isSupportSchemaError(uErr)) {
          const { data: u2 } = await admin
            .from("app_users")
            .select("id, email, plan")
            .in("id", [...userIds]);
          users = u2 || [];
        } else {
          if (uErr) throw uErr;
          users = u1 || [];
        }
        for (const u of users) {
          usersById.set(u.id, u);
        }
      }

      const threads = [];
      for (const uid of userIds) {
        const u = usersById.get(uid);
        const last = lastByUser.get(uid);
        const tr = (threadsRows || []).find((t) => t.user_id === uid) || {
          user_id: uid,
          status: "open",
          closed_at: null,
          updated_at: last?.created_at ?? null,
        };
        if (statusFilter === "open" && tr.status !== "open") continue;
        if (statusFilter === "closed" && tr.status !== "closed") continue;

        threads.push({
          user_id: uid,
          email: u?.email ?? null,
          plan: u?.plan ?? "free",
          is_banned: Boolean(u?.is_banned),
          status: tr.status,
          closed_at: tr.closed_at,
          updated_at: tr.updated_at,
          last_message: last?.body ?? "",
          last_sender_role: last?.sender_role ?? "user",
          last_at: last?.created_at ?? tr.updated_at,
        });
      }

      threads.sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime());

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

      const data = await listSupportMessages(admin, userId, { limit: 300 });

      try {
        await admin
          .from("support_messages")
          .update({ read_by_admin_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("sender_role", "user")
          .is("read_by_admin_at", null);
      } catch {
        /* ignore */
      }

      const userRow = await getAppUserById(admin, userId);
      const thread =
        (await safeGetSupportThread(admin, userId)) ||
        (await safeEnsureSupportThread(admin, userId));

      return res.json({
        messages: (data || []).map(messageToJSON),
        thread: threadToJSON(thread),
        profile: userRow ? profileToJSON(userRow) : null,
      });
    } catch (err) {
      console.error("admin support messages:", err?.message || err);
      return res.status(502).json({ error: "Could not load messages" });
    }
  });

  adminRouter.patch("/users/:userId/thread", async (req, res) => {
    try {
      const { admin } = req.adminCtx;
      const userId = String(req.params.userId || "").trim();
      const status = String(req.body?.status || "").trim();
      if (!userId) return res.status(400).json({ error: "Missing user id" });
      if (!["open", "closed"].includes(status)) {
        return res.status(400).json({ error: "status must be open or closed" });
      }

      await safeEnsureSupportThread(admin, userId);
      const now = new Date().toISOString();
      const patch = {
        status,
        updated_at: now,
        closed_at: status === "closed" ? now : null,
      };

      let data = syntheticThreadRow(userId, patch);
      const { data: updated, error } = await admin
        .from("support_threads")
        .update(patch)
        .eq("user_id", userId)
        .select("*")
        .single();
      if (!error && updated) data = updated;
      if (error && !isSupportSchemaError(error)) throw error;

      if (status === "closed") {
        await insertSupportMessage(admin, {
          userId,
          senderRole: "system",
          body:
            "This support request was closed by our team. Tap a topic above or send a message to reopen.",
        });
      } else {
        await insertSupportMessage(admin, {
          userId,
          senderRole: "system",
          body: "Support request reopened — an agent can assist you here.",
        });
      }

      return res.json({ thread: threadToJSON(data) });
    } catch (err) {
      console.error("admin support thread patch:", err?.message || err);
      return res.status(502).json({ error: "Could not update thread" });
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

      await safeReopenThreadIfNeeded(admin, userId);

      const data = await insertSupportMessage(admin, {
        userId,
        senderRole: "admin",
        body,
      });

      const thread = await safeGetSupportThread(admin, userId);

      return res.json({
        message: messageToJSON(data),
        thread: threadToJSON(thread),
      });
    } catch (err) {
      console.error("admin support reply:", err?.message || err);
      return res.status(502).json({ error: "Could not send reply" });
    }
  });

  app.use("/v1/admin/support", adminRouter);
}

function syntheticThreadRow(userId, patch) {
  return {
    user_id: userId,
    status: patch.status,
    closed_at: patch.closed_at,
    updated_at: patch.updated_at,
  };
}
