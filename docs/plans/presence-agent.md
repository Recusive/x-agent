# X Presence Agent — Implementation Plan

## Goal
Build a fully autonomous X engagement agent that runs from a single `bun run watch` command. Reads all behavior from config files. Logs everything to markdown + JSON. Makes @Orbitbuild look like someone who lives on X.

## Architecture
- Single orchestrator (`src/agent.ts`) launches all loops in parallel
- Each loop is its own module in `src/loops/`
- Shared core: drafter, poster, logger, rate-limiter, config-loader
- All config in `config/` (YAML + Markdown)
- All logs in `logs/YYYY-MM-DD/` (markdown + JSON)

## Tasks

### Phase 1: Config Layer
1. Create `config/context.md` — product context file (Orbit)
2. Create `config/strategy.yaml` — loop intervals, limits, enable/disable
3. Create `config/keywords.yaml` — niche + solution search terms
4. Update `config/persona.yaml` — ensure complete
5. Move watchlist into `config/watchlist.yaml`

### Phase 2: Core Infrastructure
6. Create `src/core/config-loader.ts` — reads all config, hot-reloads on file change
7. Create `src/core/rate-limiter.ts` — global daily caps, per-author, per-loop limits
8. Create `src/core/drafter.ts` — reads context.md + persona, calls claude -p, returns drafts
9. Create `src/core/poster.ts` — Chrome AppleScript posting (extract from chrome-post.ts)
10. Create `src/core/logger.ts` — writes activity.md + structured JSON per day

### Phase 3: Loop Modules
11. Create `src/loops/priority-watch.ts` — watchlist monitoring (refactor from watch.ts)
12. Create `src/loops/niche-engage.ts` — keyword search, engage with niche posts
13. Create `src/loops/solution-hunt.ts` — find people asking for tools, recommend product
14. Create `src/loops/content-create.ts` — generate and post original tweets on schedule
15. Create `src/loops/casual-engage.ts` — likes, light replies, presence activity
16. Create `src/loops/conversation-track.ts` — follow up on threads, maintain conversations

### Phase 4: Orchestrator
17. Create `src/agent.ts` — main entry point, reads strategy.yaml, launches enabled loops
18. Wire iMessage notifications into orchestrator
19. Update `package.json` with `bun run watch` pointing to agent.ts

### Phase 5: Testing & Polish
20. End-to-end test: all loops running concurrently
21. Verify logging output (activity.md + JSON)
22. Verify rate limiting across loops
23. Test config hot-reload (edit watchlist while running)
24. Clean up old scripts, update CLAUDE.md and README
