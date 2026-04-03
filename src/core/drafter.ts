/**
 * Drafter — generates reply drafts and original posts using claude -p.
 * Reads persona and context from config-loader.
 */

import { execSync } from "node:child_process";
import { getContext, getPersona } from "./config-loader.js";

// ── Types ────────────────────────────────────────────────────

interface PostInput {
  author: string;
  text: string;
  context?: string;
}

// ── Helpers ──────────────────────────────────────────────────

function runClaude(prompt: string, timeoutMs: number = 90000): string {
  try {
    return execSync(`claude -p ${JSON.stringify(prompt)} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: timeoutMs,
    }).trim();
  } catch {
    return "";
  }
}

function parseDrafts(raw: string): Array<string> {
  return raw
    .split("\n")
    .filter((line) => /^\d+[.)]/.test(line.trim()))
    .map((line) => line.replace(/^\d+[.)]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 3);
}

function buildPersonaBlock(): string {
  const persona = getPersona();
  const lines: Array<string> = [];

  lines.push(`You are @${persona.handle} — ${persona.product}.`);
  lines.push(`Tone: ${persona.voice.tone}`);
  lines.push(`Style: ${persona.voice.style}`);

  if (persona.voice.never.length > 0) {
    lines.push(`NEVER: ${persona.voice.never.join("; ")}`);
  }
  if (persona.voice.do.length > 0) {
    lines.push(`DO: ${persona.voice.do.join("; ")}`);
  }
  if (persona.algorithm_rules.length > 0) {
    lines.push(`Algorithm rules: ${persona.algorithm_rules.join("; ")}`);
  }

  return lines.join("\n");
}

function buildContextBlock(): string {
  const context = getContext();
  if (context.length === 0) return "";
  // Trim to first 2000 chars to keep prompt reasonable
  return `\nPRODUCT CONTEXT:\n${context.slice(0, 2000)}`;
}

// ── Public API ───────────────────────────────────────────────

/** Draft 3 reply options for a given post. */
export function draftReplies(post: PostInput): Array<string> {
  const personaBlock = buildPersonaBlock();
  const contextBlock = buildContextBlock();
  const postContext = post.context ? `\nAdditional context: ${post.context}` : "";

  const prompt = `Draft 3 short X reply options for this post. Output ONLY 3 lines, numbered 1-3. No extra text.

POST by @${post.author}:
"${post.text}"
${postContext}

PERSONA:
${personaBlock}
${contextBlock}

RULES:
- Never generic ("Great post!", "Love this!", "So true!")
- Never include product links or CTAs
- Never use hashtags
- Match the energy and depth of the original post
- Each reply under 280 characters
- Be specific and substantive

FORMAT:
1. <reply>
2. <reply>
3. <reply>`;

  const raw = runClaude(prompt);
  if (raw.length === 0) return [];
  return parseDrafts(raw);
}

/** Draft an original post on a given topic. */
export function draftOriginalPost(topic: string): string {
  const personaBlock = buildPersonaBlock();
  const contextBlock = buildContextBlock();

  const prompt = `Write a single X post (tweet) about this topic. Output ONLY the post text, nothing else.

TOPIC: ${topic}

PERSONA:
${personaBlock}
${contextBlock}

RULES:
- Under 280 characters
- No hashtags
- No generic platitudes
- Be specific, opinionated, and substantive
- Write something people want to like and reply to`;

  const raw = runClaude(prompt);
  // Take first non-empty line as the post
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  return lines[0]?.trim() ?? "";
}

/**
 * Auto-select the best draft for autonomous posting.
 * Prefers the first draft — Claude typically puts the most
 * "insightful" option first. Falls back to shortest if all else fails.
 */
export function autoSelectBest(drafts: Array<string>): string {
  if (drafts.length === 0) return "";

  // Prefer the first draft (Claude's best pick)
  const first = drafts[0];
  if (first.length > 0 && first.length <= 280) return first;

  // Fallback: pick the first one under 280 chars
  const valid = drafts.filter((d) => d.length > 0 && d.length <= 280);
  if (valid.length > 0) return valid[0];

  // Last resort: truncate first draft
  return first.slice(0, 280);
}
