/**
 * Delete a tweet/reply.
 * Usage: bun run src/delete-post.ts <tweet_id_or_url>
 */
import { createXClient } from "./x-client.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: bun run src/delete-post.ts <tweet_id_or_url>");
  process.exit(1);
}

const idMatch = input.match(/status\/(\d+)/);
const id = idMatch ? idMatch[1] : input;

const client = await createXClient();
const result = await client.v2.deleteTweet(id);
console.log(result.data.deleted ? "Deleted." : "Failed to delete.");
