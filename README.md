<p align="center">
  <img src="assets/icon.png" alt="X Agent" width="240" />
</p>

<h1 align="center">X Agent</h1>

<p align="center">
  <strong>Algorithm-optimized X engagement agent. Find posts. Draft replies. Post in seconds.</strong><br/>
  Uses X's open-source Phoenix recommendation algorithm to craft replies that actually get seen. Monitors accounts you care about and alerts you the moment they post.
</p>

<p align="center">
  <a href="https://github.com/Recusive/x-agent/releases/latest"><img src="https://img.shields.io/github/v/release/Recusive/x-agent?label=Release&color=6366f1" alt="Release" /></a>
  <img src="https://img.shields.io/badge/Claude_Code-Supported-F97316?logo=anthropic&logoColor=white" alt="Claude Code" />
  <img src="https://img.shields.io/badge/X_API_v2-Pay--Per--Use-1D9BF0" alt="X API" />
  <img src="https://img.shields.io/badge/License-MIT-22C55E" alt="MIT License" />
</p>

---

## About

X Agent is built by the **[Recursive Labs](https://github.com/Recusive)** team as part of the [Orbit](https://github.com/Recusive/Orbit-Release) ecosystem — an AI-native development environment. While X Agent will ship as a built-in feature in Orbit, it works as a standalone tool with Claude Code today.

The reply drafting engine is grounded in [X's open-source recommendation algorithm](https://github.com/xai-org/x-algorithm) — specifically the Phoenix scoring model (Grok-based transformer) and its 19 modeled engagement actions. Not guesswork. Code-verified signals.

---

## How It Works

```
watchlist.yaml          X API               Claude              Chrome
(add a username)   →   (detect new post)  →  (draft reply)  →  (post via web UI)
                        polls every 45s       3 options          bypasses API
                                              algorithm-scored   restrictions
```

1. **You add usernames** to `watchlist.yaml`
2. **Agent polls** the X API every 45 seconds
3. **Someone posts** → macOS notification + drafts 3 algorithm-optimized replies
4. **You pick one** (1/2/3 or type custom)
5. **Copies to clipboard**, opens post in Chrome — Cmd+V, Post

<details>
<summary><b>Why Chrome instead of the API for posting?</b></summary>

The X API v2 returns 403 on replies to posts with conversation controls (`reply_settings` set to "following", "verified", etc.). Most high-profile accounts use these restrictions. The web UI doesn't enforce them the same way — a logged-in user can reply to any public post from the browser. So we use the API for reading and Chrome for writing.

</details>

---

## What It Optimizes For

Every reply is drafted against Phoenix's 19 engagement prediction signals:

<details>
<summary><b>Signal priority for replies</b></summary>

| Signal | Priority | What It Means |
|--------|----------|---------------|
| `favorite_score` | Highest | Will people like this reply? |
| `dwell_time` | High | Will people pause to read it? |
| `profile_click_score` | High | Will people check who wrote this? |
| `follow_author_score` | High | Will people follow from this? |
| `reply_score` | Medium | Will people reply to your reply? |
| `not_interested_score` | Critical | Could this feel irrelevant? (negative) |
| `block_author_score` | Critical | Could this feel hostile? (negative) |

</details>

<details>
<summary><b>What the algorithm rewards in replies</b></summary>

- **Reply to fresh posts** — Thunder retrieval is recency-first. First 5 minutes = 10x visibility.
- **Reply to original posts** — Thunder surfaces replies to originals most reliably.
- **Author diversity** — AuthorDiversityScorer penalizes replying to the same account repeatedly.
- **Niche consistency** — Phoenix's retrieval model builds your embedding cluster from who engages with you. Stay in your lane.
- **Substance over length** — Dwell time is modeled twice. Specificity creates dwell.

</details>

---

## Install

### Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- [Bun](https://bun.sh) runtime
- X API developer account ([developer.x.com](https://developer.x.com)) with pay-per-use credits
- Chrome with [claude-in-chrome](https://chromewebstore.google.com/) extension (for posting)

### Setup

```bash
git clone https://github.com/Recusive/x-agent.git
cd x-agent
bun install
cp .env.example .env    # Fill in your API keys
bun run test-auth       # Verify credentials
bun run auth            # One-time OAuth 2.0 setup (opens browser)
```

### Skill (optional)

Install the Claude Code skill for in-session engagement:

```bash
cp -r skill/ ~/.claude/skills/x-engage/
```

Then say "x engage" or paste any x.com URL in Claude Code.

---

## Usage

### Watchlist Monitor

The simplest way to use it. Edit `watchlist.yaml`, run the monitor:

```yaml
# watchlist.yaml
accounts:
  - borischerny
  - karpathy
  - mattpocockuk
  - swyx
```

```bash
bun run watch
```

When someone on the list posts, you get a notification, 3 draft replies, and a prompt to pick one.

### Speed Reply

Paste any X URL, get instant drafts:

```bash
./scripts/x-speed.sh https://x.com/someone/status/123456
```

### Interactive Session

Full Claude Code session with X tools loaded:

```bash
./scripts/x-interactive.sh
```

Say "find posts", "check targets", "stats", or paste URLs.

### Background Daemon

Four parallel monitoring loops:

```bash
./scripts/x-daemon.sh           # foreground
./scripts/x-daemon.sh --bg      # background
./scripts/x-daemon.sh --stop    # stop
./scripts/x-daemon.sh --status  # check
```

| Loop | Interval | Purpose |
|------|----------|---------|
| Priority | 45s | Accounts in `watchlist.yaml` |
| Monitor | 5 min | Extended account list |
| Discovery | 15 min | Find new accounts in your niche by keyword |
| Conversations | 30 min | Track mentions and replies |

---

## Config

| File | Purpose |
|------|---------|
| `watchlist.yaml` | Accounts to monitor — one username per line |
| `config/persona.yaml` | Your voice, tone, product context, algorithm rules |
| `config/targets.yaml` | Advanced: priority tiers, discovery keywords, community tracking |
| `.env` | API keys (gitignored) |

---

## Safety Rails

- **20 replies/day** maximum (SQLite tracked)
- **No same author twice** per day (AuthorDiversityScorer alignment)
- **User approval required** before every post
- **No links or hashtags** in replies (algorithm suppresses them)
- **Working hours only** (7am–11pm)

---

## Architecture

```
x-agent/
├── src/
│   ├── watch.ts           # Watchlist monitor (main entry point)
│   ├── mcp-server.ts      # MCP server for Claude Code integration
│   ├── x-client.ts        # X API v2 wrapper (OAuth 1.0a + OAuth 2.0)
│   ├── store.ts           # SQLite tracking (seen posts, replies, daily limits)
│   ├── discover.ts        # Niche discovery engine
│   ├── check-targets.ts   # Target account checker
│   └── auth-setup.ts      # OAuth 2.0 PKCE setup
├── scripts/
│   ├── x-daemon.sh        # Background daemon (4 parallel loops)
│   ├── x-reply.sh         # Queue reviewer
│   ├── x-speed.sh         # Speed reply from URL
│   └── x-interactive.sh   # Interactive Claude Code session
├── skill/                  # Claude Code skill (x-engage)
├── config/                 # Persona + targets
├── watchlist.yaml          # Accounts to watch
└── data/                   # SQLite DB + OAuth tokens (gitignored)
```

---

## Cost

~$30–40/month total:
- X API pay-per-use: ~$5–10 (search + post reads)
- Claude API: ~$20–30 (reply drafting)

---

## Built By

<p>
  <a href="https://github.com/Recusive"><strong>Recursive Labs</strong></a> — the team behind <a href="https://github.com/Recusive/Orbit-Release">Orbit</a>, an AI-native development environment where one agent works across editor, browser, terminal, and docs.
</p>

## License

MIT
