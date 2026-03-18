import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and, desc, asc } from "drizzle-orm";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { Database } from "../config/database.js";
import { conversations, messages } from "../models/index.js";

const createConversationSchema = z.object({
  projectId: z.string().uuid().optional(),
  title: z.string().max(500).optional(),
  model: z.string().optional(),
});

export function chatRoutes(app: FastifyInstance, authService: AuthService, db: Database) {
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
}
