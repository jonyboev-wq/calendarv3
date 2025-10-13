import { useEffect, useRef, useState } from "react";
import type { CalendarInfo } from "../types";

type CalendarDropdownProps = {
  calendars: CalendarInfo[];
  activeCalendarId: string;
  onSelectCalendar: (id: string) => void;
  onToggleCalendarVisibility: (id: string, visible: boolean) => void;
  onCreateCalendar: () => void;
  onShowCalendarsPanel: () => void;
  subtleButtonClasses: string;
};

export function CalendarDropdown({
  calendars,
  activeCalendarId,
  onSelectCalendar,
  onToggleCalendarVisibility,
  onCreateCalendar,
  onShowCalendarsPanel,
  subtleButtonClasses,
}: CalendarDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const activeCalendar = calendars.find((cal) => cal.id === activeCalendarId);
  const buttonLabel =
    activeCalendar?.name ?? (calendars.length ? calendars[0].name : "+ Календарь");

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        className={`${subtleButtonClasses} flex items-center gap-2 text-sm`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="relative flex h-2.5 w-2.5 items-center justify-center">
          <span
            className="h-2.5 w-2.5 rounded-full border border-white/25"
            style={{ backgroundColor: activeCalendar?.color ?? "#6b7280" }}
          />
        </span>
        <span className="truncate max-w-[160px]">{buttonLabel}</span>
        <span className="text-xs text-gray-400">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 min-w-[260px] space-y-3 rounded-2xl border border-white/12 bg-[#101014]/95 p-4 text-xs text-gray-200 shadow-[0_18px_45px_rgba(0,0,0,0.6)] backdrop-blur-xl">
          <div className="text-[10px] uppercase tracking-wide text-gray-400">
            Календарей: {calendars.length}
          </div>
          <div className="space-y-2">
            {calendars.map((cal) => {
              const isActive = cal.id === activeCalendarId;
              return (
                <div
                  key={cal.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-white/12 bg-white/5/0 p-2 transition hover:bg-white/5"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-gray-100"
                    onClick={() => {
                      onSelectCalendar(cal.id);
                      setOpen(false);
                    }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/30"
                      style={{ backgroundColor: cal.color }}
                    />
                    <span className="truncate text-sm">{cal.name}</span>
                    {isActive && (
                      <span className="text-[9px] uppercase text-emerald-300">Активный</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="shrink-0 text-[10px] text-gray-400 transition hover:text-gray-100"
                    onClick={() => onToggleCalendarVisibility(cal.id, !cal.visible)}
                  >
                    {cal.visible ? "Скрыть" : "Показать"}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className={`${subtleButtonClasses} text-xs`}
              onClick={() => {
                setOpen(false);
                onCreateCalendar();
              }}
            >
              + Календарь
            </button>
            <button
              type="button"
              className={`${subtleButtonClasses} text-xs`}
              onClick={() => {
                setOpen(false);
                onShowCalendarsPanel();
              }}
            >
              Управление
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
