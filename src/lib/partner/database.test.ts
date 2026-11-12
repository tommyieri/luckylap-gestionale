import { describe, expect, it } from "vitest";
import { buildPartnerDatabaseRows, partnerCountryCode, partnerCountryName } from "./database";
import { partnerFixtureId, partnerFixtureWorkspace } from "./fixtures";
import type { PartnerSummary } from "./model";
import type { PartnerWorkData } from "./work";

const today = "2026-11-12";

function fixture(changes: Partial<PartnerSummary> = {}, operations: Partial<PartnerWorkData> = {}) {
  const workspace = partnerFixtureWorkspace(today);
  const email = workspace.contacts.find(
    (row) => row.kind === "email" && row.active && row.linkValue,
  )!;
  const partner = {
    ...workspace.partners.find((row) => row.id === email.partnerId)!,
    stage: "da_contattare" as const,
    ownerId: null,
    nextAction: null,
    nextActionOn: null,
    researchRemovedAt: null,
    ...changes,
  };
  return {
    ...workspace,
    partners: [partner],
    contacts: [email],
    blocks: [],
    work: {
      assistantStatus: "ready" as const,
      activities: [],
      replies: [],
      followUps: [],
      jobs: [],
      toggles: [],
      ...operations,
    },
  };
}

describe("proiezione del database Partner", () => {
  it("normalizza i paesi delle fixture, gli alias inglesi e i microstati, lasciando gli ignoti separati", () => {
    expect(
      [
        "Italia",
        "Germany",
        " Olanda ",
        "Regno Unito",
        "Giappone",
        "Austria",
        "Monaco",
        "San Marino",
        "UK",
        " de ",
      ].map(partnerCountryCode),
    ).toEqual(["IT", "DE", "NL", "GB", "JP", "AT", "MC", "SM", "GB", "DE"]);
    expect(["", "Europa", "EU", "ZZ", "Paese sintetico"].map(partnerCountryCode)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(partnerCountryName("JP")).toBe("Giappone");
  });

  it("usa il predefinito solo se verificato tra gli attivi e mantiene l’assegnazione esplicita", () => {
    const workspace = fixture();
    const defaultMember = workspace.members.find((member) => member.active)!;
    const explicitMember = workspace.members.find((member) => member.id !== defaultMember.id)!;
    expect(buildPartnerDatabaseRows(workspace, today, [], defaultMember.id)[0]).toMatchObject({
      ownerId: defaultMember.id,
      ownerLabel: `${defaultMember.name} (predefinito)`,
      partner: { ownerId: null },
    });
    expect(
      buildPartnerDatabaseRows(workspace, today, [], partnerFixtureId(99999))[0],
    ).toMatchObject({
      ownerId: null,
      ownerLabel: "Predefinito",
    });
    expect(
      buildPartnerDatabaseRows(
        fixture({ ownerId: explicitMember.id }),
        today,
        [],
        defaultMember.id,
      )[0],
    ).toMatchObject({
      ownerId: explicitMember.id,
      ownerLabel: explicitMember.name,
    });
  });

  it("dà precedenza al blocco e alla prossima azione rispetto al sollecito aperto", () => {
    const workspace = fixture({ stage: "contattato" });
    const partner = workspace.partners[0];
    const member = workspace.members.find((person) => person.active)!;
    const operations = {
      followUps: [
        {
          id: partnerFixtureId(3500),
          partnerId: partner.id,
          dueAt: "2026-11-12T23:30:00Z",
          assignedTo: member.id,
        },
      ],
    };
    const manual = fixture(
      { stage: "contattato", nextAction: "Verifica sintetica", nextActionOn: today },
      operations,
    );
    expect(
      buildPartnerDatabaseRows(fixture({ stage: "contattato" }, operations), today, [])[0].next,
    ).toEqual({
      label: "Sollecito",
      day: "2026-11-13",
      estimated: false,
      who: member.name,
    });
    expect(buildPartnerDatabaseRows(manual, today, [], member.id)[0].next).toMatchObject({
      label: "Verifica sintetica",
      day: today,
      estimated: false,
    });
    expect(
      buildPartnerDatabaseRows(
        {
          ...manual,
          blocks: [
            {
              id: partnerFixtureId(3501),
              partnerId: partner.id,
              domain: null,
              reason: "Blocco sintetico",
              createdAt: `${today}T12:00:00Z`,
            },
          ],
        },
        today,
        [],
      )[0],
    ).toMatchObject({
      blocked: true,
      stage: "contattato",
      next: { label: "Non contattare", day: null },
    });
  });

  it("distingue preparazione, stima, esito terminale e tempi registrati", () => {
    const { id: partnerId } = fixture().partners[0];
    const job = {
      partnerId,
      status: "pronta" as const,
      step: "controllo" as const,
      reason: null,
      writeOn: today,
      updatedAt: `${today}T12:00:00Z`,
      draftId: partnerFixtureId(3502),
      format: "brand",
      subtype: "accessori_auto",
    };
    expect(
      buildPartnerDatabaseRows(fixture({}, { jobs: [job] }), today, [
        { partnerId, day: "2026-11-14" },
      ])[0],
    ).toMatchObject({
      group: "programmato",
      format: "brand",
      subtype: "accessori_auto",
      next: { label: "Prima email prevista", day: "2026-11-14", estimated: true },
    });
    expect(
      buildPartnerDatabaseRows(fixture({}, { jobs: [{ ...job, status: "attesa" }] }), today, [])[0],
    ).toMatchObject({
      group: "data",
      next: { label: "Preparazione della prima email", day: today, estimated: false },
    });
    const activity = {
      partnerId,
      origin: "file" as const,
      channel: "email" as const,
      createdBy: partnerFixtureId(901),
    };
    expect(
      buildPartnerDatabaseRows(
        fixture(
          { stage: "no" },
          {
            activities: [
              {
                ...activity,
                id: partnerFixtureId(3503),
                kind: "risposta",
                occurredAt: "2026-11-11T11:00:00Z",
              },
              {
                ...activity,
                id: partnerFixtureId(3504),
                kind: "inviato",
                occurredAt: "2026-11-10T10:00:00+01:00",
                messageKind: "primo",
              },
            ],
          },
        ),
        today,
        [],
      )[0],
    ).toMatchObject({
      stage: "chiuso",
      group: "non_interessato",
      lastActivity: "2026-11-11T11:00:00Z",
      firstSent: "2026-11-10T10:00:00+01:00",
      firstReply: "2026-11-11T11:00:00Z",
      next: { label: "Concluso · Non interessato", day: null },
    });
  });
});
