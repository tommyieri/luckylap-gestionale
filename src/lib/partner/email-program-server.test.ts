import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadPartnerEmailDetail, loadPartnerEmailProgram } from "./email-program-server";
import { partnerAssistantOptOutLine } from "../partner-assistant/mail-compose";

const id = (n: number) => `92000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const snapshot = () => ({
  generatedAt: "2026-11-04T08:00:00Z",
  from: "2026-11-04",
  days: 14,
  config: {
    mode: "invio",
    pausedReason: null,
    backoffUntil: null,
    dailyFirstLimit: 10,
    firstRealOn: "2026-10-30",
    currentRulesVersion: 1,
  },
  mail: { stopReason: null, backoffUntil: null, dayStoppedOn: null, nextSendAfter: null },
  todaySent: { club: 0, altri: 0 },
  items: [],
  unprepared: [],
  sent: [],
  counts: { total: 0, returned: 0, unpreparedTotal: 0, unpreparedReturned: 0 },
});
const detail = () => ({
  kind: "draft",
  id: id(1),
  jobId: id(2),
  draftId: id(1),
  partnerId: id(3),
  co: 951,
  name: "Club Sintetico",
  sections: ["club"],
  subject: "LuckyLap e Club Sintetico",
  body: "Presentazione sintetica del brand.",
  signature: "Firma sintetica",
  language: "it",
  register: "voi",
  address: "club@example.test",
  lookbookCode: "club",
  sha256: "a".repeat(64),
  rulesVersion: 1,
  createdAt: "2026-11-04T07:00:00Z",
  sentAt: null,
  choiceReason: "Prodotti adatti alla comunità del club.",
  researchSources: [{ title: "Sito del club", url: "https://club.example.test" }],
  hold: null,
  editable: true,
  whyNotEditable: null,
});

function database(data: unknown, error: unknown = null) {
  const abortSignal = vi.fn(async (_signal: AbortSignal) => ({ data, error }));
  const rpc = vi.fn(() => ({ abortSignal }));
  return { client: { rpc } as unknown as SupabaseClient, rpc, abortSignal };
}

afterEach(() => vi.restoreAllMocks());

describe("loadPartnerEmailProgram", () => {
  it("legge il periodo richiesto con un limite di 10 secondi e restituisce la previsione", async () => {
    const db = database(snapshot());
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const result = await loadPartnerEmailProgram(db.client, "2026-11-04", 14);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("read_partner_email_program", {
      p_from: "2026-11-04",
      p_days: 14,
    });
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(db.abortSignal.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    expect(result.snapshot).toEqual(snapshot());
    expect(result.forecast.items).toEqual([]);
    expect(result.forecast.assumption).toContain("Stime");
  });

  it.each([
    ["2026-02-30", 14],
    ["2026-11-04", 0],
    ["2026-11-04", 91],
    ["2026-11-04", 1.5],
    ["2100-12-31", 2],
  ])("rigetta il periodo %s / %s prima della RPC", async (from, days) => {
    const db = database(snapshot());
    await expect(loadPartnerEmailProgram(db.client, String(from), Number(days))).rejects.toThrow(
      "Programma email non disponibile.",
    );
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { ...snapshot(), config: { ...snapshot().config, dailyFirstLimit: 100 } },
    { ...snapshot(), counts: { total: 1, returned: 0 } },
    { ...snapshot(), raw: "Dati estranei" },
    { ...snapshot(), from: "2026-11-05" },
    { ...snapshot(), days: 7 },
  ])("non costruisce una previsione da dati incompleti o di un periodo diverso", async (value) => {
    const db = database(value);
    await expect(loadPartnerEmailProgram(db.client, "2026-11-04", 14)).rejects.toThrow(
      "Programma email non disponibile.",
    );
  });

  it("non divulga l'errore della sorgente", async () => {
    const db = database(null, { message: "Dettaglio riservato della sorgente" });
    await expect(loadPartnerEmailProgram(db.client, "2026-11-04", 14)).rejects.toThrow(
      /^Programma email non disponibile\.$/,
    );
  });
});

describe("loadPartnerEmailDetail", () => {
  it("aggiunge la frase di uscita della bozza e legge solo il dettaglio richiesto", async () => {
    const db = database(detail());
    const result = await loadPartnerEmailDetail(db.client, "draft", id(1));
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("read_partner_email_detail", {
      p_kind: "draft",
      p_id: id(1),
    });
    expect(result).toEqual({ ...detail(), optOut: partnerAssistantOptOutLine() });
  });

  it("mostra il corpo inviato intero senza aggiungere una seconda firma o frase di uscita", async () => {
    const sent = {
      ...detail(),
      kind: "sent",
      editable: false,
      body: "Corpo effettivo\n\nFirma\n\nFrase di uscita già inclusa.",
      language: null,
      register: null,
      whyNotEditable: "inviata",
    };
    const db = database(sent);
    const result = await loadPartnerEmailDetail(db.client, "sent", id(1));
    expect(result).toEqual(sent);
    expect(result).not.toHaveProperty("optOut");
  });

  it("mantiene distinti ID del lavoro e della bozza e completa l'anteprima della bozza", async () => {
    const row = { ...detail(), kind: "job", id: id(2) };
    const db = database(row);
    const result = await loadPartnerEmailDetail(db.client, "job", id(2));
    expect(result.id).toBe(id(2));
    expect(result.draftId).toBe(id(1));
    expect(result.optOut).toBe(partnerAssistantOptOutLine());
  });

  it("un lavoro senza bozza non ha una frase di uscita inventata", async () => {
    const row = {
      ...detail(),
      kind: "job",
      id: id(2),
      draftId: null,
      language: null,
      register: null,
    };
    const db = database(row);
    expect(await loadPartnerEmailDetail(db.client, "job", id(2))).not.toHaveProperty("optOut");
  });

  it.each([
    { language: "xx" },
    { language: null },
    { register: "tu" },
    { register: null },
    { id: id(9) },
    { kind: "sent" },
    { partnerId: "invalid" },
    { status: { private: true } },
  ])("rigetta identità o dati di dettaglio non validi", async (changes) => {
    const db = database({ ...detail(), ...changes });
    await expect(loadPartnerEmailDetail(db.client, "draft", id(1))).rejects.toThrow(
      "Programma email non disponibile.",
    );
  });

  it("non inoltra campi inattesi della sorgente al client", async () => {
    const db = database({ ...detail(), raw: "Dati riservati non richiesti", token: "segreto" });
    const result = await loadPartnerEmailDetail(db.client, "draft", id(1));
    expect(result).not.toHaveProperty("raw");
    expect(result).not.toHaveProperty("token");
  });

  it("rifiuta un ID non valido senza leggere dal database", async () => {
    const db = database(detail());
    await expect(loadPartnerEmailDetail(db.client, "draft", "invalid")).rejects.toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("annulla la lettura pendente con il segnale del timeout", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const db = database(detail());
    db.abortSignal.mockImplementationOnce(
      (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("rete riservata"))),
        ),
    );
    const request = loadPartnerEmailDetail(db.client, "draft", id(1));
    controller.abort();
    await expect(request).rejects.toThrow(/^Programma email non disponibile\.$/);
    expect(timeout).toHaveBeenCalledWith(10_000);
  });
});
