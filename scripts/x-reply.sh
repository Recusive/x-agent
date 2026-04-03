#!/bin/bash
# x-reply.sh — Interactive reply picker
# Shows queued posts with pre-drafted replies. Pick a number to post.
#
# Usage: ./scripts/x-reply.sh

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
  echo "Make sure x-monitor.sh is running."
  exit 0
fi

echo "📬 $PENDING post(s) waiting for reply:"
echo ""

for f in "$QUEUE_DIR"/*.json; do
  [ -f "$f" ] || continue

  AUTHOR=$(jq -r '.post.author_username' "$f" 2>/dev/null || echo "unknown")
  TEXT=$(jq -r '.post.text' "$f" 2>/dev/null | head -c 200)
  AGE=$(jq -r '.post.age_minutes' "$f" 2>/dev/null || echo "?")
  LIKES=$(jq -r '.post.likes' "$f" 2>/dev/null || echo "0")
  REPLIES=$(jq -r '.post.replies' "$f" 2>/dev/null || echo "0")
  POST_ID=$(jq -r '.post.id' "$f" 2>/dev/null)

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  @$AUTHOR (${AGE}m ago) — ♥ $LIKES  💬 $REPLIES"
  echo "  $TEXT"
  echo ""

  # Show drafts
  DRAFT_COUNT=$(jq '.drafts | length' "$f" 2>/dev/null || echo 0)
  for i in $(seq 0 $((DRAFT_COUNT - 1))); do
    STYLE=$(jq -r ".drafts[$i].style // \"option\"" "$f" 2>/dev/null)
    DRAFT_TEXT=$(jq -r ".drafts[$i].text" "$f" 2>/dev/null)
    echo "  [$((i + 1))] ($STYLE): $DRAFT_TEXT"
    echo ""
  done

  read -rp "  Post which? (1/2/3/custom/skip/quit): " CHOICE

  case $CHOICE in
    1|2|3)
      IDX=$((CHOICE - 1))
      REPLY_TEXT=$(jq -r ".drafts[$IDX].text" "$f" 2>/dev/null)

      echo ""
      echo "  Posting: \"$REPLY_TEXT\""

      cd "$AGENT_DIR" && claude -p "Use the post_reply tool to reply to post $POST_ID with this exact text: \"$REPLY_TEXT\"" \
        --allowedTools "mcp__x-agent__post_reply" 2>/dev/null

      echo "  ✓ Posted!"
      rm "$f"
      ;;
    custom)
      echo ""
      read -rp "  Your reply: " CUSTOM_TEXT
      echo "  Posting: \"$CUSTOM_TEXT\""

      cd "$AGENT_DIR" && claude -p "Use the post_reply tool to reply to post $POST_ID with this exact text: \"$CUSTOM_TEXT\"" \
        --allowedTools "mcp__x-agent__post_reply" 2>/dev/null

      echo "  ✓ Posted!"
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
