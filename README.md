# codex-review-mcp

MCP server that automates code review loops between two coding agents.

## Overview

Two agents run simultaneously and exchange code reviews through files in the working directory.

```
Implementing agent ←── stdio ──→ MCP process ──→ .codex-review/requests/
Reviewing agent    ←── stdio ──→ MCP process ←── .codex-review/requests/
                                                   ──→ .codex-review/responses/
```

No daemon or broker server is needed. Each agent starts its own stdio MCP process, both processes expose the same tools, and they communicate via JSON files in `.codex-review/`.

### Review Loop

1. The implementing agent changes code and calls `request_review`
2. The reviewing agent receives the request via `wait_for_review_request`
3. The reviewer reads the code directly from the repo and sends feedback via `submit_review`
4. The implementer receives feedback, calls `ack_review`, fixes issues, and calls `request_review` again
5. Repeats until `approved: true`

## Installation

```bash
npm install
npm run build
```

## Setup

Register the same command with each MCP client.

### Claude Code

```bash
claude mcp add -s user codex-review -- node /path/to/codex-review-mcp/build/index.js
```

### Codex CLI

```bash
codex mcp add codex-review -- node /path/to/codex-review-mcp/build/index.js
```

No mode argument is required. Extra command-line arguments are ignored.

### Optional: Increase Codex MCP Timeout

Codex CLI recognizes per-server MCP timeout settings in `~/.codex/config.toml`.

```toml
[mcp_servers.codex-review]
command = "node"
args = ["/path/to/codex-review-mcp/build/index.js"]
tool_timeout_sec = 300
startup_timeout_sec = 45
```

If `codex-review` is already registered, add only the timeout keys to the existing `mcp_servers.codex-review` section.

### Run

- To the implementing agent: use `implement_and_review` or ask it to implement a task and call `request_review`
- To the reviewing agent: use `review_mode` so it waits with `wait_for_review_request` and replies with `submit_review`

## MCP Tools

All tools are available in every MCP process.

| Tool | Description |
|------|-------------|
| `request_review` | Request a review and wait for the response. Returns `{ approved, feedback, iteration }` |
| `ack_review` | Acknowledge a received review response so it is not redelivered |
| `wait_for_review_request` | Wait for a review request. Returns `{ context, iteration }` |
| `submit_review` | Submit review feedback. Requires `feedback`, `approved`, and `iteration` |
| `get_review_status` | Check current iteration and pending messages |

## MCP Prompts

| Prompt | Use | Description |
|--------|-----|-------------|
| `implement_and_review` | Implementing agent | Guides the implement -> review -> fix loop workflow |
| `review_mode` | Reviewing agent | Guides continuous review mode |

## Known Limitations

**Codex CLI tool call timeout:** If `tool_timeout_sec` is not increased, `wait_for_review_request` may time out after about 120 seconds in the default Codex CLI setup. When this happens, the reviewer should simply call `wait_for_review_request` again to resume waiting. The request file persists on disk, so no messages are lost.

## Architecture

- **File-based IPC**: Messages are JSON files in `.codex-review/`; no broker server needed
- **stdio transport**: Each agent uses the standard MCP stdio transport and starts its own local MCP process
- **Single tool surface**: Every MCP process exposes the same tools and prompts
- **Iteration matching**: Pairs requests and responses by iteration number
- **No message loss**: Files persist on disk until explicitly consumed. If a poll is interrupted, the file stays for the next attempt
