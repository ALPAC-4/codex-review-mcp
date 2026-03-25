import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeRequest, pollForResponse, markResponseConsumed } from "../file-store.js";

export function registerRequestReview(server: McpServer): void {
  server.registerTool("request_review", {
    description:
      "Request a code review from the Codex reviewer. " +
      "The reviewer has access to the same repo, so no need to pass code. " +
      "Just describe what you changed. Returns { approved, feedback, iteration }. " +
      "After receiving the result, always call ack_review(iteration) to confirm receipt. " +
      "If not approved, fix the issues, call ack_review, then call request_review again.",
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
    const ch = channel ?? "default";
    const iteration = writeRequest(context, ch);

    let nack: (() => void) | undefined;
    const onAbort = () => { nack?.(); };
    extra.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const claimed = await pollForResponse(iteration, ch, extra.signal);
      nack = claimed.nack;

      const result = {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            approved: claimed.data.approved,
            feedback: claimed.data.feedback,
            iteration: claimed.data.iteration,
          }, null, 2),
        }],
      };

      nack = undefined;
      return result;
    } catch (err) {
      nack?.();
      throw err;
    }
  });

  server.registerTool("ack_review", {
    description:
      "Acknowledge receipt of a review response. " +
      "Call this after every request_review result to confirm you received the feedback. " +
      "This prevents the response from being redelivered on restart.",
    inputSchema: {
      iteration: z.number().describe("The iteration number of the review to acknowledge"),
      channel: z
        .string()
        .optional()
        .default("default")
        .describe("Channel name"),
    },
  }, async ({ iteration, channel }) => {
    markResponseConsumed(iteration, channel ?? "default");
    return {
      content: [{
        type: "text" as const,
        text: `Review response for iteration ${iteration} acknowledged.`,
      }],
    };
  });
}
