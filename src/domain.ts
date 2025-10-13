import type { EventItem, TaskEvent } from "./types";

export interface CalendarInfo {
  id: string;
  name: string;
  color: string;
  description?: string;
  visible: boolean;
}

export type CalendarInfoMap = Map<string, CalendarInfo>;

export type CalendarEvent = EventItem & {
  calendarId: string;
  linkedTaskId?: string;
  taskId?: string;
  done?: boolean;
};

export type DaySlice = {
  event: CalendarEvent;
  sliceStart: Date;
  sliceEnd: Date;
  continuesFromPrev: boolean;
  continuesToNext: boolean;
};

export type PlannerTask = {
  id: string;
  title: string;
  durationMin: number;
  priority: 1 | 2 | 3 | 4 | 5;
  dayPreference: "any" | number;
  startTime?: string;
  endTime?: string;
  deadlineDayOffset: number | null;
  shiftBefore?: number;
  shiftAfter?: number;
  allowSplit: boolean;
  minChunk?: number;
  maxChunks?: number;
  notes?: string;
  calendarId?: string;
};

export interface TaskAssignment {
  id: string;
  title: string;
  anchorEventId: string;
  totalDurationMin: number;
  notes?: string;
  chunkEventIds: string[];
  createdAt: string;
}

export interface TaskCreateInput {
  title: string;
  anchorEventId: string;
  totalDurationMin: number;
  notes?: string;
}

export interface TaskCreateResult {
  ok: boolean;
  message?: string;
  taskId?: string;
}

export type TaskCalendarType = "study" | "work" | "personal";

export interface PlannerStoredTask {
  id: string;
  title: string;
  totalDuration: number;
  deadline: string;
  anchorEventId?: string;
  calendarType: TaskCalendarType;
  priority: 1 | 2 | 3 | 4 | 5;
  parts: string[];
  notes?: string;
}

export interface PlannerTaskEvent extends TaskEvent {
  calendarType: TaskCalendarType;
  calendarId: string;
  notes?: string;
}
