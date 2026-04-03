/**
 * iMessage integration — send drafts, receive reply choice.
 */

import { execSync } from "node:child_process";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";

const DB_PATH = `${process.env.HOME}/Library/Messages/chat.db`;
const TARGET = process.env.IMESSAGE_TARGET;

export function isConfigured(): boolean {
  return !!TARGET && existsSync(DB_PATH);
}

export function sendMessage(text: string): void {
  if (!TARGET) throw new Error("IMESSAGE_TARGET not set in .env");

  // Use a temp AppleScript file to handle multiline text safely
  const tmpFile = `/tmp/x-agent-imessage-${Date.now()}.scpt`;
  const script = `
tell application "Messages"
  set targetBuddy to buddy "${TARGET}" of (1st account whose service type = iMessage)
  send ${JSON.stringify(text)} to targetBuddy
end tell
`;
  writeFileSync(tmpFile, script);
  try {
    execSync(`osascript "${tmpFile}"`, { stdio: "ignore", timeout: 10000 });
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

export function getLatestReply(afterTimestamp: number): string | null {
  if (!TARGET) return null;

  // Messages DB stores dates as seconds since 2001-01-01 (Apple epoch)
  // Convert Unix timestamp to Apple epoch
  const appleEpoch = afterTimestamp - 978307200;
  const appleNano = appleEpoch * 1000000000;

  try {
    const result = execSync(
      `sqlite3 "${DB_PATH}" "
        SELECT m.text
        FROM message m
        JOIN handle h ON m.handle_id = h.ROWID
        WHERE h.id = '${TARGET}'
          AND m.date > ${appleNano}
          AND m.text IS NOT NULL
          AND length(m.text) <= 10
        ORDER BY m.date DESC
        LIMIT 1;
      "`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();

    return result || null;
  } catch {
    return null;
  }
}

export async function waitForReply(timeoutSeconds: number = 120): Promise<string | null> {
  const startTime = Math.floor(Date.now() / 1000);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const reply = getLatestReply(startTime);
    if (reply) return reply.trim();
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return null;
}
