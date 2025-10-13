import { memo } from "react";
import type { CalendarInfo, CalendarInfoMap } from "../domain";

type CalendarsPanelProps = {
  calendars: CalendarInfo[];
  activeCalendarId: string;
  onClose: () => void;
  fieldClasses: string;
  subtleButtonClasses: string;
  patchCalendar: (id: string, patch: Partial<CalendarInfo>) => void;
  setActiveCalendarId: (id: string) => void;
  createCalendar: () => void;
  exportCalendar: (id: string) => void;
  deleteCalendar: (id: string) => void;
  calendarExportData: { calendarId: string; ics: string } | null;
  setCalendarExportData: (value: { calendarId: string; ics: string } | null) => void;
  copyExportToClipboard: (text: string) => Promise<void>;
  exportCopyStatus: string | null;
  calendarMap: CalendarInfoMap;
  defaultCalendarId: string;
};

export const CalendarsPanel = memo(function CalendarsPanel({
  calendars,
  activeCalendarId,
  onClose,
  fieldClasses,
  subtleButtonClasses,
  patchCalendar,
  setActiveCalendarId,
  createCalendar,
  exportCalendar,
  deleteCalendar,
  calendarExportData,
  setCalendarExportData,
  copyExportToClipboard,
  exportCopyStatus,
  calendarMap,
  defaultCalendarId,
}: CalendarsPanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-start bg-black/55 backdrop-blur-sm">
      <div className="m-6 flex w-full max-w-lg flex-col space-y-5 rounded-2xl border border-white/10 bg-[#141417]/92 p-6 text-gray-100 shadow-[0_20px_60px_rgba(0,0,0,0.55)] md:w-[28rem]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Календари</h2>
          <button className={subtleButtonClasses} onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {calendars.map((cal) => {
            const isActive = cal.id === activeCalendarId;
            return (
              <div key={cal.id} className="rounded-xl border border-white/12 bg-transparent p-4 space-y-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                  <label className="flex-1 space-y-1">
                    <span className="text-xs uppercase tracking-wide text-gray-400">Название</span>
                    <input
                      className={fieldClasses}
                      value={cal.name}
                      onChange={(e) => patchCalendar(cal.id, { name: e.target.value })}
                      onBlur={(e) => {
                        const trimmed = e.target.value.trim();
                        if (!trimmed) patchCalendar(cal.id, { name: "Календарь" });
                      }}
                    />
                  </label>
                  <label className="space-y-1 md:w-40">
                    <span className="text-xs uppercase tracking-wide text-gray-400">Цвет</span>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        className="h-10 w-16 cursor-pointer rounded-md border border-white/10 bg-transparent"
                        value={cal.color}
                        onChange={(e) => patchCalendar(cal.id, { color: e.target.value })}
                      />
                      <span className="text-xs text-gray-300">{cal.color.toUpperCase()}</span>
                    </div>
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs uppercase tracking-wide text-gray-400">Описание</span>
                  <textarea
                    className={`${fieldClasses} min-h-[80px] resize-none`}
                    placeholder="Например: расписание университета"
                    value={cal.description ?? ""}
                    onChange={(e) => patchCalendar(cal.id, { description: e.target.value })}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3 text-xs text-gray-300">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border border-white/20 bg-transparent"
                      checked={cal.visible}
                      onChange={(e) => patchCalendar(cal.id, { visible: e.target.checked })}
                    />
                    <span>Отображать в сетке</span>
                  </label>
                  {!isActive && (
                    <button className={`${subtleButtonClasses} text-xs`} onClick={() => setActiveCalendarId(cal.id)}>
                      Сделать активным
                    </button>
                  )}
                  <button className={`${subtleButtonClasses} text-xs`} onClick={() => exportCalendar(cal.id)}>
                    Экспорт .ics
                  </button>
                  {cal.id !== defaultCalendarId && (
                    <button
                      className={`${subtleButtonClasses} text-xs text-red-200 hover:text-red-100`}
                      onClick={() => deleteCalendar(cal.id)}
                    >
                      Удалить
                    </button>
                  )}
                  {isActive && <span className="text-emerald-300">Активный календарь по умолчанию</span>}
                </div>
              </div>
            );
          })}
        </div>

        {calendarExportData && (
          <div className="space-y-2 rounded-xl border border-white/10 bg-transparent p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs uppercase tracking-wide text-gray-400">
                Экспорт «{calendarMap.get(calendarExportData.calendarId)?.name ?? "Календарь"}»
              </div>
              <button className={`${subtleButtonClasses} text-xs`} onClick={() => setCalendarExportData(null)}>
                Скрыть
              </button>
            </div>
            <textarea className={`${fieldClasses} min-h-[220px] font-mono text-xs`} readOnly value={calendarExportData.ics} />
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
              <button
                className={`${subtleButtonClasses} text-xs`}
                onClick={() => copyExportToClipboard(calendarExportData.ics)}
              >
                Скопировать в буфер
              </button>
              {exportCopyStatus && <span>{exportCopyStatus}</span>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button className={subtleButtonClasses} onClick={createCalendar}>
            + Новый календарь
          </button>
          <button className={subtleButtonClasses} onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
});
