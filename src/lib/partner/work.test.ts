import { describe, expect, it } from "vitest";
import { partnerFixtureId, partnerFixtureRows } from "./fixtures";
import {
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  parsePartnerContactLink,
  parsePartnerSummary,
  type PartnerSummary,
} from "./model";
import { comparePartnerWork, partnerWorkView, type PartnerWorkData } from "./work";

const TODAY = "2026-11-02";
const partner = (patch: Partial<PartnerSummary> = {}): PartnerSummary => ({
  ...parsePartnerSummary(partnerFixtureRows(TODAY).partners[0]),
  stage: "da_contattare",
  nextAction: null,
  nextActionOn: null,
  chosenApproach: null,
  ownerId: null,
  contactMonth: "2026-11-01",
  ...patch,
});
const work = (patch: Partial<PartnerWorkData> = {}): PartnerWorkData => ({
  assistantStatus: "ready",
  jobs: [],
  toggles: [],
  activities: [],
  replies: [],
  followUps: [],
  ...patch,
});
const job = (status: PartnerWorkData["jobs"][number]["status"], reason: string | null = null) => ({
  partnerId: partner().id,
  status,
  step: "scrittura" as const,
  reason,
  writeOn: null,
  updatedAt: "2026-11-02T09:00:00Z",
  draftId: status === "pronta" ? partnerFixtureId(8100) : null,
});
const view = (p = partner(), data: PartnerWorkData | null = work()) =>
  partnerWorkView(p, {
    today: TODAY,
    work: data,
    contacts: partnerFixtureRows(TODAY).contacts.map(parsePartnerContactLink),
    block: null,
    members: [],
  });
const activity = (kind: "risposta" | "inviato", occurredAt: string) => ({
  id: partnerFixtureId(kind === "risposta" ? 8101 : 8102),
  partnerId: partner().id,
  kind,
  occurredAt,
  createdBy: partnerFixtureId(901),
  origin: "team" as const,
  channel: "email" as const,
});

