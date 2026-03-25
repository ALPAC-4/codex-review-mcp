#!/usr/bin/env node

import { createServer as createHttpServer, IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MessageBroker, Role } from "./message-broker.js";
import { createServer } from "./create-server.js";

function parseArgs() {
  const args = process.argv.slice(2);
  let port = 3456;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port") {
      port = parseInt(args[++i], 10);
    }
  }

  return { port };
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function main() {
  const { port } = parseArgs();

  const brokers = new Map<string, MessageBroker>();

  function getBroker(channel: string): MessageBroker {
    let broker = brokers.get(channel);
    if (!broker) {
      broker = new MessageBroker();
      brokers.set(channel, broker);
      console.error(`[codex-review-mcp] Channel "${channel}" created`);
    }
    return broker;
  }

  // Track all transports by session ID
  const transports: Record<string, Transport> = {};

  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ──────────────────────────────────────────────────────────
    // Streamable HTTP: /mcp/claude or /mcp/codex
    // ──────────────────────────────────────────────────────────
    const mcpMatch = url.pathname.match(/^\/mcp\/(claude|codex)$/);
    if (mcpMatch) {
      const role = mcpMatch[1] as Role;

      // Ensure Accept header includes both types required by the SDK.
      // Some clients (e.g., Codex Rust rmcp) send Accept: */* or omit text/event-stream.
      const requiredAccept = "application/json, text/event-stream";
      req.headers["accept"] = requiredAccept;
      const rawIdx = req.rawHeaders.findIndex((h, i) => i % 2 === 0 && h.toLowerCase() === "accept");
      if (rawIdx !== -1) {
        req.rawHeaders[rawIdx + 1] = requiredAccept;
      } else {
        req.rawHeaders.push("Accept", requiredAccept);
      }

      let body: unknown;
      if (req.method === "POST") {
        try {
          body = await readJsonBody(req);
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId] instanceof StreamableHTTPServerTransport) {
        transport = transports[sessionId] as StreamableHTTPServerTransport;
      } else if (!sessionId && req.method === "POST" && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            console.error(`[codex-review-mcp] ${role} connected (streamable HTTP, session: ${sid})`);
            transports[sid] = transport;
          },
        });
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            console.error(`[codex-review-mcp] ${role} disconnected (session: ${sid})`);
            delete transports[sid];
          }
        };
        const server = createServer(role, getBroker);
        await server.connect(transport);
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad request: missing or invalid session" }));
        return;
      }

      await transport.handleRequest(req, res, body);
      return;
    }

    // ──────────────────────────────────────────────────────────
    // Legacy SSE: GET /sse/claude or /sse/codex
    // ──────────────────────────────────────────────────────────
    const sseMatch = req.method === "GET" && url.pathname.match(/^\/sse\/(claude|codex)$/);
    if (sseMatch) {
      const role = sseMatch[1] as Role;

      console.error(`[codex-review-mcp] ${role} connected (SSE)`);

      const transport = new SSEServerTransport("/messages", res);
      transports[transport.sessionId] = transport;

      res.on("close", () => {
        console.error(`[codex-review-mcp] ${role} disconnected (SSE)`);
        delete transports[transport.sessionId];
      });

      const server = createServer(role, getBroker);
      await server.connect(transport);
      return;
    }

    // Legacy SSE POST: /messages?sessionId=xxx
    if (req.method === "POST" && url.pathname === "/messages") {
      const sessionId = url.searchParams.get("sessionId");
      const transport = sessionId ? transports[sessionId] : undefined;

      if (!transport || !(transport instanceof SSEServerTransport)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or missing sessionId" }));
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    // ──────────────────────────────────────────────────────────
    // Health check
    // ──────────────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/health") {
      const channels: Record<string, ReturnType<MessageBroker["getStatus"]>> = {};
      for (const [name, broker] of brokers) {
        channels[name] = broker.getStatus("claude");
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        connections: Object.keys(transports).length,
        channels,
      }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.error(`[codex-review-mcp] Server running at http://127.0.0.1:${port}`);
    console.error(`[codex-review-mcp] Streamable HTTP: /mcp/claude, /mcp/codex`);
    console.error(`[codex-review-mcp] Legacy SSE:      /sse/claude, /sse/codex`);
  });

  process.on("SIGINT", () => {
    console.error("\n[codex-review-mcp] Shutting down...");
    httpServer.close();
    process.exit(0);
  });
}

main();
