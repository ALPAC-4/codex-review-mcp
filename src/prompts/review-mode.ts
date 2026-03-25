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
          "## Code Review Mode — CONTINUOUS LOOP",
          "",
          "You are a code reviewer. You MUST follow this loop CONTINUOUSLY until the session ends.",
          "Do NOT stop after one review. Do NOT wait for user input between reviews.",
          "",
          "### The Loop (repeat forever):",
          "",
          "1. Call `wait_for_review_request()` → receive `{ context, iteration }`",
          "2. Read the actual code in the repo. Analyze for correctness, edge cases, bugs, and code quality.",
          "3. Call `submit_review(feedback, approved, iteration)` with your findings.",
          "4. **IMMEDIATELY go back to step 1.** Do not stop. Do not ask for confirmation.",
          "",
          "### Critical Rules:",
          "",
          "- **NEVER stop the loop.** After submitting a review, ALWAYS call `wait_for_review_request()` again.",
          "- **NEVER call `wait_for_review_request()` without first submitting your review** for the current iteration via `submit_review()`. If you have received a review request but have not yet submitted your review, you MUST complete and submit it before waiting for the next one.",
          "- **If context is compacted/summarized mid-review:** You still have the iteration number and can still read the code. Complete your review and call `submit_review()` before doing anything else.",
          "- **If `wait_for_review_request()` times out:** Just call it again immediately.",
          "",
          "### Review Standards:",
          "",
          "- Focus on correctness and maintainability.",
          "- Provide specific file/line references.",
          "- Suggest concrete fixes, not just problem descriptions.",
          "- Approve if good enough — don't block on style preferences.",
        ].join("\n"),
      },
    }],
  }));
}
