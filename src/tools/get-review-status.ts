import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getStatus } from "../file-store.js";

export function registerGetReviewStatus(server: McpServer): void {
  server.registerTool("get_review_status", {
    description: "Check the review status: current iteration and pending messages.",
    inputSchema: {
      channel: z
        .string()
        .optional()
        .default("default")
        .describe("Channel name to check"),
    },
  }, async ({ channel }) => {
    const status = getStatus(channel ?? "default");
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(status, null, 2),
      }],
    };
  });
}
