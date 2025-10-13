import type { EventItem, FamilyKey, Task, TaskEvent } from "./types";

const EVENTS_KEY = "calendar.events";
const TASKS_KEY = "calendar.tasks";

const FAMILY_VALUES: ReadonlyArray<FamilyKey> = ["study", "work", "training", "home"] as const;
const EVENT_TYPES = new Set<EventItem["type"]>(["fixed", "flexible"]);

const ISO_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Check whether a value is an ISO-8601 datetime string.
 */
export function isValidISO(s: unknown): s is string {
  if (typeof s !== "string") {
    return false;
  }
  if (!ISO_REGEX.test(s)) {
    return false;
  }
  const timestamp = Date.parse(s);
  return !Number.isNaN(timestamp);
}

/**
 * Convert a value into a normalized ISO string (or null if invalid).
 * - Accepts an ISO string or a Date instance.
 * - Always returns `toISOString()` (UTC) when valid.
 */
export function sanitizeISODate(value: unknown): string | null {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  if (typeof value === "string") {
    if (!isValidISO(value)) return null;
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

/**
 * Load persisted events, discarding malformed records.
 */
export function loadEvents(): EventItem[] {
  return readArray(EVENTS_KEY).map(sanitizeEvent).filter(isNonNull);
}

/**
 * Persist events after sanitizing them.
 */
export function saveEvents(events: EventItem[]): void {
  const normalized = events.map(sanitizeEvent).filter(isNonNull);
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore storage failures */
  }
}

/**
 * Load persisted tasks, discarding malformed records.
 */
export function loadTasks(): Task[] {
  return readArray(TASKS_KEY).map(sanitizeTask).filter(isNonNull);
}

/**
 * Persist tasks after sanitizing them.
 */
export function saveTasks(tasks: Task[]): void {
  const normalized = tasks.map(sanitizeTask).filter(isNonNull);
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore storage failures */
  }
}

type StoredValue = Partial<Record<keyof EventItem, unknown>> & Record<string, unknown>;

function sanitizeEvent(value: unknown): EventItem | null {
  if (value === null || typeof value !== "object") {
    return null;
  }

  const event = value as StoredValue;
  if (typeof event.id !== "string" || typeof event.title !== "string") {
    return null;
  }
  if (!isValidISO(event.start) || !isValidISO(event.end)) {
    return null;
  }

  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  if (!(end > start)) {
    return null;
  }

  const type = event.type;
  if (typeof type !== "string" || !EVENT_TYPES.has(type as EventItem["type"])) {
    return null;
  }

  const priority = event.priority;
  if (!isPriority(priority)) {
    return null;
  }

  if (!isFamilyKey(event.family)) {
    return null;
  }

  const sanitized: EventItem = {
    id: event.id,
    title: event.title,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    type: type as EventItem["type"],
    priority,
    family: event.family,
  };

  if (typeof event.notes === "string" && event.notes.trim().length > 0) {
    sanitized.notes = event.notes;
  }

  if (typeof (event as any).taskId === "string") {
    (sanitized as TaskEvent).taskId = (event as any).taskId;
    (sanitized as TaskEvent).done = Boolean((event as any).done);
  }

  return sanitized;
}

type StoredTaskValue = Partial<Record<keyof Task, unknown>> & Record<string, unknown>;

function sanitizeTask(value: unknown): Task | null {
  if (value === null || typeof value !== "object") {
    return null;
  }

  const task = value as StoredTaskValue;
  if (typeof task.id !== "string" || typeof task.title !== "string") {
    return null;
  }
  if (!isFiniteNumber(task.totalDuration) || task.totalDuration < 0) {
    return null;
  }
  if (!isValidISO(task.deadline)) {
    return null;
  }
  if (task.anchorEventId !== undefined && typeof task.anchorEventId !== "string") {
    return null;
  }
  if (!isFamilyKey(task.calendarType)) {
    return null;
  }
  if (!isPriority(task.priority)) {
    return null;
  }
  const parts = Array.isArray(task.parts)
    ? task.parts.filter(isNonNegativeNumber)
    : [];

  return {
    id: task.id,
    title: task.title,
    totalDuration: task.totalDuration,
    deadline: new Date(Date.parse(task.deadline)).toISOString(),
    anchorEventId: task.anchorEventId,
    calendarType: task.calendarType,
    priority: task.priority,
    parts,
  };
}

function readArray(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPriority(value: unknown): value is 1|2|3|4|5 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isFamilyKey(value: unknown): value is FamilyKey {
  return typeof value === "string" && (FAMILY_VALUES as ReadonlyArray<string>).includes(value);
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}
