/**
 * Poster — posts replies, original posts, and likes via Chrome AppleScript.
 * Extracted and refactored from src/chrome-post.ts.
 */

import { execSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";

// ── Helpers ──────────────────────────────────────────────────

function runAppleScript(script: string, timeoutMs: number = 30000): string {
  const tmpFile = `/tmp/x-agent-chrome-${Date.now()}.scpt`;
  writeFileSync(tmpFile, script);
  try {
    return execSync(`osascript "${tmpFile}"`, {
      encoding: "utf-8",
      timeout: timeoutMs,
    }).trim();
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // Cleanup failure is non-critical
    }
  }
}

function sleep(seconds: number): void {
  execSync(`sleep ${seconds}`);
}

function navigateTo(url: string): void {
  runAppleScript(`
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then make new window
  set URL of active tab of front window to "${url}"
end tell
`);
  sleep(3);
}

function escapeForJs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function injectText(text: string): boolean {
  const escaped = escapeForJs(text);
  const result = runAppleScript(`
tell application "Google Chrome"
  tell active tab of front window
    set jsResult to execute javascript "
      (function() {
        var replyArea = document.querySelector('[data-testid=\\"tweetTextarea_0\\"]');
        if (!replyArea) {
          var placeholders = document.querySelectorAll('[data-text=\\"true\\"]');
          if (placeholders.length > 0) replyArea = placeholders[0];
        }
        if (!replyArea) return 'NO_REPLY_BOX';
        replyArea.click();
        replyArea.focus();
        document.execCommand('insertText', false, '${escaped}');
        return 'TYPED';
      })()
    "
    return jsResult
  end tell
end tell
`);
  return result === "TYPED";
}

function clickReplyButton(): boolean {
  sleep(1);
  const result = runAppleScript(`
tell application "Google Chrome"
  tell active tab of front window
    set jsResult to execute javascript "
      (function() {
        var btn = document.querySelector('[data-testid=\\"tweetButtonInline\\"]');
        if (!btn) btn = document.querySelector('[data-testid=\\"tweetButton\\"]');
        if (!btn) {
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
  return result === "CLICKED";
}

function clickPostButton(): boolean {
  sleep(1);
  const result = runAppleScript(`
tell application "Google Chrome"
  tell active tab of front window
    set jsResult to execute javascript "
      (function() {
        var btn = document.querySelector('[data-testid=\\"tweetButton\\"]');
        if (!btn) {
          var buttons = document.querySelectorAll('button[role=\\"button\\"]');
          for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].textContent.trim() === 'Post') {
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
  return result === "CLICKED";
}

function clickLikeButton(): boolean {
  const result = runAppleScript(`
tell application "Google Chrome"
  tell active tab of front window
    set jsResult to execute javascript "
      (function() {
        var btn = document.querySelector('[data-testid=\\"like\\"]');
        if (!btn) return 'NO_BUTTON';
        btn.click();
        return 'CLICKED';
      })()
    "
    return jsResult
  end tell
end tell
`);
  return result === "CLICKED";
}

// ── Public API ───────────────────────────────────────────────

/** Post a reply to a given post URL. Returns true on success. */
export function postReply(postUrl: string, replyText: string): boolean {
  try {
    navigateTo(postUrl);

    if (!injectText(replyText)) {
      return false;
    }

    if (!clickReplyButton()) {
      return false;
    }

    sleep(2);
    return true;
  } catch {
    return false;
  }
}

/** Create a new original post. Returns true on success. */
export function createPost(text: string): boolean {
  try {
    navigateTo("https://x.com/compose/post");

    if (!injectText(text)) {
      return false;
    }

    if (!clickPostButton()) {
      return false;
    }

    sleep(2);
    return true;
  } catch {
    return false;
  }
}

/** Like a post by navigating to it and clicking the like button. Returns true on success. */
export function likePost(postUrl: string): boolean {
  try {
    navigateTo(postUrl);

    if (!clickLikeButton()) {
      return false;
    }

    sleep(1);
    return true;
  } catch {
    return false;
  }
}
