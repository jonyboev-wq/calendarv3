import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import { scheduleRequests, type ScheduleRequest, type ExistingEvent, type PriorityLevel } from "./scheduler";
import { CalendarHeader } from "./components/CalendarHeader";
import { CalendarGrid } from "./components/CalendarGrid";
import { DayColumn } from "./components/DayColumn";
import { EventFormDrawer } from "./components/EventFormDrawer";
import { ImportPanel } from "./components/ImportPanel";
import { CalendarsPanel } from "./components/CalendarsPanel";
import { TaskPanel } from "./components/TaskPanel";
import { AddTaskForm } from "./components/AddTaskForm";
import type { FamilyKey, Task as StoredTask, TaskEvent } from "./types";
import type {
  CalendarInfo,
  CalendarEvent,
  PlannerTask,
  DaySlice,
  CalendarInfoMap,
  TaskAssignment,
  TaskCreateInput,
  TaskCreateResult,
} from "./domain";
import { TASK_DAY_START_HOUR, TASK_DAY_END_HOUR } from "./config/timeWindows";

type EventItem = CalendarEvent;
import { uid, clone } from "./utils/misc";
import {
  fmtDay,
  fmtHM,
  startOfDay,
  addMinutes,
  diffMinutes,
  sameDay,
  parseISOorNull,
  toLocalInputValue,
  fromLocalInput,
  getWeekDays,
  isValidDate,
} from "./utils/date";
import { familyLabel, familyCardStyle } from "./utils/family";
import { extractEventMeta } from "./utils/events";
import { createTask, markTaskEventDone, markTaskEventUndone } from "./taskService";

const DEFAULT_CALENDAR_ID = "cal-default";

const PRESET_CALENDAR_COLORS = [
  "#7287fd",
  "#ff7aa2",
  "#34d399",
  "#facc15",
  "#fb923c",
  "#38bdf8",
  "#a855f7",
];

const DEFAULT_CALENDAR: CalendarInfo = {
  id: DEFAULT_CALENDAR_ID,
  name: "Личный",
  color: "#7287fd",
  visible: true,
};

const TASK_SINGLE_THRESHOLD_MIN = 120;
const TASK_MAX_CHUNK_MIN = 80;
const EVENTS_STORAGE_KEY = "mycalendar.events";
const TASK_STORAGE_KEY = "mycalendar.taskAssignments";

const FAMILY_VALUES: FamilyKey[] = ["study", "work", "training", "home"];

const sanitizeEvents = (raw: unknown): CalendarEvent[] => {
  const arr = Array.isArray(raw) ? (raw as any[]) : [];
  const out: CalendarEvent[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const s = parseISOorNull((e as any).start);
    const en = parseISOorNull((e as any).end);
    if (!s || !en) continue;
    if (en <= s) continue;
    const linkedTaskId =
      typeof (e as any).linkedTaskId === "string" && (e as any).linkedTaskId.trim()
        ? (e as any).linkedTaskId.trim()
        : undefined;
    const taskId =
      typeof (e as any).taskId === "string" && (e as any).taskId.trim() ? (e as any).taskId.trim() : undefined;
    const done = typeof (e as any).done === "boolean" ? (e as any).done : false;
    out.push({
      id: String((e as any).id ?? uid()),
      title: String((e as any).title ?? ""),
      start: s.toISOString(),
      end: en.toISOString(),
      type: ((e as any).type === "fixed" ? "fixed" : "flexible") as "fixed" | "flexible",
      priority: (Math.max(1, Math.min(5, Number((e as any).priority ?? 3))) || 3) as CalendarEvent["priority"],
      family: ((): FamilyKey => {
        const f = (e as any).family;
        return FAMILY_VALUES.includes(f) ? (f as FamilyKey) : "home";
      })(),
      notes: typeof (e as any).notes === "string" ? (e as any).notes : "",
      calendarId: String((e as any).calendarId ?? DEFAULT_CALENDAR_ID),
      linkedTaskId,
      taskId,
      done,
    });
  }
  return out;
};

const readStoredEvents = (): CalendarEvent[] => {
  try {
    const raw = localStorage.getItem(EVENTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return sanitizeEvents(parsed);
  } catch {
    return [];
  }
};

const sanitizeCalendars = (raw: unknown): CalendarInfo[] => {
  const arr = Array.isArray(raw) ? (raw as any[]) : [];
  const seen = new Set<string>();
  const cleaned: CalendarInfo[] = [];
  const fallbackColor = (color: unknown): string => {
    if (typeof color !== "string") return DEFAULT_CALENDAR.color;
    const trimmed = color.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) return trimmed;
    return DEFAULT_CALENDAR.color;
  };
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const id = typeof (item as any).id === "string" && (item as any).id.trim()
      ? (item as any).id.trim()
      : uid();
    if (seen.has(id)) continue;
    seen.add(id);
    cleaned.push({
      id,
      name:
        typeof (item as any).name === "string" && (item as any).name.trim()
          ? (item as any).name.trim()
          : "Календарь",
      color: fallbackColor((item as any).color),
      description:
        typeof (item as any).description === "string" && (item as any).description.trim()
          ? (item as any).description.trim()
          : undefined,
      visible: typeof (item as any).visible === "boolean" ? (item as any).visible : true,
    });
  }
  if (!cleaned.some((cal) => cal.id === DEFAULT_CALENDAR_ID)) {
    cleaned.unshift({ ...DEFAULT_CALENDAR });
  }
  if (!cleaned.length) {
    cleaned.push({ ...DEFAULT_CALENDAR });
  }
  return cleaned;
};

const sanitizeTaskAssignments = (raw: unknown): TaskAssignment[] => {
  const arr = Array.isArray(raw) ? (raw as any[]) : [];
  const seen = new Set<string>();
  const cleaned: TaskAssignment[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const id =
      typeof (item as any).id === "string" && (item as any).id.trim()
        ? (item as any).id.trim()
        : uid();
    if (seen.has(id)) continue;
    seen.add(id);
    const title =
      typeof (item as any).title === "string" && (item as any).title.trim()
        ? (item as any).title.trim()
        : "Подготовка";
    const anchorEventId =
      typeof (item as any).anchorEventId === "string" && (item as any).anchorEventId.trim()
        ? (item as any).anchorEventId.trim()
        : null;
    const totalDurationMin = Number.parseInt(String((item as any).totalDurationMin ?? ""), 10);
    if (!anchorEventId || !Number.isFinite(totalDurationMin) || totalDurationMin <= 0) continue;
    const notes =
      typeof (item as any).notes === "string" && (item as any).notes.trim()
        ? (item as any).notes.trim()
        : undefined;
    const chunkEventIds = Array.isArray((item as any).chunkEventIds)
      ? (item as any).chunkEventIds
          .map((raw: unknown) => String(raw ?? "").trim())
          .filter((value: string): value is string => value.length > 0)
      : [];
    const createdAtRaw = typeof (item as any).createdAt === "string" ? (item as any).createdAt : undefined;
    const createdAt = parseISOorNull(createdAtRaw) ?? new Date();

    cleaned.push({
      id,
      title,
      anchorEventId,
      totalDurationMin,
      notes,
      chunkEventIds,
      createdAt: createdAt.toISOString(),
    });
  }
  return cleaned;
};

const formatICSTimestamp = (date: Date): string => {
  const iso = date.toISOString().replace(/[-:]/g, "");
  return `${iso.slice(0, 15)}Z`;
};

const escapeICSString = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const buildICSForCalendar = (calendar: CalendarInfo, events: EventItem[]): string => {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CalendarV3//RU",
    `X-WR-CALNAME:${escapeICSString(calendar.name)}`,
  ];
  const sorted = [...events]
    .filter((event) => event.calendarId === calendar.id)
    .sort((a, b) => {
      const sa = parseISOorNull(a.start)?.getTime() ?? 0;
      const sb = parseISOorNull(b.start)?.getTime() ?? 0;
      return sa - sb;
    });
  const stamp = formatICSTimestamp(new Date());
  sorted.forEach((event) => {
    const startDate = parseISOorNull(event.start);
    const endDate = parseISOorNull(event.end);
    if (!startDate || !endDate) return;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeICSString(event.id)}@calendarv3`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${formatICSTimestamp(startDate)}`);
    lines.push(`DTEND:${formatICSTimestamp(endDate)}`);
    lines.push(`SUMMARY:${escapeICSString(event.title || "Событие")}`);
    lines.push(`CATEGORIES:${escapeICSString(familyLabel(event.family))}`);
    lines.push(`X-CALTYPE:${event.type === "fixed" ? "FIXED" : "FLEXIBLE"}`);
    lines.push(`PRIORITY:${Math.max(0, Math.min(9, Math.round(event.priority ?? 0)))}`);
    if (event.notes) {
      lines.push(`DESCRIPTION:${escapeICSString(event.notes)}`);
    }
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
};

const pickNextCalendarColor = (existing: CalendarInfo[]): string => {
  const used = new Set(existing.map((item) => item.color.toLowerCase()));
  const fresh = PRESET_CALENDAR_COLORS.find((color) => !used.has(color.toLowerCase()));
  return fresh ?? PRESET_CALENDAR_COLORS[(existing.length + 2) % PRESET_CALENDAR_COLORS.length];
};

