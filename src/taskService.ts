import type { EventItem, FamilyKey, Interval, Task, TaskEvent } from "./types";
import { chunkTask, scheduleTaskChunksBeforeEvent, findLatestSlotBeforeDeadline } from "./scheduler";
import { loadEvents, saveEvents, loadTasks, saveTasks } from "./storage";
import { uid } from "./utils/misc";
import { addMinutes, diffMinutes, parseISOorNull, startOfDay } from "./utils/date";
import {
  TASK_DAY_START_HOUR,
  TASK_DAY_END_HOUR,
  BREAK_GAP_MIN,
  MAX_TASK_EVENTS_PER_DAY,
  MAX_TASK_EVENTS_PER_TASK,
  WEEKEND_STUDY_LIMIT,
  FAMILY_WINDOWS,
} from "./config/timeWindows";

type CreateTaskInput = Omit<Task, "id" | "parts">;
type CreateTaskContext = { events: EventItem[] };

export function createTask(
  input: CreateTaskInput,
  ctx: CreateTaskContext
): { task: Task; newEvents: TaskEvent[] } {
  const mergedEvents = combineEvents(loadEvents(), ctx.events);
  const anchorEvent = resolveAnchorEvent(mergedEvents, input);
  if (!anchorEvent) {
    throw new Error("Anchor event not found for task creation.");
  }

  const chunks = chunkTask(input.totalDuration);
  if (!chunks.length) {
    const task: Task = { ...input, id: uid(), parts: [] };
    persistTask(task);
    return { task, newEvents: [] };
  }

  const scheduled = scheduleTaskChunksBeforeEvent(mergedEvents, anchorEvent, chunks, {
    earliestStart: new Date(),
    family: input.calendarType,
    maxPerDay: MAX_TASK_EVENTS_PER_DAY,
    maxPerDayPerTask: MAX_TASK_EVENTS_PER_TASK,
    dayStartHour: familyWindowStart(input.calendarType),
    dayEndHour: familyWindowEnd(input.calendarType),
    breakGapMin: BREAK_GAP_MIN,
  });

  const acceptedIntervals = enforceDailyLimits(
    scheduled,
    mergedEvents,
    input.calendarType,
    MAX_TASK_EVENTS_PER_DAY,
    MAX_TASK_EVENTS_PER_TASK
  );

  const taskId = uid();
  const task: Task = {
    ...input,
    id: taskId,
    parts: acceptedIntervals.map((interval) => Math.max(1, diffMinutes(interval.end, interval.start))),
  };

  const newEvents: TaskEvent[] = acceptedIntervals.map((interval, index) =>
    buildTaskEvent(task, interval, index, acceptedIntervals.length)
  );

  const allEvents = combineEvents(mergedEvents, newEvents);
  saveEvents(allEvents);

  persistTask(task);

  return { task, newEvents };
}

export function markTaskEventDone(eventId: string): void {
  const events = loadEvents();
  let updated = false;

  const nextEvents = events.map((event) => {
    if (event.id !== eventId) return event;
    const updatedEvent = { ...event } as TaskEvent;
    if (updatedEvent.done) return updatedEvent;
    updatedEvent.done = true;
    updated = true;
    return updatedEvent;
  });

  if (!updated) return;
  saveEvents(nextEvents);

  optimizeFlexibleEvents();
}

