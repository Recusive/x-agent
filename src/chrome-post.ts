/**
 * Post a reply via Chrome using AppleScript + JavaScript injection.
 * No Claude Code subprocess needed — talks to Chrome directly.
 *
 * Usage: bun run src/chrome-post.ts <post_url> "<reply_text>"
 */

import { execSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";

const postUrl = process.argv[2];
const replyText = process.argv[3];

if (!postUrl || !replyText) {
  console.error('Usage: bun run src/chrome-post.ts <post_url> "<reply_text>"');
  process.exit(1);
}

function runAppleScript(script: string): string {
  const tmpFile = `/tmp/x-agent-chrome-${Date.now()}.scpt`;
  writeFileSync(tmpFile, script);
  try {
    return execSync(`osascript "${tmpFile}"`, {
      encoding: "utf-8",
      timeout: 30000,
    }).trim();
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

// Step 1: Open the post in Chrome
console.log("Opening post in Chrome...");
runAppleScript(`
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then make new window
  set URL of active tab of front window to "${postUrl}"
end tell
`);

// Step 2: Wait for page to load
execSync("sleep 3");

// Step 3: Click reply box and type via JavaScript
console.log("Clicking reply box and typing...");
const jsEscapedText = replyText.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');

const injectResult = runAppleScript(`
tell application "Google Chrome"
  tell active tab of front window
    set jsResult to execute javascript "
      (function() {
        // Find the reply textarea
        var replyArea = document.querySelector('[data-testid=\\"tweetTextarea_0\\"]');
        if (!replyArea) {
          // Try the inline reply on tweet pages
          var placeholders = document.querySelectorAll('[data-text=\\"true\\"]');
          if (placeholders.length > 0) replyArea = placeholders[0];
        }
        if (!replyArea) return 'NO_REPLY_BOX';

        // Click and focus
        replyArea.click();
        replyArea.focus();

        // Insert text using execCommand (works with contenteditable)
        document.execCommand('insertText', false, '${jsEscapedText}');

        return 'TYPED';
      })()
    "
    return jsResult
  end tell
end tell
`);

if (injectResult === "NO_REPLY_BOX") {
  console.error("Could not find reply box. Are you logged in?");
  // Fallback: copy to clipboard
  execSync(`echo -n ${JSON.stringify(replyText)} | pbcopy`);
  console.log("Copied to clipboard. Cmd+V and Post manually.");
  process.exit(1);
}

console.log("Text typed. Clicking Reply button...");

// Step 4: Wait a moment then click Reply button
execSync("sleep 1");

const postResult = runAppleScript(`
tell application "Google Chrome"
  tell active tab of front window
    set jsResult to execute javascript "
      (function() {
        // Find the reply/post button
        var btn = document.querySelector('[data-testid=\\"tweetButtonInline\\"]');
        if (!btn) btn = document.querySelector('[data-testid=\\"tweetButton\\"]');
        if (!btn) {
          // Try finding by role and text
          var buttons = document.querySelectorAll('button[role=\\"button\\"]');
          for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() === 'Reply') {
              btn = buttons[i];
              break;
            }
          }
        }
        if (!btn) return 'NO_BUTTON';

        btn.click();
        return 'CLICKED';
      })()
    "
    return jsResult
  end tell
end tell
`);

if (postResult === "NO_BUTTON") {
  console.error("Could not find Reply button.");
  execSync(`echo -n ${JSON.stringify(replyText)} | pbcopy`);
  console.log("Copied to clipboard. Click Reply manually.");
  process.exit(1);
}

// Step 5: Verify
execSync("sleep 2");
console.log("POSTED");