// ---------- planning helpers ----------
function findFirstFreeSlot(
  events: EventItem[],
  day: Date,
  durationMin: number,
  winStartHour = 8,
  winEndHour = 21
): Date | null {
  const dayStart = clone(day); dayStart.setHours(winStartHour, 0, 0, 0);
  const dayEnd = clone(day); dayEnd.setHours(winEndHour, 0, 0, 0);

  const intervals = events
    .map((e) => ({ s: parseISOorNull(e.start), e: parseISOorNull(e.end) }))
    .filter((iv): iv is { s: Date; e: Date } => !!iv.s && !!iv.e && sameDay(iv.s, day))
    .sort((a, b) => a.s.getTime() - b.s.getTime());

  let cursor = dayStart;
  for (const iv of intervals) {
    if (iv.s > cursor) {
      const gap = diffMinutes(iv.s, cursor);
      if (gap >= durationMin) return cursor;
    }
    if (iv.e > cursor) cursor = iv.e;
    if (cursor >= dayEnd) break;
  }
  if (diffMinutes(dayEnd, cursor) >= durationMin) return cursor;
  return null;
}

function pullForwardSameDay(events: EventItem[], day: Date, calendarId?: string): EventItem[] {
  const dayEvents = events
    .filter((e) => {
      const s = parseISOorNull(e.start);
      if (!s || !sameDay(s, day)) return false;
      if (calendarId && e.calendarId !== calendarId) return false;
      return true;
    })
    .sort((a, b) => (parseISOorNull(a.start)!.getTime() - parseISOorNull(b.start)!.getTime()));

  const fixed: { s: Date; e: Date }[] = [];
  dayEvents.filter((e) => e.type === "fixed").forEach((e) => {
    const s = parseISOorNull(e.start); const en = parseISOorNull(e.end);
    if (s && en) fixed.push({ s, e: en });
  });

  const flex = dayEvents.filter((e) => e.type === "flexible");
  const result = [...events];

  for (const ev of flex) {
    const s0 = parseISOorNull(ev.start);
    const e0 = parseISOorNull(ev.end);
    if (!s0 || !e0) continue;
    const duration = Math.max(1, diffMinutes(e0, s0));

    const blocks = fixed
      .concat(
        result
          .filter((x) => {
            if (x.id === ev.id) return false;
            const sx = parseISOorNull(x.start);
            if (!sx || !sameDay(sx, day)) return false;
            if (calendarId && x.calendarId !== calendarId) return false;
            return x.type === "fixed" || sx < s0;
          })
          .map((x) => ({ s: parseISOorNull(x.start)!, e: parseISOorNull(x.end)! }))
          .filter((iv) => isValidDate(iv.s) && isValidDate(iv.e))
      )
      .sort((a, b) => a.s.getTime() - b.s.getTime());

    const winStart = clone(day); winStart.setHours(6, 0, 0, 0);
    const winEnd = clone(day); winEnd.setHours(23, 0, 0, 0);

    let cursor = winStart;
    let moved = false;
    for (const b of blocks) {
      if (b.s > cursor) {
        const gap = diffMinutes(b.s, cursor);
        if (gap >= duration) {
          const s = cursor; const en = addMinutes(s, duration);
          const idx = result.findIndex((x) => x.id === ev.id);
          if (idx >= 0) result[idx] = { ...ev, start: s.toISOString(), end: en.toISOString() };
          blocks.push({ s, e: en }); blocks.sort((a, b) => a.s.getTime() - b.s.getTime());
          moved = true; break;
        }
      }
      if (b.e > cursor) cursor = b.e;
      if (cursor >= winEnd) break;
    }
    if (!moved && diffMinutes(winEnd, cursor) >= duration) {
      const s = cursor; const en = addMinutes(s, duration);
      const idx = result.findIndex((x) => x.id === ev.id);
      if (idx >= 0) result[idx] = { ...ev, start: s.toISOString(), end: en.toISOString() };
    }
  }

  return result;
}

type Interval = { start: Date; end: Date };

const sortIntervalsAsc = (a: Interval, b: Interval) => a.start.getTime() - b.start.getTime();

function splitTaskDuration(totalMinutes: number): number[] {
  const safeTotal = Math.max(10, Math.round(totalMinutes));
  if (safeTotal <= TASK_SINGLE_THRESHOLD_MIN) {
    return [safeTotal];
  }
  const chunkCount = Math.max(2, Math.ceil(safeTotal / TASK_MAX_CHUNK_MIN));
  const base = Math.floor(safeTotal / chunkCount);
  const remainder = safeTotal % chunkCount;
  const chunks: number[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const extra = i < remainder ? 1 : 0;
    chunks.push(base + extra);
  }
  return chunks;
}

function buildBusyIntervalsForDay(
  events: Interval[],
  windowStart: Date,
  windowEnd: Date
): Interval[] {
  const intervals: Interval[] = [];
  const startTime = windowStart.getTime();
  const endTime = windowEnd.getTime();
  events.forEach((event) => {
    if (!event) return;
    const s = event.start;
    const e = event.end;
    if (!isValidDate(s) || !isValidDate(e)) return;
    if (e <= s) return;
    if (e.getTime() <= startTime || s.getTime() >= endTime) return;
    const clampedStart = new Date(Math.max(s.getTime(), startTime));
    const clampedEnd = new Date(Math.min(e.getTime(), endTime));
    if (clampedEnd <= clampedStart) return;
    intervals.push({ start: clampedStart, end: clampedEnd });
  });
  intervals.sort(sortIntervalsAsc);
  return intervals;
}

function findLatestSlotBeforeDeadline(
  events: Interval[],
  durationMin: number,
  deadline: Date,
  earliestStart: Date,
  dayStartHour: number,
  dayEndHour: number
): Interval | null {
  const durationMs = Math.max(1, durationMin) * 60_000;
  const earliestDayStart = startOfDay(earliestStart);
  const initialCursor = startOfDay(deadline);

  const guardLimit = 90;
  for (let guard = 0; guard < guardLimit; guard += 1) {
    const dayCursor = new Date(initialCursor.getTime() - guard * 24 * 60 * 60 * 1000);
    if (dayCursor.getTime() < earliestDayStart.getTime()) break;

    const windowStart = clone(dayCursor);
    windowStart.setHours(dayStartHour, 0, 0, 0);
    const windowEnd = clone(dayCursor);
    windowEnd.setHours(dayEndHour, 0, 0, 0);

    let effectiveStart = windowStart;
    let effectiveEnd = windowEnd;

    if (sameDay(dayCursor, earliestStart)) {
      effectiveStart = new Date(Math.max(effectiveStart.getTime(), earliestStart.getTime()));
    }

    if (sameDay(dayCursor, deadline)) {
      effectiveEnd = new Date(Math.min(effectiveEnd.getTime(), deadline.getTime()));
    }

    if (effectiveEnd <= effectiveStart) continue;

    const busy = buildBusyIntervalsForDay(events, effectiveStart, effectiveEnd);

    const freeSlots: Interval[] = [];
    let pointer = new Date(effectiveStart);
    for (const interval of busy) {
      if (interval.start.getTime() > pointer.getTime()) {
        const slotStart = new Date(pointer);
        const slotEnd = new Date(Math.min(interval.start.getTime(), effectiveEnd.getTime()));
        if (slotEnd > slotStart) freeSlots.push({ start: slotStart, end: slotEnd });
      }
      if (interval.end.getTime() > pointer.getTime()) {
        pointer = new Date(Math.min(interval.end.getTime(), effectiveEnd.getTime()));
      }
      if (pointer.getTime() >= effectiveEnd.getTime()) break;
    }
    if (pointer.getTime() < effectiveEnd.getTime()) {
      freeSlots.push({ start: new Date(pointer), end: new Date(effectiveEnd) });
    }

    for (let idx = freeSlots.length - 1; idx >= 0; idx -= 1) {
      const slot = freeSlots[idx];
      const slotDuration = slot.end.getTime() - slot.start.getTime();
      if (slotDuration < durationMs) continue;
      const latestStart = Math.max(slot.start.getTime(), slot.end.getTime() - durationMs);
      const candidateStart = new Date(latestStart);
      const candidateEnd = new Date(candidateStart.getTime() + durationMs);
      if (candidateEnd.getTime() > slot.end.getTime()) continue;
      if (candidateStart.getTime() < earliestStart.getTime()) continue;
      return { start: candidateStart, end: candidateEnd };
    }
  }
  return null;
}

function scheduleTaskChunksBeforeEvent(
  events: EventItem[],
  anchorEvent: EventItem,
  chunkDurations: number[],
  options?: { earliestStart?: Date; dayStartHour?: number; dayEndHour?: number }
): Interval[] {
  // EVEN DISTRIBUTION STRATEGY
  // Instead of packing all chunks near the anchor (deadline),
  // we compute a per-chunk sub-deadline that linearly splits the available window
  // from earliestStart to anchorStart into N equal segments. For each chunk i,
  // we search the latest available slot before its own sub-deadline.

  const anchorStart = parseISOorNull(anchorEvent.start);
  if (!anchorStart) {
    throw new Error("Не удалось определить время привязанного события.");
  }

  const earliestStart = options?.earliestStart ?? new Date();
  const dayStartHour = options?.dayStartHour ?? TASK_DAY_START_HOUR;
  const dayEndHour = options?.dayEndHour ?? TASK_DAY_END_HOUR;
  if (dayEndHour <= dayStartHour) {
    throw new Error("Некорректное окно дня для задач.");
  }

  // Build a mutable list of occupied intervals from existing events to avoid overlaps.
  const timelineEvents: Interval[] = events
    .map((ev) => {
      const s = parseISOorNull(ev.start);
      const e = parseISOorNull(ev.end);
      if (!s || !e || e <= s) return null;
      return { start: s, end: e };
    })
    .filter((iv): iv is Interval => !!iv);

  // Guard when anchor is before earliestStart – clamp the window to at least now.
  const windowStart = earliestStart.getTime() > anchorStart.getTime() ? anchorStart : earliestStart;
  const spanMs = Math.max(0, anchorStart.getTime() - windowStart.getTime());
  const n = Math.max(1, chunkDurations.length);

  // Plan chunks in forward order using evenly spaced sub-deadlines.
  const scheduled: Interval[] = [];
  for (let i = 0; i < n; i += 1) {
    const duration = Math.max(1, Math.round(chunkDurations[i]));

    // subDeadline is proportional within [windowStart .. anchorStart]
    // i = 0 => first segment boundary, i = n-1 => near anchorStart
    const subDeadlineTime = windowStart.getTime() + Math.round(((i + 1) / n) * spanMs);
    const subDeadline = new Date(Math.min(subDeadlineTime, anchorStart.getTime()));

    // Find the latest slot before this sub-deadline, considering all already scheduled chunks
    // (we push each scheduled slot into timelineEvents to occupy that time).
    const slot = findLatestSlotBeforeDeadline(
      timelineEvents,
      duration,
      subDeadline,
      windowStart,
      dayStartHour,
      dayEndHour
    );

    if (!slot) {
      throw new Error(
        "Недостаточно свободного времени до выбранного события для равномерного размещения задачи."
      );
    }

    scheduled.push(slot);
    timelineEvents.push({ start: slot.start, end: slot.end });
  }

  // Already built in forward order corresponding to evenly spaced sub-deadlines
  return scheduled;
}

