import { clone } from "./misc";

export const fmtHM = (d: Date) =>
  d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

export const fmtDay = (d: Date) =>
  d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "2-digit" });

export const startOfDay = (d: Date) => {
  const x = clone(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

export const addMinutes = (d: Date, mins: number) => new Date(d.getTime() + mins * 60000);

export const diffMinutes = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 60000);

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const toLocalInputValue = (d: Date | null): string => {
  if (!d || !isValidDate(d)) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

export const fromLocalInput = (value: string): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return isValidDate(d) ? d : null;
};

export const parseISOorNull = (s?: string | null): Date | null => {
  if (!s) return null;
  const d = new Date(s);
  return isValidDate(d) ? d : null;
};

export const isValidDate = (d: unknown): d is Date => d instanceof Date && !isNaN(d.getTime());

export const getWeekDays = (anchor: Date) => {
  const day = anchor.getDay();
  const shift = (day + 6) % 7;
  const monday = addMinutes(startOfDay(anchor), -shift * 1440);
  return Array.from({ length: 7 }, (_, i) => addMinutes(monday, i * 1440));
};
