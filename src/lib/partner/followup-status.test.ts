import { describe, expect, it } from "vitest";
import { parsePartnerFollowupStatus, partnerFollowupReasonLabel } from "./followup-status";

const row = () => ({
  id: "91000000-0000-4000-8000-000000000951",
  status: "active",
  reason: null as string | null,
  version: 2,
  followups_sent: 1,
  next_due_on: "2026-11-19" as string | null,
  last_checked_at: "2026-11-09T10:00:00.123456+00:00" as string | null,
  next_check_at: "2026-11-09T10:30:00+00:00",
  mode: "osserva",
});

describe("metadati dei solleciti nella scheda", () => {
  it("legge soltanto il DTO RPC snake_case e restituisce la vista camelCase", () => {
    expect(parsePartnerFollowupStatus(row())).toEqual({
      id: row().id,
      status: "active",
      reason: null,
      version: 2,
      followupsSent: 1,
      nextDueOn: "2026-11-19",
      lastCheckedAt: row().last_checked_at,
      nextCheckAt: row().next_check_at,
      mode: "osserva",
    });
  });
  it.each(["spento", "osserva", "invio"])("legge modalità %s", (mode) =>
    expect(parsePartnerFollowupStatus({ ...row(), mode })?.mode).toBe(mode),
  );
  it.each(["held", "replied"])("legge ciclo %s senza dichiarare una risposta umana", (status) =>
    expect(parsePartnerFollowupStatus({ ...row(), status, reason: "ambiguous" })?.status).toBe(
      status,
    ),
  );
  it("legge il quarto sollecito come ciclo concluso e senza scadenza", () =>
    expect(
      parsePartnerFollowupStatus({
        ...row(),
        status: "complete",
        followups_sent: 4,
        next_due_on: null,
      }),
    ).toMatchObject({ status: "complete", followupsSent: 4, nextDueOn: null }));
  it("ammette una verifica non ancora effettuata", () =>
    expect(
      parsePartnerFollowupStatus({ ...row(), last_checked_at: null })?.lastCheckedAt,
    ).toBeNull());
  it.each([
    null,
    undefined,
    [],
    "invio",
    {},
    { ...row(), mode: "automatico" },
    { ...row(), mode: { toString: () => "invio" } },
    { ...row(), status: "running" },
    { ...row(), status: { toString: () => "active" } },
    { ...row(), id: "951" },
    { ...row(), version: "2" },
    { ...row(), version: 0 },
    { ...row(), version: Number.MAX_SAFE_INTEGER + 1 },
    { ...row(), followups_sent: -1 },
    { ...row(), followups_sent: 5 },
    { ...row(), followups_sent: 1.5 },
    { ...row(), status: "active", followups_sent: 4 },
    { ...row(), status: "active", next_due_on: null },
    { ...row(), status: "complete", followups_sent: 3, next_due_on: null },
    { ...row(), status: "complete", followups_sent: 4 },
    { ...row(), reason: "testo libero con recapito@example.test" },
    { ...row(), reason: "<script>" },
    { ...row(), reason: "A".repeat(81) },
    { ...row(), next_due_on: "2026-02-30" },
    { ...row(), next_due_on: "2026-13-01" },
    { ...row(), last_checked_at: "2026-11-09" },
    { ...row(), last_checked_at: "2026-02-30T10:00:00Z" },
    { ...row(), next_check_at: "2026-11-09T25:00:00Z" },
    { ...row(), nextCheckAt: row().next_check_at },
    { ...row(), address: "info@club-sintetico.example.test" },
  ])("DTO errato o superato %#: nessuna attestazione d'invio", (value) =>
    expect(parsePartnerFollowupStatus(value)).toBeNull(),
  );
  it("una chiave mancante non diventa una modalità predefinita", () => {
    const { mode: _mode, ...legacy } = row();
    expect(parsePartnerFollowupStatus(legacy)).toBeNull();
  });
  it("i motivi noti e sconosciuti non espongono dati o promettono una lettura umana", () => {
    expect(partnerFollowupReasonLabel("reply")).toContain("Possibile risposta");
    expect(partnerFollowupReasonLabel("ambiguous")).toContain("non è attribuibile con certezza");
    expect(partnerFollowupReasonLabel("codice_nuovo")).not.toContain("codice_nuovo");
    expect(partnerFollowupReasonLabel("info@club-sintetico.example.test")).not.toContain("@");
    expect(partnerFollowupReasonLabel(null)).toBe("");
  });
});
