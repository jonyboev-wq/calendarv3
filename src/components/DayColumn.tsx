import { memo, type Dispatch, type SetStateAction } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DaySlice, EventItem, CalendarInfoMap } from "../types";
import { fmtHM, fmtDay } from "../utils/date";
import { familyBadgeColor, familyLabel } from "../utils/family";

type DragState = { id: string; dayKey: string; offsetMinutes: number; duration: number; originalMinutes: number } | null;

export type DayColumnProps = {
  daySlices: Map<string, DaySlice[]>;
  day: Date;
  todayKey: string;
  dateToMinutes: (date: Date) => number;
  dayStartHour: number;
  minutesPerDay: number;
  minuteUnit: number;
  dayColumnHeight: number;
  dragPreview: { id: string; dayKey: string; startMinutes: number } | null;
  setDragState: (state: DragState) => void;
  setDragPreview: (preview: DayColumnProps["dragPreview"]) => void;
  calendarMap: CalendarInfoMap;
  activeEventId: string | null;
  setActiveEventId: Dispatch<SetStateAction<string | null>>;
  removeEvent: (id: string) => void;
  shortenEvent: (id: string, mins: number) => void;
  openCreate: (date?: Date) => void;
  setShowForm: (value: boolean) => void;
  setDraft: (event: EventItem | null) => void;
  optimizeDay: (day: Date) => void;
  extractEventMeta: (notes?: string) => { location?: string; description?: string };
  openTaskPanel: (taskId: string) => void;
  onAddTaskForEvent: (event: EventItem) => void;
  dragPointerRef: React.MutableRefObject<HTMLElement | null>;
  dragPointerIdRef: React.MutableRefObject<number | null>;
  draggingRef: React.MutableRefObject<boolean>;
  suppressClickRef: React.MutableRefObject<boolean>;
  snapToGrid: (minutes: number, step?: number) => number;
  minutesToDate: (day: Date, minutes: number) => Date;
  diffMinutes: (a: Date, b: Date) => number;
  parseISOorNull: (value?: string | null) => Date | null;
  startOfDay: (date: Date) => Date;
  DAY_COLUMN_OFFSET: number;
  timeColumnWidth: number;
  now: Date;
  familyCardStyle: (family: EventItem["family"], fixed: boolean) => string;
};

