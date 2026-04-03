/**
 * One-time OAuth 2.0 PKCE setup.
 * Run this once to authorize the app and get access + refresh tokens.
 *
 * Usage: bun run src/auth-setup.ts
 *
 * 1. Opens your browser to X's authorization page
 * 2. You click "Authorize"
 * 3. X redirects to localhost:3000/callback
 * 4. Script catches the code, exchanges for tokens
 * 5. Saves tokens to data/oauth2-tokens.json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { TwitterApi } from "twitter-api-v2";

const CLIENT_ID = process.env.X_CLIENT_ID;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const CALLBACK_URL = "http://localhost:3891/callback";
const TOKEN_PATH = new URL("../data/oauth2-tokens.json", import.meta.url).pathname;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing X_CLIENT_ID or X_CLIENT_SECRET in .env");
  console.error("These are the OAuth 2.0 Client ID and Client Secret from developer.x.com");
  process.exit(1);
}

// Step 1: Generate auth link
const client = new TwitterApi({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });

const { url, codeVerifier, state } = client.generateOAuth2AuthLink(CALLBACK_URL, {
  scope: ["tweet.read", "tweet.write", "users.read", "offline.access", "like.read", "like.write"],
});

console.log("\n📱 Opening X authorization page...\n");
console.log("If the browser doesn't open, go to this URL manually:");
console.log(url);
console.log("");

// Open browser
const proc = Bun.spawn(["open", url]);
await proc.exited;

// Step 2: Start local server to catch the callback
console.log("⏳ Waiting for authorization callback on http://localhost:3000...\n");

const server = Bun.serve({
  port: 3891,
  async fetch(req) {
    const reqUrl = new URL(req.url);

    if (reqUrl.pathname !== "/callback") {
      return new Response("Not found", { status: 404 });
    }

    const code = reqUrl.searchParams.get("code");
    const returnedState = reqUrl.searchParams.get("state");

    if (!code) {
      return new Response("Missing code parameter", { status: 400 });
    }

    if (returnedState !== state) {
      return new Response("State mismatch — possible CSRF attack", { status: 403 });
    }

    try {
      // Step 3: Exchange code for tokens
      const tokenClient = new TwitterApi({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
      const { accessToken, refreshToken, expiresIn } = await tokenClient.loginWithOAuth2({
        code,
        codeVerifier,
        redirectUri: CALLBACK_URL,
      });

      // Step 4: Save tokens
      mkdirSync(dirname(TOKEN_PATH), { recursive: true });
      const tokenData = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiresIn,
        created_at: new Date().toISOString(),
      };
      writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));

      console.log("✅ Authorization successful!");
      console.log(`   Access token saved to: ${TOKEN_PATH}`);
      console.log(`   Token expires in: ${expiresIn} seconds`);
      console.log(`   Refresh token: ${refreshToken ? "saved" : "none"}`);

      // Verify it works
      const verifyClient = new TwitterApi(accessToken);
      const me = await verifyClient.v2.me();
      console.log(`   Authenticated as: @${me.data.username}\n`);
      console.log("🎉 You're all set! The agent can now post replies.\n");

      // Shut down server after a moment
      setTimeout(() => {
        server.stop();
        process.exit(0);
      }, 1000);

      return new Response(
        "<html><body><h1>Authorized!</h1><p>You can close this tab. Go back to the terminal.</p></body></html>",
        { headers: { "Content-Type": "text/html" } },
      );
    } catch (err) {
      console.error("❌ Token exchange failed:", err);
      server.stop();
      process.exit(1);
      return new Response("Token exchange failed", { status: 500 });
    }
  },
});
