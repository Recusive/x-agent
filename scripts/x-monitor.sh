#!/bin/bash
# x-monitor.sh — Background monitoring loop
# Polls target accounts every 60s, sends macOS notification on new posts,
# pre-drafts replies using Claude Code.
#
# Usage: ./scripts/x-monitor.sh
# Stop:  Ctrl+C

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE_DIR="$AGENT_DIR/queue"
LOGDIR="$AGENT_DIR/logs/$(date +%Y-%m-%d)"
PERSONA="$AGENT_DIR/config/persona.yaml"

mkdir -p "$QUEUE_DIR" "$LOGDIR"

# Load .env
if [ -f "$AGENT_DIR/.env" ]; then
  set -a
  source "$AGENT_DIR/.env"
  set +a
fi

echo "🔍 X Agent Monitor started at $(date '+%H:%M:%S')"
echo "   Logging to: $LOGDIR"
echo "   Queue dir:  $QUEUE_DIR"
echo "   Press Ctrl+C to stop"
echo ""

while true; do
  TIMESTAMP=$(date '+%H:%M:%S')

  # Step 1: Check for new posts (fast, no AI)
  RESULT=$(cd "$AGENT_DIR" && bun run src/check-targets.ts 2>/dev/null || echo '{"error":"check failed"}')

  STATUS=$(echo "$RESULT" | jq -r '.status // "found"' 2>/dev/null || echo "error")

  if [ "$STATUS" = "quiet" ]; then
    echo "$TIMESTAMP: quiet"
  elif [ "$STATUS" = "error" ]; then
    echo "$TIMESTAMP: ⚠ check error" >> "$LOGDIR/monitor.log"
  else
    # New posts found!
    POST_COUNT=$(echo "$RESULT" | jq '.new_posts | length' 2>/dev/null || echo 0)
    echo "$TIMESTAMP: 🚨 $POST_COUNT new post(s) detected!"

    # Process each new post
    echo "$RESULT" | jq -c '.new_posts[]' 2>/dev/null | while read -r POST; do
      AUTHOR=$(echo "$POST" | jq -r '.author_username')
      TEXT=$(echo "$POST" | jq -r '.text' | head -c 100)
      POST_ID=$(echo "$POST" | jq -r '.id')
      IS_PRIORITY=$(echo "$POST" | jq -r '.is_priority')
      CONTEXT=$(echo "$POST" | jq -r '.context // ""')
      ANGLES=$(echo "$POST" | jq -r '.angles // [] | join(", ")')

      # macOS notification
      osascript -e "display notification \"$TEXT...\" with title \"🚨 @$AUTHOR just posted\" sound name \"Ping\"" 2>/dev/null || true

      echo "  → @$AUTHOR: $TEXT..."

      # Draft replies using Claude Code
      DRAFTS=$(claude -p "$(cat <<EOF
You are drafting X (Twitter) replies. Read this post and draft 3 reply options.

POST by @$AUTHOR:
"$TEXT"

Author context: $CONTEXT
Suggested angles: $ANGLES

My persona and voice:
$(cat "$PERSONA")

Draft 3 replies:
1. SHORT — punchy take, under 140 chars
2. INSIGHTFUL — 1-2 sentences, adds real value
3. QUESTION — sparks further conversation

Rules:
- Each reply must be unique and contextually relevant
- Never generic ("Great post!", "Love this!")
- Never mention Orbit or any product
- Match the energy of the original post
- Optimize for early engagement (this post is fresh)

Return as JSON: {"drafts": [{"style": "short", "text": "..."}, {"style": "insightful", "text": "..."}, {"style": "question", "text": "..."}]}
EOF
)" --output-format json 2>/dev/null || echo '{"drafts":[]}')

      # Save to queue
      echo "$POST" | jq --argjson drafts "$DRAFTS" '{post: ., drafts: $drafts.drafts}' > "$QUEUE_DIR/$POST_ID.json" 2>/dev/null || true

      echo "  → Drafts ready for @$AUTHOR (queue/$POST_ID.json)"
      echo "$(date): @$AUTHOR - $TEXT" >> "$LOGDIR/monitor.log"
    done
  fi

  # Random 45-90 second interval
  SLEEP=$((45 + RANDOM % 45))
  sleep "$SLEEP"
done
