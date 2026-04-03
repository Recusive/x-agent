/**
 * CONTENT CREATE loop — posts original content on a schedule.
 *
 * Reads scheduled times from strategy.yaml and content_topics from keywords.yaml.
 * Only posts if current time is within 5 minutes of a scheduled slot AND no post
 * has been made for that slot today.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { TwitterApi } from "twitter-api-v2";
import { parse } from "yaml";

import { draftOriginalPost } from "../core/drafter.js";
import { logError, logPost } from "../core/logger.js";
import { createPost } from "../core/poster.js";

const LOOP_NAME = "CONTENT";
const SLOT_WINDOW_MINUTES = 5;
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname;

// Track which slots have been posted today using a simple JSON file
const DATA_DIR = `${PROJECT_ROOT}data`;
const SLOTS_FILE = `${DATA_DIR}/content-slots.json`;

interface SlotsTracker {
  date: string;
  posted_slots: Array<string>;
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

function loadPostedSlots(): SlotsTracker {
  try {
    if (existsSync(SLOTS_FILE)) {
      const raw = readFileSync(SLOTS_FILE, "utf-8");
      const data = JSON.parse(raw) as SlotsTracker;
      // Reset if it's a new day
      if (data.date === todayStr()) {
        return data;
      }
    }
  } catch {
    // Corrupted file — start fresh
  }
  return { date: todayStr(), posted_slots: [] };
}

function savePostedSlots(tracker: SlotsTracker): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SLOTS_FILE, JSON.stringify(tracker, null, 2));
}

function getSchedule(): Array<string> {
  try {
    const raw = readFileSync(`${PROJECT_ROOT}config/strategy.yaml`, "utf-8");
    const parsed = parse(raw) as Record<string, unknown>;
    const loops = parsed.loops as Record<string, unknown> | undefined;
    const contentCreate = loops?.content_create as Record<string, unknown> | undefined;
    const schedule = contentCreate?.schedule;
    if (Array.isArray(schedule)) {
      return schedule.map(String);
    }
  } catch {
    // Fall through to default
  }
  return ["10:00", "16:00"];
}

function getContentTopics(): Array<string> {
  try {
    const raw = readFileSync(`${PROJECT_ROOT}config/keywords.yaml`, "utf-8");
    const parsed = parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed.content_topics)) {
      return parsed.content_topics as Array<string>;
    }
  } catch {
    // Fall through
  }
  return [];
}

function isWithinWindow(scheduledTime: string): boolean {
  const now = new Date();
  const [hoursStr, minutesStr] = scheduledTime.split(":");
  const scheduledHour = parseInt(hoursStr, 10);
  const scheduledMinute = parseInt(minutesStr, 10);

  const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();
  const scheduledTotalMinutes = scheduledHour * 60 + scheduledMinute;

  const diff = Math.abs(currentTotalMinutes - scheduledTotalMinutes);
  return diff <= SLOT_WINDOW_MINUTES;
}

export async function runCycle(_client: TwitterApi): Promise<void> {
  try {
    const schedule = getSchedule();
    const tracker = loadPostedSlots();

    // Find a slot that's due right now and hasn't been posted yet
    let activeSlot: string | null = null;
    for (const slot of schedule) {
      if (isWithinWindow(slot) && !tracker.posted_slots.includes(slot)) {
        activeSlot = slot;
        break;
      }
    }

    if (activeSlot === null) {
      return;
    }

    const topics = getContentTopics();
    if (topics.length === 0) {
      logError({
        loop: LOOP_NAME,
        error: "No content topics configured",
        context: "Check keywords.yaml content_topics section",
      });
      return;
    }

    // Pick a random topic
    const topic = topics[Math.floor(Math.random() * topics.length)];

    // Draft the post
    const postText = draftOriginalPost(topic);
    if (postText.length === 0) {
      logError({
        loop: LOOP_NAME,
        error: "Failed to draft original post",
        context: `Topic: "${topic}", Slot: ${activeSlot}`,
      });
      return;
    }

    // Post it
    const posted = createPost(postText);

    if (posted) {
      // Mark this slot as done for today
      tracker.posted_slots.push(activeSlot);
      savePostedSlots(tracker);

      logPost({
        text: postText,
        reason: `[${LOOP_NAME}] Scheduled post for ${activeSlot} slot, topic: "${topic}"`,
      });
    } else {
      logError({
        loop: LOOP_NAME,
        error: "Chrome post failed",
        context: `Post text: "${postText.slice(0, 100)}", Slot: ${activeSlot}`,
      });
    }
  } catch (err) {
    logError({
      loop: LOOP_NAME,
      error: err instanceof Error ? err.message : String(err),
      context: "Cycle-level failure",
    });
  }
}
