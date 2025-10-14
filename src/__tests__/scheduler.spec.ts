import { describe, expect, it, beforeEach } from "vitest";
import { chunkTask, scheduleTaskChunksBeforeEvent } from "../scheduler";
import type { EventItem } from "../types";
import { diffMinutes } from "../utils/date";

const MINUTE = 60_000;

const toUTC = (year: number, month: number, day: number, hour = 0, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour, minute));

const iso = (date: Date): string => date.toISOString();

const buildEvent = (
  id: string,
  start: Date,
  end: Date,
  overrides: Partial<EventItem> = {}
): EventItem => ({
  id,
  title: overrides.title ?? id,
  start: iso(start),
  end: iso(end),
  type: overrides.type ?? "fixed",
  priority: overrides.priority ?? 4,
  family: overrides.family ?? "study",
  ...(overrides.notes ? { notes: overrides.notes } : {}),
});

const dayKey = (date: Date): string => {
  const copy = new Date(date.getTime());
  copy.setUTCHours(0, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
};

const isWeekendUTC = (date: Date): boolean => {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
};

describe("chunkTask", () => {
  it("keeps sub-120 minute tasks whole", () => {
    expect(chunkTask(110)).toEqual([110]);
  });

  it("splits mid-sized tasks into two balanced parts", () => {
    expect(chunkTask(150)).toEqual([75, 75]);
  });

  it("slices larger tasks into capped study blocks", () => {
    expect(chunkTask(300)).toEqual([80, 80, 80, 60]);
  });
});

describe("scheduleTaskChunksBeforeEvent – scenarios", () => {
  let anchorCourse: EventItem;

  beforeEach(() => {
    anchorCourse = buildEvent(
      "anchor-coursework",
      toUTC(2025, 1, 1, 9, 0),
      toUTC(2025, 1, 1, 9, 30),
      { family: "study", type: "fixed", priority: 5, title: "Курсовая защита" }
    );
  });

  it("distributes coursework sessions with daily caps and weekend throttling", () => {
    const earliestStart = toUTC(2024, 12, 1, 8, 0);
    const chunks = chunkTask(30 * 60);

    const slots = scheduleTaskChunksBeforeEvent([], anchorCourse, chunks, {
      earliestStart,
      family: "study",
      maxPerDay: 5,
      maxPerDayPerTask: 1,
      weekendStudyLimit: 2,
      dayStartHour: 8,
      dayEndHour: 23,
      breakGapMin: 10,
    });

    const durations = slots.map((slot) => diffMinutes(slot.end, slot.start));
    const totalDuration = durations.reduce((sum, value) => sum + value, 0);
    const uniqueDays = new Set(slots.map((slot) => dayKey(slot.start)));

    expect(slots).toHaveLength(chunks.length);
    expect(totalDuration).toBe(30 * 60);
    expect(uniqueDays.size).toBe(slots.length);

    const weekendCounts = new Map<string, number>();
    slots.forEach((slot) => {
      if (!isWeekendUTC(slot.start)) return;
      const key = dayKey(slot.start);
      weekendCounts.set(key, (weekendCounts.get(key) ?? 0) + 1);
    });
    weekendCounts.forEach((count) => expect(count).toBeLessThanOrEqual(2));

    slots.forEach((slot, index, arr) => {
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(earliestStart.getTime());
      expect(slot.end.getTime()).toBeLessThan(anchorCourse.start.getTime());
      if (index > 0) {
        const prev = arr[index - 1];
        expect(dayKey(slot.start) > dayKey(prev.start)).toBeTruthy();
      }
    });

    durations.forEach((minutes) => {
      expect(minutes).toBeGreaterThanOrEqual(40);
      expect(minutes).toBeLessThanOrEqual(80);
    });
  });

  it("keeps training sessions within the training window and spreads them across days", () => {
    const anchorTraining = buildEvent(
      "anchor-training-block",
      toUTC(2025, 1, 15, 20, 0),
      toUTC(2025, 1, 15, 20, 30),
      { family: "training", type: "fixed", priority: 3 }
    );
    const existing: EventItem[] = [];
    const earliestStart = toUTC(2025, 1, 5, 7, 0);
    const chunks = [120, 120, 120];

    const slots = scheduleTaskChunksBeforeEvent(existing, anchorTraining, chunks, {
      earliestStart,
      family: "training",
      maxPerDay: 4,
      maxPerDayPerTask: 1,
      dayStartHour: 7,
      dayEndHour: 23,
      breakGapMin: 10,
    });

    expect(slots).toHaveLength(3);

    slots.forEach((slot) => {
      const duration = diffMinutes(slot.end, slot.start);
      expect(duration).toBe(120);
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(earliestStart.getTime());
      expect(slot.end.getTime()).toBeLessThan(anchorTraining.start.getTime());
      const hour = slot.start.getUTCHours();
      const endHour = slot.end.getUTCHours() + (slot.end.getUTCMinutes() ? 1 / 60 : 0);
      expect(hour).toBeGreaterThanOrEqual(7);
      expect(slot.end.getUTCHours()).toBeLessThanOrEqual(23);
      startDays.add(dayKey(slot.start));
    });
    expect(new Set(slots.map((slot) => dayKey(slot.start))).size).toBe(slots.length);
  });

  it("recovers urgent homework time by evicting competing flexible events before the deadline", () => {
    const anchorUrgent = buildEvent(
      "anchor-chemistry-deadline",
      toUTC(2025, 3, 11, 8, 0),
      toUTC(2025, 3, 11, 8, 10),
      { family: "study", type: "fixed", priority: 5 }
    );

    const dayStart = toUTC(2025, 3, 10, 8, 0);
    const blocking: EventItem[] = Array.from({ length: 11 }, (_, index) => {
      const start = new Date(dayStart.getTime() + index * 90 * MINUTE);
      const end = new Date(start.getTime() + 80 * MINUTE);
      return buildEvent(`flex-${index}`, start, end, {
        type: "flexible",
        family: index % 2 === 0 ? "training" : "home",
        priority: 5,
      });
    });

    const chunks = chunkTask(300); // 5h urgent task broken into capped study blocks

    const slots = scheduleTaskChunksBeforeEvent(blocking, anchorUrgent, chunks, {
      earliestStart: dayStart,
      family: "study",
      maxPerDay: 16,
      maxPerDayPerTask: 6,
      dayStartHour: 8,
      dayEndHour: 24,
      breakGapMin: 10,
    });

    expect(slots).toHaveLength(chunks.length);

    const blockingStarts = new Set(blocking.map((event) => new Date(event.start).getTime()));

    slots.forEach((slot) => {
      expect(slot.end.getTime()).toBeLessThan(anchorUrgent.start.getTime());
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(dayStart.getTime());
      expect(blockingStarts.has(slot.start.getTime())).toBe(true);
    });
  });
});
