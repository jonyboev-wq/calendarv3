import { forwardRef } from "react";
import type { JSX, CSSProperties } from "react";

type CalendarGridProps = {
  weekDays: Date[];
  today: Date;
  dayStartHour: number;
  dayEndHour: number;
  minuteUnit: number;
  dayColumnHeight: number;
  renderDayColumn: (day: Date) => JSX.Element;
  timeColumnWidth?: number;
  headerOffset: number;
  columnOffset?: number;
};

export const CalendarGrid = forwardRef<HTMLDivElement, CalendarGridProps>(function CalendarGrid(
  {
    weekDays,
    today,
    dayStartHour,
    dayEndHour,
    minuteUnit,
    dayColumnHeight,
    renderDayColumn,
    timeColumnWidth = 80,
    headerOffset,
    columnOffset = 0,
  },
  ref
) {
  const totalHours = Math.max(1, dayEndHour - dayStartHour);
  const hourHeight = minuteUnit * 60;
  const headerStyle: CSSProperties = {
    position: "sticky",
    top: Math.max(0, headerOffset),
    zIndex: 50,
    background: "rgba(17,17,19,0.65)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
  };


  return (
    <div className="w-full px-4 md:px-6 py-6" ref={ref}>
      <div className="w-full rounded-3xl border border-white/10 bg-gradient-to-b from-[#0f0f12]/85 via-[#111113]/60 to-[#0f0f12]/90 backdrop-blur-2xl p-3 md:p-6 shadow-[0_24px_70px_-35px_rgba(0,0,0,0.85)]">
        <div className="relative grid w-full" style={{ gridTemplateColumns: `${timeColumnWidth}px repeat(7, 1fr)` }}>
          <div style={headerStyle}></div>
          {weekDays.map((day) => {
            const isToday = day.toDateString() === today.toDateString();
            const dayCircleClass = isToday
              ? "flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-sm font-semibold text-white shadow"
              : "text-sm text-gray-200";

            return (
              <div
                key={day.toDateString()}
                className="px-2 pb-3 text-center text-sm font-semibold text-gray-200"
                style={headerStyle}
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="uppercase tracking-wide text-xs text-gray-300">
                    {day.toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                  <span className={dayCircleClass}>{String(day.getDate())}</span>
                </div>
              </div>
            );
          })}
          <div className="relative">
            {Array.from({ length: totalHours }, (_, index) => {
              const top = columnOffset + index * hourHeight;
              return (
                <div
                  key={`hour-bg-${index}`}
                  className="pointer-events-none absolute inset-x-0"
                  style={{
                    top,
                    height: hourHeight,
                    backgroundColor: index % 2 === 0 ? "rgba(255,255,255,0.01)" : "rgba(255,255,255,0.02)",
                    zIndex: 1,
                  }}
                />
              );
            })}
            {Array.from({ length: totalHours + 1 }, (_, index) => {
              const top = columnOffset + index * hourHeight;
              return (
                <div
                  key={`hour-label-${index}`}
                  className="absolute left-0 w-full pr-2 text-xs text-gray-400"
                  style={{ top, transform: "translateY(-50%)", zIndex: 5 }}
                >
                  {String(dayStartHour + index).padStart(2, "0")}:00
                </div>
              );
            })}
            <div style={{ height: columnOffset + dayColumnHeight }}></div>
          </div>

          {weekDays.map((day) => renderDayColumn(day))}
        </div>
      </div>
    </div>
  );
});
