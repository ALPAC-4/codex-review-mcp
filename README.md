# codex-review-mcp

MCP server that automates code review loops between Claude Code and OpenAI Codex CLI.

## Overview

Two AI coding agents run simultaneously and exchange code reviews via MCP, communicating through files in the working directory.

```
Claude Code ←── stdio ──→ MCP Server (role=claude) ──→ .codex-review/requests/
Codex CLI   ←── stdio ──→ MCP Server (role=codex)  ←── .codex-review/requests/
                                                    ──→ .codex-review/responses/
```

No separate broker server needed. Each agent runs its own stdio MCP server process, and they communicate via JSON files in `.codex-review/`.

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

## Setup

### Register with Claude Code (one-time)

```bash
claude mcp add codex-review -- node /path/to/codex-review-mcp/build/index.js --role claude
```

### Register with Codex CLI (one-time)

```bash
codex mcp add codex-review -- node /path/to/codex-review-mcp/build/index.js --role codex
```

### Optional: Increase Codex MCP timeout

Codex CLI recognizes per-server MCP timeout settings in `~/.codex/config.toml`.

```toml
[mcp_servers.codex-review]
command = "node"
args = ["/path/to/codex-review-mcp/build/index.js", "--role", "codex"]
tool_timeout_sec = 300
startup_timeout_sec = 45
```

If `codex-review` is already registered, add only the timeout keys to the existing `mcp_servers.codex-review` section.

### Run

- **To Claude:** "Implement feature X" → Claude implements, then automatically calls `request_review`
- **To Codex:** "Enter review mode" → Codex enters `wait_for_review_request` → `submit_review` loop

## MCP Tools

### Claude only (role=claude)

| Tool | Description |
|------|-------------|
| `request_review` | Request a review from Codex and wait for the response. Returns `{ approved, feedback, iteration }` |
| `get_review_status` | Check review status |

### Codex only (role=codex)

| Tool | Description |
|------|-------------|
| `wait_for_review_request` | Wait for a review request from Claude. Returns `{ context, iteration }` |
| `submit_review` | Submit review feedback. Requires `feedback`, `approved`, and `iteration` |
| `get_review_status` | Check review status |

## MCP Prompts

| Prompt | Role | Description |
|--------|------|-------------|
| `implement_and_review` | Claude | Guides the implement → review → fix loop workflow |
| `review_mode` | Codex | Guides continuous review mode |

## Known Limitations

**Codex CLI tool call timeout:** If `tool_timeout_sec` is not increased, `wait_for_review_request` may time out after about 120 seconds in the default Codex CLI setup. When this happens, Codex should simply call `wait_for_review_request` again to resume waiting. The request file persists on disk, so no messages are lost.

## Architecture

- **File-based IPC**: Messages are JSON files in `.codex-review/` — no broker server needed
- **stdio transport**: Both agents use the standard MCP stdio transport
- **Iteration matching**: Pairs requests and responses by iteration number
- **No message loss**: Files persist on disk until explicitly consumed. If a poll is interrupted, the file stays for the next attempt
