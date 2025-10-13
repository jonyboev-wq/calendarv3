import type { EventItem, FamilyKey, Interval } from "./types";
import {
  TASK_DAY_START_HOUR,
  TASK_DAY_END_HOUR,
  BREAK_GAP_MIN,
  MAX_TASK_EVENTS_PER_DAY,
  MAX_TASK_EVENTS_PER_TASK,
  WEEKEND_STUDY_LIMIT,
  FAMILY_WINDOWS,
} from "./config/timeWindows";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type PriorityLevel = 1 | 2 | 3 | 4 | 5;

export type ExistingEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: "fixed" | "flexible";
};

type RequestTimeWindow = {
  dayOffset: number;
  startMinute: number;
  endMinute: number;
};

export type ScheduleRequest = {
  id?: string;
  title: string;
  durationMin: number;
  priority: PriorityLevel;
  timeWindows?: RequestTimeWindow[];
  deadlineDayOffset?: number | null;
  flexibility?: {
    shiftMin?: number;
    shiftMax?: number;
    split?: {
      minChunk: number;
      maxChunks: number;
    };
  };
  notes?: string;
  calendarId?: string;
};

export type PlannedItem = {
  title: string;
  start: Date;
  end: Date;
  priority: number;
  sourceId?: string;
};

export type ScheduleOptions = {
  horizonDays?: number;
  dayStartHour?: number;
  dayEndHour?: number;
};

export type ScheduleResult = {
  planned: PlannedItem[];
  unplaced: ScheduleRequest[];
};

type SchedulerOptions = {
  earliestStart?: Date;
  family?: FamilyKey;
  maxPerDay?: number;
  maxPerDayPerTask?: number;
  dayStartHour?: number;
  dayEndHour?: number;
  breakGapMin?: number;
  weekendStudyLimit?: number;
};

type RequiredSchedulerOptions = {
  earliestStart: Date;
  family: FamilyKey;
  maxPerDay: number;
  maxPerDayPerTask: number;
  dayStartHour: number;
  dayEndHour: number;
  breakGapMin: number;
  weekendStudyLimit: number;
};

type TimelineBlock = Interval & {
  source?: EventItem;
  flexible?: boolean;
  priority: number;
  isBreak?: boolean;
};

const DEFAULT_OPTIONS: RequiredSchedulerOptions = {
  earliestStart: new Date(),
  family: "home",
  maxPerDay: MAX_TASK_EVENTS_PER_DAY,
  maxPerDayPerTask: MAX_TASK_EVENTS_PER_TASK,
  dayStartHour: TASK_DAY_START_HOUR,
  dayEndHour: TASK_DAY_END_HOUR,
  breakGapMin: BREAK_GAP_MIN,
  weekendStudyLimit: WEEKEND_STUDY_LIMIT,
};

// -----------------------------------------------------------
// chunkTask
// -----------------------------------------------------------
export function chunkTask(totalMinutes: number): number[] {
  const value = Math.max(0, Math.round(totalMinutes));
  if (value === 0) return [];
  if (value <= 120) return [value];
  if (value <= 160) {
    const first = Math.floor(value / 2);
    return [first, value - first];
  }
  const chunks: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    const next = Math.min(80, remaining);
    chunks.push(next);
    remaining -= next;
  }
  return chunks;
}

