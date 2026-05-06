#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ensureDirs } from "./file-store.js";
import { registerRequestReview } from "./tools/request-review.js";
import { registerWaitForReviewRequest } from "./tools/wait-for-review-request.js";
import { registerSubmitReview } from "./tools/submit-review.js";
import { registerGetReviewStatus } from "./tools/get-review-status.js";
import { registerImplementAndReviewPrompt } from "./prompts/implement-and-review.js";
import { registerReviewModePrompt } from "./prompts/review-mode.js";

async function main() {
  ensureDirs("default");

  const server = new McpServer({
    name: "codex-review-mcp",
    version: "3.0.0",
  });

  registerRequestReview(server);
  registerWaitForReviewRequest(server);
  registerSubmitReview(server);
  registerGetReviewStatus(server);
  registerImplementAndReviewPrompt(server);
  registerReviewModePrompt(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[codex-review-mcp] Started (stdio, file-based IPC)");
}

main().catch((err) => {
  console.error("[codex-review-mcp] Fatal error:", err);
  process.exit(1);
});
