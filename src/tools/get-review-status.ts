import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Role } from "../message-broker.js";
import type { GetBroker } from "../create-server.js";

export function registerGetReviewStatus(
  server: McpServer,
  getBroker: GetBroker,
  role: Role
): void {
  server.registerTool("get_review_status", {
    description:
      "Check the review channel status: current iteration, pending messages, and whether the other agent is waiting.",
    inputSchema: {
      channel: z
        .string()
        .optional()
        .default("default")
        .describe("Channel name to check"),
    },
  }, async ({ channel }) => {
    const broker = getBroker(channel ?? "default");
    const status = broker.getStatus(role);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ ...status, channel: channel ?? "default" }, null, 2),
      }],
    };
  });
}
