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
  limits: {
    max_replies_per_day: number;
    max_replies_per_author_per_day: number;
    max_replies_per_loop_per_day: number;
    max_likes_per_day: number;
  };
  timing: {
    start_hour: number;
    end_hour: number;
    min_post_age_minutes: number;
    max_post_age_minutes: number;
  };
  scoring: {
    min_likes: number;
    min_views: number;
    freshness_weight: number;
    engagement_weight: number;
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
  limits: {
    max_replies_per_day: 20,
    max_replies_per_author_per_day: 2,
    max_replies_per_loop_per_day: 10,
    max_likes_per_day: 50,
  },
  timing: {
    start_hour: 7,
    end_hour: 23,
    min_post_age_minutes: 0,
    max_post_age_minutes: 120,
  },
  scoring: {
    min_likes: 5,
    min_views: 100,
    freshness_weight: 1.5,
    engagement_weight: 1.0,
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

/** Read config/strategy.yaml — rate limits, timing, scoring thresholds. */
export function getStrategy(): StrategyConfig {
  try {
    return parseYaml<StrategyConfig>("config/strategy.yaml");
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
