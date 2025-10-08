import React, { useEffect, useMemo, useState } from "react";

// =====================================
// Calendar (React) — safer date handling, bugfix for RangeError: Invalid Date
// - Fixes crashes when editing date/time fields (datetime-local) by validating
//   and formatting dates without calling toISOString() on invalid Date objects.
// - Adds sanitization for persisted events and guards in all date operations.
// - Adds lightweight runtime tests (console.assert) to catch regressions.
// =====================================

// ===== Types =====

type FamilyKey = "study" | "work" | "health" | "life" | "other";

type EventItem = {
  id: string;
  title: string;
  start: string; // ISO (UTC)
  end: string;   // ISO (UTC)
  type: "fixed" | "flexible";
  priority: number; // 1..10
  family?: FamilyKey;
  notes?: string;
};

// ===== Utilities (dates) =====

function uid() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

const isValidDate = (d: unknown): d is Date => d instanceof Date && !isNaN(d.getTime());

function clone(d: Date) {
  return new Date(d.getTime());
}

function startOfDay(d: Date) {
  const x = clone(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60_000);
}

function diffMinutes(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 60_000);
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtHM(d: Date) {
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtDay(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

// Parse ISO string safely; return null if invalid
function parseISOorNull(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isValidDate(d) ? d : null;
}

// Convert Date -> ISO string (UTC) safely; return null if invalid
function toISOorNull(d: Date | null): string | null {
  if (!d || !isValidDate(d)) return null;
  return d.toISOString();
}

// For <input type="datetime-local"> we must use local time string "YYYY-MM-DDTHH:MM"
function toLocalInputValue(d: Date | null): string {
  if (!d || !isValidDate(d)) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

// Parse from local input value; return Date|null (local timezone)
function fromLocalInput(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isValidDate(d) ? d : null;
}

function getWeekDays(anchor: Date) {
  const day = anchor.getDay(); // 0 Sun .. 6 Sat
  const shift = (day + 6) % 7; // make Monday=0
  const monday = addMinutes(startOfDay(anchor), -shift * 1440);
  return Array.from({ length: 7 }, (_, i) => addMinutes(monday, i * 1440));
}

// ===== Data sanitization =====

function sanitizeEvents(raw: unknown): EventItem[] {
  const arr = Array.isArray(raw) ? (raw as any[]) : [];
  const out: EventItem[] = [];
  for (const e of arr) {
    if (!e || typeof e !== "object") continue;
    const s = parseISOorNull((e as any).start);
    const en = parseISOorNull((e as any).end);
    if (!s || !en) continue; // drop invalid
    if (en <= s) continue; // drop zero/negative duration
    out.push({
      id: String((e as any).id ?? uid()),
      title: String((e as any).title ?? ""),
      start: s.toISOString(),
      end: en.toISOString(),
      type: ((e as any).type === "fixed" ? "fixed" : "flexible") as "fixed" | "flexible",
      priority: Math.max(1, Math.min(10, Number((e as any).priority ?? 5))) || 5,
      family: ((): FamilyKey | undefined => {
        const f = (e as any).family;
        return ["study", "work", "health", "life", "other"].includes(f) ? f : "other";
      })(),
      notes: typeof (e as any).notes === "string" ? (e as any).notes : "",
    });
  }
  return out;
}

// ===== Planning helpers =====

// Find first free slot in [winStartHour, winEndHour) stepping over existing intervals
function findFirstFreeSlot(
  events: EventItem[],
  day: Date,
  durationMin: number,
  winStartHour = 8,
  winEndHour = 21
): Date | null {
  const dayStart = clone(day);
  dayStart.setHours(winStartHour, 0, 0, 0);
  const dayEnd = clone(day);
  dayEnd.setHours(winEndHour, 0, 0, 0);

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

// Pull flexible events earlier within the same day if gaps appear
function pullForwardSameDay(events: EventItem[], day: Date): EventItem[] {
  const dayEvents = events
    .filter((e) => {
      const s = parseISOorNull(e.start);
      return !!s && sameDay(s, day);
    })
    .sort((a, b) => {
      const sa = parseISOorNull(a.start)!;
      const sb = parseISOorNull(b.start)!;
      return sa.getTime() - sb.getTime();
    });

  const fixed: { s: Date; e: Date }[] = [];
  dayEvents
    .filter((e) => e.type === "fixed")
    .forEach((e) => {
      const s = parseISOorNull(e.start);
      const en = parseISOorNull(e.end);
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
            return x.type === "fixed" || sx < s0;
          })
          .map((x) => ({ s: parseISOorNull(x.start)!, e: parseISOorNull(x.end)! }))
          .filter((iv) => isValidDate(iv.s) && isValidDate(iv.e))
      )
      .sort((a, b) => a.s.getTime() - b.s.getTime());

    const winStart = clone(day);
    winStart.setHours(6, 0, 0, 0);
    const winEnd = clone(day);
    winEnd.setHours(23, 0, 0, 0);

    let cursor = winStart;
    let moved = false;
    for (const b of blocks) {
      if (b.s > cursor) {
        const gap = diffMinutes(b.s, cursor);
        if (gap >= duration) {
          const s = cursor;
          const en = addMinutes(s, duration);
          const idx = result.findIndex((x) => x.id === ev.id);
          if (idx >= 0) {
            result[idx] = { ...ev, start: s.toISOString(), end: en.toISOString() };
          }
          blocks.push({ s, e: en });
          blocks.sort((a, b) => a.s.getTime() - b.s.getTime());
          moved = true;
          break;
        }
      }
      if (b.e > cursor) cursor = b.e;
      if (cursor >= winEnd) break;
    }
    if (!moved && diffMinutes(winEnd, cursor) >= duration) {
      const s = cursor;
      const en = addMinutes(s, duration);
      const idx = result.findIndex((x) => x.id === ev.id);
      if (idx >= 0) result[idx] = { ...ev, start: s.toISOString(), end: en.toISOString() };
    }
  }

  return result;
}

function familyBadgeColor(f: FamilyKey | undefined) {
  switch (f) {
    case "study":
      return "bg-blue-100 text-blue-800";
    case "work":
      return "bg-amber-100 text-amber-800";
    case "health":
      return "bg-emerald-100 text-emerald-800";
    case "life":
      return "bg-pink-100 text-pink-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

// ===== Main Component =====

export default function CalendarApp() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<EventItem[]>(() => {
    try {
      const raw = localStorage.getItem("mycalendar.events");
      const parsed = raw ? JSON.parse(raw) : [];
      return sanitizeEvents(parsed);
    } catch {
      return [];
    }
  });
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Partial<EventItem> | null>(null);
  const [suggestDuration, setSuggestDuration] = useState(60);

  const weekDays = useMemo(() => getWeekDays(anchor), [anchor]);

  useEffect(() => {
    localStorage.setItem("mycalendar.events", JSON.stringify(events));
  }, [events]);

  // ------ Actions ------
  function openCreate(day?: Date, startHour?: number, startMinute = 0) {
    const d = day ?? new Date();
    const s = clone(d);
    s.setHours(startHour ?? 9, startMinute, 0, 0);
    const e = addMinutes(s, 60);
    setDraft({
      id: uid(),
      title: "",
      start: s.toISOString(),
      end: e.toISOString(),
      type: "flexible",
      priority: 5,
      family: "other",
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
    const isoStart = toISOorNull(s);
    const isoEnd = toISOorNull(e);
    if (!isoStart || !isoEnd) {
      alert("Не удалось сохранить: дата записана некорректно.");
      return;
    }
    const exists = events.some((ev) => ev.id === draft.id);
    const item: EventItem = {
      id: draft.id!,
      title: draft.title,
      start: isoStart,
      end: isoEnd,
      type,
      priority: Math.max(1, Math.min(10, draft.priority ?? 5)),
      family: (draft.family as FamilyKey) ?? "other",
      notes: draft.notes ?? "",
    };
    setEvents((prev) => (exists ? prev.map((ev) => (ev.id === item.id ? item : ev)) : [...prev, item]));
    setShowForm(false);
  }

  function removeEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  function shortenEvent(id: string, mins: number) {
    setEvents((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        const end = parseISOorNull(e.end);
        const start = parseISOorNull(e.start);
        if (!end || !start) return e; // guard invalid
        const newEnd = addMinutes(end, -mins);
        if (newEnd <= start) return e; // don't invert
        return { ...e, end: newEnd.toISOString() };
      })
    );
  }

  function optimizeDay(day: Date) {
    setEvents((prev) => pullForwardSameDay(prev, day));
  }

  function suggestLunchToday() {
    const today = startOfDay(new Date());
    const slot = findFirstFreeSlot(events, today, suggestDuration, 12, 15);
    if (!slot) {
      alert("Нет подходящего окна для обеда в 12:00–15:00. Попробуй изменить длительность или день.");
      return;
    }
    const end = addMinutes(slot, suggestDuration);
    setDraft({
      id: uid(),
      title: "Обед",
      start: slot.toISOString(),
      end: end.toISOString(),
      type: "flexible",
      priority: 7,
      family: "life",
    });
    setShowForm(true);
  }

  function moveWeek(delta: number) {
    setAnchor((a) => addMinutes(a, delta * 7 * 1440));
  }

  const byDay = useMemo(() => {
    const m = new Map<number, EventItem[]>();
    for (const d of weekDays) m.set(d.getDate(), []);
    for (const e of events) {
      const s = parseISOorNull(e.start);
      if (!s) continue;
      for (const d of weekDays) {
        if (sameDay(s, d)) {
          const arr = m.get(d.getDate());
          arr?.push(e);
          break;
        }
      }
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => {
        const sa = parseISOorNull(a.start);
        const sb = parseISOorNull(b.start);
        return (sa?.getTime() ?? 0) - (sb?.getTime() ?? 0);
      });
      m.set(k, arr);
    }
    return m;
  }, [events, weekDays]);

  // grid metrics
  const minuteHeight = 1; // 1px per minute
  const dayStartHour = 7;
  const dayEndHour = 22;

  // ===== Runtime unit tests (dev-only, harmless in prod) =====
  useEffect(() => {
    try {
      // Roundtrip local <-> ISO
      const now = new Date();
      const local = toLocalInputValue(now);
      const back = fromLocalInput(local);
      console.assert(isValidDate(back), "fromLocalInput should produce a valid Date");
      if (back) console.assert(Math.abs(back.getTime() - now.getTime()) < 60_000, "Roundtrip within 1 minute");

      // Invalid input safety
      console.assert(fromLocalInput("") === null, "Empty local input returns null");
      console.assert(toLocalInputValue(null as any) === "", "Invalid date to local input -> empty string");

      // Sanitize rejects invalid
      const sanitized = sanitizeEvents([
        { id: "x1", title: "bad", start: "", end: "" },
        { id: "x2", title: "ok", start: now.toISOString(), end: addMinutes(now, 30).toISOString(), type: "flexible", priority: 5 },
      ]);
      console.assert(sanitized.length === 1 && sanitized[0].id === "x2", "Sanitizer keeps only valid events");
    } catch (e) {
      // do nothing; tests are best-effort
    }
  }, []);

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-30 backdrop-blur bg-white/70 border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className="px-3 py-1.5 rounded-xl border hover:bg-gray-100" onClick={() => moveWeek(-1)}>← Неделя</button>
            <button className="px-3 py-1.5 rounded-xl border hover:bg-gray-100" onClick={() => setAnchor(new Date())}>Сегодня</button>
            <button className="px-3 py-1.5 rounded-xl border hover:bg-gray-100" onClick={() => moveWeek(1)}>Неделя →</button>
            <div className="ml-3 text-sm text-gray-600">Неделя {fmtDay(weekDays[0])} — {fmtDay(weekDays[6])}</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={15}
              step={5}
              value={suggestDuration}
              onChange={(e) => setSuggestDuration(parseInt(e.target.value || "60", 10))}
              className="w-24 px-3 py-1.5 rounded-xl border"
            />
            <button className="px-3 py-1.5 rounded-xl border bg-emerald-50 hover:bg-emerald-100" onClick={suggestLunchToday}>
              Предложить обед сегодня
            </button>
            <button className="px-3 py-1.5 rounded-xl border bg-blue-50 hover:bg-blue-100" onClick={() => openCreate()}>
              + Событие
            </button>
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="max-w-6xl mx-auto px-2 md:px-4 py-4">
        <div className="grid" style={{ gridTemplateColumns: "80px repeat(7, 1fr)" }}>
          {/* Hour column header spacer */}
          <div></div>
          {weekDays.map((d) => (
            <div key={d.toDateString()} className="px-2 pb-2 text-center text-sm font-medium">
              {fmtDay(d)}
            </div>
          ))}

          {/* Hours + day columns */}
          {/* Hours column */}
          <div className="relative">
            {Array.from({ length: (dayEndHour - dayStartHour) * 60 }, (_, i) => i)
              .filter((m) => m % 60 === 0)
              .map((m) => (
                <div
                  key={m}
                  className="absolute left-0 w-full text-xs text-gray-500 pr-2"
                  style={{ top: m * minuteHeight }}
                >
                  {String(dayStartHour + m / 60).padStart(2, "0")}:00
                </div>
              ))}
            <div style={{ height: (dayEndHour - dayStartHour) * 60 * minuteHeight }}></div>
          </div>

          {/* Day columns */}
          {weekDays.map((d) => (
            <div key={d.toISOString()} className="relative border-l">
              {/* hour lines */}
              {Array.from({ length: (dayEndHour - dayStartHour) * 60 }, (_, i) => i)
                .filter((m) => m % 60 === 0)
                .map((m) => (
                  <div
                    key={m}
                    className="absolute left-0 right-0 border-t border-dashed border-gray-200"
                    style={{ top: m * minuteHeight }}
                  />
                ))}

              {/* events */}
              {(byDay.get(d.getDate()) || []).map((e) => {
                const s = parseISOorNull(e.start) || new Date(d.getFullYear(), d.getMonth(), d.getDate(), dayStartHour, 0, 0);
                const eEnd = parseISOorNull(e.end) || addMinutes(s, 30);
                const top = (s.getHours() - dayStartHour) * 60 * minuteHeight + s.getMinutes() * minuteHeight;
                const height = Math.max(24, diffMinutes(eEnd, s) * minuteHeight);
                const isFixed = e.type === "fixed";
                return (
                  <div
                    key={e.id}
                    className={`absolute left-1 right-1 rounded-xl shadow-sm ${
                      isFixed ? "bg-gray-200" : "bg-white"
                    } border ${isFixed ? "border-gray-300" : "border-blue-300"}`}
                    style={{ top, height }}
                  >
                    <div className="p-2 h-full flex flex-col justify-between">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold line-clamp-2">{e.title}</div>
                          <div className="text-xs text-gray-500">{fmtHM(s)}–{fmtHM(eEnd)}</div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${familyBadgeColor(e.family)}`}>
                          {e.family || "other"}
                        </span>
                      </div>
                      <div className="flex items-center justify-end gap-2 text-xs">
                        <span className="text-gray-500">prio {e.priority}</span>
                        <button
                          className="px-2 py-1 rounded-lg border hover:bg-gray-100"
                          onClick={() => {
                            const mins = 15;
                            shortenEvent(e.id, mins);
                            optimizeDay(s);
                          }}
                          title="Отметить как завершённое раньше на 15 мин и подтянуть гибкие задачи"
                        >
                          −15 мин
                        </button>
                        <button
                          className="px-2 py-1 rounded-lg border hover:bg-gray-100"
                          onClick={() => {
                            setDraft(e);
                            setShowForm(true);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          className="px-2 py-1 rounded-lg border hover:bg-rose-50"
                          onClick={() => removeEvent(e.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div
                className="absolute inset-0"
                onDoubleClick={(ev) => {
                  const y = (ev.nativeEvent as any).offsetY as number;
                  const minute = Math.max(0, Math.round(y / minuteHeight));
                  const h = Math.floor(minute / 60) + dayStartHour;
                  const m = minute % 60;
                  openCreate(d, h, m);
                }}
                title="Двойной клик, чтобы создать событие"
                style={{ height: (dayEndHour - dayStartHour) * 60 * minuteHeight }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Drawer Form */}
      {showForm && draft && (
        <div className="fixed inset-0 z-40 bg-black/30 flex">
          <div className="ml-auto w-full max-w-md bg-white h-full p-4 md:p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{draft.id && events.some((e) => e.id === draft.id) ? "Редактировать" : "Новое событие"}</h2>
              <button className="text-gray-500 hover:text-gray-800" onClick={() => setShowForm(false)}>Закрыть</button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-sm">Название</span>
                <input
                  className="mt-1 w-full px-3 py-2 rounded-xl border"
                  value={draft.title || ""}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm">Начало</span>
                  <input
                    type="datetime-local"
                    className="mt-1 w-full px-3 py-2 rounded-xl border"
                    value={toLocalInputValue(parseISOorNull(draft.start || null))}
                    onChange={(e) => {
                      const dt = fromLocalInput(e.target.value);
                      if (!dt) {
                        setDraft({ ...draft, start: undefined });
                        return;
                      }
                      // Auto-fix end if now invalid or before start
                      const endDt = parseISOorNull(draft.end || null);
                      let newEnd = endDt && endDt > dt ? endDt : addMinutes(dt, 60);
                      setDraft({ ...draft, start: dt.toISOString(), end: newEnd.toISOString() });
                    }}
                  />
                </label>
                <label className="block">
                  <span className="text-sm">Окончание</span>
                  <input
                    type="datetime-local"
                    className="mt-1 w-full px-3 py-2 rounded-xl border"
                    value={toLocalInputValue(parseISOorNull(draft.end || null))}
                    onChange={(e) => {
                      const dt = fromLocalInput(e.target.value);
                      if (!dt) {
                        setDraft({ ...draft, end: undefined });
                        return;
                      }
                      const startDt = parseISOorNull(draft.start || null);
                      if (startDt && dt <= startDt) {
                        // keep at least 15 minutes duration
                        const fixed = addMinutes(startDt, 15);
                        setDraft({ ...draft, end: fixed.toISOString() });
                      } else {
                        setDraft({ ...draft, end: dt.toISOString() });
                      }
                    }}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-sm">Тип</span>
                  <select
                    className="mt-1 w-full px-3 py-2 rounded-xl border"
                    value={draft.type || "flexible"}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value as any })}
                  >
                    <option value="flexible">Гибкое</option>
                    <option value="fixed">Жёсткое</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-sm">Приоритет (1–10)</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="mt-1 w-full px-3 py-2 rounded-xl border"
                    value={draft.priority ?? 5}
                    onChange={(e) => setDraft({ ...draft, priority: parseInt(e.target.value || "5", 10) })}
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-sm">Семейство</span>
                <select
                  className="mt-1 w-full px-3 py-2 rounded-xl border"
                  value={(draft.family as FamilyKey) || "other"}
                  onChange={(e) => setDraft({ ...draft, family: e.target.value as FamilyKey })}
                >
                  <option value="study">Учёба</option>
                  <option value="work">Работа</option>
                  <option value="health">Здоровье</option>
                  <option value="life">Быт/Личное</option>
                  <option value="other">Другое</option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm">Заметки</span>
                <textarea
                  className="mt-1 w-full px-3 py-2 rounded-xl border"
                  rows={3}
                  value={draft.notes || ""}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </label>

              <div className="pt-2 flex items-center justify-between gap-3">
                <button
                  className="px-4 py-2 rounded-xl border bg-blue-600 text-white hover:bg-blue-700"
                  onClick={saveDraft}
                >
                  Сохранить
                </button>
                {draft?.id && events.some((e) => e.id === draft.id) && (
                  <button
                    className="px-4 py-2 rounded-xl border bg-rose-50 hover:bg-rose-100 text-rose-700"
                    onClick={() => {
                      removeEvent(draft.id!);
                      setShowForm(false);
                    }}
                  >
                    Удалить
                  </button>
                )}
              </div>

              <div className="pt-4 border-t mt-4">
                <div className="text-sm font-medium mb-2">Быстрые действия</div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-1.5 rounded-xl border hover:bg-gray-100"
                    onClick={() => {
                      const s = parseISOorNull(draft?.start || null);
                      if (!s) return;
                      optimizeDay(startOfDay(s));
                    }}
                  >
                    Оптимизировать этот день
                  </button>
                  <button
                    className="px-3 py-1.5 rounded-xl border hover:bg-gray-100"
                    onClick={() => {
                      const s = parseISOorNull(draft?.start || null);
                      if (!s) return;
                      const duration = 60;
                      const slot = findFirstFreeSlot(events, startOfDay(s), duration, 18, 21);
                      if (slot) {
                        setDraft({ ...draft!, start: slot.toISOString(), end: addMinutes(slot, duration).toISOString() });
                      } else {
                        alert("Нет свободного слота вечером 18:00–21:00");
                      }
                    }}
                  >
                    Предложить вечерний слот (60м)
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="py-8 text-center text-xs text-gray-400">Локальное хранение (localStorage). Двойной клик по дню — создать событие. Кнопка −15 мин сдвигает и подтягивает гибкие задачи. Исправлено падение при пустых/некорректных датах.</div>
    </div>
  );
}
