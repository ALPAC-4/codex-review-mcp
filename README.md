# codex-review-mcp

MCP message broker server that automates code review loops between Claude Code and OpenAI Codex CLI.

## Overview

Two AI coding agents run simultaneously and exchange code reviews via MCP.

```
Claude Code ←── SSE ──→ Broker Server ←── Streamable HTTP ──→ Codex CLI
 (implementer)          (localhost:3456)                      (reviewer)
```

### Review Loop

1. Claude implements code and calls `request_review`
2. Codex receives the request via `wait_for_review_request`
3. Codex reads the code directly from the repo, reviews it, and sends feedback via `submit_review`
4. Claude receives feedback → fixes issues → calls `request_review` again
5. Repeats until `approved: true`

## Installation

```bash
npm install
npm run build
```

## Usage

### 1. Start the server

```bash
node build/index.js              # default port 3456
node build/index.js --port 8080  # custom port
```

### 2. Register with Claude Code (one-time)

```bash
claude mcp add --transport sse codex-review http://localhost:3456/sse/claude
```

### 3. Register with Codex CLI (one-time)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.codex-review]
url = "http://localhost:3456/mcp/codex"
```

### 4. Run

- **To Claude:** "Implement feature X" → Claude implements, then automatically calls `request_review`
- **To Codex:** "Enter review mode" → Codex enters `wait_for_review_request` → `submit_review` loop

## MCP Tools

### Claude only (role=claude)

| Tool | Description |
|------|-------------|
| `request_review` | Request a review from Codex and wait for the response. Returns `{ approved, feedback, iteration }` |
| `get_review_status` | Check channel status |

### Codex only (role=codex)

| Tool | Description |
|------|-------------|
| `wait_for_review_request` | Wait for a review request from Claude. Returns `{ context, iteration }` |
| `submit_review` | Submit review feedback. Requires `feedback`, `approved`, and `iteration` |
| `get_review_status` | Check channel status |

## MCP Prompts

| Prompt | Role | Description |
|--------|------|-------------|
| `implement_and_review` | Claude | Guides the implement → review → fix loop workflow |
| `review_mode` | Codex | Guides continuous review mode |

## Channels

Run multiple Claude↔Codex pairs simultaneously using channels.

```
# Single pair (default)
request_review(context="...")               # channel="default" implied

# Multiple pairs
request_review(context="...", channel="feature-a")
wait_for_review_request(channel="feature-a")
```

## Architecture

- **In-memory message broker**: Event-driven, real-time message delivery
- **Dual transport**: SSE (Claude Code) + Streamable HTTP (Codex CLI)
- **Iteration matching**: Pairs requests and responses by iteration number, prevents stale response consumption
- **Waiter cancellation**: Cleans up orphaned waiters via AbortSignal when transport disconnects

## Endpoints

| Path | Protocol | Purpose |
|------|----------|---------|
| `/sse/claude` | SSE | Claude Code connection |
| `/sse/codex` | SSE | Codex SSE connection (alternative) |
| `/mcp/claude` | Streamable HTTP | Claude Streamable HTTP connection (alternative) |
| `/mcp/codex` | Streamable HTTP | Codex CLI connection |
| `/health` | HTTP GET | Server health check |
