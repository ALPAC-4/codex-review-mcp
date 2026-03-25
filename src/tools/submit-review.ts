import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetBroker } from "../create-server.js";

export function registerSubmitReview(server: McpServer, getBroker: GetBroker): void {
  server.registerTool("submit_review", {
    description:
      "Submit your code review feedback to the Claude implementer. " +
      "Set approved=true only if the code is correct and needs no changes. " +
      "Set approved=false with detailed feedback if issues are found. " +
      "You must pass the iteration number from the review request you received.",
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
    const broker = getBroker(channel ?? "default");

    const result = broker.sendToClaude({
      feedback,
      approved,
      reviewedAt: Date.now(),
    }, iteration);

    if (result === "dropped") {
      return {
        content: [{
          type: "text" as const,
          text: `Error: Review for iteration ${iteration} was dropped — iteration is stale or invalid (current: ${broker.getIteration()}). The implementer may have already timed out.`,
        }],
        isError: true,
      };
    }

    return {
      content: [{
        type: "text" as const,
        text: `Review ${result} for iteration ${iteration} (approved: ${approved}). Call wait_for_review_request() to wait for the next review.`,
      }],
    };
  });
}
