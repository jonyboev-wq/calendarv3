import { memo, type Dispatch, type SetStateAction } from "react";
import type { CalendarInfo } from "../domain";

type ImportPanelProps = {
  calendars: CalendarInfo[];
  importCalendarId: string;
  setImportCalendarId: Dispatch<SetStateAction<string>>;
  icsText: string;
  setIcsText: Dispatch<SetStateAction<string>>;
  importMessage: string | null;
  setImportMessage: Dispatch<SetStateAction<string | null>>;
  onClose: () => void;
  importIcsCalendar: () => void;
  fieldClasses: string;
  subtleButtonClasses: string;
  actionButtonClasses: string;
};

export const ImportPanel = memo(function ImportPanel({
  calendars,
  importCalendarId,
  setImportCalendarId,
  icsText,
  setIcsText,
  importMessage,
  setImportMessage,
  onClose,
  importIcsCalendar,
  fieldClasses,
  subtleButtonClasses,
  actionButtonClasses,
}: ImportPanelProps) {
  return (
    <div className="fixed inset-0 z-50 flex bg-black/70 backdrop-blur-sm">
      <div className="ml-auto flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-white/10 bg-[#1f1f23]/95 p-6 text-gray-100 shadow-[0_0_60px_rgba(0,0,0,0.65)] md:p-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Импорт расписания (.ics)</h2>
          <button
            className={subtleButtonClasses}
            onClick={() => {
              onClose();
              setImportMessage(null);
            }}
          >
            Закрыть
          </button>
        </div>
        <p className="mt-3 text-sm text-gray-400">
          Вставь текст календаря Apple (BEGIN:VCALENDAR … END:VCALENDAR). В событиях будут сохранены название, время, место и описание.
          Повторяющиеся занятия раскладываются на ближайшие месяцы.
        </p>
        <div className="mt-4">
          <label className="text-xs uppercase tracking-wide text-gray-400">Календарь назначения</label>
          <div className="mt-2 flex items-center gap-3">
            <span
              className="h-3 w-3 rounded-full border border-white/20"
              style={{
                backgroundColor:
                  calendars.find((cal) => cal.id === importCalendarId)?.color ??
                  calendars[0]?.color ??
                  "#888888",
              }}
            />
            <select
              className={`${fieldClasses} flex-1`}
              value={importCalendarId}
              onChange={(e) => setImportCalendarId(e.target.value)}
            >
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <textarea
          className={`${fieldClasses} mt-4 min-h-[260px] font-mono text-xs`}
          placeholder="BEGIN:VCALENDAR..."
          value={icsText}
          onChange={(e) => setIcsText(e.target.value)}
        />
        {importMessage && (
          <div className="mt-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-gray-200">
            {importMessage}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            className={`${subtleButtonClasses} order-2`}
            onClick={() => {
              setIcsText("");
              setImportMessage(null);
            }}
          >
            Очистить
          </button>
          <button className={`${actionButtonClasses} order-1 sm:order-3`} onClick={importIcsCalendar}>
            Импортировать
          </button>
        </div>
      </div>
    </div>
  );
});
