import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerImplementAndReviewPrompt(server: McpServer): void {
  server.registerPrompt("implement_and_review", {
    description: "Workflow for implementing code with an automated code review loop",
    argsSchema: {
      task: z.string().describe("Description of the implementation task"),
    },
  }, async ({ task }) => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          `Task: ${task}`,
          "",
          "## Workflow",
          "1. Implement the requested changes.",
          "2. Call `request_review` with a context describing what you changed.",
          "3. Call `ack_review` with the iteration number to confirm you received the feedback.",
          "4. If `approved: false`, fix the issues and go back to step 2.",
          "5. If `approved: true`, you are done.",
        ].join("\n"),
      },
    }],
  }));
}
