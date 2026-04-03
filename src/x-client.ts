import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { TwitterApi } from "twitter-api-v2";

const TOKEN_PATH = new URL("../data/oauth2-tokens.json", import.meta.url).pathname;

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}. Check your .env file.`);
  }
  return value;
}

interface OAuth2Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  created_at: string;
}

function loadOAuth2Tokens(): OAuth2Tokens | null {
  if (!existsSync(TOKEN_PATH)) return null;
  const raw = readFileSync(TOKEN_PATH, "utf-8");
  return JSON.parse(raw) as OAuth2Tokens;
}

function saveOAuth2Tokens(tokens: OAuth2Tokens): void {
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

async function refreshAccessToken(tokens: OAuth2Tokens): Promise<TwitterApi> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing X_CLIENT_ID or X_CLIENT_SECRET for token refresh");
  }

  const tempClient = new TwitterApi({ clientId, clientSecret });
  const { accessToken, refreshToken, expiresIn } = await tempClient.refreshOAuth2Token(
    tokens.refresh_token,
  );

  const newTokens: OAuth2Tokens = {
    access_token: accessToken,
    refresh_token: refreshToken ?? tokens.refresh_token,
    expires_in: expiresIn,
    created_at: new Date().toISOString(),
  };
  saveOAuth2Tokens(newTokens);

  return new TwitterApi(accessToken);
}

function isTokenExpired(tokens: OAuth2Tokens): boolean {
  const created = new Date(tokens.created_at).getTime();
  const expiresAt = created + (tokens.expires_in - 300) * 1000; // 5 min buffer
  return Date.now() > expiresAt;
}

export async function createXClient(): Promise<TwitterApi> {
  // Try OAuth 2.0 first (needed for replying to restricted posts)
  const tokens = loadOAuth2Tokens();
  if (tokens) {
    if (isTokenExpired(tokens)) {
      console.error("OAuth2 token expired, refreshing...");
      return refreshAccessToken(tokens);
    }
    return new TwitterApi(tokens.access_token);
  }

  // Fall back to OAuth 1.0a (works for search, read, own posts)
  console.error("No OAuth2 tokens found, using OAuth 1.0a (run 'bun run auth' to set up OAuth2)");
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
  reply_settings: string;
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
  "reply_settings",
] as const;

const USER_FIELDS = ["name", "username", "public_metrics"] as const;

function minutesAgo(dateStr: string): number {
  const created = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.round((now - created) / 60000);
}

const DEFAULT_AUTHOR = { name: "unknown", username: "unknown" };
const DEFAULT_METRICS = { like_count: 0, reply_count: 0, retweet_count: 0, impression_count: 0 };

function tweetToPost(
  tweet: {
    id: string;
    text: string;
    author_id?: string;
    created_at?: string;
    conversation_id?: string;
    public_metrics?: {
      like_count?: number;
      reply_count?: number;
      retweet_count?: number;
      impression_count?: number;
    };
  },
  users: Map<string, { name: string; username: string }>,
): PostResult {
  const author = users.get(tweet.author_id ?? "") ?? DEFAULT_AUTHOR;
  const metrics = tweet.public_metrics ?? DEFAULT_METRICS;
  const replySettings = (tweet as unknown as Record<string, unknown>).reply_settings;

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
    reply_settings: typeof replySettings === "string" ? replySettings : "everyone",
  };
}

export async function searchPosts(
  client: TwitterApi,
  query: string,
  maxResults: number = 10,
): Promise<Array<PostResult>> {
  const response = await client.v2.search(query, {
    "tweet.fields": [...TWEET_FIELDS],
    "user.fields": [...USER_FIELDS],
    expansions: ["author_id"],
    max_results: Math.max(10, Math.min(maxResults, 100)),
  });

  const users = new Map<string, { name: string; username: string }>();
  if (response.includes?.users) {
    for (const user of response.includes.users) {
      users.set(user.id, { name: user.name, username: user.username });
    }
  }

  if (!response.data?.data) return [];
  return response.data.data.map((tweet) => tweetToPost(tweet, users));
}

export async function getPost(client: TwitterApi, tweetId: string): Promise<PostResult | null> {
  const response = await client.v2.singleTweet(tweetId, {
    "tweet.fields": [...TWEET_FIELDS],
    "user.fields": [...USER_FIELDS],
    expansions: ["author_id"],
  });

  if (!response.data) return null;

  const users = new Map<string, { name: string; username: string }>();
  const firstUser = response.includes?.users?.[0];
  if (firstUser) {
    users.set(firstUser.id, { name: firstUser.name, username: firstUser.username });
  }

  return tweetToPost(response.data, users);
}

export async function getThread(
  client: TwitterApi,
  tweetId: string,
  maxResults: number = 20,
): Promise<Array<PostResult>> {
  // Get the original tweet to find conversation_id
  const original = await getPost(client, tweetId);
  if (!original) return [];

  const conversationId = original.conversation_id;
  return searchPosts(client, `conversation_id:${conversationId}`, maxResults);
}

export async function getUserPosts(
  client: TwitterApi,
  username: string,
  maxResults: number = 10,
): Promise<Array<PostResult>> {
  return searchPosts(client, `from:${username} -is:reply -is:retweet`, maxResults);
}

export async function postReply(
  client: TwitterApi,
  tweetId: string,
  text: string,
): Promise<ReplyResult> {
  const response = await client.v2.reply(text, tweetId);
  return {
    id: response.data.id,
    text: response.data.text,
    in_reply_to: tweetId,
  };
}

export async function likeTweet(client: TwitterApi, tweetId: string): Promise<boolean> {
  const me = await client.v2.me();
  const result = await client.v2.like(me.data.id, tweetId);
  return result.data.liked;
}
