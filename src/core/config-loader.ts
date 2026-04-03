/**
 * Config loader — reads all config files from disk on every call.
 * Hot-reload is more important than caching; these files are small.
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname;

function readFile(relativePath: string): string {
  return readFileSync(`${PROJECT_ROOT}${relativePath}`, "utf-8");
}

function parseYaml<T>(relativePath: string): T {
  return parse(readFile(relativePath)) as T;
}

// ── Types ────────────────────────────────────────────────────

export interface PersonaConfig {
  name: string;
  handle: string;
  product: string;
  voice: {
    tone: string;
    style: string;
    never: Array<string>;
    do: Array<string>;
  };
  angles: Array<string>;
  algorithm_rules: Array<string>;
}

export interface StrategyConfig {
  loops: Record<string, {
    enabled: boolean;
    interval_seconds?: number;
    max_replies_per_day?: number;
    max_likes_per_day?: number;
    max_light_replies_per_day?: number;
    posts_per_day?: number;
    schedule?: Array<string>;
    mention_product?: boolean;
  }>;
  global: {
    max_total_replies_per_day: number;
    max_same_author_per_day: number;
    working_hours: { start: number; end: number };
    notify_imessage: boolean;
    cooldown_between_replies_seconds: number;
  };
  /** Convenience accessor mapped from global */
  limits: {
    max_replies_per_day: number;
    max_replies_per_author_per_day: number;
    max_replies_per_loop_per_day: number;
    max_likes_per_day: number;
  };
}

export interface KeywordsConfig {
  keywords: Array<string>;
  negative_keywords: Array<string>;
}

export interface WatchlistConfig {
  accounts: Array<string>;
}

// ── Defaults (used when config files don't exist yet) ────────

const DEFAULT_STRATEGY: StrategyConfig = {
  loops: {},
  global: {
    max_total_replies_per_day: 25,
    max_same_author_per_day: 1,
    working_hours: { start: 7, end: 23 },
    notify_imessage: true,
    cooldown_between_replies_seconds: 120,
  },
  limits: {
    max_replies_per_day: 25,
    max_replies_per_author_per_day: 1,
    max_replies_per_loop_per_day: 10,
    max_likes_per_day: 30,
  },
};

const DEFAULT_KEYWORDS: KeywordsConfig = {
  keywords: [],
  negative_keywords: [],
};

const DEFAULT_WATCHLIST: WatchlistConfig = {
  accounts: [],
};

// ── Public API ───────────────────────────────────────────────

/** Read config/context.md — raw markdown string with product/company context. */
export function getContext(): string {
  try {
    return readFile("config/context.md");
  } catch {
    return "";
  }
}

/** Read config/persona.yaml — voice, tone, angles. */
export function getPersona(): PersonaConfig {
  try {
    return parseYaml<PersonaConfig>("config/persona.yaml");
  } catch {
    return {
      name: "",
      handle: "",
      product: "",
      voice: { tone: "", style: "", never: [], do: [] },
      angles: [],
      algorithm_rules: [],
    };
  }
}

/** Read config/persona.yaml as raw string (useful for prompt injection). */
export function getPersonaRaw(): string {
  try {
    return readFile("config/persona.yaml");
  } catch {
    return "";
  }
}

/** Read config/strategy.yaml — loops, global settings, derived limits. */
export function getStrategy(): StrategyConfig {
  try {
    const raw = parseYaml<Record<string, unknown>>("config/strategy.yaml");
    const global = (raw.global ?? {}) as StrategyConfig["global"];
    const loops = (raw.loops ?? {}) as StrategyConfig["loops"];

    return {
      loops,
      global: {
        max_total_replies_per_day: global.max_total_replies_per_day ?? 25,
        max_same_author_per_day: global.max_same_author_per_day ?? 1,
        working_hours: global.working_hours ?? { start: 7, end: 23 },
        notify_imessage: global.notify_imessage ?? true,
        cooldown_between_replies_seconds: global.cooldown_between_replies_seconds ?? 120,
      },
      limits: {
        max_replies_per_day: global.max_total_replies_per_day ?? 25,
        max_replies_per_author_per_day: global.max_same_author_per_day ?? 1,
        max_replies_per_loop_per_day: 10,
        max_likes_per_day: (loops.casual_engage as Record<string, unknown>)?.max_likes_per_day as number ?? 30,
      },
    };
  } catch {
    return DEFAULT_STRATEGY;
  }
}

/** Read config/keywords.yaml — search terms and negative filters. */
export function getKeywords(): KeywordsConfig {
  try {
    return parseYaml<KeywordsConfig>("config/keywords.yaml");
  } catch {
    return DEFAULT_KEYWORDS;
  }
}

/** Read config/watchlist.yaml (or root watchlist.yaml) — accounts to monitor. */
export function getWatchlist(): WatchlistConfig {
  // Try config/ first, fall back to root
  try {
    return parseYaml<WatchlistConfig>("config/watchlist.yaml");
  } catch {
    try {
      return parseYaml<WatchlistConfig>("watchlist.yaml");
    } catch {
      return DEFAULT_WATCHLIST;
    }
  }
}
