#!/bin/bash
# x-speed.sh — Speed reply from a URL
# Paste an X post URL, get instant drafts, pick and post.
# This is the "Boris just posted" rapid response tool.
#
# Usage: ./scripts/x-speed.sh https://x.com/borischerny/status/123456
#    or: ./scripts/x-speed.sh (will prompt for URL)

set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PERSONA="$AGENT_DIR/config/persona.yaml"

# Load .env
if [ -f "$AGENT_DIR/.env" ]; then
  set -a
  source "$AGENT_DIR/.env"
  set +a
fi

# Get URL from argument or prompt
URL="${1:-}"
if [ -z "$URL" ]; then
  read -rp "Paste X post URL: " URL
fi

if [ -z "$URL" ]; then
  echo "No URL provided."
  exit 1
fi

echo ""
echo "⚡ Speed reply mode — drafting..."
echo ""

# Use Claude Code with MCP tools to read the post and draft replies
cd "$AGENT_DIR" && claude -p "$(cat <<EOF
I need to reply to this X post FAST. Read the post and draft replies.

Post URL: $URL

My persona:
$(cat "$PERSONA")

Steps:
1. Use get_post to read the post
2. Draft 3 reply options:
   [1] SHORT — punchy take, under 140 chars
   [2] INSIGHTFUL — 1-2 sentences, real value
   [3] QUESTION — sparks conversation

Show me the post content and the 3 drafts clearly numbered.
Then ask which one to post (1/2/3/custom/skip).

When I choose, use post_reply to post it.
EOF
)"
