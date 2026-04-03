#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# x-daemon.sh — Persistent X engagement monitoring daemon
#
# Runs 3 loops in parallel:
#   1. Priority accounts — polls every 45s, instant notification
#   2. Monitor accounts — polls every 5 min
#   3. Discovery — finds new accounts every 15 min
#
# Edit config/targets.yaml any time — changes picked up on next cycle.
#
# Usage:
#   ./scripts/x-daemon.sh           # Run in foreground
#   ./scripts/x-daemon.sh --bg      # Run in background
#   ./scripts/x-daemon.sh --stop    # Stop background daemon
#   ./scripts/x-daemon.sh --status  # Check if running
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE_DIR="$AGENT_DIR/queue"
LOGDIR="$AGENT_DIR/logs/$(date +%Y-%m-%d)"
PIDFILE="$AGENT_DIR/data/daemon.pid"
PERSONA="$AGENT_DIR/config/persona.yaml"

mkdir -p "$QUEUE_DIR" "$LOGDIR" "$AGENT_DIR/data"

# Load .env
if [ -f "$AGENT_DIR/.env" ]; then
  set -a
  source "$AGENT_DIR/.env"
  set +a
fi

# ─── Command handling ─────────────────────────────────────────

if [ "${1:-}" = "--stop" ]; then
  if [ -f "$PIDFILE" ]; then
    PID=$(cat "$PIDFILE")
    kill "$PID" 2>/dev/null && echo "Daemon stopped (PID $PID)" || echo "Daemon not running"
    rm -f "$PIDFILE"
  else
    echo "No daemon running"
  fi
  exit 0
fi

if [ "${1:-}" = "--status" ]; then
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "Daemon running (PID $(cat "$PIDFILE"))"
    echo "Today's replies: $(cd "$AGENT_DIR" && bun run src/count-today.ts 2>/dev/null || echo '?')"
    echo "Queue: $(find "$QUEUE_DIR" -name '*.json' 2>/dev/null | wc -l | tr -d ' ') pending"
  else
    echo "Daemon not running"
  fi
  exit 0
fi

if [ "${1:-}" = "--bg" ]; then
  nohup "$0" > "$LOGDIR/daemon.log" 2>&1 &
  echo $! > "$PIDFILE"
  echo "Daemon started in background (PID $!)"
  echo "Logs: $LOGDIR/daemon.log"
  echo "Stop: $0 --stop"
  exit 0
fi

# ─── Helper functions ─────────────────────────────────────────

notify() {
  local TITLE="$1"
  local MSG="$2"
  osascript -e "display notification \"$MSG\" with title \"$TITLE\" sound name \"Ping\"" 2>/dev/null || true
}

is_working_hours() {
  local HOUR=$(date +%H)
  [ "$HOUR" -ge 7 ] && [ "$HOUR" -lt 23 ]
}

draft_replies() {
  local POST_JSON="$1"
  local AUTHOR=$(echo "$POST_JSON" | jq -r '.author_username')
  local TEXT=$(echo "$POST_JSON" | jq -r '.text')
  local CONTEXT=$(echo "$POST_JSON" | jq -r '.context // ""')
  local ANGLES=$(echo "$POST_JSON" | jq -r '.angles // [] | join(", ")')

  claude -p "$(cat <<EOF
Draft 3 X reply options. Output ONLY the JSON, nothing else.

POST by @$AUTHOR:
"$TEXT"

Author context: $CONTEXT
Suggested angles: $ANGLES

My persona:
$(cat "$PERSONA")

Return exactly this JSON format:
{"drafts": [{"style": "short", "text": "..."}, {"style": "insightful", "text": "..."}, {"style": "question", "text": "..."}]}

Rules:
- Each reply must be unique and contextually relevant
- Never generic ("Great post!", "Love this!")
- Never mention Orbit or any product directly
- Match the energy of the original post
- Optimize for favorite_score, profile_click_score, dwell_time
EOF
)" --output-format json 2>/dev/null || echo '{"drafts":[]}'
}

save_to_queue() {
  local POST_JSON="$1"
  local DRAFTS="$2"
  local POST_ID=$(echo "$POST_JSON" | jq -r '.id')
  local TIER="$3"

  echo "$POST_JSON" | jq --argjson drafts "$DRAFTS" --arg tier "$TIER" \
    '{post: ., drafts: $drafts.drafts, tier: $tier, queued_at: (now | todate)}' \
    > "$QUEUE_DIR/$POST_ID.json" 2>/dev/null || true
}

# ─── Priority monitor (every 45s) ────────────────────────────

priority_loop() {
  echo "[PRIORITY] Starting priority account monitor..."
  while true; do
    if is_working_hours; then
      RESULT=$(cd "$AGENT_DIR" && bun run src/check-targets.ts 2>/dev/null || echo '{"status":"error"}')
      STATUS=$(echo "$RESULT" | jq -r '.status // "found"' 2>/dev/null || echo "error")

      if [ "$STATUS" != "quiet" ] && [ "$STATUS" != "error" ]; then
        echo "$RESULT" | jq -c '.new_posts[]' 2>/dev/null | while read -r POST; do
          AUTHOR=$(echo "$POST" | jq -r '.author_username')
          TEXT=$(echo "$POST" | jq -r '.text' | head -c 100)
          POST_ID=$(echo "$POST" | jq -r '.id')

          echo "[PRIORITY] $(date '+%H:%M:%S') 🚨 @$AUTHOR: $TEXT..."

          # Instant notification
          notify "🚨 @$AUTHOR just posted" "$TEXT..."

          # Draft replies
          DRAFTS=$(draft_replies "$POST")
          save_to_queue "$POST" "$DRAFTS" "priority"

          echo "[PRIORITY] Drafts ready → queue/$POST_ID.json"
          echo "$(date '+%Y-%m-%d %H:%M:%S') PRIORITY @$AUTHOR $POST_ID" >> "$LOGDIR/detections.log"
        done
      fi
    fi

    # Random 35-55 second interval
    sleep $((35 + RANDOM % 20))
  done
}

