import { uid, clone } from "./utils/misc";
import { addMinutes, diffMinutes, parseISOorNull, startOfDay, sameDay } from "./utils/date";
import type {
  EventItem,
  Task,
  TaskEvent,
  TaskCalendarType,
} from "./types";

const TASK_STORAGE_KEY = "mycalendar.tasks";
const EVENT_STORAGE_KEY = "mycalendar.events";
const BREAK_MINUTES = 10;
const MAX_TASK_EVENTS_PER_DAY = 5;
const DEFAULT_DAY_START = 8; // 08:00
const DEFAULT_DAY_END = 22; // 22:00

type StorageProvider = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type TaskPlannerOptions = {
  storage?: StorageProvider;
  loadEvents?: () => EventItem[];
  saveEvents?: (events: EventItem[]) => void;
  calendarIdByType?: Partial<Record<TaskCalendarType, string>>;
  defaultCalendarId?: string;
  dayStartHour?: number;
  dayEndHour?: number;
};

type InternalEvent = EventItem | TaskEvent;

const calendarFamilyMap: Record<TaskCalendarType, EventItem["family"]> = {
  study: "study",
  work: "work",
  personal: "life",
};

const isTaskEvent = (event: EventItem): event is TaskEvent =>
  typeof (event as TaskEvent).taskId === "string" && Boolean((event as TaskEvent).taskId);

export class TaskPlanner {
  private readonly storage: StorageProvider;
  private readonly loadEventsFn: () => EventItem[];
  private readonly saveEventsFn: (events: EventItem[]) => void;
  private readonly calendarIdByType: Partial<Record<TaskCalendarType, string>>;
  private readonly defaultCalendarId?: string;
  private readonly dayStartHour: number;
  private readonly dayEndHour: number;
  private tasks: Task[];

