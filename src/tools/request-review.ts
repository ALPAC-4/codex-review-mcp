import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetBroker } from "../create-server.js";

export function registerRequestReview(server: McpServer, getBroker: GetBroker): void {
  server.registerTool("request_review", {
    description:
      "Request a code review from the Codex reviewer. " +
      "The reviewer has access to the same repo, so no need to pass code. " +
      "Just describe what you changed. Returns { approved, feedback, iteration }. " +
      "If not approved, fix the issues and call this again. Repeat until approved.",
    inputSchema: {
      context: z
        .string()
        .describe("Description of what was implemented or changed, and which files were affected"),
      channel: z
        .string()
        .optional()
        .default("default")
        .describe("Channel name for routing. Use different channels for parallel review sessions"),
    },
  }, async ({ context, channel }, extra) => {
    const broker = getBroker(channel ?? "default");

    const iteration = broker.sendToCodex({
      context,
      requestedAt: Date.now(),
    });

    const { promise, cancel } = broker.waitForReviewResponse(iteration);

    // Cancel the waiter if the transport disconnects
    extra.signal?.addEventListener("abort", cancel, { once: true });

    const response = await promise;

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          approved: response.approved,
          feedback: response.feedback,
          iteration: response.iteration,
        }, null, 2),
      }],
    };
  });
}
