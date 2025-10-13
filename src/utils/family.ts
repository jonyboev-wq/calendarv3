import type { FamilyKey } from "../types";

const familyLabels: Record<FamilyKey, string> = {
  study: "Учёба",
  work: "Работа",
  training: "Тренировка",
  home: "Дом",
};

export const familyLabel = (f: FamilyKey | undefined) => familyLabels[f ?? "home"];

export const familyBadgeColor = (f: FamilyKey | undefined) => {
  const map: Record<FamilyKey | "default", string> = {
    study: "bg-sky-900/60 text-sky-100 border border-sky-500/40",
    work: "bg-amber-900/60 text-amber-100 border border-amber-500/40",
    training: "bg-emerald-900/60 text-emerald-100 border border-emerald-500/40",
    home: "bg-purple-900/60 text-purple-100 border border-purple-500/40",
    default: "bg-zinc-700/70 text-gray-100 border border-zinc-600/50",
  };
  return map[(f ?? "default") as keyof typeof map];
};

export const familyCardStyle = (_f: FamilyKey | undefined, fixed: boolean) => {
  const surface = fixed ? "bg-[#151518]" : "bg-[#2d2d34]";
  return `${surface} border ${fixed ? "border-white/25" : "border-white/14"} shadow-[0_22px_55px_-32px_rgba(0,0,0,0.9)]`;
};

