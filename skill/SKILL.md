---
name: x-engage
description: X/Twitter engagement agent that finds high-opportunity posts, drafts algorithm-optimized replies using Phoenix scoring knowledge, and posts them via browser automation. Use this skill whenever the user wants to engage on X, find posts to reply to, draft replies, do a speed reply to an X URL, monitor target accounts, check what's happening in their niche, plan reply strategy, or pastes any x.com URL. Also triggers on "x engage", "find opportunities", "reply to posts", "check targets", "post reply", "speed reply", "monitor X", or any discussion about X/Twitter growth, reply strategy, or engagement optimization.
---

# X Engage — Algorithm-Optimized Reply Agent

Find high-opportunity posts on X, draft replies optimized for the Phoenix recommendation algorithm, and post them through the browser.

## Architecture

This skill operates in three layers:

1. **X API** (read/search) — Find posts from target accounts and keywords via the x-agent MCP server
2. **Phoenix Algorithm Knowledge** (draft) — Score and craft replies against all 19 modeled engagement actions
3. **Chrome Browser** (post) — Post replies via the real web UI using claude-in-chrome, bypassing API conversation control restrictions

The X API blocks replies to posts with restricted conversation settings (403 error). The browser posts replies exactly like a human — no restrictions. This is why we use the API for reading and Chrome for writing.

## Setup Check

Before starting any engagement session, verify:

1. **X API access**: The x-agent MCP server should be available. If MCP tools like `search_posts` or `get_post` are not available, the user needs to run Claude Code from `/Users/no9labs/Developer/Recursive/x-agent/` or ensure the MCP config is loaded.

2. **Chrome logged in**: claude-in-chrome must be connected to Chrome where the user is logged into X as @Orbitbuild. Run `tabs_context_mcp` to verify the connection. If not connected, tell the user to open Chrome and log into X.

3. **Config files**: Read these on first use:
   - Persona: `/Users/no9labs/Developer/Recursive/x-agent/config/persona.yaml`
   - Targets: `/Users/no9labs/Developer/Recursive/x-agent/config/targets.yaml`

## Modes

### 1. Speed Reply (user pastes an X URL)

This is the most common mode. The user sees a post and wants to reply fast.

1. Use `get_post` MCP tool to fetch the post (extract ID from URL)
2. Read the post text, author, engagement metrics, age
3. Draft 3 reply options using the Reply Drafting Engine below
4. Present them clearly numbered
5. When the user picks one, post it via Chrome Posting Flow below

Speed matters. Posts under 2 hours old get dramatically more reply visibility because Thunder retrieval is recency-first. Tell the user the post age and whether they're in the early window.

### 2. Find Opportunities

User says "find posts" or "what should I reply to" or "check targets."

1. Use `search_posts` or `check_targets` MCP tools
2. Build the search query from targets.yaml (priority accounts + keywords)
3. Filter results: prefer fresh posts (< 2 hours), high engagement, in-niche
4. Score each post as an opportunity:
   - Post age (fresher = better, under 2 hours is ideal)
   - Author audience (larger = more visibility for your reply)
   - Reply count (fewer replies = less competition, your reply is more visible)
   - Topic relevance (in your content lanes = builds your embedding cluster)
5. Present top 3-5 opportunities with metrics
6. For each one the user wants to engage with, draft replies and post

### 3. Interactive Session

User wants to chat about strategy, review engagement, or do a longer session.

- "stats" → Use `get_engagement_stats` MCP tool to show today's activity
- "what should I post about" → Read persona.yaml and suggest content angles
- "analyze this draft" → Score using the Algorithm Scorecard
- "why did my reply flop" → Diagnose using Anti-Pattern checks
- Strategy questions → Use the Phase Priorities section

## Reply Drafting Engine

Every reply draft must be optimized against the Phoenix algorithm's scoring model. The algorithm uses a Grok-based transformer to predict engagement probabilities across 19 action types, then combines them with weights.

### What Makes a Reply Rank

For replies specifically, these are the signals that matter most (in priority order for cold-start/growth phase accounts):

| Signal | What It Means | How to Optimize |
| --- | --- | --- |
| `favorite_score` | Will people like this reply? | Sharp insight, useful info, or genuine wit — never generic |
| `dwell_time` | Will people pause to read it? | Substance and specificity create dwell |
| `profile_click_score` | Will people check who wrote this? | Show rare expertise or a strong identity signal |
| `follow_author_score` | Will people follow from this? | Imply you have more where this came from |
| `reply_score` | Will people reply to your reply? | End with a genuine question or debatable point |
| `not_interested_score` | Could this feel irrelevant? | Stay tightly on niche — never generic |
| `block_author_score` | Could this feel hostile? | Critique ideas, never people |

### Draft Format

Always draft 3 options with different strategies:

```
[1] SHORT — punchy take, under 140 chars. Optimizes for favorite + dwell (stop power)
[2] INSIGHTFUL — 1-2 sentences adding real value. Optimizes for profile_click + follow (identity)
[3] QUESTION — sparks conversation. Optimizes for reply + dwell (conversation signal)
```

