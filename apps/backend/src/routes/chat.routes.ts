import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, asc } from "drizzle-orm";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import { conversations, messages } from "../models/index.js";
import type { AIService } from "../services/AIService.js";

const createConversationSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().max(500).optional(),
  model: z.string().optional(),
});

export function chatRoutes(app: FastifyInstance, authService: AuthService, db: Database, aiService?: AIService) {
  const auth = requireAuth(authService);

  app.post("/api/chat/conversations", { preHandler: auth }, async (request, reply) => {
    const body = createConversationSchema.parse(request.body);
    const [conversation] = await db
      .insert(conversations)
      .values({
        userId: request.user.sub,
        projectId: body.projectId,
        title: body.title || "New Conversation",
        model: body.model || "claude-sonnet-4-6",
      })
      .returning();
    return reply.status(201).send(conversation);
  });

  app.get("/api/chat/conversations", { preHandler: auth }, async (request, reply) => {
    const { limit = "20", offset = "0" } = request.query as Record<string, string>;
    const result = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.userId, request.user.sub), eq(conversations.isArchived, false)))
      .orderBy(desc(conversations.updatedAt))
      .limit(Number(limit))
      .offset(Number(offset));
    return reply.send({ data: result, total: result.length, limit: Number(limit), offset: Number(offset) });
  });

  app.get("/api/chat/conversations/:id", { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.user.sub)))
      .limit(1);

    if (!conversation) {
      return reply.status(404).send({ error: "Not found" });
    }

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    // Filter out empty assistant placeholder rows (created before streaming starts, never filled if agent was cancelled)
    const filteredMsgs = msgs.filter((m) => m.content && m.content.trim().length > 0);

    return reply.send({ conversation, messages: filteredMsgs });
  });

  app.delete("/api/chat/conversations/:id", { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await db
      .update(conversations)
      .set({ isArchived: true })
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.user.sub)));
    return reply.send({ success: true });
  });

  // Rename a conversation. Auth-gated, owner-only. Title is capped at 200
  // chars (DB column is varchar(500), but trim aggressively for UI sanity).
  // Empty / whitespace-only titles are rejected so the sidebar never ends
  // up showing a blank row.
  app.patch("/api/chat/conversations/:id", { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { title?: unknown };
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      return reply.status(400).send({ error: "title is required" });
    }
    const capped = title.length > 200 ? title.slice(0, 200) : title;
    const result = await db
      .update(conversations)
      .set({ title: capped, updatedAt: new Date() })
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.user.sub)))
      .returning();
    if (result.length === 0) {
      return reply.status(404).send({ error: "Not found" });
    }
    return reply.send({ conversation: result[0] });
  });

  // Export a conversation as Markdown or JSON. Authenticated, owner-only.
  app.get("/api/chat/conversations/:id/export", { preHandler: auth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { format = "markdown" } = request.query as { format?: "markdown" | "json" };

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.user.sub)))
      .limit(1);
    if (!conversation) return reply.status(404).send({ error: "Not found" });

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    const useful = msgs.filter((m) => m.content && m.content.trim().length > 0);

    const safeTitle = (conversation.title || "conversation").replace(/[^a-z0-9-]+/gi, "-").slice(0, 60);
    const date = new Date(conversation.createdAt).toISOString().slice(0, 10);

    if (format === "json") {
      reply
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="ailancers-${date}-${safeTitle}.json"`);
      return reply.send({
        conversation: {
          id: conversation.id,
          title: conversation.title,
          model: conversation.model,
          createdAt: conversation.createdAt,
        },
        messages: useful,
      });
    }

    // Markdown
    const lines: string[] = [];
    lines.push(`# ${conversation.title || "Conversation"}`);
    lines.push("");
    lines.push(`Exported from Ailancers Code on ${new Date().toISOString().slice(0, 10)}.`);
    lines.push(`Created: ${new Date(conversation.createdAt).toISOString()}`);
    if (conversation.model) lines.push(`Model: ${conversation.model}`);
    lines.push("");
    lines.push("---");
    lines.push("");
    for (const m of useful) {
      const role = m.role === "user" ? "🧑 User" : m.role === "assistant" ? "🤖 Assistant" : `👤 ${m.role}`;
      lines.push(`## ${role}`);
      lines.push("");
      // If the content is JSON-encoded structured content (images), best-effort flatten
      let body = m.content;
      if (m.contentType === "structured" && body.startsWith("[")) {
        try {
          const parts = JSON.parse(body) as Array<{ type: string; text?: string }>;
          body = parts.map((p) => p.type === "text" ? p.text : `[${p.type}]`).join("\n");
        } catch {
          // leave as-is
        }
      }
      lines.push(body);
      lines.push("");
      if (m.toolCalls) {
        // toolCalls is jsonb — already parsed by Drizzle, may be an array of {name,...}
        const tc = (Array.isArray(m.toolCalls) ? m.toolCalls : []) as Array<{ name: string; input: unknown }>;
        if (tc.length > 0) {
          lines.push(`> Tool calls: ${tc.map((t) => t.name).join(", ")}`);
          lines.push("");
        }
      }
      lines.push("---");
      lines.push("");
    }
    reply
      .header("Content-Type", "text/markdown; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="ailancers-${date}-${safeTitle}.md"`);
    return reply.send(lines.join("\n"));
  });

  // /compact — summarise everything older than the most recent N=4 turns
  // and insert a `role: "system"` summary message at the cutoff. The WS
  // history loader treats the most-recent system message as the boundary
  // and ignores everything before it. No DB schema change — `role: system`
  // wasn't used elsewhere.
  app.post("/api/chat/conversations/:id/compact", { preHandler: auth }, async (request, reply) => {
    if (!aiService) {
      return reply.status(503).send({ error: "AI service not available." });
    }
    const { id } = request.params as { id: string };

    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, request.user.sub)))
      .limit(1);
    if (!conversation) return reply.status(404).send({ error: "Not found" });

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    // Drop existing system summary rows from the working set — re-running
    // /compact replaces the previous summary rather than nesting.
    const useful = msgs.filter((m) => m.role !== "system" && m.content && m.content.trim().length > 0);

    const KEEP_TAIL = 4;
    if (useful.length <= KEEP_TAIL) {
      return reply.send({
        compacted: false,
        reason: `Conversation has ${useful.length} messages (need > ${KEEP_TAIL} to compact).`,
      });
    }

    const toCompact = useful.slice(0, useful.length - KEEP_TAIL);
    // Build a compact text representation. Each turn is one bullet:
    //   "- USER: <first 200 chars>"
    //   "- ASSISTANT: <first 200 chars>"
    // The summariser is asked to produce a tight markdown synopsis.
    const transcript = toCompact.map((m) => {
      let body = m.content;
      if (m.contentType === "structured" && body.startsWith("[")) {
        try {
          const parts = JSON.parse(body) as Array<{ type: string; text?: string }>;
          body = parts.map((p) => p.type === "text" ? p.text : `[${p.type}]`).join("\n");
        } catch { /* leave as-is */ }
      }
      const trimmed = body.length > 1200 ? body.slice(0, 1200) + "…" : body;
      return `### ${m.role.toUpperCase()}\n${trimmed}`;
    }).join("\n\n");

    let summary = "";
    await aiService.streamChat(
      [
        {
          role: "user",
          content:
            "Summarise the following AI-coding conversation transcript so the agent can pick up where it left off. " +
            "Preserve: user goals, constraints they stated, files / paths / functions touched, decisions made, " +
            "and any unresolved threads. Drop chit-chat and resolved-and-discarded ideas. Output structured markdown " +
            "with sections: ## Goals, ## Decisions, ## Files & changes, ## Open threads. Aim for 200-400 words.\n\n" +
            transcript,
        },
      ],
      {
        onDelta: (text) => { summary += text; },
        onEnd: () => {},
        onError: () => {},
      },
      { model: aiService.getDefaultModels().chatModel },
    );

    if (!summary.trim()) {
      return reply.status(502).send({ error: "Summariser returned empty." });
    }

    // Insert the system summary row. Older messages stay in DB (export still
    // sees them) but the WS loader skips past the boundary. Re-running
    // /compact cleans up the previous system row first.
    await db.delete(messages)
      .where(and(eq(messages.conversationId, id), eq(messages.role, "system")));
    await db.insert(messages).values({
      conversationId: id,
      role: "system",
      content: `<compact_summary timestamp="${new Date().toISOString()}" replaces="${toCompact.length}-messages">\n${summary.trim()}\n</compact_summary>`,
      contentType: "text",
    });

    return reply.send({
      compacted: true,
      summarised: toCompact.length,
      kept: KEEP_TAIL,
    });
  });
}
