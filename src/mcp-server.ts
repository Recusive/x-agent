import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createXClient,
  searchPosts,
  getPost,
  getThread,
  getUserPosts,
  postReply,
  likeTweet,
} from "./x-client.js";
import {
  isPostSeen,
  markPostSeen,
  logReply,
  getRepliedAuthorsToday,
  getRepliesTodayCount,
  getStats,
} from "./store.js";

const client = createXClient();

const server = new McpServer({
  name: "x-agent",
  version: "1.0.0",
});

// --- Tools ---

server.tool(
  "search_posts",
  "Search X for recent posts matching a query. Use 'from:username' to search specific accounts. Combine with keywords, e.g. 'from:borischerny AI editor'",
  {
    query: z.string().describe("X search query"),
    max_results: z
      .number()
      .min(1)
      .max(100)
      .default(10)
      .describe("Max results (default 10)"),
  },
  async ({ query, max_results }) => {
    const posts = await searchPosts(client, query, max_results);
    // Mark all as seen
    for (const post of posts) {
      markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(posts, null, 2) }],
    };
  }
);

server.tool(
  "get_post",
  "Get a single X post by ID or URL. Extracts post ID from URLs automatically.",
  {
    post_id: z
      .string()
      .describe("Tweet ID or full X URL (e.g. https://x.com/user/status/123456)"),
  },
  async ({ post_id }) => {
    // Extract ID from URL if needed
    const idMatch = post_id.match(/status\/(\d+)/);
    const id = idMatch ? idMatch[1] : post_id;

    const post = await getPost(client, id);
    if (!post) {
      return { content: [{ type: "text", text: "Post not found" }] };
    }
    markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);
    return {
      content: [{ type: "text", text: JSON.stringify(post, null, 2) }],
    };
  }
);

server.tool(
  "get_thread",
  "Get the conversation thread for a post",
  {
    post_id: z.string().describe("Tweet ID or URL"),
    max_results: z.number().default(20).describe("Max replies to fetch"),
  },
  async ({ post_id, max_results }) => {
    const idMatch = post_id.match(/status\/(\d+)/);
    const id = idMatch ? idMatch[1] : post_id;
    const thread = await getThread(client, id, max_results);
    return {
      content: [{ type: "text", text: JSON.stringify(thread, null, 2) }],
    };
  }
);

server.tool(
  "get_user_posts",
  "Get recent original posts (no replies/retweets) from a specific user",
  {
    username: z.string().describe("X username without @"),
    max_results: z.number().default(10).describe("Max posts to fetch"),
  },
  async ({ username, max_results }) => {
    const posts = await getUserPosts(client, username, max_results);
    for (const post of posts) {
      markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(posts, null, 2) }],
    };
  }
);

server.tool(
  "post_reply",
  "Post a reply to a tweet. Returns the posted reply details.",
  {
    post_id: z.string().describe("Tweet ID to reply to"),
    text: z.string().max(280).describe("Reply text (max 280 chars)"),
  },
  async ({ post_id, text }) => {
    // Safety checks
    const todayCount = getRepliesTodayCount();
    if (todayCount >= 20) {
      return {
        content: [
          {
            type: "text",
            text: "Daily reply limit reached (20). Try again tomorrow.",
          },
        ],
      };
    }

    const repliedAuthors = getRepliedAuthorsToday();
    const post = await getPost(client, post_id);
    if (post && repliedAuthors.includes(post.author_username)) {
      return {
        content: [
          {
            type: "text",
            text: `Already replied to @${post.author_username} today. Author diversity is important for the algorithm.`,
          },
        ],
      };
    }

    const reply = await postReply(client, post_id, text);
    if (post) {
      logReply(reply.id, post_id, post.author_username, text);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "posted",
              reply_id: reply.id,
              reply_url: `https://x.com/Orbitbuild/status/${reply.id}`,
              text: reply.text,
              today_total: todayCount + 1,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "like_post",
  "Like a post on X",
  {
    post_id: z.string().describe("Tweet ID to like"),
  },
  async ({ post_id }) => {
    const liked = await likeTweet(client, post_id);
    return {
      content: [
        { type: "text", text: liked ? "Liked successfully" : "Already liked or failed" },
      ],
    };
  }
);

server.tool(
  "check_targets",
  "Check target accounts for new posts in the last N minutes. Returns only posts not seen before.",
  {
    usernames: z.array(z.string()).describe("List of usernames to check"),
    minutes: z.number().default(5).describe("Look back N minutes"),
  },
  async ({ usernames, minutes }) => {
    const query = usernames.map((u) => `from:${u}`).join(" OR ");
    const allPosts = await searchPosts(client, `(${query}) -is:reply -is:retweet`, 50);

    const newPosts = allPosts.filter(
      (p) => p.age_minutes <= minutes && !isPostSeen(p.id)
    );

    for (const post of newPosts) {
      markPostSeen(post.id, post.author_username, post.text, post.likes, post.replies);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { new_posts: newPosts, checked: usernames.length, total_found: allPosts.length },
            null,
            2
          ),
        },
      ],
    };
  }
);

server.tool(
  "get_engagement_stats",
  "Get engagement statistics — replies posted today, total replies, unique authors",
  {},
  async () => {
    const stats = getStats();
    return {
      content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
    };
  }
);

// --- Start ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
