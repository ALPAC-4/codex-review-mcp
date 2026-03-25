import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerImplementAndReviewPrompt(server: McpServer): void {
  server.registerPrompt("implement_and_review", {
    description: "Workflow for implementing code with automated Codex code review loop",
    argsSchema: {
      task: z.string().describe("Description of the implementation task"),
      channel: z.string().optional().describe("Channel name for this review session (default: 'default')"),
    },
  }, async ({ task, channel }) => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          `Task: ${task}`,
          channel ? `Channel: ${channel}` : "",
          "",
          "## Workflow",
          "1. Implement the requested changes.",
          `2. Call \`request_review\` with a context describing what you changed${channel ? ` and channel="${channel}"` : ""}.`,
          "   The reviewer has access to the same repo and will read the code directly.",
          "3. If `approved: false`, fix the issues and call `request_review` again.",
          "4. Repeat until `approved: true`.",
          "",
          "## Tips",
          "- Save files to disk before requesting review.",
          "- Address ALL feedback items before re-requesting.",
          "- Write clear context descriptions so the reviewer understands your intent.",
        ].filter(Boolean).join("\n"),
      },
    }],
  }));
}