type ICSDateValue = {
  raw: string;
  tz?: string;
};

type ICSRawEvent = {
  summary?: string;
  description?: string;
  location?: string;
  dtStart?: ICSDateValue;
  dtEnd?: ICSDateValue;
  rrule?: string;
  exdates: ICSDateValue[];
};

type ICSOccurrence = {
  summary: string;
  start: Date;
  end: Date;
  notes?: string;
};

const tzOffsets: Record<string, string> = {
  "Europe/Moscow": "+03:00",
};

const dayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

function unfoldICSLines(ics: string): string[] {
  const rows = ics.split(/\r?\n/);
  const lines: string[] = [];
  for (const row of rows) {
    if (!row) continue;
    if (row.startsWith(" ") || row.startsWith("\t")) {
      if (lines.length === 0) continue;
      lines[lines.length - 1] += row.slice(1);
    } else {
      lines.push(row);
    }
  }
  return lines;
}

function parseICSTimestamp(value: string, tz?: string): Date | null {
  if (!value) return null;
  const isUTC = value.endsWith("Z");
  const raw = isUTC ? value.slice(0, -1) : value;
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  let hh = "00";
  let mm = "00";
  let ss = "00";
  if (raw.length > 8) {
    hh = raw.slice(9, 11) || "00";
    mm = raw.slice(11, 13) || "00";
    ss = raw.slice(13, 15) || "00";
  }
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  if (isUTC) return new Date(`${iso}Z`);
  if (tz && tzOffsets[tz]) return new Date(`${iso}${tzOffsets[tz]}`);
  return new Date(`${iso}Z`);
}

function parseICSRRule(rruleRaw: string | undefined) {
  if (!rruleRaw) return null;
  const items = rruleRaw.split(";").map((part) => part.split("=") as [string, string]);
  const map = new Map(items.filter((pair) => pair[0] && pair[1]).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = map.get("FREQ");
  if (!freq) return null;
  const interval = Number.parseInt(map.get("INTERVAL") || "1", 10) || 1;
  const count = map.get("COUNT") ? Number.parseInt(map.get("COUNT")!, 10) : undefined;
  const untilRaw = map.get("UNTIL");
  const until = untilRaw ? parseICSTimestamp(untilRaw) : undefined;
  const byday = map.get("BYDAY") ? map.get("BYDAY")!.split(",").map((code) => code.trim().toUpperCase()).filter(Boolean) : undefined;
  return { freq: freq.toUpperCase(), interval, count, until, byday };
}

function expandICSOccurrences(raw: ICSRawEvent): ICSOccurrence[] {
  if (!raw.dtStart || !raw.dtEnd) return [];
  const start = parseICSTimestamp(raw.dtStart.raw, raw.dtStart.tz);
  const end = parseICSTimestamp(raw.dtEnd.raw, raw.dtEnd.tz);
  if (!start || !end) return [];
  const baseDuration = end.getTime() - start.getTime();
  const summary = raw.summary?.trim() || "Событие";
  const notesParts = [raw.location?.trim(), raw.description?.replace(/\\n/g, "\n").trim()].filter(Boolean);
  const notes = notesParts.length ? notesParts.join("\n") : undefined;
  const exDates = new Set(
    raw.exdates
      .map((ex) => parseICSTimestamp(ex.raw, ex.tz))
      .filter((d): d is Date => !!d)
      .map((d) => d.toISOString())
  );

  const occurrences: ICSOccurrence[] = [];
  const rule = parseICSRRule(raw.rrule);
  if (!rule || rule.freq !== "WEEKLY") {
    if (!exDates.has(start.toISOString())) {
      occurrences.push({ summary, start, end, notes });
    }
    return occurrences;
  }

  const intervalWeeks = Math.max(1, rule.interval);
  const limit = rule.until ?? new Date(start.getTime() + 1000 * 60 * 60 * 24 * 180);
  const countLimit = rule.count ?? Infinity;
  const byDays = (rule.byday && rule.byday.length ? rule.byday : [dayCodes[start.getDay()]]) as string[];

  for (const code of byDays) {
    const targetDow = dayCodes.indexOf(code as typeof dayCodes[number]);
    if (targetDow === -1) continue;
    let current = new Date(start);
    const diff = (targetDow - current.getDay() + 7) % 7;
    current.setDate(current.getDate() + diff);
    if (diff !== 0 || current < start) {
      current.setDate(current.getDate() + (diff === 0 ? 7 * intervalWeeks : 0));
    }
    while (current <= limit && occurrences.length < countLimit) {
      const occurrenceStart = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate(),
        start.getHours(),
        start.getMinutes(),
        start.getSeconds(),
        start.getMilliseconds()
      );
      if (occurrenceStart < start) {
        current.setDate(current.getDate() + 7 * intervalWeeks);
        continue;
      }
      const occurrenceEnd = new Date(occurrenceStart.getTime() + baseDuration);
      const isoKey = occurrenceStart.toISOString();
      if (!exDates.has(isoKey)) {
        occurrences.push({ summary, start: occurrenceStart, end: occurrenceEnd, notes });
      }
      current.setDate(current.getDate() + 7 * intervalWeeks);
    }
  }

  return occurrences;
}

