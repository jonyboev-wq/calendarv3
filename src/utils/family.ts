import type { FamilyKey } from "../types";

const familyLabels: Record<FamilyKey, string> = {
  study: "Учёба",
  work: "Работа",
  health: "Здоровье",
  life: "Личное",
  other: "Другое",
};

export const familyLabel = (f: FamilyKey | undefined) => familyLabels[f ?? "other"];

export const familyBadgeColor = (f: FamilyKey | undefined) => {
  const map: Record<FamilyKey | "default", string> = {
    study: "bg-zinc-700/70 text-gray-100 border border-zinc-600/50",
    work: "bg-zinc-700/70 text-gray-100 border border-zinc-600/50",
    health: "bg-zinc-700/70 text-gray-100 border border-zinc-600/50",
    life: "bg-zinc-700/70 text-gray-100 border border-zinc-600/50",
    other: "bg-zinc-700/70 text-gray-100 border border-zinc-600/50",
    default: "bg-zinc-700/70 text-gray-100 border border-zinc-600/50",
  };
  return map[(f ?? "default") as keyof typeof map];
};

export const familyCardStyle = (_f: FamilyKey | undefined, fixed: boolean) => {
  const surface = fixed ? "bg-[#151518]" : "bg-[#2d2d34]";
  return `${surface} border ${fixed ? "border-white/25" : "border-white/14"} shadow-[0_22px_55px_-32px_rgba(0,0,0,0.9)]`;
};