describe("fase di lavoro Partner", () => {
  it("mantiene lo stato commerciale e mostra sempre l'invio incerto", () => {
    const result = view(
      partner({ stage: "trattativa" }),
      work({ jobs: [job("serve_tommaso", "invio_incerto")] }),
    );
    expect(result.label).toBe("Primi contatti avviati");
    expect(result.warning).toContain("Invio da verificare");
    expect(result.needsAction).toBe(true);
  });

  it("fa prevalere Non contattare anche sulla bozza pronta", () => {
    const p = partner();
    const result = partnerWorkView(p, {
      today: TODAY,
      work: work({ jobs: [job("pronta")] }),
      contacts: [],
      members: [],
      block: {
        id: partnerFixtureId(8103),
        partnerId: p.id,
        domain: null,
        reason: "Stop sintetico",
        createdAt: "2026-11-01T10:00:00Z",
      },
    });
    expect(result.label).toBe("Non contattare");
    expect(result.reason).toBe("Stop sintetico");
  });

  it("rende visibili fermi, motivi, bozza e lavoro in preparazione", () => {
    expect(
      view(partner(), work({ toggles: [{ partnerId: partner().id, active: false }] })).label,
    ).toBe("Fermo");
    expect(view(partner(), work({ jobs: [job("serve_tommaso", "non_idoneo")] })).label).toBe(
      "Fermo",
    );
    expect(
      view(partner(), work({ jobs: [job("serve_tommaso", "fuso_mancante")] })).reason,
    ).toContain("fuso");
    expect(view(partner(), work({ jobs: [job("pronta")] })).label).toBe("Pronta");
    expect(view(partner(), work({ jobs: [job("in_coda")] })).label).toBe("In preparazione");
    expect(view(partner(), work({ jobs: [job("inviata")] })).label).toBe("Da verificare");
  });

  it("non chiama pronta una bozza mancante", () => {
    expect(view(partner(), work({ jobs: [{ ...job("pronta"), draftId: null }] })).label).toBe(
      "Da verificare",
    );
  });

  it("mostra Fermo se il team prende il contatto anche con una bozza pronta", () => {
    const data = work({ jobs: [job("pronta")] });
    expect(view(partner({ ownerId: partnerFixtureId(901) }), data).label).toBe("Fermo");
    expect(
      view(partner({ nextActionOn: "2027-06-15", nextAction: "Ricontatto" }), data).reason,
    ).toContain("prossima azione");
    expect(
      view(
        partner(),
        work({
          ...data,
          activities: [{ ...activity("risposta", "2026-11-02T10:00:00Z"), kind: "nota" }],
        }),
      ).reason,
    ).toContain("team");
    expect(
      partnerWorkView(partner(), {
        today: TODAY,
        work: data,
        contacts: [],
        block: null,
        members: [],
      }).reason,
    ).toContain("email attiva");
  });

  it("non deduce a chi tocca dallo stato commerciale", () => {
    expect(view(partner({ stage: "risposto" })).turn).toBe("Da verificare");
    expect(view().turn).toBe("A noi");
    expect(view(partner({ stage: "chiuso" }), null).turn).toBe("Da verificare");
  });

  it("usa l'ultima comunicazione confermata anche dopo un accordo e confronta gli istanti", () => {
    const activities = [
      activity("risposta", "2026-11-02T11:30:00+01:00"),
      activity("inviato", "2026-11-02T10:00:00Z"),
    ];
    expect(view(partner({ stage: "chiuso" }), work({ activities })).turn).toBe("A noi");
    expect(
      view(
        partner(),
        work({
          activities: activities.map((a) =>
            a.kind === "inviato" ? { ...a, occurredAt: "2026-11-02T11:00:00Z" } : a,
          ),
        }),
      ).turn,
    ).toBe("A loro");
  });

  it("se invio e risposta hanno lo stesso istante chiede verifica indipendentemente da UUID e fase", () => {
    for (const stage of PARTNER_STAGES) {
      for (const replyHasHigherId of [false, true]) {
        const activities = [
          {
            ...activity("risposta", "2026-11-02T12:00:00+01:00"),
            id: partnerFixtureId(replyHasHigherId ? 8202 : 8201),
            createdAt: "2026-11-02T15:00:00Z",
          },
          {
            ...activity("inviato", "2026-11-02T11:00:00Z"),
            id: partnerFixtureId(replyHasHigherId ? 8201 : 8202),
            createdAt: "2026-11-02T16:00:00Z",
          },
        ];
        const result = view(partner({ stage }), work({ activities }));
        expect(result.turn).toBe("Da verificare");
        expect(result.warning).toContain("Ordine delle comunicazioni da verificare");
        expect(result.needsAction).toBe(true);
        expect(result.sortPriority).toBe(0);
        expect(result.label).toBe(
          stage === "da_contattare" ? "Da verificare" : PARTNER_STAGE_LABELS[stage],
        );
      }
    }
  });

  it("stesso tipo allo stesso istante resta ordinabile e una comunicazione successiva risolve la parità", () => {
    const ties = [
      activity("risposta", "2026-11-02T11:00:00Z"),
      { ...activity("risposta", "2026-11-02T12:00:00+01:00"), id: partnerFixtureId(8203) },
    ];
    expect(view(partner({ stage: "risposto" }), work({ activities: ties })).turn).toBe("A noi");
    const result = view(
      partner({ stage: "contattato" }),
      work({ activities: [...ties, activity("inviato", "2026-11-02T11:30:00Z")] }),
    );
    expect(result.turn).toBe("A loro");
    expect(result.warning).toBeNull();
  });

  it("non inventa il sollecito sette giorni dopo l'invio", () => {
    const result = view(
      partner({ stage: "contattato" }),
      work({ activities: [activity("inviato", "2026-11-01T10:00:00Z")] }),
    );
    expect(result.dueLabel).not.toContain("sollecito");
    expect(result.dueOn).toBe("2026-11-01");
  });

  it("usa il vero sollecito aperto nel giorno di Roma e fa prevalere la prossima azione", () => {
    const followUps = [
      {
        id: partnerFixtureId(8104),
        partnerId: partner().id,
        dueAt: "2026-11-04T23:30:00Z",
        assignedTo: null,
      },
    ];
    expect(view(partner(), work({ followUps })).dueOn).toBe("2026-11-05");
    expect(view(partner(), work({ followUps })).dueLabel).toContain("sollecito");
    const result = view(
      partner({ nextActionOn: "2027-06-15", nextAction: "Ricontatto" }),
      work({ followUps }),
    );
    expect(result.dueOn).toBe("2027-06-15");
    expect(result.dueLabel).toContain("Ricontatto");
  });

  it("mantiene distinguibili assistente assente ed errore, senza mascherare la fase commerciale", () => {
    expect(view(partner(), work({ assistantStatus: "error" })).warning).toContain("assistente");
    expect(view(partner(), work({ assistantStatus: "inactive" })).warning).toBeNull();
    expect(view(partner({ stage: "risposto" }), null).label).toBe("Risposto");
    expect(view(partner({ stage: "risposto" }), null).warning).toContain("non disponibili");
  });

  it("mostra il motivo umano e ordina prima le risposte e poi le scadenze", () => {
    expect(view(partner({ chosenApproach: "evento", why: "Ricerca sintetica" })).motivation).toBe(
      "Presenza all’evento",
    );
    expect(view(partner({ why: "Ricerca sintetica" })).motivation).toBe("Ricerca sintetica");
    const reply = view(
      partner({ stage: "risposto" }),
      work({ activities: [activity("risposta", "2026-11-02T10:00:00Z")] }),
    );
    const ready = view(partner(), work({ jobs: [job("pronta")] }));
    expect(comparePartnerWork(reply, ready)).toBeLessThan(0);
  });
});
