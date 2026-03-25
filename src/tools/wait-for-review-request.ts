import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pollForRequest } from "../file-store.js";

export function registerWaitForReviewRequest(server: McpServer): void {
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
    const ch = channel ?? "default";

    let nack: (() => void) | undefined;
    const onAbort = () => { nack?.(); };
    extra.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const claimed = await pollForRequest(ch, extra.signal);
      nack = claimed.nack;

      // Do NOT mark request consumed here — it will be acked when
      // submit_review is called with this iteration number.

      const result = {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            context: claimed.data.context,
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
}