export const DayColumn = memo(function DayColumn({
  daySlices,
  day,
  todayKey,
  dateToMinutes,
  dayStartHour,
  minutesPerDay,
  minuteUnit,
  dayColumnHeight,
  dragPreview,
  setDragState,
  setDragPreview,
  calendarMap,
  activeEventId,
  setActiveEventId,
  removeEvent,
  shortenEvent,
  openCreate,
  setShowForm,
  setDraft,
  optimizeDay,
  extractEventMeta,
  openTaskPanel,
  onAddTaskForEvent,
  dragPointerRef,
  dragPointerIdRef,
  draggingRef,
  suppressClickRef,
  snapToGrid,
  minutesToDate,
  diffMinutes,
  parseISOorNull,
  startOfDay,
  DAY_COLUMN_OFFSET,
  timeColumnWidth,
  now,
  familyCardStyle,
}: DayColumnProps) {
  const dayStart = startOfDay(day);
  const dayKey = dayStart.toISOString();
  const slices = daySlices.get(dayKey) ?? [];
  const isTodayColumn = dayKey === todayKey;
  const nowMinutesForColumn = Math.max(0, dateToMinutes(now) - dayStartHour * 60);
  const inNowRange = nowMinutesForColumn >= 0 && nowMinutesForColumn <= minutesPerDay;
  const nowTopPx = DAY_COLUMN_OFFSET + nowMinutesForColumn * minuteUnit;
  const baseNowLineThickness = 2;
  const nowLineThickness = isTodayColumn ? baseNowLineThickness / 1.5 : baseNowLineThickness / 2;
  const nowLineOpacity = isTodayColumn ? 1 : 0.45;
  const nowBadgeLeft = -timeColumnWidth + 12;

  const handleDoubleClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest("[data-event-card='true']")) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const relative = ev.clientY - rect.top;
    const relativeOffset = relative - DAY_COLUMN_OFFSET;
    const minuteOffset = Math.max(0, snapToGrid(Math.round(relativeOffset / minuteUnit)));
    openCreate(minutesToDate(dayStart, minuteOffset));
  };

  return (
    <div
      key={dayKey}
      data-day={dayKey}
      className="relative border-l border-white/5 bg-white/5 transition-colors hover:bg-white/10 overflow-visible"
      onClick={() => setActiveEventId(null)}
      onDoubleClick={handleDoubleClick}
      style={{ height: dayColumnHeight, paddingTop: DAY_COLUMN_OFFSET }}
    >
      {Array.from({ length: minutesPerDay }, (_, i) => i)
        .filter((m) => m % 60 === 0)
        .map((m) => (
          <div key={m} className="absolute left-0 right-0 border-t border-dashed border-white/10" style={{ top: m * minuteUnit, transform: "translateY(-6px)" }} />
        ))}
      {inNowRange && (
        <div aria-hidden className="absolute inset-x-0 pointer-events-none" style={{ top: nowTopPx, zIndex: 45 }}>
          <div
            className="w-full bg-red-500"
            style={{
              height: `${nowLineThickness}px`,
              opacity: nowLineOpacity,
            }}
          />
          {isTodayColumn && (
            <>
              <div className="absolute -left-2 h-2 w-2 rounded-full bg-red-500" style={{ top: 0, transform: "translateY(-50%)" }} />
              <div
                className="absolute rounded-md border border-red-500/20 bg-red-500 px-2 py-0.5 text-[10px] leading-none text-white shadow-[0_8px_20px_rgba(255,59,48,0.35)]"
                style={{ top: 0, left: `${nowBadgeLeft}px`, transform: "translateY(-50%)" }}
              >
                {fmtHM(now)}
              </div>
            </>
          )}
        </div>
      )}
      {slices.map((slice) => (
        <EventSliceCard
          key={`${slice.event.id}-${slice.sliceStart.toISOString()}`}
          slice={slice}
          dayStart={dayStart}
          minuteUnit={minuteUnit}
          DAY_COLUMN_OFFSET={DAY_COLUMN_OFFSET}
          dragPreview={dragPreview}
          setDragState={setDragState}
          setDragPreview={setDragPreview}
          draggingRef={draggingRef}
          suppressClickRef={suppressClickRef}
          dragPointerRef={dragPointerRef}
          dragPointerIdRef={dragPointerIdRef}
          diffMinutes={diffMinutes}
          parseISOorNull={parseISOorNull}
          extractEventMeta={extractEventMeta}
          openTaskPanel={openTaskPanel}
          onAddTaskForEvent={onAddTaskForEvent}
          startOfDay={startOfDay}
          calendarMap={calendarMap}
          familyCardStyle={familyCardStyle}
          activeEventId={activeEventId}
          setActiveEventId={setActiveEventId}
          removeEvent={removeEvent}
          shortenEvent={shortenEvent}
          setShowForm={setShowForm}
          setDraft={setDraft}
          optimizeDay={optimizeDay}
          now={now}
        />
      ))}
    </div>
  );
});

type EventSliceCardProps = {
  slice: DaySlice;
  dayStart: Date;
  minuteUnit: number;
  DAY_COLUMN_OFFSET: number;
  dragPreview: DayColumnProps["dragPreview"];
  setDragState: DayColumnProps["setDragState"];
  setDragPreview: DayColumnProps["setDragPreview"];
  draggingRef: DayColumnProps["draggingRef"];
  suppressClickRef: DayColumnProps["suppressClickRef"];
  dragPointerRef: DayColumnProps["dragPointerRef"];
  dragPointerIdRef: DayColumnProps["dragPointerIdRef"];
  diffMinutes: DayColumnProps["diffMinutes"];
  parseISOorNull: DayColumnProps["parseISOorNull"];
  extractEventMeta: DayColumnProps["extractEventMeta"];
  openTaskPanel: DayColumnProps["openTaskPanel"];
  onAddTaskForEvent: DayColumnProps["onAddTaskForEvent"];
  startOfDay: DayColumnProps["startOfDay"];
  calendarMap: CalendarInfoMap;
  familyCardStyle: DayColumnProps["familyCardStyle"];
  activeEventId: string | null;
  setActiveEventId: DayColumnProps["setActiveEventId"];
  removeEvent: DayColumnProps["removeEvent"];
  shortenEvent: DayColumnProps["shortenEvent"];
  setShowForm: DayColumnProps["setShowForm"];
  setDraft: DayColumnProps["setDraft"];
  optimizeDay: DayColumnProps["optimizeDay"];
  now: Date;
};

