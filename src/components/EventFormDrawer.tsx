import { memo, type Dispatch, type SetStateAction } from "react";
import type { CalendarInfo, CalendarEvent } from "../domain";
import type { FamilyKey } from "../types";
import { parseISOorNull, fromLocalInput, toLocalInputValue, addMinutes, startOfDay } from "../utils/date";

type EventItem = CalendarEvent;

type EventFormDrawerProps = {
  draft: Partial<EventItem>;
  calendars: CalendarInfo[];
  activeCalendarId: string;
  events: EventItem[];
  setDraft: Dispatch<SetStateAction<Partial<EventItem> | null>>;
  onClose: () => void;
  saveDraft: () => void;
  removeEvent: (id: string) => void;
  optimizeDay: (day: Date) => void;
  findFirstFreeSlot: (events: EventItem[], day: Date, durationMin: number, winStartHour?: number, winEndHour?: number) => Date | null;
  fieldClasses: string;
  subtleButtonClasses: string;
  actionButtonClasses: string;
};

export const EventFormDrawer = memo(function EventFormDrawer({
  draft,
  calendars,
  activeCalendarId,
  events,
  setDraft,
  onClose,
  saveDraft,
  removeEvent,
  optimizeDay,
  findFirstFreeSlot,
  fieldClasses,
  subtleButtonClasses,
  actionButtonClasses,
}: EventFormDrawerProps) {
  if (!draft) return null;
  const existing = draft.id ? events.some((e) => e.id === draft.id) : false;

  return (
    <div className="fixed inset-0 z-40 flex bg-black/60 backdrop-blur-sm">
      <div className="ml-auto flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-white/10 bg-[#1f1f23]/95 p-5 text-gray-100 shadow-[0_0_60px_rgba(0,0,0,0.65)] md:p-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{existing ? "Редактировать" : "Новое событие"}</h2>
          <button className={subtleButtonClasses} onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Priority (1-5)</span>
            <input
              className={fieldClasses}
              value={draft.title || ""}
              onChange={(e) => setDraft((prev) => ({ ...prev!, title: e.target.value }))}
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Priority (1-5)</span>
            <div className="flex items-center gap-3">
              <span
                className="h-3 w-3 rounded-full border border-white/20"
                style={{
                  backgroundColor:
                    calendars.find((cal) => cal.id === (draft.calendarId || activeCalendarId))?.color ??
                    calendars[0]?.color ??
                    "#888888",
                }}
              />
              <select
                className={`${fieldClasses} flex-1`}
                value={draft.calendarId || activeCalendarId}
                onChange={(e) => setDraft((prev) => ({ ...prev!, calendarId: e.target.value }))}
              >
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.name}
                  </option>
                ))}
              </select>
            </div>
          </label>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">Priority (1-5)</span>
              <input
                type="datetime-local"
                className={fieldClasses}
                value={toLocalInputValue(parseISOorNull(draft.start ?? null))}
                onChange={(e) => {
                  const dt = fromLocalInput(e.target.value);
                  if (!dt) {
                    setDraft((prev) => ({ ...prev!, start: undefined }));
                    return;
                  }
                  const endDt = parseISOorNull(draft.end ?? null);
                  const newEnd = endDt && endDt > dt ? endDt : addMinutes(dt, 60);
                  setDraft((prev) => ({ ...prev!, start: dt.toISOString(), end: newEnd.toISOString() }));
                }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">Priority (1-5)</span>
              <input
                type="datetime-local"
                className={fieldClasses}
                value={toLocalInputValue(parseISOorNull(draft.end ?? null))}
                onChange={(e) => {
                  const dt = fromLocalInput(e.target.value);
                  if (!dt) {
                    setDraft((prev) => ({ ...prev!, end: undefined }));
                    return;
                  }
                  const startDt = parseISOorNull(draft.start ?? null);
                  if (startDt && dt <= startDt) {
                    setDraft((prev) => ({ ...prev!, end: addMinutes(startDt, 15).toISOString() }));
                  } else {
                    setDraft((prev) => ({ ...prev!, end: dt.toISOString() }));
                  }
                }}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">Priority (1-5)</span>
              <select
                className={fieldClasses}
                value={draft.type || "flexible"}
                onChange={(e) => setDraft((prev) => ({ ...prev!, type: e.target.value as EventItem["type"] }))}
              >
                <option value="flexible">Гибкое</option>
                <option value="fixed">Жёсткое</option>
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide text-gray-400">Priority (1-5)</span>
              <input
                type="number"
                min={1}
                max={5}
                className={fieldClasses}
                value={draft.priority ?? 3}
                onChange={(e) =>
                  setDraft((prev) => {
                    const nextPriority = Math.max(
                      1,
                      Math.min(5, Number(e.target.value) || 3),
                    ) as EventItem["priority"];
                    return { ...prev!, priority: nextPriority };
                  })
                }
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Category</span>
            <select
              className={fieldClasses}
              value={(draft.family as FamilyKey) || "home"}
              onChange={(e) => setDraft((prev) => ({ ...prev!, family: e.target.value as FamilyKey }))}
            >
              <option value="study">Study</option>
              <option value="work">Work</option>
              <option value="training">Training</option>
              <option value="home">Home</option>
              
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide text-gray-400">Priority (1-5)</span>
            <textarea
              className={`${fieldClasses} min-h-[120px] resize-none`}
              value={draft.notes || ""}
              onChange={(e) => setDraft((prev) => ({ ...prev!, notes: e.target.value }))}
            />
          </label>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button className={actionButtonClasses} onClick={saveDraft}>
              Сохранить
            </button>
            {draft.id && existing && (
              <button
                className="pressable rounded-xl border border-white/15 bg-[#27272a] px-4 py-2 text-gray-100"
                onClick={() => {
                  if (draft.id) removeEvent(draft.id);
                  onClose();
                }}
              >
                Удалить
              </button>
            )}
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="mb-3 text-xs uppercase tracking-wide text-gray-400">Быстрые действия</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={subtleButtonClasses}
                onClick={() => {
                  const s = parseISOorNull(draft?.start || null);
                  if (!s) return;
                  optimizeDay(startOfDay(s));
                }}
              >
                Оптимизировать день
              </button>
              <button
                className={subtleButtonClasses}
                onClick={() => {
                  const s = parseISOorNull(draft?.start || null);
                  if (!s) return;
                  const duration = 60;
                  const slot = findFirstFreeSlot(events, startOfDay(s), duration, 18, 21);
                  if (slot) {
                    const end = addMinutes(slot, duration);
                    setDraft((prev) => ({ ...prev!, start: slot.toISOString(), end: end.toISOString() }));
                  } else {
                    alert("Нет свободного слота вечером 18:00–21:00");
                  }
                }}
              >
                Вечерний слот (60м)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});





