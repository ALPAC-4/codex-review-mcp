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

type Role = "claude" | "codex";

function parseArgs(): Role {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--role") {
      const role = args[i + 1] as Role;
      if (role === "claude" || role === "codex") return role;
    }
  }
  console.error("Usage: codex-review-mcp --role claude|codex");
  process.exit(1);
}

async function main() {
  const role = parseArgs();
  ensureDirs("default");

  const server = new McpServer({
    name: "codex-review-mcp",
    version: "3.0.0",
  });

  if (role === "claude") {
    registerRequestReview(server);
    registerImplementAndReviewPrompt(server);
  } else {
    registerWaitForReviewRequest(server);
    registerSubmitReview(server);
    registerReviewModePrompt(server);
  }

  registerGetReviewStatus(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[codex-review-mcp] Started as ${role} (stdio, file-based IPC)`);
}

main().catch((err) => {
  console.error("[codex-review-mcp] Fatal error:", err);
  process.exit(1);
});
