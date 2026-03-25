import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerReviewModePrompt(server: McpServer): void {
  server.registerPrompt("review_mode", {
    description: "Enter continuous code review mode — wait for requests and submit feedback in a loop",
  }, async () => ({
    messages: [{
      role: "user" as const,
      content: {
        type: "text" as const,
        text: [
          "## Code Review Mode",
          "",
          "You are a code reviewer. You have access to the same repo as the implementer. Follow this loop:",
          "",
          "1. Call `wait_for_review_request()` to receive the next review request (returns `{ context, iteration }`).",
          "2. Read the actual code in the repo based on the context description. Analyze for correctness, edge cases, bugs, and code quality.",
          "3. Call `submit_review()` with:",
          "   - `feedback`: specific, actionable review comments",
          "   - `approved`: true if code is clean, false if changes needed",
          "   - `iteration`: the iteration number from the request you received",
          "4. Go back to step 1.",
          "",
          "## Standards",
          "- Focus on correctness and maintainability.",
          "- Provide specific file/line references.",
          "- Suggest concrete fixes, not just problem descriptions.",
          "- Approve if good enough — don't block on style preferences.",
        ].join("\n"),
      },
    }],
  }));
}