export function markTaskEventUndone(eventId: string): void {
  const events = loadEvents();
  const tasks = loadTasks();

  const targetIndex = events.findIndex((event) => event.id === eventId);
  if (targetIndex === -1) return;

  const targetEvent = { ...events[targetIndex] } as TaskEvent;
  if (!targetEvent.taskId) {
    const eventCopy = { ...targetEvent, done: false };
    events[targetIndex] = eventCopy;
    saveEvents(events);
    return;
  }

  const relatedTask = tasks.find((taskItem) => taskItem.id === targetEvent.taskId);
  const taskDuration = Math.max(1, diffMinutes(parseISODate(targetEvent.end), parseISODate(targetEvent.start)));
  const anchorEvent = resolveAnchorForTask(events, targetEvent, relatedTask);

  const earliestStart = computeNextDayStart(
    parseISODate(targetEvent.start),
    relatedTask?.calendarType ?? targetEvent.family
  );
  const deadline = parseISODate(relatedTask?.deadline) ?? parseISODate(targetEvent.end);
  const allowNight = deadline.getTime() - Date.now() < 24 * 60 * 60 * 1000;

  const remainingEvents = events.filter((_, idx) => idx !== targetIndex);
  const scheduled = scheduleTaskChunksBeforeEvent(remainingEvents, anchorEvent, [taskDuration], {
    earliestStart,
    family: relatedTask?.calendarType ?? targetEvent.family,
    maxPerDay: MAX_TASK_EVENTS_PER_DAY,
    maxPerDayPerTask: MAX_TASK_EVENTS_PER_TASK,
    dayStartHour: familyWindowStart(relatedTask?.calendarType ?? targetEvent.family),
    dayEndHour: allowNight ? 24 : familyWindowEnd(relatedTask?.calendarType ?? targetEvent.family),
    breakGapMin: BREAK_GAP_MIN,
  });

  const slots = enforceDailyLimits(
    scheduled,
    remainingEvents,
    relatedTask?.calendarType ?? targetEvent.family,
    MAX_TASK_EVENTS_PER_DAY,
    MAX_TASK_EVENTS_PER_TASK
  );

  const chosenSlot = slots[0] ?? {
    start: parseISODate(targetEvent.start),
    end: parseISODate(targetEvent.end),
  };

  const updatedEvent: TaskEvent = {
    ...targetEvent,
    start: toISO(chosenSlot.start),
    end: toISO(chosenSlot.end),
    done: false,
  };

  const nextEvents = [...remainingEvents, updatedEvent];
  saveEvents(sortEvents(nextEvents));
}

export function optimizeFlexibleEvents(): void {
  const events = loadEvents();
  if (!events.length) return;

  const fixed: EventItem[] = [];
  const flexible: TaskEvent[] = [];

  events.forEach((event) => {
    if (event.type === "fixed") {
      fixed.push(event);
      return;
    }
    const taskEvent = event as TaskEvent;
    if (taskEvent.done) {
      return;
    }
    flexible.push(taskEvent);
  });

  const timeline = fixed.map((event) => ({
    start: parseISODate(event.start),
    end: parseISODate(event.end),
  }));

  const scheduleOpts = {
    earliestStart: startOfDay(new Date()),
    family: "home" as FamilyKey,
    maxPerDay: MAX_TASK_EVENTS_PER_DAY,
    maxPerDayPerTask: MAX_TASK_EVENTS_PER_TASK,
    dayStartHour: TASK_DAY_START_HOUR,
    dayEndHour: TASK_DAY_END_HOUR,
    breakGapMin: BREAK_GAP_MIN,
    weekendStudyLimit: WEEKEND_STUDY_LIMIT,
  };

  const optimized: EventItem[] = [...fixed];

  const sortedFlexible = [...flexible].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return parseISODate(a.start).getTime() - parseISODate(b.start).getTime();
  });

  for (const event of sortedFlexible) {
    const duration = Math.max(1, diffMinutes(parseISODate(event.end), parseISODate(event.start)));
    const deadline = parseISODate(event.start);
    const localOpts = {
      ...scheduleOpts,
      family: event.family,
      dayStartHour: familyWindowStart(event.family),
      dayEndHour: familyWindowEnd(event.family),
    };
    const earliestWindow = addMinutes(
      startOfDay(new Date(Math.min(Date.now(), deadline.getTime()))),
      localOpts.dayStartHour * 60
    );
    const earliest = new Date(Math.max(localOpts.earliestStart.getTime(), earliestWindow.getTime()));
    const slot = findLatestSlotBeforeDeadline(
      timeline,
      duration,
      deadline,
      earliest,
      localOpts
    );

    if (slot && slot.start.getTime() < deadline.getTime()) {
      const updatedEvent: TaskEvent = {
        ...event,
        start: toISO(slot.start),
        end: toISO(slot.end),
      };
      optimized.push(updatedEvent);
      timeline.push(slot);
      continue;
    }

    optimized.push(event);
    timeline.push({
      start: parseISODate(event.start),
      end: parseISODate(event.end),
    });
  }

  saveEvents(sortEvents(optimized));
}