# ─── Monitor accounts (every 5 min) ──────────────────────────

monitor_loop() {
  echo "[MONITOR] Starting monitor account loop..."
  sleep 60  # Offset from priority loop
  while true; do
    if is_working_hours; then
      # Read monitor accounts from config
      HANDLES=$(cd "$AGENT_DIR" && python3 -c "
import yaml
with open('config/targets.yaml') as f:
    cfg = yaml.safe_load(f)
handles = [a['handle'] for a in cfg.get('monitor_accounts', [])]
print(' OR '.join([f'from:{h}' for h in handles]))
" 2>/dev/null || echo "")

      if [ -n "$HANDLES" ]; then
        RESULT=$(cd "$AGENT_DIR" && bun run src/search.ts "($HANDLES) -is:reply -is:retweet" 20 2>/dev/null || echo "")

        # Parse and check for fresh posts (< 15 min)
        # The search.ts outputs human-readable, so we use a simpler check
        echo "[MONITOR] $(date '+%H:%M:%S') Checked monitor accounts"
      fi
    fi

    sleep $((280 + RANDOM % 40))  # ~5 min
  done
}

# ─── Discovery (every 15 min) ────────────────────────────────

discovery_loop() {
  echo "[DISCOVERY] Starting niche discovery loop..."
  sleep 120  # Offset from other loops
  while true; do
    if is_working_hours; then
      RESULT=$(cd "$AGENT_DIR" && bun run src/discover.ts 2>/dev/null || echo '{"status":"error"}')
      STATUS=$(echo "$RESULT" | jq -r '.status // "found"' 2>/dev/null || echo "found")

      if [ "$STATUS" != "no_discoveries" ] && [ "$STATUS" != "error" ]; then
        COUNT=$(echo "$RESULT" | jq '.discoveries | length' 2>/dev/null || echo 0)

        if [ "$COUNT" -gt 0 ]; then
          echo "[DISCOVERY] $(date '+%H:%M:%S') Found $COUNT new accounts!"

          # Notify about top 3
          echo "$RESULT" | jq -c '.discoveries[:3][]' 2>/dev/null | while read -r POST; do
            AUTHOR=$(echo "$POST" | jq -r '.author_username')
            TEXT=$(echo "$POST" | jq -r '.text' | head -c 80)
            LIKES=$(echo "$POST" | jq -r '.likes')
            POST_ID=$(echo "$POST" | jq -r '.id')
            URL=$(echo "$POST" | jq -r '.url')

            notify "🔍 New in your niche: @$AUTHOR" "$TEXT... (${LIKES} likes)"

            # Draft replies for top discoveries
            DRAFTS=$(draft_replies "$POST")
            save_to_queue "$POST" "$DRAFTS" "discovery"

            echo "[DISCOVERY] Queued @$AUTHOR ($LIKES likes) → queue/$POST_ID.json"
            echo "$(date '+%Y-%m-%d %H:%M:%S') DISCOVERY @$AUTHOR $POST_ID $LIKES likes" >> "$LOGDIR/detections.log"
          done
        fi
      fi
    fi

    sleep $((840 + RANDOM % 120))  # ~15 min
  done
}

# ─── Conversation tracker (every 30 min) ─────────────────────

conversation_loop() {
  echo "[CONVO] Starting conversation follow-up tracker..."
  sleep 180  # Offset from other loops
  while true; do
    if is_working_hours; then
      # Check mentions and replies to @Orbitbuild
      MENTIONS=$(cd "$AGENT_DIR" && bun run src/search.ts "@Orbitbuild -from:Orbitbuild" 10 2>/dev/null || echo "")

      if [ -n "$MENTIONS" ]; then
        # Count non-empty lines (each is a post)
        MENTION_COUNT=$(echo "$MENTIONS" | grep -c "@" || echo 0)
        if [ "$MENTION_COUNT" -gt 0 ]; then
          notify "💬 $MENTION_COUNT mentions of @Orbitbuild" "Check conversations"
          echo "[CONVO] $(date '+%H:%M:%S') $MENTION_COUNT mentions found"
          echo "$(date '+%Y-%m-%d %H:%M:%S') MENTIONS $MENTION_COUNT" >> "$LOGDIR/detections.log"
        fi
      fi
    fi

    sleep $((1700 + RANDOM % 200))  # ~30 min
  done
}

# ─── Main ─────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  X Engagement Daemon"
echo "  Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo "  Config:  $AGENT_DIR/config/targets.yaml"
echo "  Queue:   $QUEUE_DIR/"
echo "  Logs:    $LOGDIR/"
echo ""
echo "  Loops:"
echo "    Priority accounts — every 45s"
echo "    Monitor accounts  — every 5 min"
echo "    Discovery         — every 15 min"
echo "    Conversations     — every 30 min"
echo ""
echo "  Reply:   ./scripts/x-reply.sh"
echo "  Stop:    Ctrl+C or ./scripts/x-daemon.sh --stop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Save PID
echo $$ > "$PIDFILE"

# Trap for cleanup
cleanup() {
  echo ""
  echo "Shutting down daemon..."
  rm -f "$PIDFILE"
  kill 0 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Launch all loops in parallel
priority_loop &
monitor_loop &
discovery_loop &
conversation_loop &

# Wait for all
wait
