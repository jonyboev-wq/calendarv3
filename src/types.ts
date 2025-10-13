export type FamilyKey = "study"|"work"|"training"|"home";

export interface EventItem {
  id: string;
  title: string;
  start: string; // ISO
  end: string;   // ISO
  type: "fixed"|"flexible";
  priority: 1|2|3|4|5;     // five-level priority only
  family: FamilyKey;
  notes?: string;
}

export interface Task {
  id: string;
  title: string;
  totalDuration: number; // minutes
  deadline: string;      // ISO
  anchorEventId?: string;
  calendarType: FamilyKey;
  priority: 1|2|3|4|5;
  parts: number[];       // chunk durations (minutes)
}

export interface TaskEvent extends EventItem {
  taskId: string;
  done: boolean;
}

export interface Interval {
  start: Date;
  end: Date;
}
