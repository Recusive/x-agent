# Keep This File Fresh

This CLAUDE.md is the single source of truth for how this repo works. Treat it as a living document — not a static artifact. Whenever you add, remove, rename, or change behavior in this repo (new scripts, config changes, new tools, architectural shifts), update this file in the same pass. Delete stale sections. Don't let it drift. If something here contradicts the code, the code wins — fix this file.

# X Engagement Agent

Algorithm-optimized X/Twitter engagement agent for @Orbitbuild. Finds high-opportunity posts, drafts replies using Phoenix scoring knowledge, posts via browser automation.

## Architecture

```
X API (read/search) → Claude (draft) → Chrome (post via web UI)
```

- **X API**: Search posts, check target accounts, discover new accounts. MCP server at `src/mcp-server.ts`.
- **Chrome**: Post replies via `claude-in-chrome` browser automation. Bypasses API 403 conversation control restrictions.
- **Why not API for posting?**: X API blocks replies to posts with restricted `reply_settings`. The web UI doesn't. Every high-profile account uses these restrictions.

## Quick Start

```bash
bun install
bun run test-auth          # verify API keys
bun run auth               # one-time OAuth 2.0 setup (opens browser)
./scripts/x-daemon.sh      # start monitoring daemon
./scripts/x-reply.sh       # review and post queued replies
```

## Commands

| Command | What |
|---------|------|
| `bun run watch` | **Start watchlist monitor** (edit `config/watchlist.yaml` to add accounts) |
| `bun run test-auth` | Verify X API credentials |
| `bun run auth` | OAuth 2.0 PKCE setup (one-time, opens browser) |
| `bun run src/search.ts "<query>"` | Search posts |
| `bun run src/fetch-post.ts <url>` | Fetch a single post |
| `bun run src/discover.ts` | Find new accounts in niche |
| `./scripts/x-daemon.sh` | Start monitoring daemon (foreground) |
| `./scripts/x-daemon.sh --bg` | Start daemon in background |
| `./scripts/x-daemon.sh --stop` | Stop background daemon |
| `./scripts/x-daemon.sh --status` | Check daemon status |
| `./scripts/x-reply.sh` | Review queued posts, pick replies |
| `./scripts/x-speed.sh <url>` | Speed reply to a specific post |
| `./scripts/x-interactive.sh` | Interactive Claude Code session with X tools |

## Daemon — 4 Parallel Loops

| Loop | Interval | Purpose |
|------|----------|---------|
| Priority | 45s | Monitor priority_accounts, instant notification |
| Monitor | 5 min | Check monitor_accounts |
| Discovery | 15 min | Search keywords, find new accounts |
| Conversations | 30 min | Track mentions of @Orbitbuild |

## Watchlist

**`config/watchlist.yaml`** — The simplest way to monitor accounts. Add a username, the agent watches it.

```yaml
accounts:
  - borischerny
  - karpathy
  - newperson    # just add a line
```

Run with `bun run watch`. Polls every 45 seconds. When someone on the list posts:
1. macOS notification with sound
2. Post appears in terminal with metrics
3. Claude drafts 3 reply options
4. You pick 1/2/3 or type custom
5. Copies to clipboard + opens post in Chrome
6. You Cmd+V and Post

Edit the file any time — changes picked up on next poll cycle. No restart needed.

## Config Files

- **`config/watchlist.yaml`** — Accounts to monitor. One username per line under `accounts:`. This is the primary way to add/remove watched accounts.

- **`config/context.md`** — Product context briefing. The agent reads this before drafting any reply or post. Contains what Orbit is, talking points, and what NOT to say.

- **`config/strategy.yaml`** — Controls all loop behavior: intervals, daily limits, scheduling, global settings. Single source of truth for agent behavior.

- **`config/keywords.yaml`** — Search terms organized by purpose: niche (space monitoring), solution_queries (high-intent tool seekers), content_topics (original post themes).

- **`config/targets.yaml`** — Advanced config for the daemon. Contains:
  - `priority_accounts` — reply within 1 minute (with context + angles per account)
  - `monitor_accounts` — reply within 15 minutes
  - `discovery.keywords` — find new accounts in niche
  - `community` — accounts you're building relationships with
  - `settings` — poll intervals, daily limits, working hours

- **`config/persona.yaml`** — Voice, tone, product context, algorithm optimization rules

## MCP Server

Defined in `.mcp.json`. Tools available when Claude Code runs from this directory:
- `search_posts`, `get_post`, `get_thread`, `get_user_posts`
- `post_reply`, `like_post` (API — works for open posts)
- `check_targets`, `get_engagement_stats`

## Chrome Posting Flow

For posts with restricted replies (most high-profile accounts):
1. `find` the reply textbox by semantic query, not coordinates
2. `click` the ref, `type` the text, `find` the Reply button, `click` to submit
3. Always get user approval before clicking Reply

## Skill

The `x-engage` skill is installed at `~/.claude/skills/x-engage/`. Trigger with "x engage", "find posts", "speed reply", or by pasting any x.com URL.

## Safety Rails

- 20 replies/day max (SQLite tracked in `data/x-agent.db`)
- Never same author twice per day
- Never post without user approval
- Never include links or hashtags in replies
- Working hours only (7am-11pm)

## Environment

Requires `.env` with:
- `X_API_KEY`, `X_API_KEY_SECRET` — OAuth 1.0 Consumer keys
- `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` — OAuth 1.0 Access tokens
- `X_CLIENT_ID`, `X_CLIENT_SECRET` — OAuth 2.0 keys
- `ANTHROPIC_API_KEY`

OAuth 2.0 tokens stored in `data/oauth2-tokens.json` (gitignored, auto-refreshes).

## Code Quality

Strict TypeScript (`"strict": true`) + Biome linter with strict rules. Both must pass clean.

```bash
bunx tsc --noEmit       # typecheck
bun run lint             # lint + format check
bun run lint:fix         # auto-fix
```

Rules: `noExplicitAny`, `noNonNullAssertion`, `noExcessiveCognitiveComplexity`, `useConsistentArrayType` (generic syntax), `useNodejsImportProtocol`, all `recommended` rules. Config in `biome.json`.

## Package Manager

Bun only. No npm, no pnpm.

## Cost

~$30-40/month: X API pay-per-use (~$5-10) + Claude API (~$20-30).
