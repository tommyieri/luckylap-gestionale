import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PARTNER_ACTIVITY_CHANNELS,
  PARTNER_ACTIVITY_CHANNEL_LABELS,
  PARTNER_ACTIVITY_KINDS,
  PARTNER_ACTIVITY_KIND_LABELS,
  PARTNER_APPROACHES,
  PARTNER_APPROACH_LABELS,
  PARTNER_CHANNELS,
  PARTNER_CONTACT_KINDS,
  PARTNER_DIFFERENCE_FIELDS,
  PARTNER_LANGUAGES,
  PARTNER_LANGUAGE_LABELS,
  PARTNER_LOOKBOOK_CODES,
  PARTNER_MESSAGE_KINDS,
  PARTNER_MESSAGE_LIMITS,
  PARTNER_PRIORITIES,
  PARTNER_PRIORITY_LABELS,
  PARTNER_SECTIONS,
  PARTNER_SECTION_LABELS,
  PARTNER_STAGES,
  PARTNER_STAGE_LABELS,
  PARTNER_VARIANT_CHANNELS,
  PartnerReadError,
  charCount,
  formatCo,
  hasControlCharacters,
  isPartnerApproach,
  isPartnerStage,
  isVisibleVariant,
  memberName,
  parsePartnerActivity,
  parsePartnerBlock,
  parsePartnerContact,
  parsePartnerContactLink,
  parsePartnerDetailRow,
  parsePartnerDifference,
  parsePartnerOpenDifference,
  parsePartnerResearchImport,
  parsePartnerRevision,
  parsePartnerSummary,
  parsePartnerVariantSummary,
  partnerActivityLine,
  partnerActivityText,
  readyMessagesLabel,
  recentSentActivity,
  recentSentQuestion,
  researchImportLine,
  shortReason,
} from "./model";

