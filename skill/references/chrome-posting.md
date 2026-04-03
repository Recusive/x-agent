# Chrome Posting Flow — Troubleshooting

## Why Chrome Instead of API

The X API v2 returns 403 "Forbidden" when replying to posts with conversation controls (reply_settings set to "following", "mentionedUsers", "subscribers", or "verified"). Most high-profile accounts use these restrictions.

The web UI at x.com does NOT enforce these restrictions the same way. A logged-in user can reply to any public post from the browser. So we use the API for reading/searching and Chrome for posting.

## Prerequisites

- Chrome must be open
- User must be logged into X as @Orbitbuild on Chrome
- claude-in-chrome extension must be active and connected

## Step-by-Step Posting

1. `tabs_context_mcp(createIfEmpty: true)` — get or create a tab
2. `navigate(url: post_url, tabId: id)` — go to the post
3. `computer(action: "screenshot", tabId: id)` — verify page loaded and logged in
4. `find(query: "reply input text box", tabId: id)` — find the reply textbox ref
5. `computer(action: "left_click", ref: textbox_ref, tabId: id)` — click to focus
6. `computer(action: "type", text: reply_text, tabId: id)` — type the reply
7. `computer(action: "screenshot", tabId: id)` — verify text appears correctly
8. `find(query: "Reply button to submit", tabId: id)` — find the submit button ref
9. **Ask user for confirmation** — show what will be posted
10. `computer(action: "left_click", ref: button_ref, tabId: id)` — click Reply
11. `computer(action: "wait", duration: 2, tabId: id)` — wait for submission
12. `computer(action: "screenshot", tabId: id)` — verify it posted

## Common Issues

**Login screen appears instead of post**: User is not logged in. Tell them to log into X on Chrome manually.

**Reply button click doesn't work with coordinates**: Always use the `ref` from `find` instead of coordinates. X's layout is dynamic.

**Reply box doesn't expand on first click**: Click the textbox ref found via `find`, not the visual coordinates. The element ref is more reliable.

**"Post your reply" text visible but not clickable**: The actual input element is behind the placeholder text. Use `find(query: "Post text textbox")` to get the real input ref.

**Tab doesn't exist error**: Call `tabs_context_mcp` again to get fresh tab IDs. Create a new tab if needed with `tabs_create_mcp`.
