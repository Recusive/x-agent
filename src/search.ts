/**
 * Search for posts.
 * Usage: bun run src/search.ts "<query>" [max_results]
 */
import { createXClient, searchPosts } from "./x-client.js";

const query = process.argv[2];
const maxResults = parseInt(process.argv[3] ?? "10", 10);

if (!query) {
  console.error('Usage: bun run src/search.ts "<query>" [max_results]');
  process.exit(1);
}

const client = await createXClient();
const posts = await searchPosts(client, query, maxResults);

for (const p of posts) {
  console.log(
    `@${p.author_username} (${p.age_minutes}m ago, ${p.likes} likes, ${p.replies} replies):`,
  );
  console.log(`  ${p.text.slice(0, 200)}`);
  console.log(`  https://x.com/${p.author_username}/status/${p.id}`);
  console.log("");
}
