/**
 * Post a reply to a tweet.
 * Usage: bun run src/post-reply.ts <tweet_id> "<reply text>"
 */

import { logReply } from "./store.js";
import { createXClient, postReply } from "./x-client.js";

const tweetId = process.argv[2];
const text = process.argv[3];

if (!tweetId || !text) {
  console.error('Usage: bun run src/post-reply.ts <tweet_id> "<reply text>"');
  process.exit(1);
}

const client = await createXClient();
const reply = await postReply(client, tweetId, text);
logReply(reply.id, tweetId, "unknown", text);

console.log(
  JSON.stringify(
    {
      status: "posted",
      reply_id: reply.id,
      reply_url: `https://x.com/Orbitbuild/status/${reply.id}`,
      text: reply.text,
    },
    null,
    2,
  ),
);
