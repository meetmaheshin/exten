import type { FastifyInstance } from "fastify";
import { requireAuth } from "../middleware/requireAuth.js";
import type { AuthService } from "../services/AuthService.js";
import type { BillingReporter } from "../services/BillingReporter.js";

export function billingRoutes(
  app: FastifyInstance,
  authService: AuthService,
  billingReporter: BillingReporter,
) {
  const auth = requireAuth(authService);

  /**
   * GET /api/billing/status?subProjectId=X
   * Returns cached billing status for a sub-project.
   * On cold start, fetches from chat-ui backend.
   */
  app.get("/api/billing/status", { preHandler: auth }, async (request, reply) => {
    const { subProjectId } = request.query as { subProjectId?: string };
    if (!subProjectId) {
      return reply.status(400).send({ error: "subProjectId query parameter required" });
    }

    const status = await billingReporter.getBillingStatus(subProjectId);
    if (!status) {
      return reply.send({
        billingStatus: "unknown",
        enabled: false,
        todaySpend: 0,
        dailyCap: null,
        capRemaining: null,
        capPercent: 0,
      });
    }

    return reply.send(status);
  });
}