function enforceDailyLimits(
  intervals: Interval[],
  events: EventItem[],
  family: FamilyKey,
  maxPerFamily: number,
  maxPerTaskPerDay: number
): Interval[] {
  const existingFamilyCounts = buildFamilyDayCounts(events, family);
  const accepted: Interval[] = [];
  const perTaskPerDay = new Map<string, number>();
  const newCounts = new Map<string, number>();

  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  for (const interval of sorted) {
    const key = dayId(interval.start);
    const existing = existingFamilyCounts.get(key) ?? 0;
    const added = newCounts.get(key) ?? 0;
    if (existing + added >= maxPerFamily) continue;
    if ((perTaskPerDay.get(key) ?? 0) >= maxPerTaskPerDay) continue;
    perTaskPerDay.set(key, (perTaskPerDay.get(key) ?? 0) + 1);
    newCounts.set(key, added + 1);
    accepted.push(interval);
  }

  return accepted;
}

function buildTaskEvent(task: Task, interval: Interval, index: number, total: number): TaskEvent {
  const start = toISO(interval.start);
  const end = toISO(interval.end);
  const title = total > 1 ? `${task.title} (${index + 1}/${total})` : task.title;
  return {
    id: `task-${task.id}-${index + 1}`,
    title,
    start,
    end,
    type: "flexible",
    priority: task.priority,
    family: task.calendarType,
    notes: task.anchorEventId ? `Linked to ${task.anchorEventId}` : undefined,
    taskId: task.id,
    done: false,
  };
}

function persistTask(task: Task): void {
  const tasks = loadTasks().filter((existing) => existing.id !== task.id);
  tasks.push(task);
  saveTasks(tasks);
}

function resolveAnchorEvent(events: EventItem[], input: CreateTaskInput): EventItem | null {
  if (input.anchorEventId) {
    const found = events.find((event) => event.id === input.anchorEventId);
    if (found) return found;
  }
  const deadlineDate = parseISODate(input.deadline);
  if (!deadlineDate) return null;
  return {
    id: `deadline-${uid()}`,
    title: `${input.title} deadline`,
    start: toISO(deadlineDate),
    end: toISO(addMinutes(deadlineDate, 5)),
    type: "fixed",
    priority: input.priority,
    family: input.calendarType,
  };
}

function resolveAnchorForTask(
  events: EventItem[],
  targetEvent: TaskEvent,
  task: Task | undefined
): EventItem {
  if (task?.anchorEventId) {
    const anchor = events.find((event) => event.id === task.anchorEventId);
    if (anchor) return anchor;
  }
  const deadline = parseISODate(task?.deadline ?? targetEvent.end);
  return {
    id: `deadline-${uid()}`,
    title: `${task?.title ?? targetEvent.title} deadline`,
    start: toISO(deadline),
    end: toISO(addMinutes(deadline, 5)),
    type: "fixed",
    priority: task?.priority ?? targetEvent.priority,
    family: task?.calendarType ?? targetEvent.family,
  };
}

function combineEvents(existing: EventItem[], incoming: EventItem[]): EventItem[] {
  const map = new Map<string, EventItem>();
  existing.forEach((event) => map.set(event.id, event));
  incoming.forEach((event) => map.set(event.id, event));
  return sortEvents([...map.values()]);
}

function sortEvents(events: EventItem[]): EventItem[] {
  return [...events].sort(
    (a, b) => parseISODate(a.start).getTime() - parseISODate(b.start).getTime()
  );
}

function buildFamilyDayCounts(events: EventItem[], family: FamilyKey): Map<string, number> {
  const counts = new Map<string, number>();
  events.forEach((event) => {
    if (event.family !== family) return;
    const date = parseISODate(event.start);
    const key = dayId(date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
}

function dayId(date: Date): string {
  return startOfDay(date).toISOString().slice(0, 10);
}

function parseISODate(value: string | undefined): Date {
  if (!value) return new Date(NaN);
  const parsed = parseISOorNull(value);
  return parsed ?? new Date(value);
}

function toISO(date: Date): string {
  return new Date(date.getTime()).toISOString();
}

function computeNextDayStart(start: Date, family?: FamilyKey): Date {
  const base = startOfDay(start);
  const startHour = familyWindowStart(family);
  const nextDay = addMinutes(base, 1440 + startHour * 60);
  return new Date(Math.max(nextDay.getTime(), Date.now()));
}

function familyWindowStart(family?: FamilyKey): number {
  if (!family) return TASK_DAY_START_HOUR;
  return FAMILY_WINDOWS[family]?.start ?? TASK_DAY_START_HOUR;
}

function familyWindowEnd(family?: FamilyKey): number {
  if (!family) return TASK_DAY_END_HOUR;
  return FAMILY_WINDOWS[family]?.end ?? TASK_DAY_END_HOUR;
}