function parseICSEvents(ics: string): ICSOccurrence[] {
  const lines = unfoldICSLines(ics);
  const events: ICSRawEvent[] = [];
  let current: ICSRawEvent | null = null;
  for (const lineRaw of lines) {
    const line = lineRaw.trimEnd();
    if (line === "BEGIN:VEVENT") {
      current = { exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const keyPart = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [key, ...paramParts] = keyPart.split(";");
    const params: Record<string, string> = {};
    for (const part of paramParts) {
      const eq = part.indexOf("=");
      if (eq !== -1) {
        const pKey = part.slice(0, eq).toUpperCase();
        const pValue = part.slice(eq + 1);
        params[pKey] = pValue;
      }
    }
    const upperKey = key.toUpperCase();
    if (upperKey === "SUMMARY") {
      current.summary = value;
    } else if (upperKey === "DESCRIPTION") {
      current.description = current.description ? `${current.description}\n${value}` : value;
    } else if (upperKey === "LOCATION") {
      current.location = value;
    } else if (upperKey === "DTSTART") {
      current.dtStart = { raw: value, tz: params.TZID };
    } else if (upperKey === "DTEND") {
      current.dtEnd = { raw: value, tz: params.TZID };
    } else if (upperKey === "RRULE") {
      current.rrule = value;
    } else if (upperKey === "EXDATE") {
      const rawVals = value.split(",");
      rawVals.forEach((raw) => current!.exdates.push({ raw, tz: params.TZID }));
    }
  }
  return events.flatMap(expandICSOccurrences);
}

// ---------- component ----------
export default function CalendarApp() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [calendars, setCalendars] = useState<CalendarInfo[]>(() => {
    try {
      const raw = localStorage.getItem("mycalendar.calendars");
      const parsed = raw ? JSON.parse(raw) : [];
      return sanitizeCalendars(parsed);
    } catch {
      return [{ ...DEFAULT_CALENDAR }];
    }
  });
  const [activeCalendarId, setActiveCalendarId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem("mycalendar.activeCalendar");
      return stored || DEFAULT_CALENDAR_ID;
    } catch {
      return DEFAULT_CALENDAR_ID;
    }
  });
  const [events, setEvents] = useState<EventItem[]>(() => readStoredEvents());
  const [taskAssignments, setTaskAssignments] = useState<TaskAssignment[]>(() => {
    try {
      const raw = localStorage.getItem(TASK_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return sanitizeTaskAssignments(parsed);
    } catch {
      return [];
    }
  });
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Partial<EventItem> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [icsText, setIcsText] = useState("");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importCalendarId, setImportCalendarId] = useState<string>(() => activeCalendarId);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [showTasksPanel, setShowTasksPanel] = useState(false);
  const [taskPanelMessage, setTaskPanelMessage] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [taskSeed, setTaskSeed] = useState<{ eventId: string; title: string } | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    id: string;
    dayKey: string;
    offsetMinutes: number;
    duration: number;
    originalMinutes: number;
  } | null>(null);
  const [showPlanner, setShowPlanner] = useState(false);
  const [showCalendarsPanel, setShowCalendarsPanel] = useState(false);
  const [calendarExportData, setCalendarExportData] = useState<{ calendarId: string; ics: string } | null>(null);
  const [exportCopyStatus, setExportCopyStatus] = useState<string | null>(null);
  const makePlannerTask = (overrides?: Partial<PlannerTask>): PlannerTask => ({
    id: uid(),
    title: "",
    durationMin: 60,
    priority: 3,
    dayPreference: "any",
    startTime: "09:00",
    endTime: "18:00",
    deadlineDayOffset: null,
    shiftBefore: undefined,
    shiftAfter: undefined,
    allowSplit: false,
    minChunk: undefined,
    maxChunks: undefined,
    notes: "",
    calendarId: activeCalendarId,
    ...overrides,
  });
  const [plannerTasks, setPlannerTasks] = useState<PlannerTask[]>(() => [makePlannerTask()]);
  const [plannerMessage, setPlannerMessage] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    id: string;
    dayKey: string;
    startMinutes: number;
  } | null>(null);
  const dragPointerRef = useRef<HTMLElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const calendarSwipeRef = useRef<HTMLDivElement | null>(null);
  const autoScrolledRef = useRef(false);
  const updatePlannerTask = (id: string, patch: Partial<PlannerTask>) => {
    setPlannerTasks((prev) => prev.map((task) => (task.id === id ? { ...task, ...patch } : task)));
  };
  const removePlannerTask = (id: string) => {
    setPlannerTasks((prev) => {
      if (prev.length <= 1) return [makePlannerTask()];
      return prev.filter((task) => task.id !== id);
    });
  };
  const addPlannerTask = () => {
    setPlannerTasks((prev) => [...prev, makePlannerTask()]);
  };
  const refreshEventsFromStorage = useCallback(() => {
    setEvents(readStoredEvents());
  }, []);

  useEffect(() => {
    if (!taskStatus) return;
    const timeout = window.setTimeout(() => setTaskStatus(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [taskStatus]);

  useLayoutEffect(() => {
    const firstEvent = events
      .map((e) => ({ ...e, start: parseISOorNull(e.start) }))
      .filter((e) => e.start)
      .sort((a, b) => a.start!.getTime() - b.start!.getTime())[0];

    if (firstEvent) {
      const element = document.getElementById(`event-${firstEvent.id}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, []);

  const weekDays = useMemo(() => getWeekDays(anchor), [anchor, now]);


  const calendarMap = useMemo<CalendarInfoMap>(() => {
    const map: CalendarInfoMap = new Map();
    calendars.forEach((cal) => map.set(cal.id, cal));
    return map;
  }, [calendars]);

  const visibleCalendarIds = useMemo(() => {
    const set = new Set<string>();
    calendars.forEach((cal) => {
      if (cal.visible) set.add(cal.id);
    });
    return set;
  }, [calendars]);

  const activeCalendar = calendarMap.get(activeCalendarId) ?? calendars[0] ?? DEFAULT_CALENDAR;

  useEffect(() => {
    localStorage.setItem("mycalendar.calendars", JSON.stringify(calendars));
    if (!calendars.some((cal) => cal.id === activeCalendarId)) {
      const fallback = calendars[0]?.id ?? DEFAULT_CALENDAR_ID;
      if (fallback && fallback !== activeCalendarId) {
        setActiveCalendarId(fallback);
      }
    }
    if (!calendars.some((cal) => cal.id === importCalendarId)) {
      const fallback = calendars[0]?.id ?? DEFAULT_CALENDAR_ID;
      if (fallback && fallback !== importCalendarId) {
        setImportCalendarId(fallback);
      }
    }
  }, [calendars, activeCalendarId, importCalendarId]);

  useEffect(() => {
    localStorage.setItem("mycalendar.activeCalendar", activeCalendarId);
  }, [activeCalendarId]);

  useEffect(() => {
    if (!calendarExportData) setExportCopyStatus(null);
  }, [calendarExportData]);

  useEffect(() => {
    const calendarIds = new Set(calendars.map((cal) => cal.id));
    const fallback = calendars[0]?.id ?? DEFAULT_CALENDAR_ID;
    if (!fallback) return;
    setEvents((prev) => {
      let changed = false;
      const mapped = prev.map((event) => {
        if (calendarIds.has(event.calendarId)) return event;
        changed = true;
        return { ...event, calendarId: fallback };
      });
      return changed ? mapped : prev;
    });
  }, [calendars]);

  useEffect(() => {
    localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  useEffect(() => {
    localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(taskAssignments));
  }, [taskAssignments]);

  useEffect(() => {
    setTaskAssignments((prev) => {
      if (!prev.length) return prev;
      const existingIds = new Set(events.map((ev) => ev.id));
      let mutated = false;
      const updated = prev.map((task) => {
        const filtered = task.chunkEventIds.filter((id) => existingIds.has(id));
        if (filtered.length !== task.chunkEventIds.length) {
          mutated = true;
          return { ...task, chunkEventIds: filtered };
        }
        return task;
      });
      return mutated ? updated : prev;
    });
  }, [events]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setActiveEventId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = window.setInterval(tick, 60_000);
    tick();
    return () => window.clearInterval(interval);
  }, []);


  function openCreate(startDate?: Date) {
    const base = startDate ? new Date(startDate) : new Date();
    base.setSeconds(0, 0);
    if (!startDate) base.setHours(9, 0, 0, 0);
    const end = addMinutes(base, 60);
    setDraft({
      id: uid(),
      title: "",
      start: base.toISOString(),
      end: end.toISOString(),
      type: "flexible",
      priority: 5,
      family: "home",
      calendarId: activeCalendarId,
    });
    setShowForm(true);
  }

  function saveDraft() {
    if (!draft?.title) return;
    const s = parseISOorNull(draft.start || null);
    const e = parseISOorNull(draft.end || null);
    const type = draft.type === "fixed" ? "fixed" : "flexible";
    if (!s || !e || e <= s) {
      alert("Проверь даты: начало и окончание должны быть корректны, а длительность > 0 минут.");
      return;
    }
    const exists = events.some((ev) => ev.id === draft.id);
    const item: EventItem = {
      id: draft.id!,
      title: draft.title,
      start: s.toISOString(),
      end: e.toISOString(),
      type,
      priority: Math.max(1, Math.min(5, draft.priority ?? 3)) as EventItem["priority"],
      family: (draft.family as FamilyKey) ?? "home",
      notes: draft.notes ?? "",
      calendarId:
        typeof draft.calendarId === "string" && calendars.some((cal) => cal.id === draft.calendarId)
          ? draft.calendarId
          : activeCalendarId,
      linkedTaskId: draft.linkedTaskId,
    };
    setEvents((prev) => (exists ? prev.map((ev) => (ev.id === item.id ? item : ev)) : [...prev, item]));
    setShowForm(false);
  }

  const lastRemovedRef = useRef<EventItem | null>(null);
  const lastRemovedAtRef = useRef<number>(0);

  function restoreLastRemoved() {
    const last = lastRemovedRef.current;
    if (!last) return;
    setEvents((prev) => {
      if (prev.some((event) => event.id === last.id)) return prev;
      return [...prev, last].sort((a, b) => (parseISOorNull(a.start)?.getTime() ?? 0) - (parseISOorNull(b.start)?.getTime() ?? 0));
    });
    lastRemovedRef.current = null;
    lastRemovedAtRef.current = 0;
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        if (lastRemovedRef.current) {
          restoreLastRemoved();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function removeEvent(id: string) {
    setEvents((prev) => {
      const target = prev.find((e) => e.id === id);
      if (!target) return prev;
      if (target.type === "fixed") {
        const message = `Удалить жёсткое событие «${target.title || "Без названия"}»?`;
        if (!window.confirm(message)) return prev;
        lastRemovedRef.current = { ...target };
        lastRemovedAtRef.current = Date.now();
        return prev.filter((e) => e.id !== id);
      }
      lastRemovedRef.current = { ...target };
      lastRemovedAtRef.current = Date.now();
      return prev.filter((e) => e.id !== id);
    });
  }

  function shortenEvent(id: string, mins: number) {
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        const end = parseISOorNull(e.end);
        const start = parseISOorNull(e.start);
        if (!end || !start) return e;
        const newEnd = addMinutes(end, -mins);
        if (newEnd <= start) return e;
        return { ...e, end: newEnd.toISOString() };
      })
    );
  }

  function optimizeDay(day: Date) {
    setEvents((prev) => pullForwardSameDay(prev, day, activeCalendarId));
  }

  function importIcsCalendar() {

    try {
      const targetCalendarId =
        calendars.find((cal) => cal.id === importCalendarId)?.id ??
        calendars[0]?.id ??
        DEFAULT_CALENDAR_ID;
      const occurrences = parseICSEvents(icsText).sort((a, b) => a.start.getTime() - b.start.getTime());
      if (!occurrences.length) {
        setImportMessage("Не удалось найти события в тексте. Проверь, что вставлен полный блок BEGIN:VEVENT…END:VEVENT.");
        return;
      }
      const existingKeys = new Set(events.map((ev) => `${ev.title}|${ev.start}`));
      const newItems: EventItem[] = [];
      let skipped = 0;
      for (const occ of occurrences) {
        const key = `${occ.summary}|${occ.start.toISOString()}`;
        if (existingKeys.has(key)) {
          skipped += 1;
          continue;
        }
        existingKeys.add(key);
        newItems.push({
          id: uid(),
          title: occ.summary,
          start: occ.start.toISOString(),
          end: occ.end.toISOString(),
          type: "fixed",
          priority: 5,
          family: "study",
          notes: occ.notes ?? "",
          calendarId: targetCalendarId,
        });
      }
      if (newItems.length) {
        setEvents((prev) => [...prev, ...newItems]);
      }
      setImportMessage(`Добавлено ${newItems.length} событий, пропущено ${skipped}.`);
      if (newItems.length) {
        setIcsText("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setImportMessage(`Ошибка импорта: ${message}`);
    }
  }

  function runAutoPlanner() {
    const timeStringToMinutes = (value?: string) => {
      if (!value) return null;
      const [hh, mm] = value.split(":");
      const hours = Number.parseInt(hh ?? "", 10);
      const minutes = Number.parseInt(mm ?? "", 10);
      if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
      const safeHours = Math.max(0, Math.min(23, hours));
      const safeMinutes = Math.max(0, Math.min(59, minutes));
      return safeHours * 60 + safeMinutes;
    };

    try {
      setPlannerMessage(null);
      const prepared = plannerTasks
        .map((task) => ({ ...task, title: task.title.trim() }))
        .filter((task) => !!task.title);

      if (!prepared.length) {
        setPlannerMessage("Добавьте хотя бы одну задачу и заполните её название.");
        return;
      }

      for (const task of prepared) {
        if (!Number.isFinite(task.durationMin) || task.durationMin <= 0) {
          setPlannerMessage(`У задачи "${task.title}" некорректная длительность.`);
          return;
        }
        if (task.dayPreference !== "any") {
          const startMinute = timeStringToMinutes(task.startTime);
          const endMinute = timeStringToMinutes(task.endTime);
          if (startMinute == null || endMinute == null) {
            setPlannerMessage(`Уточните временное окно для задачи "${task.title}".`);
            return;
          }
          if (endMinute <= startMinute) {
            setPlannerMessage(`Конец окна должен быть позже начала у задачи "${task.title}".`);
            return;
          }
        }
        if (task.allowSplit) {
          if (!task.minChunk || task.minChunk <= 0) {
            setPlannerMessage(`Укажите минимальный размер блока для задачи "${task.title}".`);
            return;
          }
          if (task.maxChunks != null && task.maxChunks < 1) {
            setPlannerMessage(`Максимальное число блоков должно быть больше нуля для "${task.title}".`);
            return;
          }
        }
      }

      const calendarForTask = (task: PlannerTask) =>
        task.calendarId && calendars.some((cal) => cal.id === task.calendarId)
          ? task.calendarId
          : activeCalendarId;

      const requests: (ScheduleRequest & { calendarId?: string })[] = prepared.map((task, idx) => {
        const duration = Math.max(10, Math.round(task.durationMin));
        const startMinute = timeStringToMinutes(task.startTime);
        const endMinute = timeStringToMinutes(task.endTime);
        const timeWindows =
          task.dayPreference !== "any" && startMinute != null && endMinute != null
            ? [
                {
                  dayOffset: task.dayPreference,
                  startMinute,
                  endMinute,
                },
              ]
            : undefined;

        const flexibility =
          task.shiftBefore || task.shiftAfter || (task.allowSplit && task.minChunk)
            ? {
                shiftMin: task.shiftBefore ? -Math.abs(Math.round(task.shiftBefore)) : undefined,
                shiftMax: task.shiftAfter ? Math.abs(Math.round(task.shiftAfter)) : undefined,
                split:
                  task.allowSplit && task.minChunk
                    ? {
                        minChunk: Math.max(10, Math.round(task.minChunk)),
                        maxChunks:
                          task.maxChunks != null
                            ? Math.max(1, Math.round(task.maxChunks))
                            : Math.max(1, Math.ceil(duration / Math.max(10, Math.round(task.minChunk)))),
                      }
                    : undefined,
              }
            : undefined;

        return {
          id: task.id || `planner-${idx}`,
          title: task.title,
          durationMin: duration,
          priority: Math.max(1, Math.min(5, task.priority)) as PriorityLevel,
          timeWindows,
          deadlineDayOffset: task.deadlineDayOffset ?? undefined,
          flexibility,
          notes: task.notes,
          calendarId: calendarForTask(task),
        };
      });

      const allowedCalendarIds = new Set(
        requests.map((req) => (req.calendarId && calendars.some((cal) => cal.id === req.calendarId)
          ? req.calendarId
          : activeCalendarId))
      );

      const existingForSolver = events
        .map((ev) => {
          const startDate = parseISOorNull(ev.start);
          const endDate = parseISOorNull(ev.end);
          if (!startDate || !endDate) return null;
          if (!allowedCalendarIds.has(ev.calendarId)) return null;
          return {
            id: ev.id,
            title: ev.title,
            start: startDate,
            end: endDate,
            type: ev.type,
          } satisfies ExistingEvent;
        })
        .filter((x): x is ExistingEvent => !!x);

      const result = scheduleRequests(requests, existingForSolver, {
        horizonDays: 7,
        dayStartHour,
        dayEndHour,
      });

      const requestById = new Map(requests.map((req) => [req.id ?? "", req]));

      const newEvents = result.planned.map((plan, idx) => {
        const source = plan.sourceId ? requestById.get(plan.sourceId) : undefined;
        const baseNotes = source?.notes?.trim();
        const notes = baseNotes ? `Автоплан\n${baseNotes}` : "Автопланирование";
        const calendarId = source?.calendarId ?? activeCalendarId;
        return {
          id: `auto-${uid()}-${idx}`,
          title: plan.title,
          start: plan.start.toISOString(),
          end: plan.end.toISOString(),
          type: "flexible" as const,
          priority: Math.min(5, plan.priority * 2) as EventItem["priority"],
          family: "home" as const,
          notes,
          calendarId,
        } satisfies EventItem;
      });

      if (!newEvents.length) {
        setPlannerMessage(
          result.unplaced.length
            ? `Не удалось разместить: ${result.unplaced.map((t) => t.title).join(", ")}.`
            : "Не удалось найти доступные слоты."
        );
        return;
      }

      setEvents((prev) => [...prev, ...newEvents]);

      const unplacedIds = new Set(result.unplaced.map((item) => item.id).filter(Boolean) as string[]);
      if (unplacedIds.size) {
        setPlannerTasks((prev) => {
          const remaining = prev.filter((task) => task.id && unplacedIds.has(task.id));
          return remaining.length
            ? remaining.map((task) => ({ ...task, calendarId: calendarForTask(task) }))
            : [makePlannerTask()];
        });
      } else {
        setPlannerTasks([makePlannerTask()]);
      }

      setPlannerMessage(
        `Добавлено ${newEvents.length} событий.` +
          (result.unplaced.length
            ? ` Не удалось разместить: ${result.unplaced.map((t) => t.title).join(", ")}.`
            : "")
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlannerMessage(`Ошибка автопланирования: ${message}`);
    }
  }

  const createTaskAssignment = (input: TaskCreateInput): TaskCreateResult => {
    const anchor = events.find((ev) => ev.id === input.anchorEventId);
    if (!anchor) {
      return { ok: false, message: "Не найдено выбранное событие для привязки." };
    }
    const anchorStart = parseISOorNull(anchor.start);
    if (!anchorStart) {
      return { ok: false, message: "У события отсутствует корректная дата начала." };
    }
    const nowInstant = new Date();
    if (anchorStart.getTime() <= nowInstant.getTime()) {
      return { ok: false, message: "Событие уже началось или прошло. Выберите другое событие." };
    }
    const totalDurationMin = Math.max(10, Math.round(input.totalDurationMin));
    if (!Number.isFinite(totalDurationMin) || totalDurationMin <= 0) {
      return { ok: false, message: "Укажите длительность задачи больше нуля." };
    }
    const chunkDurations = splitTaskDuration(totalDurationMin);
    let scheduled: Interval[];
    try {
      scheduled = scheduleTaskChunksBeforeEvent(events, anchor, chunkDurations, {
        earliestStart: nowInstant,
        dayStartHour: TASK_DAY_START_HOUR,
        dayEndHour: TASK_DAY_END_HOUR,
      });
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "Не удалось построить расписание задачи.",
      };
    }
    if (!scheduled.length) {
      return { ok: false, message: "Не получилось разместить блоки задачи до выбранного события." };
    }

    const taskId = uid();
    const baseTitle = input.title.trim() || "Подготовка";
    const baseNotes = input.notes?.trim() || "";
    const chunkEventCount = scheduled.length;
    const anchorTitle = anchor.title || "Событие";
    const createdAt = new Date().toISOString();
    const chunkEvents: EventItem[] = scheduled.map((slot, idx) => {
      const chunkTitle =
        chunkEventCount > 1 ? `${baseTitle} · блок ${idx + 1}/${chunkEventCount}` : baseTitle;
      const notesLines = [
        `Подготовка к событию: ${anchorTitle}`,
        `Дедлайн: ${fmtDay(anchorStart)} ${fmtHM(anchorStart)}`,
        chunkEventCount > 1 ? `Блок ${idx + 1} из ${chunkEventCount}` : null,
        baseNotes ? `Комментарий: ${baseNotes}` : null,
      ].filter(Boolean);
      return {
        id: `task-${taskId}-${idx + 1}`,
        title: chunkTitle,
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        type: "fixed",
        priority: (Math.max(1, Math.min(5, anchor.priority ?? 3)) as EventItem["priority"]),
        family: anchor.family ?? "home",
        notes: notesLines.join("\n"),
        calendarId: anchor.calendarId,
        linkedTaskId: taskId,
      };
    });

    const chunkEventIds = chunkEvents.map((event) => event.id);

    setEvents((prev) => {
      const next = [...prev, ...chunkEvents];
      next.sort((a, b) => {
        const sa = parseISOorNull(a.start)?.getTime() ?? 0;
        const sb = parseISOorNull(b.start)?.getTime() ?? 0;
        return sa - sb;
      });
      return next;
    });

    setTaskAssignments((prev) => [
      ...prev,
      {
        id: taskId,
        title: baseTitle,
        totalDurationMin,
        anchorEventId: anchor.id,
        notes: baseNotes || undefined,
        chunkEventIds,
        createdAt,
      },
    ]);

    return {
      ok: true,
      message: `Создано ${chunkEventCount} блок(ов) перед событием «${anchorTitle}».`,
      taskId,
    };
  };

  const removeTaskAssignment = (taskId: string) => {
    setTaskAssignments((prev) => prev.filter((task) => task.id !== taskId));
    setEvents((prev) => prev.filter((event) => event.linkedTaskId !== taskId));
  };

  function createCalendar() {
    const nextColor = pickNextCalendarColor(calendars);
    const newCalendar: CalendarInfo = {
      id: `cal-${uid()}`,
      name: `Календарь ${calendars.length + 1}`,
      color: nextColor,
      visible: true,
    };
    setCalendars((prev) => [...prev, newCalendar]);
    setActiveCalendarId(newCalendar.id);
    setImportCalendarId(newCalendar.id);
    setPlannerTasks((prev) => prev.map((task) => ({ ...task, calendarId: newCalendar.id })));
  }

  const patchCalendar = (id: string, patch: Partial<CalendarInfo>) => {
    setCalendars((prev) => prev.map((cal) => (cal.id === id ? { ...cal, ...patch } : cal)));
  };

  function deleteCalendar(id: string) {
    if (id === DEFAULT_CALENDAR_ID) {
      alert("Базовый календарь нельзя удалить.");
      return;
    }
    const target = calendarMap.get(id);
    const confirmMessage = target
      ? `Удалить календарь «${target.name}»? События будут перенесены в другой календарь.`
      : "Удалить календарь?";
    if (!window.confirm(confirmMessage)) return;
    const remaining = calendars.filter((cal) => cal.id !== id);
    const fallbackId = remaining[0]?.id ?? DEFAULT_CALENDAR_ID;
    const nextCalendars = remaining.length ? remaining : [{ ...DEFAULT_CALENDAR }];
    setCalendars(nextCalendars);
    setEvents((prev) =>
      prev.map((event) => (event.calendarId === id ? { ...event, calendarId: fallbackId } : event))
    );
    setPlannerTasks((prev) =>
      prev.map((task) =>
        task.calendarId && task.calendarId === id ? { ...task, calendarId: fallbackId } : task
      )
    );
    if (activeCalendarId === id) setActiveCalendarId(fallbackId);
    if (importCalendarId === id) setImportCalendarId(fallbackId);
    if (calendarExportData?.calendarId === id) setCalendarExportData(null);
  }

  function exportCalendar(id: string) {
    const calendar = calendarMap.get(id);
    if (!calendar) return;
    const ics = buildICSForCalendar(calendar, events);
    setCalendarExportData({ calendarId: id, ics });
  }

  async function copyExportToClipboard(text: string) {
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setExportCopyStatus("Скопировано в буфер обмена");
      } else {
        throw new Error("Clipboard API недоступен");
      }
    } catch (error) {
      console.error(error);
      setExportCopyStatus("Не удалось скопировать автоматически");
    }
  }

  function closeCalendarsPanel() {
    setShowCalendarsPanel(false);
    setCalendarExportData(null);
  }

  const navSegmentClasses =
    "pressable px-4 py-2 text-sm font-medium text-gray-200 bg-[#1a1a1d]/80 border border-white/10";
  const actionButtonClasses =
    "pressable px-4 py-2 rounded-xl bg-[#2f2f34] text-gray-100 font-semibold shadow-[0_12px_30px_-18px_rgba(0,0,0,0.9)] border border-white/12";
  const subtleButtonClasses =
    "pressable px-3 py-1.5 rounded-lg bg-[#202023] text-gray-200 border border-white/12";
  const fieldClasses =
    "w-full rounded-xl border border-white/10 bg-[#232327] px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-300/25";
  const handlePrevWeek = () => setAnchor(new Date(anchor.getTime() - 7 * 24 * 60 * 60000));
  const handleNextWeek = () => setAnchor(new Date(anchor.getTime() + 7 * 24 * 60 * 60000));
  const handleToday = () => setAnchor(new Date());
  const weekLabel = `Неделя ${fmtDay(weekDays[0])} — ${fmtDay(weekDays[6])}`;
  const handleCreateEvent = () => openCreate();
  const handleOptimizeToday = () => optimizeDay(startOfDay(now));
  const handleOpenPlanner = () => {
    setShowPlanner(true);
    setPlannerMessage(null);
  };
  const openTasksPanel = (options?: { taskId?: string; seed?: { eventId: string; title: string } }) => {
    setFocusedTaskId(options?.taskId ?? null);
    setTaskSeed(options?.seed ?? null);
    setTaskPanelMessage(null);
    setShowTasksPanel(true);
  };
  const handleOpenTasks = () => openTasksPanel();
  const handleAddTaskForEvent = (event: EventItem) => {
    if ((event as TaskEvent).taskId) {
      setTaskStatus("Это событие уже связано с задачей.");
      return;
    }
    const startDate = parseISOorNull(event.start);
    if (!startDate || startDate.getTime() <= now.getTime()) {
      setTaskPanelMessage("Событие уже началось или прошло, добавьте задачу вручную.");
      setTaskSeed(null);
      setFocusedTaskId(null);
      setShowTasksPanel(true);
      return;
    }
    const titleSeed = event.title ? `Подготовка: ${event.title}` : "Новая задача";
    openTasksPanel({ seed: { eventId: event.id, title: titleSeed } });
  };
  const handleOpenImport = () => {
    setShowImport(true);
    setImportMessage(null);
    setImportCalendarId(activeCalendarId);
  };
  const handleAddTaskSubmit = useCallback(
    async (input: Omit<StoredTask, "id" | "parts">) => {
      try {
        const result = createTask(input, { events });
        refreshEventsFromStorage();
        const slots = result.newEvents.length;
        const slotLabel =
          slots % 10 === 1 && slots % 100 !== 11
            ? "слот"
            : slots % 10 >= 2 && slots % 10 <= 4 && (slots % 100 < 10 || slots % 100 >= 20)
            ? "слота"
            : "слотов";
        setTaskStatus(`Задача "${result.task.title}" запланирована (${slots} ${slotLabel}).`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось создать задачу.";
        setTaskStatus(message);
        throw (error instanceof Error ? error : new Error(message));
      }
    },
    [events, refreshEventsFromStorage]
  );
  const handleTaskEventDone = useCallback(
    (eventId: string) => {
      try {
        markTaskEventDone(eventId);
        refreshEventsFromStorage();
        setTaskStatus("Слот задачи отмечен как выполненный.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось отметить выполнение.";
        setTaskStatus(message);
      }
    },
    [refreshEventsFromStorage]
  );
  const handleTaskEventUndone = useCallback(
    (eventId: string) => {
      try {
        markTaskEventUndone(eventId);
        refreshEventsFromStorage();
        setTaskStatus("Слот задачи возвращён в план.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Не удалось вернуть слот.";
        setTaskStatus(message);
      }
    },
    [refreshEventsFromStorage]
  );
  const handleToggleCalendarVisibility = (id: string, visible: boolean) => {
    patchCalendar(id, { visible });
  };
  const dayStartHour = TASK_DAY_START_HOUR;
  const dayEndHour = TASK_DAY_END_HOUR;
  const timeColumnWidth = 80;
  const minutesPerDay = (dayEndHour - dayStartHour) * 60;
  const minuteUnit = 1;
  const dayColumnHeight = minutesPerDay * minuteUnit;
  const DAY_COLUMN_OFFSET = 72;
  const todayKey = startOfDay(now).toISOString();

  const daySlices = useMemo(() => {
    const map = new Map<string, DaySlice[]>();
    weekDays.forEach((day) => {
      const key = startOfDay(day).toISOString();
      map.set(key, []);
    });

    events.forEach((event) => {
      if (!visibleCalendarIds.has(event.calendarId)) return;
      const startDate = parseISOorNull(event.start);
      const endDate = parseISOorNull(event.end);
      if (!startDate || !endDate || endDate <= startDate) return;
      weekDays.forEach((day) => {
        const baseStart = startOfDay(day);
        const workingStart = addMinutes(baseStart, dayStartHour * 60);
        const workingEnd = addMinutes(workingStart, minutesPerDay);
        if (endDate <= workingStart || startDate >= workingEnd) return;
        const key = baseStart.toISOString();
        const slices = map.get(key);
        if (!slices) return;
        const sliceStart = startDate > workingStart ? startDate : workingStart;
        const sliceEnd = endDate < workingEnd ? endDate : workingEnd;
        slices.push({
          event,
          sliceStart,
          sliceEnd,
          continuesFromPrev: startDate < workingStart,
          continuesToNext: endDate > workingEnd,
        });
      });
    });

    map.forEach((list, key) => {
      list.sort((a, b) => a.sliceStart.getTime() - b.sliceStart.getTime());
      map.set(key, list);
    });

    return map;
  }, [events, weekDays, minutesPerDay, visibleCalendarIds]);

  const taskProgress = useMemo(() => {
    const progress = new Map<string, { total: number; done: number }>();
    events.forEach((event) => {
      if (!event.taskId) return;
      const entry = progress.get(event.taskId) ?? { total: 0, done: 0 };
      entry.total += 1;
      if (event.done) entry.done += 1;
      progress.set(event.taskId, entry);
    });
    return progress;
  }, [events]);
  const dayPreferenceOptions = useMemo(() => {
    const todayStart = startOfDay(new Date());
    return Array.from({ length: 7 }, (_, offset) => {
      const dayDate = addMinutes(todayStart, offset * 1440);
      const label =
        offset === 0
          ? "Сегодня"
          : offset === 1
          ? "Завтра"
          : fmtDay(dayDate);
      return { offset, label };
    });
  }, []);

  const dateToMinutes = (date: Date) => date.getHours() * 60 + date.getMinutes();

  const snapToGrid = (minutes: number, step = 10) =>
    Math.round(minutes / step) * step;

  const minutesToDate = (day: Date, minutes: number) => {
    const base = clone(day);
    base.setHours(dayStartHour, 0, 0, 0);
    return addMinutes(base, minutes);
  };

  useEffect(() => {
    if (!dragState) return;

    const computeMinutes = (clientY: number) => {
      const column = document.querySelector<HTMLElement>(`[data-day='${dragState.dayKey}']`);
      if (!column) return null;
      const rect = column.getBoundingClientRect();
      const relative = clientY - rect.top - DAY_COLUMN_OFFSET;
      const minute = Math.round(relative / minuteUnit) - dragState.offsetMinutes;
      const snapped = snapToGrid(minute);
      const maxMinutes = minutesPerDay - dragState.duration;
      return Math.max(0, Math.min(maxMinutes, snapped));
    };

    const handleMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const minutes = computeMinutes(ev.clientY);
      if (minutes == null) return;
      if (minutes !== dragState.originalMinutes) {
        draggingRef.current = true;
      }
      setDragPreview({ id: dragState.id, dayKey: dragState.dayKey, startMinutes: minutes });
    };

    const finishDrag = (ev: PointerEvent) => {
      if (dragPointerRef.current && dragPointerIdRef.current === ev.pointerId) {
        try {
          dragPointerRef.current.releasePointerCapture(ev.pointerId);
        } catch {}
        dragPointerRef.current = null;
        dragPointerIdRef.current = null;
      }
      const minutes = computeMinutes(ev.clientY) ?? dragPreview?.startMinutes ?? dragState.originalMinutes;
      if (minutes != null && minutes !== dragState.originalMinutes) {
        const dayDate = new Date(dragState.dayKey);
        const newStart = minutesToDate(dayDate, minutes);
        const newEnd = addMinutes(newStart, dragState.duration);
        setEvents((prev) =>
          prev.map((item) =>
            item.id === dragState.id
              ? { ...item, start: newStart.toISOString(), end: newEnd.toISOString() }
              : item
          )
        );
      }
      setDragPreview(null);
      setDragState(null);
      if (draggingRef.current) {
        suppressClickRef.current = true;
      }
      draggingRef.current = false;
    };

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [dragState, dragPreview, minuteUnit, minutesPerDay, dayStartHour]);

  const renderDayColumn = (day: Date) => (
    <DayColumn
      key={day.toISOString()}
      daySlices={daySlices}
      day={day}
      todayKey={todayKey}
      dayStartHour={dayStartHour}
      minutesPerDay={minutesPerDay}
      minuteUnit={minuteUnit}
      dayColumnHeight={dayColumnHeight}
      dragPreview={dragPreview}
      setDragState={setDragState}
      setDragPreview={setDragPreview}
      calendarMap={calendarMap}
      activeEventId={activeEventId}
      setActiveEventId={setActiveEventId}
      removeEvent={removeEvent}
      shortenEvent={shortenEvent}
      openCreate={openCreate}
      setShowForm={setShowForm}
      setDraft={(event) => setDraft(event)}
      optimizeDay={optimizeDay}
      extractEventMeta={extractEventMeta}
      openTaskPanel={(taskId) => openTasksPanel({ taskId })}
      onAddTaskForEvent={handleAddTaskForEvent}
      dragPointerRef={dragPointerRef}
      dragPointerIdRef={dragPointerIdRef}
      draggingRef={draggingRef}
      suppressClickRef={suppressClickRef}
      snapToGrid={snapToGrid}
      minutesToDate={minutesToDate}
      diffMinutes={diffMinutes}
      parseISOorNull={parseISOorNull}
      startOfDay={startOfDay}
      DAY_COLUMN_OFFSET={DAY_COLUMN_OFFSET}
      timeColumnWidth={timeColumnWidth}
      now={now}
      familyCardStyle={familyCardStyle}
      taskProgress={taskProgress}
      onTaskEventDone={handleTaskEventDone}
      onTaskEventUndone={handleTaskEventUndone}
    />
  );
;

  // small runtime asserts
  useEffect(() => {
    try {
      const now = new Date();
      const local = toLocalInputValue(now);
      const back = fromLocalInput(local);
      console.assert(isValidDate(back), "fromLocalInput should produce a valid Date");
    } catch {}
  }, []);

  const headerRef = useRef<HTMLDivElement | null>(null);
  const [headerOffset, setHeaderOffset] = useState(0);

  useEffect(() => {
    if (autoScrolledRef.current) return;
    const isScrollable = (el: HTMLElement | null) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const oy = style.overflowY;
      return el.scrollHeight > el.clientHeight && (oy === "auto" || oy === "scroll" || oy === "overlay");
    };

    const findScroller = (start: HTMLElement | null): HTMLElement | null => {
      let node: HTMLElement | null = start;
      while (node) {
        if (isScrollable(node)) return node;
        node = node.parentElement as HTMLElement | null;
      }
      return null;
    };

    const doScroll = () => {
      try {
        const fallback = calendarSwipeRef.current as HTMLElement | null;
        const colSelector = `[data-day='${todayKey}']`;
        const col = document.querySelector<HTMLElement>(colSelector);
        const scroller = findScroller(col || fallback) || fallback;
        const viewportHeight = scroller?.clientHeight || window.innerHeight;
        const minutesFromDayStart = dateToMinutes(now) - dayStartHour * 60;
        const minutePx = Math.max(0, minutesFromDayStart) * minuteUnit;

        if (scroller && scroller !== document.scrollingElement) {
          const sRect = scroller.getBoundingClientRect();
          const cRect = col?.getBoundingClientRect();
          const relativeTop = cRect ? cRect.top - sRect.top : 0;
          const raw = relativeTop + DAY_COLUMN_OFFSET + minutePx - Math.floor(viewportHeight / 2);
          const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
          const targetY = Math.min(Math.max(0, raw), maxScroll);
          scroller.scrollTo({ top: targetY, behavior: "auto" });
        } else if (col) {
          const cRect = col.getBoundingClientRect();
          const relativeTop = cRect.top + window.scrollY;
          const raw = relativeTop + DAY_COLUMN_OFFSET + minutePx - Math.floor(viewportHeight / 2);
          const doc = document.documentElement;
          const maxScroll = Math.max(0, doc.scrollHeight - window.innerHeight);
          const targetY = Math.min(Math.max(0, raw), maxScroll);
          window.scrollTo({ top: targetY, behavior: "auto" });
        }
      } catch {}
    };

    doScroll();
    const t1 = window.setTimeout(doScroll, 150);
    const t2 = window.setTimeout(doScroll, 400);
    const t3 = window.setTimeout(doScroll, 1000);
    autoScrolledRef.current = true;
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [todayKey, headerOffset, now, minuteUnit, dayStartHour]);

  useLayoutEffect(() => {
    const measure = () => {
      if (!headerRef.current) return;
      const rect = headerRef.current.getBoundingClientRect();
      setHeaderOffset(rect.height);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [calendars.length, weekLabel, showCalendarsPanel]);

  return (
    <div className="min-h-screen w-full bg-[#0f0f12] text-gray-100">
      <div ref={headerRef} className="sticky top-0 z-30 border-b border-white/10 bg-[#111113]/45 backdrop-blur-xl">
        <CalendarHeader
          navSegmentClasses={navSegmentClasses}
          actionButtonClasses={actionButtonClasses}
          subtleButtonClasses={subtleButtonClasses}
          onPrevWeek={handlePrevWeek}
          onToday={handleToday}
          onNextWeek={handleNextWeek}
          weekLabel={weekLabel}
          onCreateEvent={handleCreateEvent}
          onOptimizeToday={handleOptimizeToday}
          onOpenPlanner={handleOpenPlanner}
          onOpenTasks={handleOpenTasks}
          onOpenImport={handleOpenImport}
          calendars={calendars}
          activeCalendarId={activeCalendarId}
          onSelectCalendar={setActiveCalendarId}
          onToggleCalendarVisibility={handleToggleCalendarVisibility}
          onCreateCalendar={createCalendar}
          onShowCalendarsPanel={() => setShowCalendarsPanel(true)}
        />
      </div>

      <div className="border-b border-white/10 bg-[#111113]/35">
        <div className="px-6 py-4">
          <AddTaskForm
            onSubmit={handleAddTaskSubmit}
            fieldClasses={fieldClasses}
            actionButtonClasses={actionButtonClasses}
          />
          {taskStatus && <p className="mt-2 text-sm text-emerald-300">{taskStatus}</p>}
        </div>
      </div>

      <CalendarGrid
        ref={calendarSwipeRef}
        weekDays={weekDays}
        today={now}
        dayStartHour={dayStartHour}
        dayEndHour={dayEndHour}
      minuteUnit={minuteUnit}
      dayColumnHeight={dayColumnHeight}
      renderDayColumn={renderDayColumn}
      timeColumnWidth={timeColumnWidth}
      headerOffset={headerOffset}
      columnOffset={DAY_COLUMN_OFFSET}
    />

      {/* Drawer Form */}
      {showForm && draft && (
        <EventFormDrawer
          draft={draft}
          calendars={calendars}
          activeCalendarId={activeCalendarId}
          events={events}
          setDraft={setDraft}
          onClose={() => setShowForm(false)}
          saveDraft={saveDraft}
          removeEvent={removeEvent}
          optimizeDay={optimizeDay}
          findFirstFreeSlot={findFirstFreeSlot}
          fieldClasses={fieldClasses}
          subtleButtonClasses={subtleButtonClasses}
          actionButtonClasses={actionButtonClasses}
        />
      )}

      {showImport && (
        <ImportPanel
          calendars={calendars}
          importCalendarId={importCalendarId}
          setImportCalendarId={setImportCalendarId}
          icsText={icsText}
          setIcsText={setIcsText}
          importMessage={importMessage}
          setImportMessage={setImportMessage}
          onClose={() => setShowImport(false)}
          importIcsCalendar={importIcsCalendar}
          fieldClasses={fieldClasses}
          subtleButtonClasses={subtleButtonClasses}
          actionButtonClasses={actionButtonClasses}
        />
      )}
      {showTasksPanel && (
        <TaskPanel
          tasks={taskAssignments}
          events={events}
          calendars={calendars}
          onClose={() => {
            setShowTasksPanel(false);
            setFocusedTaskId(null);
            setTaskSeed(null);
          }}
          onCreateTask={(payload) => {
            const result = createTaskAssignment(payload);
            if (result.ok && result.taskId) {
              setTaskSeed(null);
              setFocusedTaskId(result.taskId);
              requestAnimationFrame(() => {
                const element = document.getElementById(`task-${result.taskId}`);
                if (element) {
                  element.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              });
            }
            return result;
          }}
          onRemoveTask={(taskId) => {
            removeTaskAssignment(taskId);
            setTaskPanelMessage("Задача удалена");
          }}
          message={taskPanelMessage}
          setMessage={setTaskPanelMessage}
          fieldClasses={fieldClasses}
          actionButtonClasses={actionButtonClasses}
          subtleButtonClasses={subtleButtonClasses}
          focusedTaskId={focusedTaskId}
          now={now}
          taskSeed={taskSeed}
        />
      )}

      {showCalendarsPanel && (
        <CalendarsPanel
          calendars={calendars}
          activeCalendarId={activeCalendarId}
          onClose={closeCalendarsPanel}
          fieldClasses={fieldClasses}
          subtleButtonClasses={subtleButtonClasses}
          patchCalendar={patchCalendar}
          setActiveCalendarId={setActiveCalendarId}
          createCalendar={createCalendar}
          exportCalendar={exportCalendar}
          deleteCalendar={deleteCalendar}
          calendarExportData={calendarExportData}
          setCalendarExportData={setCalendarExportData}
          copyExportToClipboard={copyExportToClipboard}
          exportCopyStatus={exportCopyStatus}
          calendarMap={calendarMap}
          defaultCalendarId={DEFAULT_CALENDAR_ID}
        />
      )}



      {showPlanner && (
        <div className="fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm">
          <div className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-white/10 bg-[#1f1f23]/95 p-6 text-gray-100 shadow-[0_0_60px_rgba(0,0,0,0.65)] md:p-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Автопланирование задач</h2>
              <button
                className={subtleButtonClasses}
                onClick={() => {
                  setShowPlanner(false);
                  setPlannerMessage(null);
                  setPlannerTasks((prev) => (prev.length ? prev : [makePlannerTask()]));
                }}
              >
                Закрыть
              </button>
            </div>
            <p className="mt-3 text-sm text-gray-400">
              Заполни задачи: длительность, желаемые окна и гибкость. Если окно не укажешь — планировщик подберёт ближайшие свободные слоты. Все созданные блоки попадут в активный календарь «{activeCalendar.name}».
            </p>
            <div className="mt-5 space-y-4">
              {plannerTasks.map((task, index) => (
                <div key={task.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs uppercase tracking-[0.08em] text-gray-400">
                      Задача {index + 1}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className={`${subtleButtonClasses} px-2 py-1 text-xs`}
                        onClick={() => removePlannerTask(task.id)}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-gray-400">Название</span>
                      <input
                        className={fieldClasses}
                        placeholder="Например, отчёт"
                        value={task.title}
                        onChange={(e) => updatePlannerTask(task.id, { title: e.target.value })}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-gray-400">Длительность (мин)</span>
                      <input
                        type="number"
                        min={10}
                        step={5}
                        className={fieldClasses}
                        value={task.durationMin}
                        onChange={(e) =>
                          updatePlannerTask(task.id, {
                            durationMin: Math.max(0, Number.parseInt(e.target.value || "0", 10) || 0),
                          })
                        }
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-gray-400">Приоритет (1–5)</span>
                      <select
                        className={fieldClasses}
                        value={task.priority}
                        onChange={(e) =>
                          updatePlannerTask(task.id, { priority: Number.parseInt(e.target.value, 10) as PriorityLevel })
                        }
                      >
                        {[1, 2, 3, 4, 5].map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-gray-400">Желаемый день</span>
                      <select
                        className={fieldClasses}
                        value={task.dayPreference === "any" ? "any" : String(task.dayPreference)}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === "any") {
                            updatePlannerTask(task.id, { dayPreference: "any" });
                          } else {
                            updatePlannerTask(task.id, { dayPreference: Number.parseInt(value, 10) });
                          }
                        }}
                      >
                        <option value="any">Подойдёт любой</option>
                        {dayPreferenceOptions.map((option) => (
                          <option key={option.offset} value={option.offset}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-gray-400">Начало окна</span>
                      <input
                        type="time"
                        className={`${fieldClasses} ${task.dayPreference === "any" ? "opacity-60" : ""}`}
                        disabled={task.dayPreference === "any"}
                        value={task.startTime ?? ""}
                        onChange={(e) => updatePlannerTask(task.id, { startTime: e.target.value || undefined })}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-gray-400">Конец окна</span>
                      <input
                        type="time"
                        className={`${fieldClasses} ${task.dayPreference === "any" ? "opacity-60" : ""}`}
                        disabled={task.dayPreference === "any"}
                        value={task.endTime ?? ""}
                        onChange={(e) => updatePlannerTask(task.id, { endTime: e.target.value || undefined })}
                      />
                    </label>
                  </div>

                  <label className="mt-3 block space-y-1">
                    <span className="text-xs uppercase tracking-wide text-gray-400">Заметки</span>
                    <textarea
                      className={`${fieldClasses} min-h-[80px] resize-none`}
                      placeholder="Комментарий или напоминание"
                      value={task.notes ?? ""}
                      onChange={(e) => updatePlannerTask(task.id, { notes: e.target.value })}
                    />
                  </label>

                  <details className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-gray-200">
                    <summary className="cursor-pointer text-xs uppercase tracking-wide text-gray-400">
                      Дополнительные настройки
                    </summary>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="space-y-1">
                        <span className="text-xs uppercase tracking-wide text-gray-400">Дедлайн (дни от сегодня)</span>
                        <input
                          type="number"
                          min={0}
                          max={30}
                          className={fieldClasses}
                          value={task.deadlineDayOffset ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            updatePlannerTask(task.id, {
                              deadlineDayOffset: value === "" ? null : Math.max(0, Number.parseInt(value, 10) || 0),
                            });
                          }}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs uppercase tracking-wide text-gray-400">Можно раньше (мин)</span>
                        <input
                          type="number"
                          min={0}
                          className={fieldClasses}
                          value={task.shiftBefore ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            updatePlannerTask(task.id, {
                              shiftBefore: value === "" ? undefined : Math.max(0, Number.parseInt(value, 10) || 0),
                            });
                          }}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs uppercase tracking-wide text-gray-400">Можно позже (мин)</span>
                        <input
                          type="number"
                          min={0}
                          className={fieldClasses}
                          value={task.shiftAfter ?? ""}
                          onChange={(e) => {
                            const value = e.target.value;
                            updatePlannerTask(task.id, {
                              shiftAfter: value === "" ? undefined : Math.max(0, Number.parseInt(value, 10) || 0),
                            });
                          }}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-400">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border border-white/20 bg-transparent"
                          checked={task.allowSplit ?? false}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            updatePlannerTask(task.id, {
                              allowSplit: checked,
                              minChunk: checked ? task.minChunk ?? Math.min(task.durationMin, 60) : undefined,
                              maxChunks: checked ? task.maxChunks ?? 2 : undefined,
                            });
                          }}
                        />
                        Разбивать на блоки
                      </label>
                      {task.allowSplit && (
                        <>
                          <label className="space-y-1">
                            <span className="text-xs uppercase tracking-wide text-gray-400">Минимальный блок (мин)</span>
                            <input
                              type="number"
                              min={10}
                              step={5}
                              className={fieldClasses}
                              value={task.minChunk ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                updatePlannerTask(task.id, {
                                  minChunk: value === "" ? undefined : Math.max(10, Number.parseInt(value, 10) || 10),
                                });
                              }}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-xs uppercase tracking-wide text-gray-400">Максимум блоков</span>
                            <input
                              type="number"
                              min={1}
                              className={fieldClasses}
                              value={task.maxChunks ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                updatePlannerTask(task.id, {
                                  maxChunks: value === "" ? undefined : Math.max(1, Number.parseInt(value, 10) || 1),
                                });
                              }}
                            />
                          </label>
                        </>
                      )}
                    </div>
                  </details>
                </div>
              ))}
            </div>
            {plannerMessage && (
              <div className="mt-4 rounded-xl border border-amber-200/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                {plannerMessage}
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <button className={subtleButtonClasses} onClick={addPlannerTask}>
                + Задача
              </button>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className={subtleButtonClasses}
                  onClick={() => {
                    setPlannerTasks([makePlannerTask()]);
                    setPlannerMessage(null);
                  }}
                >
                  Очистить
                </button>
                <button className={actionButtonClasses} onClick={runAutoPlanner}>
                  Запланировать
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="py-8 text-center text-xs text-gray-500">
        Локальное хранение (localStorage). Двойной клик по дню — создать событие.
        Кнопка −15 мин сдвигает и подтягивает гибкие задачи. Исправлено падение при пустых/некорректных датах.
      </div>
    </div>
  );
}



