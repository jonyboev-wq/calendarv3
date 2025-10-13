import type { ReactNode } from "react";
import { CalendarDropdown } from "./CalendarDropdown";

type HeaderCalendar = {
  id: string;
  name: string;
  color: string;
  visible: boolean;
};

type CalendarHeaderProps = {
  navSegmentClasses: string;
  actionButtonClasses: string;
  subtleButtonClasses: string;
  onPrevWeek: () => void;
  onToday: () => void;
  onNextWeek: () => void;
  weekLabel: string;
  onCreateEvent: () => void;
  onOptimizeToday: () => void;
  onOpenPlanner: () => void;
  onOpenImport: () => void;
  onOpenTasks: () => void;
  calendars: HeaderCalendar[];
  activeCalendarId: string;
  onSelectCalendar: (id: string) => void;
  onToggleCalendarVisibility: (id: string, visible: boolean) => void;
  onCreateCalendar: () => void;
  onShowCalendarsPanel: () => void;
  renderImportButtonIcon?: () => ReactNode;
};

export function CalendarHeader({
  navSegmentClasses,
  actionButtonClasses,
  subtleButtonClasses,
  onPrevWeek,
  onToday,
  onNextWeek,
  weekLabel,
  onCreateEvent,
  onOptimizeToday,
  onOpenPlanner,
  onOpenImport,
  onOpenTasks,
  calendars,
  activeCalendarId,
  onSelectCalendar,
  onToggleCalendarVisibility,
  onCreateCalendar,
  onShowCalendarsPanel,
  renderImportButtonIcon,
}: CalendarHeaderProps) {
  return (
    <div className="w-full px-6 py-4 flex flex-col gap-3 rounded-b-3xl border border-white/10 bg-gradient-to-b from-[#141416]/70 via-[#101013]/60 to-[#0f0f12]/80 backdrop-blur-2xl shadow-[0_18px_45px_-30px_rgba(0,0,0,0.85)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex flex-wrap items-center justify-start gap-2">
          <CalendarDropdown
            calendars={calendars}
            activeCalendarId={activeCalendarId}
            onSelectCalendar={onSelectCalendar}
            onToggleCalendarVisibility={onToggleCalendarVisibility}
            onCreateCalendar={onCreateCalendar}
            onShowCalendarsPanel={onShowCalendarsPanel}
            subtleButtonClasses={subtleButtonClasses}
          />
          <button className={`${actionButtonClasses} sm:w-auto`} onClick={onCreateEvent}>
            + Событие
          </button>
        </div>
        <div className="order-first flex justify-center lg:order-none lg:flex-1">
          <div className="flex items-center overflow-hidden rounded-full border border-white/10 bg-white/10 shadow-inner shadow-black/30">
            <button className={`${navSegmentClasses} border-r border-white/10`} onClick={onPrevWeek}>
              ← Неделя
            </button>
            <button className={navSegmentClasses} onClick={onToday}>
              Сегодня
            </button>
            <button className={`${navSegmentClasses} border-l border-white/10`} onClick={onNextWeek}>
              Неделя →
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className={`${subtleButtonClasses} sm:w-auto`} onClick={onOptimizeToday}>
            Оптимизировать день
          </button>
          <button className={`${subtleButtonClasses} sm:w-auto`} onClick={onOpenPlanner}>
            Автоплан
          </button>
          <button className={`${subtleButtonClasses} sm:w-auto`} onClick={onOpenTasks}>
            Задачи
          </button>
          <button className={`${subtleButtonClasses} sm:w-auto`} onClick={onOpenImport}>
            {renderImportButtonIcon ? renderImportButtonIcon() : "Импорт .ics"}
          </button>
        </div>
      </div>
      <div className="text-sm text-gray-300 text-center lg:text-right">{weekLabel}</div>
    </div>
  );
}
