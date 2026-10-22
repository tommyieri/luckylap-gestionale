// Partner: dati sintetici per l'anteprima locale e per i test (00-sequenza §1.5).
//
// Sei contatti inventati come quelli di supabase/tests/fixtures/partner: domini example.test,
// numeri +39 000 000 00xx, nomi di persone di fantasia. Le righe hanno la forma delle tabelle e
// passano dagli stessi parser della lettura vera (read.ts). Mesi e date sono calcolati da oggi,
// così l'anteprima mostra sempre tutti e cinque i periodi. Nessuna chiamata a Supabase.
import { isLocalPreviewEnabled } from "../runtime";
import { partnerLinkValue } from "./contacts";
import { addDays, addMonths, romeDay } from "./dates";
import {
  type PartnerContactKind,
  type PartnerDetail,
  type PartnerSummary,
  type PartnerWorkspace,
} from "./model";
import {
  partnerDataFromRows,
  partnerDetailFromRows,
  partnerRulesFromRow,
  partnerWorkspaceFromRows,
  type PartnerDataSnapshot,
  type PartnerRules,
} from "./read";

export const partnerFixtureId = (n: number) =>
  `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** Il membro dell'anteprima: «Seguiti da me» mostra i suoi contatti. */
export const PARTNER_FIXTURE_MEMBER_ID = partnerFixtureId(901);

const MEMBERS = [
  [901, "Ada Prova"],
  [902, "Bruno Prova"],
  [903, "Carla Prova"],
  [904, "Dario Prova"],
  [905, "Elena Prova"],
] as const;

const at = (day: string, time = "09:00:00") => `${day}T${time}.000Z`;

type Spec = {
  n: number;
  sourceKey: string;
  name: string;
  city: string;
  country: string;
  typeLabel: string;
  sections: string[];
  priority: string;
  monthOffset: number;
  preferredChannel: string;
  stage: string;
  research: Record<string, unknown>;
  contacts: [PartnerContactKind, string, boolean?][];
};

const SPECS: Spec[] = [
  {
    n: 1,
    sourceKey: "L001",
    name: "Garage Sintetico Uno",
    city: "Monaco",
    country: "Germania",
    typeLabel: "Concept store car-culture",
    sections: ["vendita", "collab"],
    priority: "alta",
    monthOffset: 0,
    preferredChannel: "email",
    stage: "contattato",
    research: {
      why: "Negozio sintetico di prova con clienti appassionati di auto storiche.",
      idea: {
        vendita: "Conto vendita di sei magliette in vetrina.",
        collab: "Una maglietta in edizione limitata con il loro logo.",
      },
      pitch: "Testo di prova: magliette disegnate per chi frequenta il garage.",
      hero: [],
      when: "Prima delle feste: ordinano a novembre.",
      route: "Email al titolare. Poi una telefonata dopo una settimana.",
      lang: "tedesco",
      flags: "Chiuso il lunedì.",
      sources: ["https://www.garage-uno.example.test/chi-siamo"],
      score: 9,
      eu: true,
    },
    contacts: [
      ["email", "info@garage-uno.example.test", true],
      ["phone", "Sede +39 000 000 0001; Magazzino +39 000 000 0002"],
      ["instagram", "@garage_uno"],
      ["web", "https://www.garage-uno.example.test/"],
    ],
  },
  {
    n: 2,
    sourceKey: "L002",
    name: "Raduno Sintetico Due",
    city: "Zandvoort",
    country: "Paesi Bassi",
    typeLabel: "Evento in circuito",
    sections: ["eventi"],
    priority: "alta",
    monthOffset: 1,
    preferredChannel: "form",
    stage: "da_contattare",
    research: {
      description: "Raduno di tre giorni con pista aperta e area espositori.",
      why: "Raduno sintetico di prova con area espositori.",
      idea: { eventi: "Banco con le magliette durante il raduno." },
      hero: ["Area espositori vicino ai box"],
      when: "Iscrizioni espositori aperte fino a metà mese.",
      route:
        "Modulo espositori su https://raduno-due.example.test/espositori. Poi una email allo staff.",
      date_note: "Iscrizioni espositori entro dieci giorni dall'evento.",
      application: "Modulo online con conferma via email.",
      followers: "12k su Instagram",
      lang: "English",
      sources: ["https://raduno-due.example.test/programma", "javascript:alert(1)"],
      extra: [
        {
          section: "eventi",
          name: "Edizione di primavera",
          when: "Maggio",
          route: "Stesso modulo.",
          application: "Apre a febbraio.",
        },
      ],
    },
    contacts: [
      [
        "email",
        "info@raduno-due.example.test, stampa@raduno-due.example.test; booking@raduno-due.example.test",
      ],
      ["instagram", "@radunodue (circa 12k follower, profilo ufficiale)"],
      ["form", "https://raduno-due.example.test/espositori"],
      ["web", "https://raduno-due.example.test"],
    ],
  },
  {
    n: 3,
    sourceKey: "n003",
    name: "Club Registro Tre",
    city: "Torino",
    country: "Italia",
    typeLabel: "Club e registri",
    sections: ["collab"],
    priority: "media",
    monthOffset: 2,
    preferredChannel: "phone",
    stage: "risposto",
    research: {
      why: "Club sintetico di prova con un registro di auto storiche.",
      idea: { collab: "Maglietta per il raduno annuale del club." },
      pitch: "Testo di prova per il club.",
      when: "Il direttivo si riunisce a gennaio.",
      route: "Telefonata in segreteria. Poi WhatsApp.",
      lang: "italiano",
      sources: ["https://club-tre.example.test/storia"],
    },
    contacts: [
      ["phone", "+39 000 000 0003"],
      ["whatsapp", "+39 000 000 0004"],
      ["instagram", "https://www.instagram.com/club_registro_tre/"],
      ["web", "https://club-tre.example.test/"],
    ],
  },
  {
    n: 4,
    sourceKey: "n004",
    name: "Creator Sintetico Quattro",
    city: "",
    country: "Regno Unito",
    typeLabel: "Creator",
    sections: ["eventi", "collab"],
    priority: "media",
    monthOffset: 4,
    preferredChannel: "ig",
    stage: "da_contattare",
    research: {
      why: "Creator sintetico di prova che racconta raduni e gare.",
      idea: { collab: "Una maglietta firmata.", eventi: "Presenza a un raduno insieme." },
      when: "Prepara i contenuti dell'anno a febbraio.",
      route: "Messaggio su Instagram. Poi email allo studio.",
      followers: "48k su Instagram",
      flags: "Risponde solo ai messaggi brevi.",
      sources: ["https://quattro.example.test/about"],
      skipped_it: "Vendita: non ha un negozio.",
    },
    contacts: [
      ["email", "studio@quattro.example.test"],
      ["instagram", "@creator.quattro."],
      ["brand_page", "https://brand.example.test/quattro"],
      ["web", "https://quattro.example.test/"],
    ],
  },
  {
    n: 5,
    sourceKey: "n005",
    name: "テスト商店 Garage Cinque",
    city: "Tokyo",
    country: "Giappone",
    typeLabel: "Shop online curato",
    sections: ["vendita"],
    priority: "bassa",
    monthOffset: 6,
    preferredChannel: "web",
    stage: "da_contattare",
    research: {
      why: "Negozio online sintetico di prova.",
      idea: { vendita: "Una piccola selezione nello shop online." },
      when: "Dopo le prime vendite in Europa.",
      route: "Solo dal sito.",
      lang: "Giapponese (inglese accettabile)",
      sources: ["https://cinque.example.test/shop"],
    },
    contacts: [["web", "https://cinque.example.test/shop"]],
  },
  {
    n: 6,
    sourceKey: "L006",
    name: "Porsche Club Sintetico Sei",
    city: "Stoccarda",
    country: "Germania",
    typeLabel: "Club e registri",
    sections: ["vendita", "eventi", "collab"],
    priority: "bassa",
    monthOffset: 9,
    preferredChannel: "email",
    stage: "trattativa",
    research: {
      why: "Club sintetico di prova con un raduno estivo.",
      idea: {
        vendita: "Magliette nel negozio del club.",
        eventi: "Banco al raduno estivo.",
        collab: "Maglietta del raduno.",
      },
      pitch: "Testo di prova per il club.",
      when: "Il raduno è in estate.",
      route: "Email alla segreteria.",
      date_note: "Date da confermare.",
      lang: "tedesco",
    },
    contacts: [
      ["email", "segreteria@club-sei.example.test", true],
      ["phone", "solo su appuntamento"],
      ["web", "sito in costruzione"],
    ],
  },
];

type VariantSpec = {
  n: number;
  partner: number;
  approach: string;
  channel: string;
  language: string;
  lookbook: string | null;
  subject: string;
  body: string;
  followUp: string;
  confirmEmail?: string;
  gist: string;
  notes?: string;
  formFields?: string;
};
const VARIANTS: VariantSpec[] = [
  {
    n: 201,
    partner: 1,
    approach: "vendita",
    channel: "email",
    language: "de",
    lookbook: "negozi",
    subject: "LuckyLap im Garage Sintetico Uno",
    body: "Hallo,\n\nwir sind LuckyLap, ein synthetischer Testtext.\n\nViele Grüße",
    followUp: "Hallo, eine kurze Nachfrage zu unserer letzten Nachricht.",
    gist: "Proposta di conto vendita per il negozio.",
    notes: "Allegare il lookbook Stockists.",
  },
  {
    n: 202,
    partner: 1,
    approach: "collab",
    channel: "email",
    language: "en",
    lookbook: "collab",
    subject: "A shirt together",
    body: "Hello,\n\nthis is a synthetic test message about a collaboration.\n\nBest regards",
    followUp: "Hello again, a short follow-up.",
    gist: "Maglietta in collaborazione.",
  },
  {
    n: 203,
    partner: 2,
    approach: "evento",
    channel: "form",
    language: "en",
    lookbook: "eventi",
    subject: "Exhibitor request: LuckyLap",
    body: "Hello,\n\nthis is a synthetic exhibitor request for a small stand.\n\nBest regards",
    followUp: "Hello, a short follow-up on our exhibitor request.",
    confirmEmail: "Thank you for confirming our stand (synthetic text).",
    gist: "Richiesta di uno stand.",
    notes: "Il modulo chiede la misura dello stand.",
    formFields: "Nome, azienda, email, tipo di stand.",
  },
  {
    n: 204,
    partner: 3,
    approach: "collab",
    channel: "phone",
    language: "it",
    lookbook: "club",
    subject: "",
    body: "Cosa dire al telefono: presentare LuckyLap e proporre una maglietta per il raduno (testo sintetico).",
    followUp: "Richiamare dopo una settimana.",
    gist: "Telefonata al club.",
    notes: "Chiedere del presidente.",
  },
  ...(
    [
      [205, "vendita", "de", "negozi", "Shirts für den Club-Shop"],
      [206, "evento", "de", "porsche_club", "Ein Stand beim Sommertreffen"],
      [207, "su_misura", "de", "porsche_club", "Ein eigenes Shirt für den Club"],
      [208, "media", "en", null, "A story for the club magazine"],
    ] as const
  ).map(([n, approach, language, lookbook, subject]) => ({
    n,
    partner: 6,
    approach,
    channel: "email",
    language,
    lookbook,
    subject,
    body:
      language === "de"
        ? "Hallo,\n\nsynthetischer Text für den Club.\n\nViele Grüße"
        : "Hello,\n\nsynthetic text for the club.\n\nBest regards",
    followUp: language === "de" ? "Hallo, eine kurze Nachfrage." : "Hello, a short follow-up.",
    gist: "Proposta sintetica per il club.",
  })),
];

/** Righe sintetiche con la forma delle tabelle Partner. */
export function partnerFixtureRows(today: string) {
  const id = partnerFixtureId;
  const author = (n: number) => id(MEMBERS[(n - 1) % MEMBERS.length][0]);
  const yesterday = addDays(today, -1);
  const eventStart = addDays(today, 34);
  const partners = SPECS.map((spec) => ({
    id: id(spec.n),
    co: spec.n,
    source_key: spec.sourceKey,
    origin: "research",
    name: spec.name,
    city: spec.city,
    country: spec.country,
    type_label: spec.typeLabel,
    sections: spec.sections,
    priority: spec.priority,
    contact_month: addMonths(today, spec.monthOffset),
    event_starts_on:
      spec.n === 2 ? eventStart : spec.n === 6 ? addDays(addMonths(today, 9), 9) : null,
    event_ends_on:
      spec.n === 2
        ? addDays(eventStart, 2)
        : spec.n === 6
          ? addDays(addMonths(today, 9), 11)
          : null,
    application_deadline: spec.n === 2 ? addDays(today, 20) : null,
    preferred_channel: spec.preferredChannel,
    research_removed_at: spec.n === 5 ? at(yesterday, "07:00:00") : null,
    stage: spec.stage,
    stage_from_file_at: null,
    owner_id: spec.n === 1 ? id(901) : spec.n === 3 ? id(902) : spec.n === 6 ? id(903) : null,
    next_action: spec.n === 1 ? "sollecito" : null,
    next_action_on: spec.n === 1 ? addDays(today, -2) : null,
    chosen_approach: spec.n === 1 ? "vendita" : null,
    approach_from_file_at: null,
    version: spec.n === 1 ? 4 : 2,
    updated_at: at(yesterday),
    created_at: at(addDays(today, -7)),
    created_by: null,
    research: spec.research,
    route: (spec.research.route as string | undefined) ?? null,
    followers: (spec.research.followers as string | undefined) ?? null,
  }));
  let contactNumber = 100;
  const contacts = SPECS.flatMap((spec) =>
    spec.contacts.map(([kind, value, verified], position) => ({
      id: id((contactNumber += 1)),
      partner_id: id(spec.n),
      kind,
      value,
      link_value: partnerLinkValue(kind, value),
      label: "",
      verified: verified === true,
      active: true,
      position,
      version: 1,
      research_slot: kind,
      erased_at: null,
      created_at: at(addDays(today, -7)),
    })),
  );
  const editedAt = at(yesterday, "15:20:00");
  const variants = VARIANTS.map((variant) => ({
    id: id(variant.n),
    partner_id: id(variant.partner),
    approach: variant.approach,
    origin: "research",
    channel: variant.channel,
    language: variant.language,
    to_text:
      variant.partner === 2
        ? "https://raduno-due.example.test/espositori"
        : variant.partner === 3
          ? "+39 000 000 0003"
          : variant.partner === 1
            ? "info@garage-uno.example.test"
            : "segreteria@club-sei.example.test",
    cc_text: "",
    lookbook_code: variant.lookbook,
    original_subject: variant.subject,
    original_body: variant.body,
    original_follow_up: variant.followUp,
    original_confirm_email: variant.confirmEmail ?? "",
    gist_it: variant.gist,
    notes_it: variant.notes ?? "",
    form_fields_it: variant.formFields ?? "",
    current_revision_id: variant.n === 202 ? id(302) : null,
    original_changed_at: variant.n === 202 ? at(today, "07:00:00") : null,
    research_removed_at: null,
    version: variant.n === 202 ? 4 : 1,
  }));
  const revisions = [
    {
      id: id(301),
      variant_id: id(202),
      revision_no: 1,
      kind: "edit",
      subject: "A shirt together, made in Italy",
      body: "Hello,\n\nthis is a synthetic message edited by the team.\n\nBest regards",
      follow_up: "Hello again, a short follow-up.",
      confirm_email: "",
      file_exported_at: null,
      created_by: id(902),
      created_at: at(addDays(today, -3), "11:00:00"),
    },
    {
      id: id(302),
      variant_id: id(202),
      revision_no: 2,
      kind: "edit",
      subject: "A shirt together, made in Italy",
      body: "Hello,\n\nthis is a synthetic message edited twice by the team.\n\nBest regards",
      follow_up: "Hello again, a short follow-up.",
      confirm_email: "",
      file_exported_at: null,
      created_by: id(901),
      created_at: editedAt,
    },
  ];
  const fileOperation = id(601);
  const deviceImports = [
    {
      id: id(501),
      operation_id: fileOperation,
      device: "telefono",
      exported_at: at(addDays(today, -4), "18:30:00"),
      stages_applied: 1,
      texts_applied: 0,
      approaches_applied: 0,
      differences: 1,
      ignored: 0,
      unknown: 0,
      imported_by: id(901),
      imported_at: at(addDays(today, -1), "10:00:00"),
    },
  ];
  const activity = (
    n: number,
    partner: number,
    fields: Record<string, unknown>,
    day: string,
    time: string,
  ) => ({
    id: id(n),
    operation_id: id(n + 1000),
    partner_id: id(partner),
    partner_name: SPECS[partner - 1].name,
    partner_co: partner,
    kind: "nota",
    origin: "team",
    occurred_at: at(day, time),
    message_kind: null,
    channel: null,
    approach: null,
    stage_before: null,
    stage_after: null,
    owner_after: null,
    next_action_on: null,
    body: "",
    created_by: author(1),
    created_at: at(day, time),
    ...fields,
  });
  const activities = [
    activity(
      401,
      1,
      {
        kind: "inviato",
        message_kind: "primo",
        channel: "email",
        approach: "vendita",
        stage_before: "da_contattare",
        stage_after: "contattato",
      },
      addDays(today, -5),
      "08:40:00",
    ),
    activity(
      402,
      1,
      { kind: "responsabile", owner_after: id(901) },
      addDays(today, -5),
      "08:41:00",
    ),
    activity(
      403,
      1,
      { kind: "prossima_azione", next_action_on: addDays(today, -2) },
      addDays(today, -5),
      "08:42:00",
    ),
    activity(
      404,
      1,
      { kind: "messaggio", approach: "collab", channel: "email", created_by: id(902) },
      addDays(today, -3),
      "11:00:00",
    ),
    activity(
      405,
      1,
      { kind: "messaggio", approach: "collab", channel: "email" },
      yesterday,
      "15:20:00",
    ),
    {
      ...activity(
        406,
        3,
        {
          kind: "inviato",
          origin: "file",
          message_kind: "primo",
          channel: "phone",
          approach: "collab",
          stage_before: "da_contattare",
          stage_after: "contattato",
        },
        addDays(today, -4),
        "18:30:00",
      ),
      operation_id: fileOperation,
      created_at: at(addDays(today, -1), "10:00:00"),
    },
    activity(
      407,
      3,
      {
        kind: "risposta",
        channel: "phone",
        stage_before: "contattato",
        stage_after: "risposto",
        created_by: id(902),
      },
      addDays(today, -1),
      "12:00:00",
    ),
    activity(
      408,
      3,
      { kind: "nota", body: "Il presidente richiama la prossima settimana.", created_by: id(902) },
      addDays(today, -1),
      "12:05:00",
    ),
  ];
  const differences = [
    {
      id: id(701),
      partner_id: id(1),
      origin: "research",
      field: "message",
      variant_id: id(202),
      contact_id: null,
      team_value: {
        subject: revisions[1].subject,
        body: revisions[1].body,
        follow_up: revisions[1].follow_up,
        confirm_email: "",
      },
      incoming_value: {
        subject: "A shirt together",
        body: "Hello,\n\nthis is the new synthetic original from the research.\n\nBest regards",
        follow_up: "Hello again, a short follow-up.",
        confirm_email: "",
      },
      created_at: at(today, "07:00:00"),
      device_import_id: null,
    },
    {
      id: id(702),
      partner_id: id(3),
      origin: "file",
      field: "stage",
      variant_id: null,
      contact_id: null,
      team_value: "risposto",
      incoming_value: "trattativa",
      created_at: at(addDays(today, -1), "10:00:00"),
      device_import_id: id(501),
    },
  ];
  const blocks = [
    {
      id: id(801),
      partner_id: id(4),
      domain: null,
      reason: "Ha chiesto di non ricevere proposte commerciali. Rispettiamo la richiesta.",
      created_at: at(addDays(today, -6)),
    },
  ];
  const imports = [
    {
      id: id(851),
      source_commit: "0a1b2c3d",
      source_generated: addDays(today, -2),
      applied_at: at(yesterday, "07:00:00"),
      partners_total: 6,
      partners_new: 6,
      partners_updated: 0,
      partners_removed: 1,
      variants_total: 8,
      differences_new: 1,
      context_md: PARTNER_FIXTURE_CONTEXT,
    },
  ];
  const profiles = MEMBERS.map(([n, name]) => ({ user_id: id(n), display_name: name }));
  const memberships = MEMBERS.map(([n]) => ({ user_id: id(n), active: true }));
  return {
    partners,
    contacts,
    variants,
    revisions,
    activities,
    differences,
    blocks,
    imports,
    deviceImports,
    profiles,
    memberships,
  };
}

export const PARTNER_FIXTURE_CONTEXT = `# Regole sintetiche per i messaggi

