import { describe, expect, it } from "vitest";
import {
  parsePartnerWorkCommand,
  partnerWorkSnapshot,
  partnerWorkReceipt,
  partnerHref,
  workTargetHref,
} from "./model";

const actorId = "10000000-0000-4000-8000-000000000001";
const partnerId = "20000000-0000-4000-8000-000000000001";
const operationId = "30000000-0000-4000-8000-000000000001";
const linkId = "40000000-0000-4000-8000-000000000001";
const command = {
  operationId,
  actorId,
  payload: { schema_version: 1, kind: "project", partner_id: partnerId },
};
export const partnerRow = {
  id: partnerId,
  co: 42,
  name: "Partner sintetico",
  sections: ["collab"],
  event_starts_on: "2028-03-26",
  event_ends_on: null,
  application_deadline: null,
  stage: "trattativa",
};

describe("confine dati dei collegamenti Partner", () => {
  it("accetta solo comandi completi senza attori nel payload o campi aggiunti", () => {
    expect(parsePartnerWorkCommand(command)).toEqual(command);
    expect(
      parsePartnerWorkCommand({ ...command, payload: { ...command.payload, actor_id: actorId } }),
    ).toBeNull();
    expect(parsePartnerWorkCommand({ ...command, extra: true })).toBeNull();
    expect(parsePartnerWorkCommand({ ...command, actorId: "founder" })).toBeNull();
    expect(
      parsePartnerWorkCommand({ ...command, payload: { ...command.payload, kind: "unknown" } }),
    ).toBeNull();
  });
  it("la risoluzione conserva la versione vista e una scelta booleana esplicita", () => {
    const value = {
      operationId,
      actorId,
      payload: {
        schema_version: 1,
        kind: "resolve",
        link_id: linkId,
        expected_version: 2,
        keep_manual: false,
      },
    };
    expect(parsePartnerWorkCommand(value)).toEqual(value);
    for (const expected_version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "2"])
      expect(
        parsePartnerWorkCommand({ ...value, payload: { ...value.payload, expected_version } }),
      ).toBeNull();
    expect(
      parsePartnerWorkCommand({ ...value, payload: { ...value.payload, keep_manual: "false" } }),
    ).toBeNull();
  });
  it("proietta solo le colonne consentite e rifiuta date/link incoerenti", () => {
    const snapshot = partnerWorkSnapshot(
      [{ ...partnerRow, private_contact: "non deve passare" }],
      [],
    );
    expect(JSON.stringify(snapshot)).not.toContain("private_contact");
    expect(snapshot.partners[0].eventStartsOn).toBe("2028-03-26");
    expect(() =>
      partnerWorkSnapshot([{ ...partnerRow, event_starts_on: "2028-02-30" }], []),
    ).toThrow();
    const link = {
      id: linkId,
      partner_id: partnerId,
      kind: "event",
      task_id: null,
      calendar_event_id: linkId,
      project_id: null,
      version: 1,
      needs_review: false,
      detached: false,
    };
    expect(partnerWorkSnapshot([partnerRow], [link]).links[0].calendarEventId).toBe(linkId);
    expect(() => partnerWorkSnapshot([], [link])).toThrow();
    expect(() => partnerWorkSnapshot([partnerRow], [{ ...link, task_id: linkId }])).toThrow();
  });
  it("crea collegamenti canonici senza testo libero", () => {
    expect(partnerHref(42)).toBe("/partner?co=42#lead-42");
    expect(workTargetHref("event", linkId)).toBe(`/team#evento-${linkId}`);
    expect(workTargetHref("shop_review", linkId)).toBe(`/team#attivita-${linkId}`);
    expect(workTargetHref("project", linkId)).toBe(`/development#progetto-${linkId}`);
    expect(workTargetHref("event", "//hostile.invalid")).toBeNull();
  });
  it("collega una vendita soltanto con evento e ordine espliciti e ricevuta correlata", () => {
    const value = {
      operationId,
      actorId,
      payload: {
        schema_version: 1,
        kind: "link_sale",
        partner_id: partnerId,
        event_id: linkId,
        order_id: partnerId,
      },
    };
    const parsed = parsePartnerWorkCommand(value)!;
    expect(parsed).toEqual(value);
    expect(
      parsePartnerWorkCommand({ ...value, payload: { ...value.payload, order_id: null } }),
    ).toBeNull();
    expect(
      partnerWorkReceipt(
        {
          operation_id: operationId,
          partner_id: partnerId,
          kind: "link_sale",
          target_id: linkId,
          replayed: false,
        },
        parsed,
      )?.targetId,
    ).toBe(linkId);
    expect(
      partnerWorkReceipt(
        {
          operation_id: operationId,
          partner_id: partnerId,
          kind: "link_sale",
          target_id: partnerId,
          replayed: false,
        },
        parsed,
      ),
    ).toBeNull();
    const snapshot = partnerWorkSnapshot(
      [partnerRow],
      [],
      [
        {
          id: partnerId,
          external_reference: "SINTETICO",
          occurred_at: "2028-03-26T12:00:00Z",
          channel: "direct",
          amount_cents: 12345,
        },
      ],
      [{ event_id: linkId, order_id: partnerId, partner_id: partnerId }],
    );
    expect(snapshot.eventSales).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/amount_cents|12345/);
  });
});

it.each(["shopify_web", "shopify_pos"])(
  "accepts actual canonical %s channel for event sales without refusing the entire workspace",
  (channel) => {
    const snapshot = partnerWorkSnapshot(
      [partnerRow],
      [],
      [
        {
          id: operationId,
          external_reference: "Syntheticorder",
          occurred_at: "2026-10-22T10:00Z",
          channel,
        },
      ],
    );
    expect(snapshot.orders[0].channel).toBe(channel);
  },
);
