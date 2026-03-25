import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MessageBroker, Role } from "./message-broker.js";
import { registerRequestReview } from "./tools/request-review.js";
import { registerWaitForReviewRequest } from "./tools/wait-for-review-request.js";
import { registerSubmitReview } from "./tools/submit-review.js";
import { registerGetReviewStatus } from "./tools/get-review-status.js";
import { registerImplementAndReviewPrompt } from "./prompts/implement-and-review.js";
import { registerReviewModePrompt } from "./prompts/review-mode.js";

export type GetBroker = (channel: string) => MessageBroker;

export function createServer(role: Role, getBroker: GetBroker): McpServer {
  const server = new McpServer({
    name: "codex-review-mcp",
    version: "2.0.0",
  });

  if (role === "claude") {
    registerRequestReview(server, getBroker);
    registerImplementAndReviewPrompt(server);
  } else {
    registerWaitForReviewRequest(server, getBroker);
    registerSubmitReview(server, getBroker);
    registerReviewModePrompt(server);
  }

  registerGetReviewStatus(server, getBroker, role);

  return server;
}
