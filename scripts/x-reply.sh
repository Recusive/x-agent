#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# x-reply.sh — Review queued posts and post replies via Chrome
#
# Shows posts detected by the daemon with pre-drafted replies.
# Pick a number to copy to clipboard + open in browser,
# or use Chrome automation via Claude Code.
#
# Usage: ./scripts/x-reply.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QUEUE_DIR="$AGENT_DIR/queue"

# Load .env
if [ -f "$AGENT_DIR/.env" ]; then
  set -a
  source "$AGENT_DIR/.env"
  set +a
fi

PENDING=$(find "$QUEUE_DIR" -name "*.json" -type f 2>/dev/null | wc -l | tr -d ' ')

if [ "$PENDING" -eq 0 ]; then
  echo "No pending posts in queue."
  echo "Start the daemon: ./scripts/x-daemon.sh"
  exit 0
fi

# Sort by tier (priority first) then by age
echo ""
echo "📬 $PENDING post(s) waiting for reply:"
echo ""

for f in $(ls -t "$QUEUE_DIR"/*.json 2>/dev/null); do
  [ -f "$f" ] || continue

  AUTHOR=$(jq -r '.post.author_username' "$f" 2>/dev/null || echo "unknown")
  TEXT=$(jq -r '.post.text' "$f" 2>/dev/null | head -c 200)
  AGE=$(jq -r '.post.age_minutes' "$f" 2>/dev/null || echo "?")
  LIKES=$(jq -r '.post.likes' "$f" 2>/dev/null || echo "0")
  REPLIES=$(jq -r '.post.replies' "$f" 2>/dev/null || echo "0")
  TIER=$(jq -r '.tier // "unknown"' "$f" 2>/dev/null)
  POST_ID=$(jq -r '.post.id' "$f" 2>/dev/null)
  URL="https://x.com/$AUTHOR/status/$POST_ID"

  # Tier badge
  case $TIER in
    priority)  BADGE="🔴 PRIORITY" ;;
    monitor)   BADGE="🟡 MONITOR" ;;
    discovery) BADGE="🟢 DISCOVERY" ;;
    *)         BADGE="⚪ $TIER" ;;
  esac

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $BADGE — @$AUTHOR (${AGE}m ago) — ♥ $LIKES  💬 $REPLIES"
  echo "  $TEXT"
  echo "  $URL"
  echo ""

  # Show drafts
  DRAFT_COUNT=$(jq '.drafts | length' "$f" 2>/dev/null || echo 0)
  for i in $(seq 0 $((DRAFT_COUNT - 1))); do
    STYLE=$(jq -r ".drafts[$i].style // \"option\"" "$f" 2>/dev/null)
    DRAFT_TEXT=$(jq -r ".drafts[$i].text" "$f" 2>/dev/null)
    echo "  [$((i + 1))] ($STYLE): $DRAFT_TEXT"
    echo ""
  done

  read -rp "  Pick (1/2/3), type custom, 'open' to view, skip, quit: " CHOICE

  case $CHOICE in
    1|2|3)
      IDX=$((CHOICE - 1))
      REPLY_TEXT=$(jq -r ".drafts[$IDX].text" "$f" 2>/dev/null)

      # Copy to clipboard
      echo -n "$REPLY_TEXT" | pbcopy

      echo ""
      echo "  📋 Copied to clipboard: \"$REPLY_TEXT\""
      echo "  🌐 Opening post..."
      open "$URL"
      echo ""
      echo "  → Click reply box → Cmd+V → Post"
      echo "  (Or use 'x engage' in Claude Code for browser automation)"
      echo ""
      rm "$f"
      ;;
    open)
      open "$URL"
      echo "  Opened in browser. Come back to pick a reply."
      ;;
    custom)
      echo ""
      read -rp "  Your reply: " CUSTOM_TEXT
      echo -n "$CUSTOM_TEXT" | pbcopy
      echo "  📋 Copied to clipboard"
      echo "  🌐 Opening post..."
      open "$URL"
      echo "  → Click reply box → Cmd+V → Post"
      rm "$f"
      ;;
    skip)
      echo "  Skipped."
      rm "$f"
      ;;
    quit|q)
      echo "  Done."
      exit 0
      ;;
    *)
      echo "  Invalid choice, skipping."
      ;;
  esac

  echo ""
done

echo "Queue empty. Done!"
