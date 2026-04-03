/**
 * Test iMessage send + receive.
 * Usage: bun run src/test-imessage.ts
 */

import { isConfigured, sendMessage, waitForReply } from "./imessage.js";

if (!isConfigured()) {
  console.error("iMessage not configured. Check IMESSAGE_TARGET in .env and Full Disk Access.");
  process.exit(1);
}

console.log("Sending test message...");

sendMessage(
  `🤖 X Agent Test\n\nThis is a test from your X engagement agent.\n\n[1] Reply works\n[2] Reply also works\n[3] All good\n\nReply 1, 2, or 3`,
);

console.log("Sent! Check your phone.");
console.log("Waiting for your reply (2 min timeout)...\n");

const reply = await waitForReply(120);

if (reply) {
  console.log(`Got your reply: "${reply}"`);
  if (["1", "2", "3"].includes(reply)) {
    console.log(`You picked option ${reply}. iMessage integration works!`);
  } else {
    console.log("Reply received but not 1/2/3. Integration works though!");
  }
} else {
  console.log("No reply received within 2 minutes. Check your Messages app.");
}
