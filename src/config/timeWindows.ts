import type { FamilyKey } from "../types";

export const TASK_DAY_START_HOUR = 8;
export const TASK_DAY_END_HOUR = 23;
export const BREAK_GAP_MIN = 10;
export const MAX_TASK_EVENTS_PER_DAY = 5;
export const MAX_TASK_EVENTS_PER_TASK = 1;
export const WEEKEND_STUDY_LIMIT = 2;

export const FAMILY_WINDOWS: Record<FamilyKey, { start: number; end: number }> = {
  study: { start: 8, end: 23 },
  work: { start: 9, end: 20 },
  training: { start: 7, end: 23 },
  home: { start: 10, end: 22 },
};

