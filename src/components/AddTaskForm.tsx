import { useState } from "react";
import type { FamilyKey, Task } from "../types";
import { addMinutes, fromLocalInput, toLocalInputValue } from "../utils/date";

type AddTaskFormProps = {
  onSubmit: (input: Omit<Task, "id" | "parts">) => Promise<void> | void;
  fieldClasses: string;
  actionButtonClasses: string;
};

const FAMILY_OPTIONS: { label: string; value: FamilyKey }[] = [
  { label: "Учёба", value: "study" },
  { label: "Работа", value: "work" },
  { label: "Тренировка", value: "training" },
  { label: "Дом", value: "home" },
];

export function AddTaskForm({ onSubmit, fieldClasses, actionButtonClasses }: AddTaskFormProps) {
  const defaultDeadline = toLocalInputValue(addMinutes(new Date(), 120));
  const [title, setTitle] = useState("");
  const [totalDuration, setTotalDuration] = useState<string>("90");
  const [deadline, setDeadline] = useState<string>(defaultDeadline);
  const [calendarType, setCalendarType] = useState<FamilyKey>("study");
  const [priority, setPriority] = useState<string>("3");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const trimmedTitle = title.trim();
    const durationMinutes = Number.parseInt(totalDuration, 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setError("Укажите длительность задачи в минутах.");
      return;
    }
    const deadlineDate = fromLocalInput(deadline);
    if (!deadlineDate) {
      setError("Выберите корректный дедлайн.");
      return;
    }
    const priorityValue = Number.parseInt(priority, 10);
    if (![1, 2, 3, 4, 5].includes(priorityValue)) {
      setError("Приоритет должен быть от 1 до 5.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        title: trimmedTitle || "Новая задача",
        totalDuration: durationMinutes,
        deadline: deadlineDate.toISOString(),
        calendarType,
        priority: priorityValue as Task["priority"],
      });
      setTitle("");
      setTotalDuration("90");
      setDeadline(toLocalInputValue(addMinutes(new Date(), 120)));
      setPriority("3");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать задачу.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 rounded-2xl border border-white/10 bg-[#141417]/80 p-4 md:grid-cols-5 md:items-end">
      <div className="md:col-span-2 space-y-1">
        <label className="text-xs uppercase tracking-wide text-gray-400">Название</label>
        <input
          className={fieldClasses}
          placeholder="Например, протокол совещания"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
          maxLength={120}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-gray-400">Длительность (мин)</label>
        <input
          className={fieldClasses}
          type="number"
          min={10}
          step={5}
          value={totalDuration}
          onChange={(event) => {
            setTotalDuration(event.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-gray-400">Дедлайн</label>
        <input
          className={fieldClasses}
          type="datetime-local"
          value={deadline}
          onChange={(event) => {
            setDeadline(event.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs uppercase tracking-wide text-gray-400">Категория</label>
        <select
          className={fieldClasses}
          value={calendarType}
          onChange={(event) => {
            setCalendarType(event.target.value as FamilyKey);
            setError(null);
          }}
        >
          {FAMILY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1 md:col-span-5 md:flex md:flex-wrap md:items-end md:gap-4">
        <div className="flex-1 space-y-1 md:max-w-xs">
          <label className="text-xs uppercase tracking-wide text-gray-400">Приоритет</label>
          <select
            className={fieldClasses}
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value);
              setError(null);
            }}
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 md:mt-0">
          <button type="submit" className={`${actionButtonClasses} w-full md:w-auto`} disabled={submitting}>
            {submitting ? "Добавляем..." : "Добавить задачу"}
          </button>
        </div>
        {error && <div className="mt-3 text-sm text-rose-300 md:mt-0 md:flex-1">{error}</div>}
      </div>
    </form>
  );
}
