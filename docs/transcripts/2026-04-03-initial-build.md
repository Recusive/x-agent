# Session Transcript: Initial X Agent Build

**Date:** April 3, 2026
**Session:** Full build from concept to working agent

---

## Summary

Built the entire X engagement agent from scratch in one session. Started with a question about whether it's possible to build a bot for X, ended with a fully autonomous 6-loop presence agent with iMessage integration and Chrome auto-posting.

## Key Decisions Made

### Architecture
- **X API for reading, Chrome for posting** — X API v2 returns 403 on replies to posts with restricted `reply_settings`. Most high-profile accounts use these. Chrome web UI doesn't enforce the same restriction. So we read via API, post via AppleScript + JavaScript injection into Chrome.
- **Shell scripts + MCP → Full TypeScript agent** — Started with shell scripts calling `claude -p`, evolved into a proper TypeScript orchestrator with 6 parallel loops.
- **Config-driven, not hardcoded** — All behavior comes from YAML/Markdown files in `config/`. No code changes needed to add accounts, change voice, or tune intervals.

### Algorithm Research
- Read the X open-source algorithm at `xai-org/x-algorithm` (Rust + Python/JAX)
- Key files: `weighted_scorer.rs` (19 engagement signals), `phoenix_scorer.rs` (Grok transformer predictions), `author_diversity_scorer.rs` (exponential decay for repeated authors), `oon_scorer.rs` (out-of-network penalty)
- The `params` module with actual weights is excluded from open source ("security reasons")
- Critical insight: Phoenix evaluates each reply against each viewer's personal engagement history independently (candidate isolation via attention mask)

### X API Setup
- OAuth 1.0a for search/read (works)
- OAuth 2.0 PKCE for posting (attempted, still gets 403 on restricted posts)
- Pay-per-use pricing ($5 credits purchased): $0.005/read, $0.01/create
- API blocks replies to restricted conversations, web UI doesn't — confirmed by testing

### Chrome Posting
- `agent-browser` → couldn't login to X (blocks automated browsers)
- `claude-in-chrome` → works but connected to Dia not Chrome, unreliable
- **AppleScript + JS injection** → final solution. Requires "Allow JavaScript from Apple Events" in Chrome. Uses `document.execCommand('insertText')` for contenteditable divs, finds Reply button via `data-testid`.

### iMessage Integration
- Sends drafts to phone via `osascript` → Messages app
- Reads replies from `~/Library/Messages/chat.db` (SQLite)
- Required Full Disk Access for Cursor
- When messaging yourself: replies arrive as `is_from_me=0` (counterintuitive but correct)
- Filter by `length(m.text) <= 10` to catch "1", "2", "3" replies

## What Was Built

### Config Layer (`config/`)
- `context.md` — Product briefing (Orbit: Tauri 2 + React 19 AI editor)
- `persona.yaml` — Voice/tone with 6 reply styles (technical, casual, humor, frustration, question, announcement)
- `strategy.yaml` — 6 loops with intervals, limits, schedules
- `keywords.yaml` — Niche terms, solution queries, content topics
- `watchlist.yaml` — Accounts to monitor

### Core Infrastructure (`src/core/`)
- `config-loader.ts` — Hot-reloading config reader
- `rate-limiter.ts` — SQLite-backed daily limits (global, per-author, per-loop)
- `drafter.ts` — Claude drafting engine (reads context.md + persona.yaml)
- `poster.ts` — Chrome AppleScript posting (reply, create post, like)
- `logger.ts` — Daily activity.md + structured JSON

### 6 Loop Modules (`src/loops/`)
1. `priority-watch.ts` — Watchlist accounts, reply within 2 min (45s poll)
2. `niche-engage.ts` — Find/engage niche posts (10 min)
3. `solution-hunt.ts` — Find people asking for tools, recommend product (15 min)
4. `content-create.ts` — Post original content on schedule (10am, 4pm)
5. `casual-engage.ts` — Likes + light replies for presence (20 min)
6. `conversation-track.ts` — Follow up on threads/mentions (30 min)

### Orchestrator (`src/agent.ts`)
- Reads strategy.yaml, launches enabled loops in parallel
- Working hours enforcement, random jitter, graceful shutdown
- iMessage notifications on start/stop
- Live terminal output with loop labels

### Supporting Scripts
- `src/x-client.ts` — X API v2 wrapper (OAuth 1.0a + 2.0)
- `src/store.ts` — SQLite for seen posts, reply history
- `src/imessage.ts` — iMessage send/receive
- `src/chrome-post.ts` — Direct Chrome posting
- `src/watch.ts` — Original watchlist monitor (superseded by agent.ts)

### Skill (`skill/` + `~/.claude/skills/x-engage/`)
- SKILL.md with Phoenix algorithm knowledge
- Reply templates, scoring framework, Chrome posting flow
- References: algorithm-scorecard.md, reply-templates.md, signal-content-map.md, chrome-posting.md

## Bugs Found and Fixed

1. **X API search `max_results` minimum is 10** — was passing 3, got 400 error
2. **`sort_order: "recency"` not available on pay-per-use** — removed from search params
3. **OAuth 2.0 didn't fix 403** — conversation controls are API-level, not auth-level
4. **Rate-limiter `strategy.limits` vs `strategy.global`** — config-loader StrategyConfig type didn't match actual YAML structure
5. **iMessage `is_from_me` flip** — when messaging yourself, phone replies arrive as `is_from_me=0` on Mac
6. **osascript multiline strings** — used temp AppleScript files instead of `-e` flag
7. **Chrome JS injection blocked** — needed "Allow JavaScript from Apple Events" setting
8. **Conversation tracker missing parent context** — added `getPost()` call to fetch original post before drafting reply
9. **`claude -p` timeout** — increased from 30s to 90s

## Costs
- X API: $5 credits purchased (pay-per-use)
- Estimated monthly: ~$30-40 (X API $5-10 + Claude API $20-30)

## Commits
1. `7cf5bba` — Initial x-agent setup
2. `6a5b9de` — Watchlist monitor, daemon, discovery, skill, README
3. `888d57d` — MIT license
4. `f3fd37c` — iMessage integration, Chrome auto-posting, full flow tests
5. `e4cfeb6` — Full X presence agent with 6 autonomous loops
6. `dc4cb50` — Fix rate-limiter config mapping
7. `409f378` — Fix conversation tracker parent context

## Next Steps
- Run the agent for a full day and review activity.md
- Tune drafting prompts based on reply quality
- Add more accounts to watchlist.yaml
- Test content-create loop at scheduled times
- Monitor X API credit usage
- Consider adding Telegram/Discord as notification alternatives
