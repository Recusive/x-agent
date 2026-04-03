import { TwitterApi } from "twitter-api-v2";

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}. Check your .env file.`);
  }
  return value;
}

export function createXClient(): TwitterApi {
  return new TwitterApi({
    appKey: getEnvOrThrow("X_API_KEY"),
    appSecret: getEnvOrThrow("X_API_KEY_SECRET"),
    accessToken: getEnvOrThrow("X_ACCESS_TOKEN"),
    accessSecret: getEnvOrThrow("X_ACCESS_TOKEN_SECRET"),
  });
}

export interface PostResult {
  id: string;
  text: string;
  author_id: string;
  author_username: string;
  author_name: string;
  created_at: string;
  likes: number;
  replies: number;
  reposts: number;
  views: number;
  conversation_id: string;
  age_minutes: number;
}

export interface ReplyResult {
  id: string;
  text: string;
  in_reply_to: string;
}

const TWEET_FIELDS = [
  "created_at",
  "public_metrics",
  "conversation_id",
  "in_reply_to_user_id",
] as const;

const USER_FIELDS = ["name", "username", "public_metrics"] as const;

function minutesAgo(dateStr: string): number {
  const created = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.round((now - created) / 60000);
}

export async function searchPosts(
  client: TwitterApi,
  query: string,
  maxResults: number = 10
): Promise<PostResult[]> {
  const response = await client.v2.search(query, {
    "tweet.fields": [...TWEET_FIELDS],
    "user.fields": [...USER_FIELDS],
    expansions: ["author_id"],
    max_results: Math.min(maxResults, 100),
    sort_order: "recency",
  });

  const users = new Map<string, { name: string; username: string }>();
  if (response.includes?.users) {
    for (const user of response.includes.users) {
      users.set(user.id, { name: user.name, username: user.username });
    }
  }

  const posts: PostResult[] = [];
  if (response.data?.data) {
    for (const tweet of response.data.data) {
      const author = users.get(tweet.author_id ?? "") ?? {
        name: "unknown",
        username: "unknown",
      };
      const metrics = tweet.public_metrics ?? {
        like_count: 0,
        reply_count: 0,
        retweet_count: 0,
        impression_count: 0,
      };

      posts.push({
        id: tweet.id,
        text: tweet.text,
        author_id: tweet.author_id ?? "",
        author_username: author.username,
        author_name: author.name,
        created_at: tweet.created_at ?? "",
        likes: metrics.like_count ?? 0,
        replies: metrics.reply_count ?? 0,
        reposts: metrics.retweet_count ?? 0,
        views: metrics.impression_count ?? 0,
        conversation_id: tweet.conversation_id ?? tweet.id,
        age_minutes: minutesAgo(tweet.created_at ?? new Date().toISOString()),
      });
    }
  }

  return posts;
}

export async function getPost(
  client: TwitterApi,
  tweetId: string
): Promise<PostResult | null> {
  const response = await client.v2.singleTweet(tweetId, {
    "tweet.fields": [...TWEET_FIELDS],
    "user.fields": [...USER_FIELDS],
    expansions: ["author_id"],
  });

  if (!response.data) return null;

  const tweet = response.data;
  const author = response.includes?.users?.[0] ?? {
    name: "unknown",
    username: "unknown",
    id: "",
  };
  const metrics = tweet.public_metrics ?? {
    like_count: 0,
    reply_count: 0,
    retweet_count: 0,
    impression_count: 0,
  };

  return {
    id: tweet.id,
    text: tweet.text,
    author_id: tweet.author_id ?? "",
    author_username: author.username,
    author_name: author.name,
    created_at: tweet.created_at ?? "",
    likes: metrics.like_count ?? 0,
    replies: metrics.reply_count ?? 0,
    reposts: metrics.retweet_count ?? 0,
    views: metrics.impression_count ?? 0,
    conversation_id: tweet.conversation_id ?? tweet.id,
    age_minutes: minutesAgo(tweet.created_at ?? new Date().toISOString()),
  };
}

export async function getThread(
  client: TwitterApi,
  tweetId: string,
  maxResults: number = 20
): Promise<PostResult[]> {
  // Get the original tweet to find conversation_id
  const original = await getPost(client, tweetId);
  if (!original) return [];

  const conversationId = original.conversation_id;
  return searchPosts(
    client,
    `conversation_id:${conversationId}`,
    maxResults
  );
}

export async function getUserPosts(
  client: TwitterApi,
  username: string,
  maxResults: number = 10
): Promise<PostResult[]> {
  return searchPosts(client, `from:${username} -is:reply -is:retweet`, maxResults);
}

export async function postReply(
  client: TwitterApi,
  tweetId: string,
  text: string
): Promise<ReplyResult> {
  const response = await client.v2.reply(text, tweetId);
  return {
    id: response.data.id,
    text: response.data.text,
    in_reply_to: tweetId,
  };
}

export async function likeTweet(
  client: TwitterApi,
  tweetId: string
): Promise<boolean> {
  const me = await client.v2.me();
  const result = await client.v2.like(me.data.id, tweetId);
  return result.data.liked;
}