// -----------------------------------------------------------
// scheduleTaskChunksBeforeEvent
// -----------------------------------------------------------
export function scheduleTaskChunksBeforeEvent(
  events: EventItem[],
  anchorEvent: EventItem,
  chunks: number[],
  opts: SchedulerOptions = {}
): Interval[] {
  const settings = resolveOptions(opts, anchorEvent);
  const earliest = clampDate(settings.earliestStart);
  const anchorStart = clampDate(anchorEvent.start);
  const chunkFamily: FamilyKey = settings.family;
  const chunkPriority = anchorEvent.priority ?? 3;

  if (!isFinite(anchorStart.getTime()) || earliest.getTime() >= anchorStart.getTime()) {
    return [];
  }

  const scheduledChunks = sanitizeChunks(chunks);
  if (!scheduledChunks.length) return [];

  const timeline = buildTimeline(events, anchorEvent);
  const perDayExisting = buildPerDayCounts([...events, anchorEvent]);
  const perDayExistingStudy = buildPerDayStudyCounts([...events, anchorEvent]);
  const perDayNew = new Map<string, number>();
  const perDayNewForTask = new Map<string, number>();
  const perDayStudyNew = new Map<string, number>();

  const placements: Array<Interval | null> = Array(scheduledChunks.length).fill(null);
  const horizon = anchorStart.getTime() - earliest.getTime();
  const subDeadlineStep = horizon / (scheduledChunks.length + 1);

  const descriptors = scheduledChunks
    .map((duration, index) => {
      const deadlineMs = earliest.getTime() + subDeadlineStep * (index + 1);
      const safeDeadlineMs = Math.min(anchorStart.getTime() - MINUTE_MS, Math.max(earliest.getTime(), deadlineMs));
      return { index, duration, subDeadline: new Date(safeDeadlineMs) };
    })
    .sort((a, b) => b.subDeadline.getTime() - a.subDeadline.getTime()); // schedule closest to anchor first

  for (const descriptor of descriptors) {
    const duration = descriptor.duration;
    const deadlines = buildDeadlineCandidates(descriptor.subDeadline, earliest, anchorStart);
    let slot: Interval | null = tryPlaceWithDeadlines(
      timeline,
      duration,
      deadlines,
      earliest,
      settings,
      perDayExisting,
      perDayExistingStudy,
      perDayNew,
      perDayNewForTask,
      perDayStudyNew,
      chunkFamily
    );

    if (!slot) {
      let madeSpace = false;
      for (let attempt = 0; attempt < 3 && !slot; attempt += 1) {
        madeSpace =
          tryFreeFlexibleSpace(
            timeline,
            earliest,
            descriptor.subDeadline,
            chunkPriority,
            perDayExisting,
            perDayExistingStudy
          ) || madeSpace;
        if (!madeSpace) break;
        slot = tryPlaceWithDeadlines(
          timeline,
          duration,
          deadlines,
          earliest,
          settings,
          perDayExisting,
          perDayExistingStudy,
          perDayNew,
          perDayNewForTask,
          perDayStudyNew,
          chunkFamily
        );
      }
    }

    if (!slot) continue;

    placements[descriptor.index] = slot;

    const dayKey = dayId(slot.start);
    perDayNew.set(dayKey, (perDayNew.get(dayKey) ?? 0) + 1);
    perDayNewForTask.set(dayKey, (perDayNewForTask.get(dayKey) ?? 0) + 1);
    if (chunkFamily === "study" && isWeekend(slot.start)) {
      perDayStudyNew.set(dayKey, (perDayStudyNew.get(dayKey) ?? 0) + 1);
    }

    addBlockToTimeline(timeline, slot.start, slot.end, chunkPriority);
    ensureBreakBefore(timeline, slot, settings.breakGapMin, chunkPriority, settings.dayStartHour);
  }

  return placements
    .filter((interval): interval is Interval => interval != null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

// -----------------------------------------------------------
// findLatestSlotBeforeDeadline
// -----------------------------------------------------------
export function findLatestSlotBeforeDeadline(
  timeline: Interval[],
  duration: number,
  subDeadline: Date,
  windowStart: Date,
  opts: RequiredSchedulerOptions
): Interval | null {
  const durationMs = Math.max(1, Math.round(duration)) * MINUTE_MS;
  const deadline = clampDate(subDeadline);
  const lowerBound = clampDate(windowStart);

  let cursorDay = startOfDay(deadline);

  while (cursorDay.getTime() >= startOfDay(lowerBound).getTime()) {
    const dayStart = setDayTime(cursorDay, opts.dayStartHour);
    const dayEnd = setDayTime(cursorDay, opts.dayEndHour);
    if (dayEnd <= dayStart) return null;

    const searchStart = Math.max(dayStart.getTime(), lowerBound.getTime());
    let searchEnd = Math.min(dayEnd.getTime(), deadline.getTime());

    if (searchEnd - durationMs < searchStart) {
      cursorDay = new Date(cursorDay.getTime() - DAY_MS);
      continue;
    }

    const busy = collectBusyBlocks(timeline, dayStart, dayEnd);
    const slot = findLatestSlotInDay(busy, durationMs, searchStart, searchEnd);
    if (slot) return slot;

    searchEnd = dayStart.getTime() - MINUTE_MS;
    cursorDay = new Date(cursorDay.getTime() - DAY_MS);
  }

  return null;
}

// -----------------------------------------------------------
// helpers
// -----------------------------------------------------------
function resolveOptions(options: SchedulerOptions, anchor: EventItem): RequiredSchedulerOptions {
  const resolved: RequiredSchedulerOptions = {
    earliestStart: options.earliestStart ? clampDate(options.earliestStart) : clampDate(new Date()),
    family: options.family ?? anchor.family ?? DEFAULT_OPTIONS.family,
    maxPerDay: options.maxPerDay ?? DEFAULT_OPTIONS.maxPerDay,
    maxPerDayPerTask: options.maxPerDayPerTask ?? DEFAULT_OPTIONS.maxPerDayPerTask,
    dayStartHour: TASK_DAY_START_HOUR,
    dayEndHour: TASK_DAY_END_HOUR,
    breakGapMin: options.breakGapMin ?? DEFAULT_OPTIONS.breakGapMin,
    weekendStudyLimit: options.weekendStudyLimit ?? DEFAULT_OPTIONS.weekendStudyLimit,
  };

  const familyWindow = FAMILY_WINDOWS[resolved.family] ?? FAMILY_WINDOWS.home;
  resolved.dayStartHour = options.dayStartHour ?? familyWindow.start ?? TASK_DAY_START_HOUR;
  resolved.dayEndHour = options.dayEndHour ?? familyWindow.end ?? TASK_DAY_END_HOUR;

  if (resolved.dayEndHour <= resolved.dayStartHour) {
    resolved.dayEndHour = resolved.dayStartHour + 1;
  }

  return resolved;
}

function sanitizeChunks(chunks: number[]): number[] {
  return chunks
    .map((value) => Math.max(1, Math.round(value)))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function buildTimeline(events: EventItem[], anchorEvent: EventItem): TimelineBlock[] {
  const timeline: TimelineBlock[] = [];

  const toProcess = [...events, anchorEvent];
  const seen = new Set<string>();

  for (const event of toProcess) {
    if (!event) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const start = clampDate(event.start);
    const end = clampDate(event.end);
    if (end <= start) continue;

    timeline.push({
      start,
      end,
      source: event,
      flexible: event.type === "flexible",
      priority: event.priority ?? 3,
    });
  }

  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
  return timeline;
}

function buildPerDayCounts(events: EventItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of events) {
    const start = clampDate(event.start);
    if (!Number.isFinite(start.getTime())) continue;
    const key = dayId(start);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function buildPerDayStudyCounts(events: EventItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of events) {
    if (event.family !== "study") continue;
    const start = clampDate(event.start);
    if (!Number.isFinite(start.getTime())) continue;
    const key = dayId(start);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function tryPlaceWithDeadlines(
  timeline: TimelineBlock[],
  duration: number,
  deadlines: Date[],
  earliest: Date,
  opts: RequiredSchedulerOptions,
  perDayExisting: Map<string, number>,
  perDayExistingStudy: Map<string, number>,
  perDayNew: Map<string, number>,
  perDayNewForTask: Map<string, number>,
  perDayStudyNew: Map<string, number>,
  family: FamilyKey
): Interval | null {
  for (const deadline of deadlines) {
    let cursorDeadline = deadline;
    const visited = new Set<number>();

    for (let iteration = 0; iteration < 7; iteration += 1) {
      if (cursorDeadline.getTime() < earliest.getTime()) break;

      const slot = findLatestSlotBeforeDeadline(timeline, duration, cursorDeadline, earliest, opts);
      if (!slot) break;

      if (respectsDailyLimits(
        slot,
        opts,
        perDayExisting,
        perDayExistingStudy,
        perDayNew,
        perDayNewForTask,
        perDayStudyNew,
        family
      )) {
        return slot;
      }

      const previousDayDeadline = startOfDay(slot.start).getTime() - MINUTE_MS;
      if (visited.has(previousDayDeadline)) break;
      visited.add(previousDayDeadline);
      cursorDeadline = new Date(previousDayDeadline);
    }
  }

  return null;
}

function buildDeadlineCandidates(subDeadline: Date, earliest: Date, anchorStart: Date): Date[] {
  const candidates: Date[] = [];
  const primary = clampToRange(subDeadline, earliest, anchorStart);
  candidates.push(primary);

  const minus = new Date(primary.getTime() - DAY_MS);
  if (minus.getTime() >= earliest.getTime()) {
    candidates.push(minus);
  }

  const plus = new Date(Math.min(anchorStart.getTime() - MINUTE_MS, primary.getTime() + DAY_MS));
  if (plus.getTime() > primary.getTime()) {
    candidates.push(plus);
  }

  return candidates;
}

function tryFreeFlexibleSpace(
  timeline: TimelineBlock[],
  windowStart: Date,
  deadline: Date,
  chunkPriority: number,
  perDayExisting: Map<string, number>,
  perDayExistingStudy: Map<string, number>
): boolean {
  const rangeStart = windowStart.getTime();
  const rangeEnd = deadline.getTime();
  const candidates = timeline.filter((block) => {
    if (!block.flexible) return false;
    if (block.priority < chunkPriority) return false;
    return overlapsRange(block.start.getTime(), block.end.getTime(), rangeStart, rangeEnd);
  });

  if (!candidates.length) return false;

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (b.end.getTime() - b.start.getTime()) - (a.end.getTime() - a.start.getTime());
  });

  const removable = candidates[0];
  const index = timeline.indexOf(removable);
  if (index >= 0) {
    timeline.splice(index, 1);
    const key = dayId(removable.start);
    if (perDayExisting.has(key)) {
      perDayExisting.set(key, Math.max(0, (perDayExisting.get(key) ?? 0) - 1));
    }
    if (removable.source?.family === "study") {
      perDayExistingStudy.set(key, Math.max(0, (perDayExistingStudy.get(key) ?? 0) - 1));
    }
    return true;
  }
  return false;
}

function addBlockToTimeline(timeline: TimelineBlock[], start: Date, end: Date, priority: number): void {
  timeline.push({ start, end, priority, flexible: false });
  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function ensureBreakBefore(
  timeline: TimelineBlock[],
  interval: Interval,
  breakMinutes: number,
  priority: number,
  dayStartHour: number
): void {
  const gapMs = Math.max(0, Math.round(breakMinutes) * MINUTE_MS);
  if (!gapMs) return;

  const dayStart = setDayTime(interval.start, dayStartHour);
  const candidateStartMs = Math.max(interval.start.getTime() - gapMs, dayStart.getTime());
  if (candidateStartMs >= interval.start.getTime()) return;
  const candidateStart = new Date(candidateStartMs);

  timeline.push({
    start: candidateStart,
    end: interval.start,
    priority,
    flexible: false,
    isBreak: true,
  });
  timeline.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function respectsDailyLimits(
  interval: Interval,
  opts: RequiredSchedulerOptions,
  perDayExisting: Map<string, number>,
  perDayExistingStudy: Map<string, number>,
  perDayNew: Map<string, number>,
  perDayNewForTask: Map<string, number>,
  perDayStudyNew: Map<string, number>,
  family: FamilyKey
): boolean {
  const key = dayId(interval.start);

  const totalExisting = perDayExisting.get(key) ?? 0;
  const totalNew = perDayNew.get(key) ?? 0;
  if (totalExisting + totalNew >= opts.maxPerDay) return false;

  const taskPerDay = perDayNewForTask.get(key) ?? 0;
  if (taskPerDay >= opts.maxPerDayPerTask) return false;

  if (family === "study" && isWeekend(interval.start)) {
    const existingStudy = perDayExistingStudy.get(key) ?? 0;
    const newStudy = perDayStudyNew.get(key) ?? 0;
    if (existingStudy + newStudy >= opts.weekendStudyLimit) return false;
  }

  return true;
}

function collectBusyBlocks(timeline: Interval[], dayStart: Date, dayEnd: Date): Interval[] {
  const startMs = dayStart.getTime();
  const endMs = dayEnd.getTime();
  const blocks: Interval[] = [];

  for (const block of timeline) {
    const blockStart = block.start.getTime();
    const blockEnd = block.end.getTime();
    if (blockEnd <= startMs || blockStart >= endMs) continue;
    const start = new Date(Math.max(blockStart, startMs));
    const end = new Date(Math.min(blockEnd, endMs));
    if (end <= start) continue;
    blocks.push({ start, end });
  }

  blocks.sort((a, b) => a.start.getTime() - b.start.getTime());
  return mergeBlocks(blocks);
}

function mergeBlocks(blocks: Interval[]): Interval[] {
  if (!blocks.length) return blocks;
  const merged: Interval[] = [];
  let current = { ...blocks[0] };

  for (let i = 1; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.start.getTime() <= current.end.getTime()) {
      current.end = new Date(Math.max(current.end.getTime(), block.end.getTime()));
    } else {
      merged.push(current);
      current = { ...block };
    }
  }
  merged.push(current);
  return merged;
}

function findLatestSlotInDay(
  busy: Interval[],
  durationMs: number,
  searchStart: number,
  searchEnd: number
): Interval | null {
  const segments = [
    ...busy.map((block) => ({ start: block.start.getTime(), end: block.end.getTime() })),
    { start: searchStart, end: searchStart },
    { start: searchEnd, end: searchEnd },
  ].sort((a, b) => a.start - b.start);

  for (let i = segments.length - 1; i > 0; i -= 1) {
    const right = segments[i];
    const left = segments[i - 1];
    const gapStart = Math.max(left.end, searchStart);
    const gapEnd = Math.min(right.start, searchEnd);
    if (gapEnd - gapStart < durationMs) continue;

    const candidateEnd = gapEnd;
    const candidateStart = gapEnd - durationMs;
    if (candidateStart < gapStart) continue;

    return { start: new Date(candidateStart), end: new Date(candidateEnd) };
  }

  return null;
}

function clampDate(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  const asDate = new Date(value);
  return new Date(asDate.getTime());
}

function startOfDay(value: Date): Date {
  const date = new Date(value.getTime());
  date.setHours(0, 0, 0, 0);
  return date;
}

function setDayTime(day: Date, hour: number): Date {
  const date = startOfDay(day);
  date.setHours(hour, 0, 0, 0);
  return date;
}

function dayId(value: Date): string {
  return startOfDay(value).toISOString().slice(0, 10);
}

function isWeekend(value: Date): boolean {
  const day = value.getDay();
  return day === 0 || day === 6;
}

function clampToRange(date: Date, min: Date, max: Date): Date {
  const value = date.getTime();
  const minValue = min.getTime();
  const maxValue = max.getTime() - MINUTE_MS;
  const clamped = Math.min(Math.max(value, minValue), maxValue);
  return new Date(clamped);
}

function overlapsRange(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

// -----------------------------------------------------------
// Legacy scheduler API (used by planner UI)
// -----------------------------------------------------------
export function scheduleRequests(
  requests: ScheduleRequest[],
  existingEvents: ExistingEvent[],
  options: ScheduleOptions = {}
): ScheduleResult {
  const horizonDays = Math.max(1, Math.round(options.horizonDays ?? 7));
  const dayStartHour = clampNumber(options.dayStartHour ?? TASK_DAY_START_HOUR, 0, 23);
  const tentativeEnd = options.dayEndHour ?? TASK_DAY_END_HOUR;
  const dayEndHour = clampNumber(tentativeEnd, dayStartHour + 1, 24);

  const busy: Interval[] = existingEvents
    .map((event) => ({
      start: clampDate(event.start),
      end: clampDate(event.end),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const today = startOfDay(new Date());
  const queue = [...requests].sort((a, b) => a.priority - b.priority || b.durationMin - a.durationMin);

  const planned: PlannedItem[] = [];
  const unplaced: ScheduleRequest[] = [];

  for (const request of queue) {
    const windows = buildRequestWindows(request, horizonDays, dayStartHour, dayEndHour);
    let placement: Interval | null = null;

    for (const window of windows) {
      const day = addMinutes(today, window.dayOffset * 1440);
      placement = findEarliestSlot(
        busy,
        day,
        window.startMinute,
        window.endMinute,
        request.durationMin,
        dayStartHour,
        dayEndHour
      );
      if (placement) break;
    }

    if (!placement) {
      unplaced.push(request);
      continue;
    }

    planned.push({
      title: request.title,
      start: placement.start,
      end: placement.end,
      priority: request.priority,
      sourceId: request.id,
    });

    busy.push(placement);
    busy.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return { planned, unplaced };
}

function buildRequestWindows(
  request: ScheduleRequest,
  horizonDays: number,
  defaultStartHour: number,
  defaultEndHour: number
): RequestTimeWindow[] {
  const result: RequestTimeWindow[] = [];
  const defaultStartMin = defaultStartHour * 60;
  const defaultEndMin = defaultEndHour * 60;
  const deadlineOffset =
    request.deadlineDayOffset != null
      ? clampNumber(Math.round(request.deadlineDayOffset), 0, horizonDays - 1)
      : horizonDays - 1;

  if (request.timeWindows && request.timeWindows.length) {
    request.timeWindows.forEach((window) => {
      const dayOffset = clampNumber(Math.round(window.dayOffset), 0, deadlineOffset);
      const startMinute = clampNumber(Math.round(window.startMinute), 0, 1440);
      const endMinute = clampNumber(Math.round(window.endMinute), startMinute + 10, 1440);
      result.push({
        dayOffset,
        startMinute,
        endMinute,
      });
    });
    return result.sort((a, b) => a.dayOffset - b.dayOffset || a.startMinute - b.startMinute);
  }

  for (let offset = 0; offset <= deadlineOffset; offset += 1) {
    result.push({
      dayOffset: offset,
      startMinute: defaultStartMin,
      endMinute: defaultEndMin,
    });
  }

  return result;
}

function findEarliestSlot(
  busy: Interval[],
  day: Date,
  startMinute: number,
  endMinute: number,
  durationMinutes: number,
  defaultStartHour: number,
  defaultEndHour: number
): Interval | null {
  const dayStart = startOfDay(day);
  const windowStart = addMinutes(dayStart, startMinute ?? defaultStartHour * 60);
  const windowEnd = addMinutes(dayStart, endMinute ?? defaultEndHour * 60);
  if (windowEnd <= windowStart) return null;

  const durationMs = Math.max(1, Math.round(durationMinutes)) * MINUTE_MS;
  const stepMs = 10 * MINUTE_MS;

  for (let cursor = windowStart.getTime(); cursor + durationMs <= windowEnd.getTime(); cursor += stepMs) {
    const candidateStart = new Date(cursor);
    const candidateEnd = new Date(cursor + durationMs);
    if (!overlapsAny(busy, candidateStart, candidateEnd)) {
      return { start: candidateStart, end: candidateEnd };
    }
  }

  return null;
}

function overlapsAny(busy: Interval[], start: Date, end: Date): boolean {
  for (const block of busy) {
    if (block.start < end && start < block.end) {
      return true;
    }
  }
  return false;
}

function addMinutes(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * MINUTE_MS);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
