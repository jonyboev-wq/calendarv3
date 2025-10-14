import { beforeEach, describe, expect, it } from "vitest";
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

const countByDay = (intervals: { start: Date }[]): Map<string, number> => {
  const counts = new Map<string, number>();
  intervals.forEach((interval) => {
    const key = dayKey(interval.start);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
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

describe("scheduleTaskChunksBeforeEvent scenarios", () => {
  let anchorCourse: EventItem;

  beforeEach(() => {
    anchorCourse = buildEvent(
      "coursework-anchor",
      toUTC(2025, 1, 1, 9, 0),
      toUTC(2025, 1, 1, 9, 30),
      { family: "study", type: "fixed", priority: 5, title: "Coursework deadline anchor" }
    );
  });

  it("distributes coursework with daily caps and weekend throttling", () => {
    const earliestStart = toUTC(2024, 12, 1, 8, 0);
    const chunks = chunkTask(30 * 60);
    const anchorStart = new Date(anchorCourse.start);

    expect(chunks.length).toBe(23);
    expect(chunks.filter((minutes) => minutes === 80).length).toBeGreaterThanOrEqual(21);

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

    expect(slots).toHaveLength(chunks.length);

    const durations = slots.map((slot) => diffMinutes(slot.end, slot.start));
    const totalDuration = durations.reduce((sum, value) => sum + value, 0);
    expect(totalDuration).toBe(30 * 60);
    expect(Math.max(...durations)).toBeLessThanOrEqual(80);
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(40);

    const perDay = countByDay(slots);
    expect(perDay.size).toBe(slots.length);
    perDay.forEach((count) => {
      expect(count).toBeLessThanOrEqual(1);
    });

    const weekendCounts = new Map<string, number>();
    slots.forEach((slot) => {
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(earliestStart.getTime());
      expect(slot.end.getTime()).toBeLessThan(anchorStart.getTime());

      if (!isWeekendUTC(slot.start)) return;
      const key = dayKey(slot.start);
      weekendCounts.set(key, (weekendCounts.get(key) ?? 0) + 1);
    });

    weekendCounts.forEach((count) => expect(count).toBeLessThanOrEqual(2));

    let previousStart = earliestStart.getTime() - MINUTE;
    slots.forEach((slot) => {
      expect(slot.start.getTime()).toBeGreaterThan(previousStart);
      previousStart = slot.start.getTime();
    });
  });

  it("keeps training sessions within the training window and spreads them across days", () => {
    const anchorTraining = buildEvent(
      "training-anchor",
      toUTC(2025, 1, 15, 20, 0),
      toUTC(2025, 1, 15, 20, 30),
      { family: "training", type: "fixed", priority: 3 }
    );

    const earliestStart = toUTC(2025, 1, 5, 7, 0);
    const chunks = [120, 120, 120];
    const anchorStart = new Date(anchorTraining.start);

    const slots = scheduleTaskChunksBeforeEvent([], anchorTraining, chunks, {
      earliestStart,
      family: "training",
      maxPerDay: 4,
      maxPerDayPerTask: 1,
      dayStartHour: 7,
      dayEndHour: 23,
      breakGapMin: 10,
    });

    expect(slots).toHaveLength(3);
    const perDay = countByDay(slots);
    expect(perDay.size).toBe(slots.length);
    perDay.forEach((count) => expect(count).toBeLessThanOrEqual(1));

    slots.forEach((slot) => {
      const duration = diffMinutes(slot.end, slot.start);
      const startHour = slot.start.getHours() + slot.start.getMinutes() / 60;
      const endHour = slot.end.getHours() + slot.end.getMinutes() / 60;
      expect(duration).toBe(120);
      expect(startHour).toBeGreaterThanOrEqual(7);
      expect(endHour).toBeLessThanOrEqual(23);
      expect(slot.start.getTime()).toBeGreaterThanOrEqual(earliestStart.getTime());
      expect(slot.end.getTime()).toBeLessThan(anchorStart.getTime());
    });
  });

  it("recovers urgent homework time by evicting competing flexible events before the deadline", () => {
    const anchorUrgent = buildEvent(
      "chemistry-deadline",
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

    const chunks = chunkTask(300);
    const anchorStart = new Date(anchorUrgent.start);

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
    const totalDuration = slots.reduce((sum, slot) => sum + diffMinutes(slot.end, slot.start), 0);
    expect(totalDuration).toBe(300);

    const blockingIntervals = blocking.map((event) => ({
      start: new Date(event.start).getTime(),
      end: new Date(event.end).getTime(),
      family: event.family,
    }));

    const familiesUsed = new Set<EventItem["family"]>();
    slots.forEach((slot) => {
      const startTime = slot.start.getTime();
      const endTime = slot.end.getTime();
      expect(startTime).toBeGreaterThanOrEqual(dayStart.getTime());
      expect(endTime).toBeLessThan(anchorStart.getTime());
      const overlapped = blockingIntervals.find(
        (interval) => startTime < interval.end && interval.start < endTime
      );
      expect(overlapped).toBeDefined();
      familiesUsed.add(overlapped!.family);
    });

    expect(familiesUsed.has("training")).toBe(true);
    expect(familiesUsed.has("home")).toBe(true);
  });
});
