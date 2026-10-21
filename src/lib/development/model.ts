import { isTeamId } from "../team/model";
export const DEVELOPMENT_STAGES = ["idea", "design", "sampling", "production", "ready", "archived"] as const;
export type DevelopmentStage = (typeof DEVELOPMENT_STAGES)[number];
export const stageLabels: Record<DevelopmentStage, string> = { idea: "Idea", design: "Design", sampling: "Campionatura", production: "Produzione", ready: "Pronto", archived: "Archiviato" };
export type DevelopmentProject = { id: string; name: string; brief: string; stage: DevelopmentStage; targetDate: string | null; ownerId: string | null; version: number; updatedAt: string };
export type DevelopmentState = { error?: string; success?: string; revision?: string; values?: Record<string, string> };
export function parseDevelopmentForm(form: FormData) {
  const text = (key: string, limit: number) => { const values = form.getAll(key); if (values.length > 1 || (values.length && typeof values[0] !== "string")) throw new Error("I dati della scheda non sono validi."); const value = String(values[0] ?? "").trim(); if (value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error("I dati della scheda superano i limiti consentiti."); return value; };
  const id = text("id", 36), version = text("version", 16), name = text("name", 240), brief = text("brief", 8000), stage = text("stage", 20), targetDate = text("targetDate", 10), ownerId = text("ownerId", 36);
  if (!isTeamId(id) || !name || !DEVELOPMENT_STAGES.includes(stage as DevelopmentStage) || (ownerId && !isTeamId(ownerId)) || (version && (!/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version))))) throw new Error("Inserisci nome, fase e referente validi.");
  if (targetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !Number.isFinite(Date.parse(targetDate)) || new Date(`${targetDate}T12:00:00Z`).toISOString().slice(0, 10) !== targetDate)) throw new Error("La data obiettivo non è valida.");
  return { id, expectedVersion: version ? Number(version) : null, name, brief, stage: stage as DevelopmentStage, targetDate: targetDate || null, ownerId: ownerId || null };
}