Testo di prova per l'anteprima locale: le regole vere arrivano con l'import della ricerca.

## Tono

- Frasi brevi, niente superlativi.
- Una sola proposta per messaggio.

## Firma

| Lingua | Firma |
| --- | --- |
| it | Il team LuckyLap |
| en | The LuckyLap team |
`;

export function partnerFixtureWorkspace(today: string): PartnerWorkspace {
  const rows = partnerFixtureRows(today);
  return partnerWorkspaceFromRows({
    partners: rows.partners,
    contacts: rows.contacts,
    variants: rows.variants,
    differences: rows.differences,
    blocks: rows.blocks,
    profiles: rows.profiles,
    memberships: rows.memberships,
    lastImport: rows.imports[0],
  });
}

export function partnerFixtureDetail(co: number, today: string): PartnerDetail | null {
  const rows = partnerFixtureRows(today);
  const partner = rows.partners.find((item) => item.co === co);
  if (!partner) return null;
  const mine = <T extends { partner_id: string | null }>(items: T[]) =>
    items.filter((item) => item.partner_id === partner.id);
  const variants = mine(rows.variants);
  const activities = mine(rows.activities);
  return partnerDetailFromRows(co, {
    partner,
    contacts: mine(rows.contacts),
    variants,
    revisions: variants.map((variant) => {
      const list = rows.revisions.filter((revision) => revision.variant_id === variant.id);
      return { variantId: variant.id, rows: list, count: list.length };
    }),
    currentRevisions: [],
    activities,
    activityCount: activities.length,
    differences: mine(rows.differences),
    blocks: mine(rows.blocks),
    deviceImports: rows.deviceImports,
  });
}

export function partnerFixtureData(today: string): PartnerDataSnapshot {
  const rows = partnerFixtureRows(today);
  return partnerDataFromRows({
    imports: rows.imports,
    deviceImports: rows.deviceImports,
    openDifferences: rows.differences.length,
    profiles: rows.profiles,
    memberships: rows.memberships,
  });
}

export function partnerFixtureRules(today: string): PartnerRules | null {
  return partnerRulesFromRow(partnerFixtureRows(today).imports[0]);
}

type PreviewEnvironment = Parameters<typeof isLocalPreviewEnabled>[0];

/**
 * Anteprima locale di /partner: dati sintetici solo con `isLocalPreviewEnabled()`, mai su
 * Vercel né con NODE_ENV=production. `null` vuol dire: leggi dal database come sempre.
 */
export function partnerLocalPreview(
  now: Date = new Date(),
  environment?: PreviewEnvironment,
): { today: string; memberId: string; workspace: PartnerWorkspace } | null {
  if (!isLocalPreviewEnabled(environment)) return null;
  const today = romeDay(now);
  return { today, memberId: PARTNER_FIXTURE_MEMBER_ID, workspace: partnerFixtureWorkspace(today) };
}

/** Una scheda sintetica per i test, con i campi da cambiare. */
export function partnerSummaryFixture(overrides: Partial<PartnerSummary> = {}): PartnerSummary {
  const co = overrides.co ?? 1;
  return {
    id: partnerFixtureId(co),
    co,
    sourceKey: `T${String(co).padStart(3, "0")}`,
    origin: "research",
    name: `Contatto sintetico ${co}`,
    city: "Città di prova",
    country: "Italia",
    typeLabel: "Negozio",
    sections: ["vendita"],
    priority: "media",
    contactMonth: "2026-10-01",
    eventStartsOn: null,
    eventEndsOn: null,
    applicationDeadline: null,
    preferredChannel: "email",
    researchRemovedAt: null,
    stage: "da_contattare",
    stageFromFileAt: null,
    ownerId: null,
    nextAction: null,
    nextActionOn: null,
    chosenApproach: null,
    approachFromFileAt: null,
    version: 1,
    updatedAt: "2026-10-21T09:00:00.000Z",
    route: "",
    followers: "",
    ...overrides,
  };
}

export { PARTNER_PREVIEW_NOTICE } from "./model";