  constructor(options: TaskPlannerOptions = {}) {
    this.storage = options.storage ?? window.localStorage;
    this.loadEventsFn =
      options.loadEvents ??
      (() => {
        const raw = this.storage.getItem(EVENT_STORAGE_KEY);
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? (parsed as EventItem[]) : [];
        } catch {
          return [];
        }
      });
    this.saveEventsFn =
      options.saveEvents ??
      ((events) => {
        this.storage.setItem(EVENT_STORAGE_KEY, JSON.stringify(events));
      });
    this.calendarIdByType = options.calendarIdByType ?? {};
    this.defaultCalendarId = options.defaultCalendarId;
    this.dayStartHour = options.dayStartHour ?? DEFAULT_DAY_START;
    this.dayEndHour = options.dayEndHour ?? DEFAULT_DAY_END;
    this.tasks = this.readTasksFromStorage();
  }

  get allTasks(): Task[] {
    return [...this.tasks];
  }

  getTaskById(id: string): Task | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  createTask(taskInput: Task): TaskEvent[] {
    const task: Task = {
      ...taskInput,
      id: taskInput.id || uid(),
      parts: [...(taskInput.parts ?? [])],
    };
    const events = this.loadEvents();
    const scheduleResult = this.buildTaskEvents(task, events);
    const mergedEvents = [...events, ...scheduleResult.events];
    task.parts = scheduleResult.eventIds;

    this.tasks = [...this.tasks.filter((t) => t.id !== task.id), task];
    this.persistTasks();
    this.saveEventsFn(mergedEvents);

    return scheduleResult.events;
  }

  redistributeTasks(calendarType: TaskCalendarType): void {
    const events = this.loadEvents();
    const now = new Date();
    const preservedEvents: InternalEvent[] = [];
    const tasksToRebuild: Task[] = [];

    const taskIdsForCalendar = new Set(
      this.tasks.filter((task) => task.calendarType === calendarType).map((task) => task.id)
    );

    events.forEach((event) => {
      if (isTaskEvent(event) && taskIdsForCalendar.has(event.taskId)) {
        const deadline = this.getTaskById(event.taskId)?.deadline;
        if (event.done || (deadline && parseISOorNull(deadline)! < now && event.done)) {
          preservedEvents.push(event);
        }
      } else {
        preservedEvents.push(event);
      }
    });

    this.tasks = this.tasks.map((task) => {
      if (task.calendarType !== calendarType) return task;
      const updatedTask: Task = { ...task, parts: [] };
      tasksToRebuild.push(updatedTask);
      return updatedTask;
    });

    let rebuiltEvents: InternalEvent[] = preservedEvents.slice();
    tasksToRebuild
      .sort((a, b) => b.priority - a.priority || a.deadline.localeCompare(b.deadline))
      .forEach((task) => {
        const result = this.buildTaskEvents(task, rebuiltEvents);
        task.parts = result.eventIds;
        rebuiltEvents = [...rebuiltEvents, ...result.events];
      });

    this.persistTasks();
    this.saveEventsFn(rebuiltEvents as EventItem[]);
  }

  markTaskEventDone(eventId: string): void {
    const events = this.loadEvents();
    let calendarType: TaskCalendarType | undefined;
    const updated = events.map((event) => {
      if (isTaskEvent(event) && event.id === eventId) {
        calendarType = event.calendarType;
        return { ...event, done: true };
      }
      return event;
    });
    this.saveEventsFn(updated);
    if (calendarType) {
      this.optimizeFlexibleEvents(calendarType);
    }
  }

  markTaskEventUndone(eventId: string): void {
    const events = this.loadEvents();
    let target: TaskEvent | null = null;
    const filtered: InternalEvent[] = [];
    events.forEach((event) => {
      if (isTaskEvent(event) && event.id === eventId) {
        target = { ...event, done: false };
      } else {
        filtered.push(event);
      }
    });

    if (!target) {
      this.saveEventsFn(events);
      return;
    }

    const activeEvent = target as TaskEvent;
    const task = activeEvent.taskId ? this.getTaskById(activeEvent.taskId) : undefined;
    if (!task) {
      this.saveEventsFn([...filtered, activeEvent]);
      return;
    }

    const rebuilt = this.scheduleSingleTaskEvent(task, activeEvent, filtered);
    this.replaceTaskPart(task, activeEvent.id, rebuilt.id);
    this.saveEventsFn([...filtered, rebuilt]);
    this.persistTasks();
  }

  optimizeFlexibleEvents(calendarType: TaskCalendarType): void {
    this.redistributeTasks(calendarType);
  }

  findNextFreeSlot(duration: number, day: Date, _calendarType: TaskCalendarType): Date | null {
    const events = this.loadEvents();
    return this.findSlot(duration, day, events);
  }

  // ---------- internal helpers ----------

  private loadEvents(): EventItem[] {
    return this.loadEventsFn().map((event) => ({ ...event }));
  }

  private readTasksFromStorage(): Task[] {
    try {
      const raw = this.storage.getItem(TASK_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => this.sanitizeTask(item))
        .filter((task): task is Task => Boolean(task));
    } catch {
      return [];
    }
  }

  private sanitizeTask(item: any): Task | null {
    if (!item || typeof item !== "object") return null;
    const id = typeof item.id === "string" ? item.id : uid();
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const totalDuration = Number(item.totalDuration);
    const deadline = typeof item.deadline === "string" ? item.deadline : null;
    const calendarType = (["study", "work", "personal"] as TaskCalendarType[]).includes(item.calendarType)
      ? (item.calendarType as TaskCalendarType)
      : "personal";
    const priority = Math.min(10, Math.max(1, Number(item.priority) || 1));
    const parts = Array.isArray(item.parts)
      ? item.parts.map((part: any) => String(part)).filter(Boolean)
      : [];

    if (!title || !deadline || !Number.isFinite(totalDuration)) return null;
    return {
      id,
      title,
      totalDuration,
      deadline,
      linkedEventId: typeof item.linkedEventId === "string" ? item.linkedEventId : undefined,
      calendarType,
      priority,
      parts,
    };
  }

  private persistTasks(): void {
    this.storage.setItem(TASK_STORAGE_KEY, JSON.stringify(this.tasks));
  }

  private buildTaskEvents(
    task: Task,
    currentEvents: InternalEvent[]
  ): { events: TaskEvent[]; eventIds: string[] } {
    const events: TaskEvent[] = [];
    const eventIds: string[] = [];
    const chunkDurations = this.splitDurations(task.totalDuration);
    const scheduledDays = new Set<string>();
    const today = startOfDay(new Date());
    const rawDeadline = parseISOorNull(task.deadline) ?? today;
    const deadlineDay = startOfDay(rawDeadline);
    const searchDays = this.enumerateCandidateDays(today, deadlineDay, chunkDurations.length);

    const workingEvents: InternalEvent[] = [...currentEvents];

    chunkDurations.forEach((chunkDuration, index) => {
      let scheduledDate: Date | null = null;
      let scheduledStart: Date | null = null;
      for (const candidateDay of searchDays) {
        const dayKey = candidateDay.toISOString();
        if (scheduledDays.has(dayKey)) continue;
        if (this.countTaskEventsForDay(workingEvents, candidateDay, task.calendarType) >= MAX_TASK_EVENTS_PER_DAY) {
          continue;
        }
        const start = this.findSlot(chunkDuration, candidateDay, workingEvents);
        if (start) {
          scheduledDate = candidateDay;
          scheduledStart = start;
          break;
        }
      }

      if (!scheduledDate || !scheduledStart) {
        const fallbackDay = this.findFirstAvailableDayAfter(
          deadlineDay,
          workingEvents,
          task.calendarType,
          chunkDuration
        );
        if (fallbackDay) {
          scheduledDate = fallbackDay.day;
          scheduledStart = fallbackDay.start;
        } else {
          scheduledDate = deadlineDay;
          scheduledStart = this.defaultDayStart(deadlineDay);
        }
      }

      const effectiveDay = scheduledDate ?? deadlineDay;
      const start = scheduledStart ?? this.defaultDayStart(effectiveDay);
      const end = addMinutes(start, chunkDuration);
      const eventId = `task-${task.id}-${index + 1}-${uid()}`;
      const newEvent: TaskEvent = {
        id: eventId,
        title: task.title,
        start: start.toISOString(),
        end: end.toISOString(),
        type: "flexible",
        priority: task.priority,
        family: calendarFamilyMap[task.calendarType],
        notes: `Задача: ${task.title}`,
        calendarId:
          this.calendarIdByType[task.calendarType] ?? this.defaultCalendarId ?? task.calendarType,
        taskId: task.id,
        done: false,
        calendarType: task.calendarType,
      };

      workingEvents.push(newEvent);
      eventIds.push(eventId);
      events.push(newEvent);
      scheduledDays.add(startOfDay(effectiveDay).toISOString());
    });

    return { events, eventIds };
  }

  private scheduleSingleTaskEvent(task: Task, target: TaskEvent, events: InternalEvent[]): TaskEvent {
    const chunkDuration = diffMinutes(parseISOorNull(target.end)!, parseISOorNull(target.start)!);
    const today = startOfDay(new Date());
    const rawDeadline = parseISOorNull(task.deadline) ?? today;
    const deadline = startOfDay(rawDeadline);
    const searchDays = this.enumerateCandidateDays(today, deadline, 1);
    let resultStart: Date | null = null;
    let resultDay: Date | null = null;
    for (const day of searchDays) {
      if (this.countTaskEventsForDay(events, day, task.calendarType) >= MAX_TASK_EVENTS_PER_DAY) continue;
      const start = this.findSlot(chunkDuration, day, events);
      if (start) {
        resultStart = start;
        resultDay = day;
        break;
      }
    }
    if (!resultStart || !resultDay) {
      const fallback = this.findFirstAvailableDayAfter(
        deadline,
        events,
        task.calendarType,
        chunkDuration
      );
      if (fallback) {
        resultStart = fallback.start;
        resultDay = fallback.day;
      } else {
        resultDay = deadline;
        resultStart = this.defaultDayStart(deadline);
      }
    }
    const start = resultStart;
    const end = addMinutes(start, chunkDuration);
    const rebuilt: TaskEvent = {
      ...target,
      start: start.toISOString(),
      end: end.toISOString(),
      done: false,
    };
    events.push(rebuilt);
    return rebuilt;
  }

  private replaceTaskPart(task: Task, previousId: string, nextId: string): void {
    task.parts = task.parts.map((partId) => (partId === previousId ? nextId : partId));
    this.tasks = this.tasks.map((stored) => (stored.id === task.id ? { ...task } : stored));
  }

  private splitDurations(total: number): number[] {
    const safe = Math.max(10, Math.round(total));
    if (safe <= 120) return [safe];
    if (safe <= 160) {
      const half = Math.floor(safe / 2);
      const remainder = safe - half;
      return [half, remainder];
    }
    const parts: number[] = [];
    let remaining = safe;
    while (remaining > 0) {
      const chunk = Math.min(80, remaining);
      parts.push(chunk);
      remaining -= chunk;
    }
    return parts;
  }

  private enumerateCandidateDays(start: Date, deadline: Date, parts: number): Date[] {
    const days: Date[] = [];
    const startDay = startOfDay(start);
    const endDay = startOfDay(deadline);
    let cursor = startDay;
    while (cursor <= endDay) {
      days.push(cursor);
      cursor = addMinutes(cursor, 1440);
    }
    if (days.length >= parts) return days;
    let overflowCursor = addMinutes(endDay, 1440);
    while (days.length < parts) {
      days.push(overflowCursor);
      overflowCursor = addMinutes(overflowCursor, 1440);
    }
    return days;
  }

  private countTaskEventsForDay(events: InternalEvent[], day: Date, calendarType: TaskCalendarType): number {
    return events.filter(
      (event) =>
        isTaskEvent(event) &&
        event.calendarType === calendarType &&
        sameDay(parseISOorNull(event.start)!, day)
    ).length;
  }

  private findSlot(duration: number, day: Date, events: InternalEvent[]): Date | null {
    const dayStart = this.defaultDayStart(day);
    const dayEnd = this.defaultDayEnd(day);
    const busy = this.collectBusyIntervals(events, day);
    busy.sort((a, b) => a.start.getTime() - b.start.getTime());

    let cursor = dayStart;
    for (const interval of busy) {
      if (interval.start > cursor) {
        const gap = diffMinutes(interval.start, cursor);
        if (gap >= duration) {
          return cursor;
        }
      }
      if (interval.end > cursor) {
        cursor = addMinutes(interval.end, 0);
      }
      if (cursor >= dayEnd) break;
    }
    if (diffMinutes(dayEnd, cursor) >= duration) {
      return cursor;
    }
    return null;
  }

  private collectBusyIntervals(events: InternalEvent[], day: Date): { start: Date; end: Date }[] {
    const intervals: { start: Date; end: Date }[] = [];
    events.forEach((event) => {
      const start = parseISOorNull(event.start);
      const end = parseISOorNull(event.end);
      if (!start || !end || end <= start) return;
      if (!sameDay(start, day) && !sameDay(end, day)) return;
      const clampedStart = sameDay(start, day) ? start : this.defaultDayStart(day);
      const clampedEnd = sameDay(end, day) ? end : this.defaultDayEnd(day);
      const paddedEnd = isTaskEvent(event) ? addMinutes(clampedEnd, BREAK_MINUTES) : clampedEnd;
      intervals.push({ start: clampedStart, end: paddedEnd });
    });
    return intervals;
  }

  private findFirstAvailableDayAfter(
    startDay: Date,
    events: InternalEvent[],
    calendarType: TaskCalendarType,
    duration: number
  ): { day: Date; start: Date } | null {
    let cursor = startOfDay(startDay);
    for (let i = 0; i < 30; i += 1) {
      if (this.countTaskEventsForDay(events, cursor, calendarType) >= MAX_TASK_EVENTS_PER_DAY) {
        cursor = addMinutes(cursor, 1440);
        continue;
      }
      const slot = this.findSlot(duration, cursor, events);
      if (slot) {
        return { day: cursor, start: slot };
      }
      cursor = addMinutes(cursor, 1440);
    }
    return null;
  }

  private defaultDayStart(day: Date): Date {
    const d = clone(day);
    d.setHours(this.dayStartHour, 0, 0, 0);
    return d;
  }

  private defaultDayEnd(day: Date): Date {
    const d = clone(day);
    d.setHours(this.dayEndHour, 0, 0, 0);
    return d;
  }
}

export default TaskPlanner;

const defaultPlanner = new TaskPlanner();

export const createTask = (task: Task) => defaultPlanner.createTask(task);
export const redistributeTasks = (calendarType: TaskCalendarType) =>
  defaultPlanner.redistributeTasks(calendarType);
export const markTaskEventDone = (eventId: string) => defaultPlanner.markTaskEventDone(eventId);
export const markTaskEventUndone = (eventId: string) => defaultPlanner.markTaskEventUndone(eventId);
export const optimizeFlexibleEvents = (calendarType: TaskCalendarType) =>
  defaultPlanner.optimizeFlexibleEvents(calendarType);
export const findNextFreeSlot = (duration: number, day: Date, calendarType: TaskCalendarType) =>
  defaultPlanner.findNextFreeSlot(duration, day, calendarType);