const EventSliceCard = memo(function EventSliceCard({
  slice,
  dayStart,
  minuteUnit,
  DAY_COLUMN_OFFSET,
  dragPreview,
  setDragState,
  setDragPreview,
  draggingRef,
  suppressClickRef,
  dragPointerRef,
  dragPointerIdRef,
  diffMinutes,
  parseISOorNull,
  extractEventMeta,
  openTaskPanel,
  onAddTaskForEvent,
  startOfDay,
  calendarMap,
  familyCardStyle,
  activeEventId,
  setActiveEventId,
  removeEvent,
  shortenEvent,
  setShowForm,
  setDraft,
  optimizeDay,
  now,
}: EventSliceCardProps) {
  const e = slice.event;
  const eventStart = parseISOorNull(e.start) ?? slice.sliceStart;
  const eventEnd = parseISOorNull(e.end) ?? slice.sliceEnd;
  const fullDurationMinutes = Math.max(1, diffMinutes(eventEnd, eventStart));
  const nowTime = now.getTime();
  const canAddTask = eventStart.getTime() > nowTime;
  const sliceStartMinutes = Math.max(0, diffMinutes(slice.sliceStart, dayStart));
  const effectivePreview =
    dragPreview && dragPreview.id === e.id && dragPreview.dayKey === dayStart.toISOString() ? dragPreview.startMinutes : null;
  const eventStartMinutes = Math.max(0, diffMinutes(eventStart, dayStart));
  const startBase = effectivePreview ?? (slice.continuesFromPrev ? sliceStartMinutes : eventStartMinutes);
  const startMinutes = Math.max(0, startBase);
  const visibleDurationMinutes = Math.max(1, diffMinutes(slice.sliceEnd, slice.sliceStart));
  const top = Math.max(0, DAY_COLUMN_OFFSET + startMinutes * minuteUnit);
  const height = Math.max(24, visibleDurationMinutes * minuteUnit);
  const isFixed = e.type === "fixed";
  const meta = extractEventMeta(e.notes);
  const isActive = activeEventId === e.id;
  const canDrag = !isFixed && !slice.continuesFromPrev;
  const isPreviewed = dragPreview && dragPreview.id === e.id && dragPreview.dayKey === dayStart.toISOString();
  const baseZIndex = isFixed ? 20 : 15;
  const zIndex = isActive ? 60 : isPreviewed ? 50 : baseZIndex;
  const calendarInfo = calendarMap.get(e.calendarId);
  const calendarColor = calendarInfo?.color ?? "#6b7280";
  const calendarName = calendarInfo?.name ?? "Календарь";
  const interactiveClasses = canDrag
    ? "cursor-pointer transition-transform duration-200 ease-out hover:-translate-y-0.5 group"
    : isFixed
    ? "cursor-default"
    : "cursor-not-allowed opacity-90";
  const focusClasses = isFixed ? "" : "focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-200/40";
  const groupClass = isFixed ? "" : "group";
  const activeRing = isActive ? "ring-2 ring-gray-100/40" : "";

  const startDisplay = slice.sliceStart;
  const endDisplay = slice.sliceEnd;

  const handlePointerDown = (ev: ReactPointerEvent<HTMLDivElement>) => {
    if (!canDrag) return;
    ev.stopPropagation();
    ev.preventDefault();
    draggingRef.current = false;
    suppressClickRef.current = false;
    const rect = ev.currentTarget.getBoundingClientRect();
    const offsetMinutes = Math.round((ev.clientY - rect.top) / minuteUnit);
    setDragState({
      id: e.id,
      dayKey: dayStart.toISOString(),
      offsetMinutes,
      duration: fullDurationMinutes,
      originalMinutes: eventStartMinutes,
    });
    setDragPreview({ id: e.id, dayKey: dayStart.toISOString(), startMinutes: eventStartMinutes });
    if (ev.currentTarget.setPointerCapture) {
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
        dragPointerRef.current = ev.currentTarget;
        dragPointerIdRef.current = ev.pointerId;
      } catch {}
    }
  };

  const handleClick = (ev: React.MouseEvent<HTMLDivElement>) => {
    ev.stopPropagation();
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setActiveEventId((prev) => (prev === e.id ? null : e.id));
  };

  const handleKeyDown = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      setActiveEventId((prev) => (prev === e.id ? null : e.id));
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-event-card="true"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`absolute left-1 right-1 rounded-2xl backdrop-blur-sm ${familyCardStyle(e.family, isFixed)} ${interactiveClasses} ${focusClasses} ${activeRing} ${groupClass}`}
      style={{ top, height, zIndex, borderColor: calendarColor }}
      onPointerDown={handlePointerDown}
    >
      <div className="relative h-full overflow-visible">
        <div className={`flex h-full flex-col justify-between p-3 transition duration-200 ease-out ${isActive ? "opacity-20" : ""}`}>
          <div className="space-y-1 overflow-hidden">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-semibold text-gray-100 line-clamp-2">{e.title}</div>
                <div className="text-xs text-gray-300 whitespace-nowrap">
                  {fmtHM(startDisplay)}–{fmtHM(endDisplay)}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-gray-400">
                  <span className="h-2 w-2 rounded-full border border-white/30" style={{ backgroundColor: calendarColor }} />
                  <span className="truncate">{calendarName}</span>
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${familyBadgeColor(e.family)}`}>
                {familyLabel(e.family)}
              </span>
            </div>
            {e.linkedTaskId && (
              <a
                href={`#task-${e.linkedTaskId}`}
                className="text-[11px] text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
                onClick={(event) => {
                  event.preventDefault();
                  openTaskPanel(e.linkedTaskId!);
                }}
              >
                Открыть связанную задачу
              </a>
            )}
            {meta.location && (
              <div className="text-xs text-gray-300 flex items-center gap-1 overflow-hidden">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
                <span className="truncate">{meta.location}</span>
              </div>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-[0.08em] text-gray-500">
            приор {e.priority} · {isFixed ? "Жёсткое" : "Гибкое"}
            {slice.continuesFromPrev ? " · ←" : ""}
            {slice.continuesToNext ? " · →" : ""}
          </div>
        </div>
        {slice.continuesFromPrev && (
          <div className="pointer-events-none absolute inset-x-1 top-0 h-3 rounded-t-2xl bg-gradient-to-b from-black/60 to-transparent" />
        )}
        {slice.continuesToNext && (
          <div className="pointer-events-none absolute inset-x-1 bottom-0 h-3 rounded-b-2xl bg-gradient-to-t from-black/60 to-transparent" />
        )}
        {!isFixed && (
          <button
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-black/40 text-xs text-gray-100 opacity-0 transition hover:bg-black/70 focus:opacity-100 focus:pointer-events-auto focus:outline-none group-hover:opacity-100 group-hover:pointer-events-auto pointer-events-none"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
            }}
            onClick={(event) => {
              event.stopPropagation();
              removeEvent(e.id);
              setActiveEventId((prev) => (prev === e.id ? null : prev));
            }}
            aria-label="Удалить событие"
          >
            ×
          </button>
        )}
        {isActive && (
          <div
            className="detail-pop absolute z-50 flex w-64 max-w-xs flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#111114]/95 p-3 text-xs text-gray-200 shadow-[0_16px_40px_rgba(0,0,0,0.7)]"
            style={{ top: 0, left: "calc(100% + 12px)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 text-gray-100">
              <div className="text-sm font-semibold leading-snug">{e.title}</div>
              <button
                className="pressable rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-200"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveEventId(null);
                }}
              >
                Закрыть
              </button>
            </div>
            <div className="mt-2 text-[11px] text-gray-300 whitespace-nowrap">
              {fmtDay(eventStart)} · {fmtHM(eventStart)} — {fmtHM(eventEnd)}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-300">
              <span className="h-2 w-2 rounded-full border border-white/20" style={{ backgroundColor: calendarColor }} />
              <span>{calendarName}</span>
            </div>
            {meta.location && (
              <div className="mt-2 text-[11px] text-gray-200">
                <span className="font-medium text-gray-100">Локация: </span>
                {meta.location}
              </div>
            )}
            <div className="mt-2 flex-1 overflow-y-auto rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-300 whitespace-pre-wrap">
              {meta.description || "Нет заметок"}
            </div>
        {e.linkedTaskId && (
          <a
            href={`#task-${e.linkedTaskId}`}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
            onClick={(event) => {
              event.preventDefault();
              openTaskPanel(e.linkedTaskId!);
            }}
          >
            Перейти к задаче
          </a>
        )}
        {canAddTask && (
          <button
            className="mt-3 w-full rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 transition hover:bg-emerald-500/20"
            onClick={(event) => {
              event.stopPropagation();
              onAddTaskForEvent(e);
              setActiveEventId(null);
            }}
          >
            Добавить задачу
          </button>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-gray-300">
          <span className="rounded-lg border border-white/15 px-2 py-1">Приоритет: {e.priority}</span>
          <span className="rounded-lg border border-white/15 px-2 py-1">Тип: {isFixed ? "Жёсткое" : "Гибкое"}</span>
        </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                className="pressable rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-gray-100"
                onClick={(event) => {
                  event.stopPropagation();
                  const parsedStart = parseISOorNull(e.start);
                  if (parsedStart) {
                    shortenEvent(e.id, 15);
                    const parsedStart = parseISOorNull(e.start);
                    if (parsedStart) {
                      optimizeDay(startOfDay(parsedStart));
                    }
                    setActiveEventId(null);
                  }
                }}
              >
                −15 мин
              </button>
              <button
                className="pressable rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-gray-100"
                onClick={(event) => {
                  event.stopPropagation();
                  setDraft(e);
                  setShowForm(true);
                }}
              >
                Редактировать
              </button>
              <button
                className="pressable rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-gray-100"
                onClick={(event) => {
                  event.stopPropagation();
                  removeEvent(e.id);
                  setActiveEventId(null);
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
