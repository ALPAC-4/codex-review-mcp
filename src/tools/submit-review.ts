import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeResponse, markRequestConsumed } from "../file-store.js";

export function registerSubmitReview(server: McpServer): void {
  server.registerTool("submit_review", {
    description:
      "Submit your code review feedback to the Claude implementer. " +
      "Set approved=true only if the code is correct and needs no changes. " +
      "Set approved=false with detailed feedback if issues are found. " +
      "You must pass the iteration number from the review request you received. " +
      "After calling this, ALWAYS call wait_for_review_request() immediately to continue the review loop.",
    inputSchema: {
      feedback: z
        .string()
        .describe("Detailed review feedback with specific issues and suggestions"),
      approved: z
        .boolean()
        .describe("true if code passes review (LGTM), false if changes needed"),
      iteration: z
        .number()
        .describe("The iteration number from the review request being responded to"),
      channel: z
        .string()
        .optional()
        .default("default")
        .describe("Channel name. Must match the channel used in wait_for_review_request"),
    },
  }, async ({ feedback, approved, iteration, channel }) => {
    const ch = channel ?? "default";

    // Write the response FIRST — ensures it's visible before we consume the request.
    // If crash after writeResponse but before markRequestConsumed, the request
    // gets redelivered (at-least-once) which is safe.
    writeResponse(feedback, approved, iteration, ch);

    // Mark the request as consumed — safe now because response is durable.
    markRequestConsumed(iteration, ch);

    return {
      content: [{
        type: "text" as const,
        text: `Review submitted for iteration ${iteration} (approved: ${approved}). Call wait_for_review_request() to wait for the next review.`,
      }],
    };
  });
}
