import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetBroker } from "../create-server.js";

export function registerWaitForReviewRequest(server: McpServer, getBroker: GetBroker): void {
  server.registerTool("wait_for_review_request", {
    description:
      "Wait for a code review request from the Claude implementer. " +
      "Returns the context describing what was changed. You have access to the same repo — read the code directly to review. " +
      "After reviewing, call submit_review with your feedback. " +
      "Loop: wait_for_review_request → read code & analyze → submit_review → repeat.",
    inputSchema: {
      channel: z
        .string()
        .optional()
        .default("default")
        .describe("Channel name to listen on. Must match the channel used by the Claude implementer"),
    },
  }, async ({ channel }, extra) => {
    const broker = getBroker(channel ?? "default");
    const { promise, cancel } = broker.waitForReviewRequest();

    // Cancel the waiter if the transport disconnects
    extra.signal?.addEventListener("abort", cancel, { once: true });

    const request = await promise;

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          context: request.context,
          iteration: request.iteration,
        }, null, 2),
      }],
    };
  });
}
