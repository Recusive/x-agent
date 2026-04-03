/**
 * Fetch a single post by ID or URL.
 * Usage: bun run src/fetch-post.ts <tweet_id_or_url>
 */
import { createXClient, getPost } from "./x-client.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: bun run src/fetch-post.ts <tweet_id_or_url>");
  process.exit(1);
}

const idMatch = input.match(/status\/(\d+)/);
const id = idMatch ? idMatch[1] : input;

const client = await createXClient();
const post = await getPost(client, id);
console.log(JSON.stringify(post, null, 2));