### Reply Rules (from the algorithm source code)

- Reply to original posts, not deep thread replies. Thunder surfaces replies to originals most reliably.
- Reply to fresh posts. Thunder inventory is recency-first.
- Never reply to the same account twice in one day. AuthorDiversityScorer penalizes repeated author appearances exponentially.
- Never write generic replies ("Great post!", "Love this!", "So true!"). These trigger `not_interested_score` — a negative signal that subtracts from the weighted score.
- Match the energy of the original post. Technical post gets technical reply. Casual post gets casual reply.
- Never mention Orbit or any product directly in replies. The profile click is the conversion mechanism, not the reply text.
- Use the persona voice from persona.yaml: technically sharp, builder mentality, slightly irreverent, never salesy.

### Reply Templates

Choose the template that fits the post:

**Add Data** — when the post is missing proof:
> We measured this on [real workload]. The surprise was [specific result]. The bottleneck was not [obvious thing] — it was [non-obvious thing].

**Respectful Counterpoint** — when you want debate without block risk:
> Best for [specific condition], agreed. But it breaks once you optimize for [constraint]. We hit that wall and solved it by [specific move].

**Build On The Point** — when you want association with the original idea:
> Building exactly this. The hard part has not been [obvious thing] — it has been [specific edge case]. We fixed it by [brief tactic].

**Benchmark Reply** — when numbers matter:
> We tested [A] vs [B]. Winner flips once you care about [latency, cost, accuracy]. Here is the weird part: [one surprising datapoint].

**Tooling Recommendation** — when someone is asking for options:
> If you optimize for [specific use case], pick [approach]. If you optimize for [other use case], pick [other approach]. Most people mix those up.

## Chrome Posting Flow

After the user approves a reply, post it through Chrome. This is the step-by-step flow:

1. Get chrome tab context: `tabs_context_mcp` (if not already connected)
2. Navigate to the post URL: `navigate` with the x.com URL
3. Take a screenshot to verify the page loaded and you're logged in
4. Find the reply input: `find` with query "reply input text box" or "Post text textbox"
5. Click the reply input element using the ref returned
6. Type the reply text: `computer` action `type` with the approved text
7. Take a screenshot to verify the text appears correctly
8. Find the Reply submit button: `find` with query "Reply button to submit"
9. Ask the user for confirmation before clicking (show them what will be posted)
10. Click the Reply button using the ref
11. Wait 2 seconds, take a screenshot to confirm it posted
12. Report success with the reply URL

Important: Always use `find` to get element refs rather than guessing coordinates. X's layout changes and coordinates are unreliable. The `find` tool returns semantic refs that work regardless of layout.

If the page shows a login screen instead of the post, tell the user they need to log into X on Chrome first.

## Safety Rails

These are hard limits, not suggestions:

- **20 replies per day maximum**. Check via `get_engagement_stats` before posting.
- **Never reply to the same author twice in one day**. The AuthorDiversityScorer exponentially decays repeated author appearances.
- **Never post without user approval**. Always show the draft and get explicit "yes" or a number choice before clicking Reply.
- **Never include links in replies**. X suppresses link-containing replies in the algorithm.
- **Never use hashtags in replies**. They signal low-quality content.

## Algorithm Scorecard (Quick Reference)

When the user asks to analyze a draft, score these signal families:

- **Stop power** (25 pts): `favorite_score` + `dwell_score` + `dwell_time` + `click_score`
- **Share power** (20 pts): `share_score` + `share_via_dm_score` + `share_via_copy_link_score`
- **Conversation** (15 pts): `reply_score` + `quote_score` + `quoted_click_score`
- **Identity** (15 pts): `profile_click_score` + `follow_author_score`
- **Media** (10 pts): `photo_expand_score` or eligible `vqv_score`
- **Risk** (subtract up to 15 pts): `not_interested` + `block_author` + `mute_author` + `report`

Green = full points, Yellow = half, Red = zero. For risk signals: Green = 0 subtracted, Red = full subtraction.

For deeper analysis, read `references/algorithm-scorecard.md`.

## Phase Context

@Orbitbuild is in **cold start phase** (71 followers). Cold start priorities:
- Stop power: `favorite`, `dwell`, `click`
- Relevance shaping: strict niche consistency, replies on original posts in your lane
- Follow intent: `profile_click` and `follow_author`

The goal is not viral reach — it's building the embedding cluster so Phoenix retrieves you into the right audiences. Every reply should reinforce: AI code editors, developer tools, building in public, AI-assisted development.

## Additional References

This skill's bundled references (read when deeper analysis is needed):
- `references/algorithm-scorecard.md` — Full 19-action scoring framework
- `references/reply-templates.md` — Extended reply templates and lane rules
- `references/signal-content-map.md` — Signal priority by growth phase
- `references/chrome-posting.md` — Chrome automation troubleshooting

For even deeper algorithm knowledge, the **x-content-creator** skill is available globally. Use it for:
- Content calendar planning
- Post flop diagnosis
- Embedding cluster analysis
- Launch-day posting strategy
- Video strategy
- Full workflow recipes
