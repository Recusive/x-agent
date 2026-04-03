/**
 * Quick test to verify X API credentials work.
 * Run: bun run test-auth
 */

import { createXClient } from "./x-client.js";

async function main(): Promise<void> {
  console.log("Testing X API authentication...\n");

  const client = await createXClient();

  // Test 1: Get authenticated user
  const me = await client.v2.me({
    "user.fields": ["name", "username", "public_metrics"],
  });

  console.log(`Authenticated as: @${me.data.username} (${me.data.name})`);
  console.log(`Followers: ${me.data.public_metrics?.followers_count ?? "unknown"}`);
  console.log(`Following: ${me.data.public_metrics?.following_count ?? "unknown"}`);
  console.log(`Tweets: ${me.data.public_metrics?.tweet_count ?? "unknown"}`);

  // Test 2: Search (read access)
  console.log("\nTesting search (read access)...");
  const searchResult = await client.v2.search("from:Orbitbuild", {
    max_results: 10,
    "tweet.fields": ["created_at", "public_metrics"],
  });

  const count = searchResult.data?.data?.length ?? 0;
  console.log(`Found ${count} recent tweets from @Orbitbuild`);

  console.log("\n--- All tests passed! API credentials are working. ---");
  console.log("Read: OK");
  console.log("Write: Ready (not tested to avoid posting)");
}

main().catch((err) => {
  console.error("\nAuthentication failed:");
  console.error(String(err));
  console.error("\nCheck your .env file has the correct keys.");
  process.exit(1);
});
