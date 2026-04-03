/**
 * Test the full iMessage flow with a specific post.
 * Usage: bun run src/test-flow.ts <url>
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isConfigured, sendMessage, waitForReply } from "./imessage.js";
import { createXClient, getPost } from "./x-client.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: bun run src/test-flow.ts <url>");
  process.exit(1);
}

const idMatch = input.match(/status\/(\d+)/);
const id = idMatch ? idMatch[1] : input;

const client = await createXClient();
const post = await getPost(client, id);

if (!post) {
  console.error("Post not found");
  process.exit(1);
}

console.log(`\nPost by @${post.author_username}: ${post.text.slice(0, 100)}`);
console.log(`♥ ${post.likes}  💬 ${post.replies}  👁 ${post.views}\n`);

// Draft replies
console.log("Drafting replies...");
const persona = readFileSync(new URL("../config/persona.yaml", import.meta.url).pathname, "utf-8");

const prompt = `Draft 3 short X reply options for this post. Output ONLY 3 lines, numbered 1-3. No extra text.

POST by @${post.author_username}:
"${post.text}"

Persona: ${persona.slice(0, 500)}

Rules:
- Never generic
- Never mention any product
- Match the energy
- Each under 280 chars

Format:
1. <reply>
2. <reply>
3. <reply>`;

const result = execSync(`claude -p ${JSON.stringify(prompt)} 2>/dev/null`, {
  encoding: "utf-8",
  timeout: 90000,
}).trim();

const drafts = result
  .split("\n")
  .filter((line) => /^\d+[.)]/.test(line.trim()))
  .map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
  .slice(0, 3);

console.log("\nDrafts:");
for (let i = 0; i < drafts.length; i++) {
  console.log(`  [${i + 1}] ${drafts[i]}`);
}

if (!isConfigured()) {
  console.error("\niMessage not configured");
  process.exit(1);
}

// Send via iMessage
const url = `https://x.com/${post.author_username}/status/${post.id}`;
const msg = [
  `🚨 @${post.author_username} posted:`,
  `"${post.text.slice(0, 200)}"`,
  `♥ ${post.likes}  💬 ${post.replies}  👁 ${post.views}`,
  ``,
  ...drafts.map((d, i) => `[${i + 1}] ${d}`),
  ``,
  `Reply 1, 2, or 3`,
  url,
].join("\n");

console.log("\n📱 Sending to iMessage...");
sendMessage(msg);
console.log("📱 Sent! Waiting for your reply (3 min)...\n");

const choice = await waitForReply(180);

if (!choice) {
  console.log("No reply received.");
  process.exit(0);
}

console.log(`📱 Got: "${choice}"`);

if (["1", "2", "3"].includes(choice)) {
  const idx = parseInt(choice, 10) - 1;
  const replyText = drafts[idx];

  console.log(`\n🌐 Posting via Chrome: "${replyText}"`);
  sendMessage(`⏳ Posting: "${replyText}"`);

  try {
    execSync(`bun run src/chrome-post.ts ${JSON.stringify(url)} ${JSON.stringify(replyText)}`, {
      encoding: "utf-8",
      timeout: 120000,
      cwd: `${import.meta.dirname}/..`,
    });
    console.log("✅ Posted!");
    sendMessage(`✅ Posted!\n"${replyText}"\n\n${url}`);
  } catch {
    // Fallback to clipboard
    execSync(`echo -n ${JSON.stringify(replyText)} | pbcopy`);
    execSync(`open "${url}"`);
    console.log("⚠ Chrome post failed. Copied to clipboard instead.");
    sendMessage(
      `⚠ Auto-post failed. Copied to clipboard:\n"${replyText}"\n\nCmd+V and Post.\n${url}`,
    );
  }
} else {
  console.log(`Received "${choice}" — not 1/2/3, skipping.`);
}