const MIGRATIONS = join(__dirname, "../../../supabase/migrations");
const migration = readFileSync(
  join(
    MIGRATIONS,
    readdirSync(MIGRATIONS).find((name) => name.endsWith("_partner_module.sql")) ?? "",
  ),
  "utf8",
);
const sqlArray = (functionName: string) => {
  const body = migration.split(`create function private.${functionName}()`)[1] ?? "";
  return [...(/array\[([^\]]*)\]/.exec(body)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map(
    (match) => match[1],
  );
};

describe("valori di dominio Partner", () => {
  it("stati e approcci uguali a quelli della migrazione partner_module", () => {
    expect(sqlArray("partner_stages")).toEqual([...PARTNER_STAGES]);
    expect(sqlArray("partner_approaches")).toEqual([...PARTNER_APPROACHES]);
  });

  it("etichette italiane per ogni stato e approccio (spec 02 §1 e §5.6)", () => {
    expect(PARTNER_STAGES.map((stage) => PARTNER_STAGE_LABELS[stage])).toEqual([
      "Da contattare",
      "Contattato",
      "Ha risposto",
      "In trattativa",
      "Accordo fatto",
      "Non interessato",
    ]);
    expect(PARTNER_APPROACHES.map((approach) => PARTNER_APPROACH_LABELS[approach])).toEqual([
      "Vendita",
      "Presenza all’evento",
      "Collab",
      "Su misura",
      "Media",
    ]);
  });

  it("limiti dei testi dei messaggi come i check del database", () => {
    expect(PARTNER_MESSAGE_LIMITS).toEqual({
      subject: 300,
      body: 8000,
      follow_up: 4000,
      confirm_email: 4000,
    });
    for (const [field, max] of Object.entries(PARTNER_MESSAGE_LIMITS))
      expect(migration).toContain(`char_length(original_${field}) <= ${max}`);
  });

  it("riconosce solo stati e approcci dell'elenco", () => {
    expect(isPartnerStage("risposto")).toBe(true);
    expect(isPartnerStage("Risposto")).toBe(false);
    expect(isPartnerStage(null)).toBe(false);
    expect(isPartnerApproach("su_misura")).toBe(true);
    expect(isPartnerApproach("eventi")).toBe(false);
  });

  it("conta i caratteri come PostgreSQL e trova i caratteri di controllo", () => {
    expect(charCount("Grüße 🏁")).toBe(7);
    expect("🏁".length).toBe(2);
    expect(hasControlCharacters("riga\n\tsotto\r")).toBe(false);
    expect(hasControlCharacters("a\u0000b")).toBe(true);
    expect(hasControlCharacters("a\u007fb")).toBe(true);
    expect(hasControlCharacters("a\u000bb")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Righe del database ed etichette (spec 02 §6, §7.1)
// ---------------------------------------------------------------------------

const checkValues = (column: string) => {
  const match = new RegExp(`${column} text[^,]*check \\(${column} in \\(([^)]*)\\)\\)`).exec(
    migration,
  );
  return [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((item) => item[1]);
};
const at = "2026-10-21T09:00:00+00:00";
const id = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const partnerRow = (fields: Record<string, unknown> = {}) => ({
  id: id(1),
  co: 7,
  source_key: "L007",
  origin: "research",
  name: "Garage Sintetico",
  city: "Monaco",
  country: "Germania",
  type_label: "Negozio",
  sections: ["collab", "vendita"],
  priority: "alta",
  contact_month: "2026-11-01",
  event_starts_on: null,
  event_ends_on: null,
  application_deadline: null,
  preferred_channel: "email",
  research_removed_at: null,
  stage: "contattato",
  stage_from_file_at: null,
  owner_id: null,
  next_action: null,
  next_action_on: null,
  chosen_approach: null,
  approach_from_file_at: null,
  version: 3,
  updated_at: at,
  route: "Email al titolare.",
  followers: null,
  ...fields,
});
const activityRow = (fields: Record<string, unknown> = {}) => ({
  id: id(40),
  operation_id: id(41),
  partner_id: id(1),
  partner_name: "Garage Sintetico",
  partner_co: 7,
  kind: "inviato",
  origin: "team",
  occurred_at: "2026-10-22T08:42:00Z",
  message_kind: "primo",
  channel: "email",
  approach: "collab",
  stage_before: "da_contattare",
  stage_after: "contattato",
  owner_after: null,
  next_action_on: null,
  body: "",
  created_by: id(901),
  created_at: "2026-10-22T08:42:00Z",
  ...fields,
});
const members = [{ id: id(901), name: "Ada Prova", active: true }];

describe("costanti come i check della migrazione", () => {
  it("sezioni, priorità, canali, recapiti, lingue, lookbook, registro e differenze", () => {
    expect(checkValues("priority")).toEqual([...PARTNER_PRIORITIES]);
    expect(checkValues("preferred_channel")).toEqual([...PARTNER_CHANNELS]);
    expect(checkValues("language")).toEqual([...PARTNER_LANGUAGES]);
    expect(checkValues("lookbook_code")).toEqual([...PARTNER_LOOKBOOK_CODES]);
    expect(checkValues("message_kind")).toEqual([...PARTNER_MESSAGE_KINDS]);
    expect(migration).toContain(
      `kind text not null check (kind in (${PARTNER_CONTACT_KINDS.map((k) => `'${k}'`).join(", ")}))`,
    );
    expect(migration).toContain(
      `sections <@ array[${PARTNER_SECTIONS.map((s) => `'${s}'`).join(", ")}]::text[]`,
    );
    for (const kind of PARTNER_ACTIVITY_KINDS) expect(migration).toContain(`'${kind}'`);
    expect(migration).toContain(
      `channel text check (channel in (${PARTNER_ACTIVITY_CHANNELS.map((c) => `'${c}'`).join(", ")}))`,
    );
    expect(migration).toContain(
      `channel text not null check (channel in (${PARTNER_VARIANT_CHANNELS.map((c) => `'${c}'`).join(", ")}))`,
    );
    for (const field of PARTNER_DIFFERENCE_FIELDS) expect(migration).toContain(`'${field}'`);
  });

  it("etichette italiane per sezioni, priorità, canali e registro", () => {
    expect(PARTNER_SECTIONS.map((s) => PARTNER_SECTION_LABELS[s])).toEqual([
      "Vendita",
      "Eventi",
      "Collab",
    ]);
    expect(PARTNER_PRIORITIES.map((p) => PARTNER_PRIORITY_LABELS[p])).toEqual([
      "Priorità alta",
      "Priorità media",
      "Riserva",
    ]);
    expect(PARTNER_ACTIVITY_CHANNEL_LABELS.dm).toBe("Instagram");
    expect(PARTNER_ACTIVITY_CHANNEL_LABELS.form).toBe("modulo del sito");
    expect(PARTNER_LANGUAGE_LABELS.de).toBe("in tedesco");
    for (const kind of PARTNER_ACTIVITY_KINDS)
      expect(PARTNER_ACTIVITY_KIND_LABELS[kind].length).toBeGreaterThan(2);
    expect(formatCo(7)).toBe("CO 007");
    expect(formatCo(1234)).toBe("CO 1234");
  });
});

describe("parser delle righe", () => {
  it("legge una riga valida e mette le sezioni nell'ordine canonico", () => {
    const partner = parsePartnerSummary(partnerRow());
    expect(partner).toMatchObject({
      co: 7,
      sections: ["vendita", "collab"],
      stage: "contattato",
      route: "Email al titolare.",
      followers: "",
      version: 3,
    });
  });

  it("rifiuta CO fuori limite, sezioni vuote, stato sconosciuto, origine incoerente", () => {
    for (const fields of [
      { co: 0 },
      { co: 100000 },
      { co: "7" },
      { sections: [] },
      { sections: ["vendita", "vendita"] },
      { sections: ["negozi"] },
      { stage: "perso" },
      { origin: "team" },
      { source_key: null },
      { contact_month: "2026-11-15" },
      { event_ends_on: "2026-11-02" },
      { event_starts_on: "2026-11-03", event_ends_on: "2026-11-02" },
      { next_action: "sollecito" },
      { name: " Spazi " },
      { version: 0 },
      { owner_id: "non-un-id" },
    ])
      expect(() => parsePartnerSummary(partnerRow(fields)), JSON.stringify(fields)).toThrow(
        PartnerReadError,
      );
    expect(() => parsePartnerSummary(null)).toThrow(PartnerReadError);
  });

  it("research deve essere un oggetto; i campi strani valgono vuoti, le fonti solo http(s)", () => {
    const row = (research: unknown) => ({
      ...partnerRow(),
      research,
      created_at: at,
      created_by: null,
    });
    for (const research of [null, [], "testo", 3])
      expect(() => parsePartnerDetailRow(row(research))).toThrow(PartnerReadError);
    const detail = parsePartnerDetailRow(
      row({
        why: "Perché sì.",
        idea: { vendita: "Vetrina.", altro: "x", eventi: 4 },
        hero: ["a", 2],
        route: "Email.",
        followers: 12,
        sources: ["https://fonte.example.test/a", "javascript:alert(1)", "ftp://x.example.test"],
        extra: [{ name: "Edizione", route: "Stesso modulo." }, "x"],
        skipped_it: "Media: no.",
      }),
    );
    expect(detail.research).toMatchObject({
      why: "Perché sì.",
      idea: { vendita: "Vetrina." },
      hero: ["a"],
      followers: "",
      sources: ["https://fonte.example.test/a"],
      extra: [
        { section: "", name: "Edizione", when: "", route: "Stesso modulo.", application: "" },
      ],
      skippedIt: "Media: no.",
    });
    expect(detail.route).toBe("Email.");
  });

  it("recapiti cancellati senza valore, revisioni e registro coerenti", () => {
    const contact = {
      id: id(10),
      partner_id: id(1),
      kind: "phone",
      value: null,
      link_value: null,
      label: "",
      verified: false,
      active: false,
      position: 0,
      version: 2,
      research_slot: "phone",
      erased_at: at,
      created_at: at,
    };
    expect(parsePartnerContact(contact).erasedAt).toBe(at);
    expect(() => parsePartnerContact({ ...contact, value: "+39 000 000 0001" })).toThrow();
    expect(() => parsePartnerContact({ ...contact, active: true })).toThrow();
    expect(() => parsePartnerContactLink({ ...contact, kind: "fax" })).toThrow();
    const revision = {
      id: id(20),
      variant_id: id(21),
      revision_no: 1,
      kind: "restore",
      subject: null,
      body: null,
      follow_up: null,
      confirm_email: null,
      file_exported_at: null,
      created_by: id(901),
      created_at: at,
    };
    expect(parsePartnerRevision(revision).texts).toBeNull();
    expect(() => parsePartnerRevision({ ...revision, subject: "x" })).toThrow();
    expect(() => parsePartnerRevision({ ...revision, kind: "file" })).toThrow();
    expect(parsePartnerActivity(activityRow()).kind).toBe("inviato");
    expect(() => parsePartnerActivity(activityRow({ message_kind: null }))).toThrow();
    expect(() => parsePartnerActivity(activityRow({ kind: "nota" }))).toThrow();
    expect(() => parsePartnerActivity(activityRow({ channel: "ig" }))).toThrow();
  });

  it("differenze, blocchi, import e varianti", () => {
    const difference = {
      id: id(30),
      partner_id: id(1),
      origin: "file",
      field: "stage",
      variant_id: null,
      contact_id: null,
      team_value: "risposto",
      incoming_value: "trattativa",
      created_at: at,
      device_import_id: id(31),
    };
    expect(parsePartnerDifference(difference)).toMatchObject({
      teamValue: "risposto",
      deviceImportId: id(31),
    });
    expect(() => parsePartnerDifference({ ...difference, device_import_id: null })).toThrow();
    expect(() => parsePartnerOpenDifference({ ...difference, field: "message" })).toThrow();
    expect(() =>
      parsePartnerBlock({
        id: id(32),
        partner_id: null,
        domain: null,
        reason: "Motivo.",
        created_at: at,
      }),
    ).toThrow();
    expect(() =>
      parsePartnerBlock({
        id: id(32),
        partner_id: id(1),
        domain: null,
        reason: "  ",
        created_at: at,
      }),
    ).toThrow();
    const imported = {
      id: id(33),
      source_commit: "f00ba12",
      source_generated: "2026-10-21",
      applied_at: at,
      partners_total: 6,
      partners_new: 6,
      partners_updated: 0,
      partners_removed: 0,
      variants_total: 8,
      differences_new: 0,
    };
    expect(parsePartnerResearchImport(imported).sourceCommit).toBe("f00ba12");
    expect(() => parsePartnerResearchImport({ ...imported, source_commit: "main" })).toThrow();
    expect(
      researchImportLine(
        parsePartnerResearchImport({ ...imported, applied_at: "2026-10-23T08:00:00Z" }),
        "2026-10-23",
      ),
    ).toBe("Ricerca del 21 ottobre 2026, importata il 23 ottobre (commit f00ba12).");
    const variant = {
      id: id(34),
      partner_id: id(1),
      approach: "collab",
      channel: "email",
      language: "en",
      lookbook_code: null,
      current_revision_id: null,
      original_changed_at: at,
      research_removed_at: null,
      version: 1,
    };
    expect(() => parsePartnerVariantSummary(variant)).toThrow();
    expect(parsePartnerVariantSummary({ ...variant, original_changed_at: null }).edited).toBe(
      false,
    );
  });
});

describe("testi derivati", () => {
  it("righe del registro come in spec 02 §5.7", () => {
    const sent = parsePartnerActivity(activityRow());
    expect(partnerActivityLine(sent, members)).toBe(
      "22 ott · Ada Prova · Inviato via email (Collab)",
    );
    const followUp = parsePartnerActivity(activityRow({ message_kind: "sollecito" }));
    expect(partnerActivityText(followUp)).toBe("Sollecito inviato via email (Collab)");
    const fromFile = {
      ...parsePartnerActivity(
        activityRow({
          origin: "file",
          occurred_at: "2026-10-20T17:30:00Z",
          channel: null,
          approach: null,
        }),
      ),
      device: "telefono" as const,
    };
    expect(partnerActivityLine(fromFile, members)).toBe(
      "20 ott · dal file del telefono · Contattato",
    );
    const meeting = parsePartnerActivity(
      activityRow({ kind: "incontro", message_kind: null, channel: "visita", approach: null }),
    );
    expect(partnerActivityText(meeting)).toBe("Incontro di persona");
    const owner = parsePartnerActivity(
      activityRow({
        kind: "responsabile",
        message_kind: null,
        channel: null,
        approach: null,
        stage_before: null,
        stage_after: null,
        owner_after: id(901),
      }),
    );
    expect(partnerActivityText(owner, members)).toBe("Seguito da Ada Prova");
    expect(partnerActivityText({ ...owner, ownerAfter: id(999) }, members)).toBe(
      "Seguito da un ex membro",
    );
    const state = parsePartnerActivity(
      activityRow({
        kind: "stato",
        message_kind: null,
        channel: null,
        approach: null,
        stage_after: "risposto",
        stage_before: "contattato",
      }),
    );
    expect(partnerActivityText(state)).toBe("Stato: Ha risposto");
    const next = parsePartnerActivity(
      activityRow({
        kind: "prossima_azione",
        message_kind: null,
        channel: null,
        approach: null,
        stage_before: null,
        stage_after: null,
        next_action_on: "2026-10-29",
      }),
    );
    expect(partnerActivityText(next)).toBe("Prossima azione: 29 ott");
  });

  it("un «inviato» degli ultimi 10 minuti chiede conferma", () => {
    const sent = parsePartnerActivity(activityRow());
    expect(recentSentActivity([sent], new Date("2026-10-22T08:50:00Z"))).toBe(sent);
    expect(recentSentActivity([sent], new Date("2026-10-22T08:53:00Z"))).toBeNull();
    expect(recentSentActivity([sent], new Date("2026-10-22T08:50:00Z"), "sollecito")).toBeNull();
    expect(recentSentQuestion(sent, members)).toBe(
      "Già segnato inviato alle 10:42 da Ada Prova. Segnare di nuovo?",
    );
  });

  it("varianti visibili, messaggi pronti, motivo breve", () => {
    expect(isVisibleVariant({ researchRemovedAt: at, edited: false })).toBe(false);
    expect(isVisibleVariant({ researchRemovedAt: at, edited: true })).toBe(true);
    expect(isVisibleVariant({ researchRemovedAt: null, currentRevisionId: null })).toBe(true);
    expect([0, 1, 3].map(readyMessagesLabel)).toEqual([
      null,
      "Messaggio pronto",
      "3 messaggi pronti",
    ]);
    expect(shortReason("Ha chiesto di non ricevere proposte. Rispettiamo la richiesta.")).toBe(
      "Ha chiesto di non ricevere proposte.",
    );
    const long = shortReason("Motivo lunghissimo ".repeat(10));
    expect(long.endsWith("…")).toBe(true);
    expect([...long].length).toBeLessThanOrEqual(60);
    expect(memberName(members, null)).toBe("Nessuno");
  });
});
