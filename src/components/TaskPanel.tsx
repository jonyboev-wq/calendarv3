import { memo, useEffect, useMemo, useState } from "react";
import type {
  CalendarInfo,
  CalendarEvent,
  TaskAssignment,
  TaskCreateInput,
  TaskCreateResult,
} from "../domain";
import { fmtDay, fmtHM, parseISOorNull, diffMinutes } from "../utils/date";
import { familyBadgeColor, familyLabel } from "../utils/family";

type EventItem = CalendarEvent;

type TaskPanelProps = {
  tasks: TaskAssignment[];
  events: EventItem[];
  calendars: CalendarInfo[];
  onClose: () => void;
  onCreateTask: (input: TaskCreateInput) => TaskCreateResult;
  onRemoveTask: (taskId: string) => void;
  message: string | null;
  setMessage: (message: string | null) => void;
  fieldClasses: string;
  actionButtonClasses: string;
  subtleButtonClasses: string;
  focusedTaskId: string | null;
  now: Date;
  taskSeed: { eventId: string; title: string } | null;
};

const hoursFromMinutes = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

export const TaskPanel = memo(function TaskPanel({
  tasks,
  events,
  calendars,
  onClose,
  onCreateTask,
  onRemoveTask,
  message,
  setMessage,
  fieldClasses,
  actionButtonClasses,
  subtleButtonClasses,
  focusedTaskId,
  now,
  taskSeed,
}: TaskPanelProps) {
  const [title, setTitle] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [durationHours, setDurationHours] = useState<number>(1);
  const [notes, setNotes] = useState("");

  const anchorEventById = useMemo(() => {
    const map = new Map<string, EventItem>();
    events.forEach((event) => map.set(event.id, event));
    return map;
  }, [events]);

  const upcomingEvents = useMemo(() => {
    return events
      .map((event) => {
        const start = parseISOorNull(event.start);
        if (!start) return null;
        return { event, start };
      })
      .filter((item): item is { event: EventItem; start: Date } => !!item)
      .filter((item) => item.start.getTime() > now.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [events, now]);

  const seedOption = useMemo(() => {
    if (!taskSeed) return null;
    const event = anchorEventById.get(taskSeed.eventId);
    if (!event) return null;
    const start = parseISOorNull(event.start);
    if (!start) return null;
    return {
      id: event.id,
      label: `${event.title || "Событие"} — ${fmtDay(start)} ${fmtHM(start)}`,
    };
  }, [taskSeed, anchorEventById]);

  const eventOptions = useMemo(() => {
    const base = upcomingEvents.map(({ event, start }) => ({
      id: event.id,
      label: `${event.title || "Событие"} — ${fmtDay(start)} ${fmtHM(start)}`,
    }));
    if (seedOption && !base.some((option) => option.id === seedOption.id)) {
      return [seedOption, ...base];
    }
    return base;
  }, [upcomingEvents, seedOption]);

  useEffect(() => {
    if (!eventOptions.length) {
      setSelectedEventId("");
      return;
    }
    if (selectedEventId && eventOptions.some((option) => option.id === selectedEventId)) {
      return;
    }
    setSelectedEventId(eventOptions[0].id);
  }, [eventOptions, selectedEventId]);

  useEffect(() => {
    if (!taskSeed) return;
    setTitle(taskSeed.title);
    setSelectedEventId(taskSeed.eventId);
    setMessage(null);
  }, [taskSeed, setMessage]);

  const handleSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!selectedEventId) {
      setMessage("Нет подходящих будущих событий для привязки задачи.");
      return;
    }
    const normalizedHours = Number.isFinite(durationHours) ? Math.max(0.5, durationHours) : 1;
    const totalDurationMin = Math.round(normalizedHours * 60);
    const trimmedTitle = title.trim();
    const trimmedNotes = notes.trim();
    const result = onCreateTask({
      title: trimmedTitle || "Подготовка",
      anchorEventId: selectedEventId,
      totalDurationMin,
      notes: trimmedNotes || undefined,
    });
    setMessage(result.message ?? null);
    if (result.ok) {
      setTitle("");
      setNotes("");
      setDurationHours(hoursFromMinutes(totalDurationMin));
    }
  };

  const calendarById = useMemo(() => {
    const map = new Map<string, CalendarInfo>();
    calendars.forEach((calendar) => map.set(calendar.id, calendar));
    return map;
  }, [calendars]);

  const renderedTasks = useMemo(() => {
    return tasks
      .map((task) => {
        const anchorEvent = anchorEventById.get(task.anchorEventId) ?? null;
        const anchorStart = anchorEvent ? parseISOorNull(anchorEvent.start) : null;
        const anchorEnd = anchorEvent ? parseISOorNull(anchorEvent.end) : null;
        const calendar = anchorEvent ? calendarById.get(anchorEvent.calendarId) ?? null : null;
        const chunkEvents = task.chunkEventIds
          .map((id) => anchorEventById.get(id))
          .filter((ev): ev is EventItem => !!ev)
          .map((event) => {
            const start = parseISOorNull(event.start);
            const end = parseISOorNull(event.end);
            return { event, start, end };
          })
          .filter((item): item is { event: EventItem; start: Date; end: Date } => !!item.start && !!item.end)
          .sort((a, b) => a.start.getTime() - b.start.getTime());
        const scheduledMinutes = chunkEvents.reduce(
          (acc, item) => acc + Math.max(0, diffMinutes(item.end, item.start)),
          0
        );
        const completedMinutes = chunkEvents.reduce((acc, item) => {
          if (item.end.getTime() <= now.getTime()) {
            return acc + Math.max(0, diffMinutes(item.end, item.start));
          }
          return acc;
        }, 0);
        const progress = Math.max(0, Math.min(1, task.totalDurationMin ? completedMinutes / task.totalDurationMin : 0));

        return {
          task,
          anchorEvent,
          anchorStart,
          anchorEnd,
          calendar,
          chunkEvents,
          scheduledMinutes,
          completedMinutes,
          progress,
        };
      })
      .sort((a, b) => {
        if (a.anchorStart && b.anchorStart) return a.anchorStart.getTime() - b.anchorStart.getTime();
        if (a.anchorStart) return -1;
        if (b.anchorStart) return 1;
        return a.task.title.localeCompare(b.task.title);
      });
  }, [anchorEventById, calendarById, now, tasks]);

  return (
    <div className="fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm">
      <div className="ml-auto flex h-full w-full max-w-3xl flex-col overflow-y-auto border-l border-white/10 bg-[#1f1f23]/95 p-6 text-gray-100 shadow-[0_0_60px_rgba(0,0,0,0.65)] md:p-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Привязанные задачи</h2>
            <p className="mt-1 text-sm text-gray-400">
              Задачи разбиваются на блоки до 1 ч 20 мин и автоматически ставятся перед выбранным событием.
            </p>
          </div>
          <button
            className={subtleButtonClasses}
            onClick={() => {
              setMessage(null);
              onClose();
            }}
          >
            Закрыть
          </button>
        </div>

        <form className="mt-6 space-y-4 rounded-2xl border border-white/10 bg-black/30 p-4" onSubmit={handleSubmit}>
          <div className="text-xs uppercase tracking-wide text-gray-400">Новая задача</div>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Название</span>
            <input
              className={fieldClasses}
              placeholder="Курсовая работа"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Событие-дедлайн</span>
            <select
              className={fieldClasses}
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
            >
              {!eventOptions.length && <option value="">Нет будущих событий</option>}
              {eventOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Длительность (часы)</span>
            <input
              type="number"
              min={0.5}
              step={0.5}
              className={fieldClasses}
              value={durationHours}
              onChange={(e) => setDurationHours(Number.parseFloat(e.target.value || "1") || 1)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Комментарий</span>
            <textarea
              className={`${fieldClasses} min-h-[80px] resize-none`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Короткое описание или чеклист"
            />
          </label>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className={subtleButtonClasses}
              onClick={() => {
                setTitle("");
                setNotes("");
                setDurationHours(1);
                setMessage(null);
              }}
            >
              Очистить
            </button>
            <button type="submit" className={actionButtonClasses} disabled={!eventOptions.length}>
              Создать задачу
            </button>
          </div>
          {message && (
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200">{message}</div>
          )}
        </form>

        <div className="mt-6 space-y-4">
          {renderedTasks.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-6 text-center text-sm text-gray-400">
              Пока нет задач с привязкой. Добавьте новую через форму выше.
            </div>
          )}
          {renderedTasks.map(
            ({
              task,
              anchorEvent,
              anchorStart,
              anchorEnd,
              calendar,
              chunkEvents,
              scheduledMinutes,
              completedMinutes,
              progress,
            }) => {
              const isFocused = focusedTaskId === task.id;
              const anchorMissing = !anchorEvent;
              const calendarColor = calendar?.color ?? "#71717a";
              return (
                <div
                  key={task.id}
                  id={`task-${task.id}`}
                  className={`rounded-2xl border px-4 py-4 transition ${
                    isFocused ? "border-emerald-400/60 bg-emerald-400/5" : "border-white/10 bg-black/30"
                  }`}
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="text-base font-semibold text-gray-100">{task.title}</div>
                      <div className="text-xs uppercase tracking-wide text-gray-400">
                        Всего: {hoursFromMinutes(task.totalDurationMin)} ч · Блоков: {chunkEvents.length}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-300">
                      <span className="h-2 w-2 rounded-full border border-white/20" style={{ backgroundColor: calendarColor }} />
                      <span>{calendar?.name ?? "Без календаря"}</span>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2 text-sm text-gray-300">
                    <div>
                      {anchorMissing ? (
                        <span className="text-amber-300">Привязанное событие удалено</span>
                      ) : (
                        <>
                          <span className="font-medium text-gray-100">Дедлайн:</span>{" "}
                          {fmtDay(anchorStart!)} {fmtHM(anchorStart!)} — {fmtHM(anchorEnd!)} ·{" "}
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${familyBadgeColor(anchorEvent?.family)}`}>
                            {familyLabel(anchorEvent?.family)}
                          </span>
                        </>
                      )}
                    </div>
                    {task.notes && <div className="text-xs text-gray-400">Комментарий: {task.notes}</div>}
                    <div>
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>Прогресс</span>
                        <span>
                          {hoursFromMinutes(completedMinutes)} ч из {hoursFromMinutes(task.totalDurationMin)} ч
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-white/10">
                        <div
                          className="h-2 rounded-full bg-emerald-400 transition-all"
                          style={{ width: `${Math.round(progress * 100)}%` }}
                        />
                      </div>
                    </div>
                    {scheduledMinutes < task.totalDurationMin && (
                      <div className="text-xs text-amber-300">
                        Запланировано всего {hoursFromMinutes(scheduledMinutes)} ч, нужно {hoursFromMinutes(task.totalDurationMin)} ч.
                      </div>
                    )}
                    <details className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-300">
                      <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-gray-400">
                        Расписание блоков ({chunkEvents.length})
                      </summary>
                      <div className="mt-2 space-y-1">
                        {chunkEvents.map((item, idx) => (
                          <div key={item.event.id} className="flex items-center justify-between gap-3">
                            <span className="text-gray-200">
                              {idx + 1}. {fmtDay(item.start)} · {fmtHM(item.start)} — {fmtHM(item.end)}
                            </span>
                            <span className="text-gray-400">
                              {hoursFromMinutes(Math.max(0, diffMinutes(item.end, item.start)))} ч
                            </span>
                          </div>
                        ))}
                        {chunkEvents.length === 0 && (
                          <div className="text-amber-300">Блоки не найдены — возможно, события были удалены.</div>
                        )}
                      </div>
                    </details>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      className={subtleButtonClasses}
                      onClick={() => {
                        if (window.confirm("Удалить задачу и связанные блоки?")) {
                          onRemoveTask(task.id);
                        }
                      }}
                    >
                      Удалить задачу
                    </button>
                  </div>
                </div>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
});
