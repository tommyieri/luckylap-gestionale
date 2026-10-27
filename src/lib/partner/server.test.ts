import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import {
  PARTNER_ASSISTANT_INACTIVE,
  type PartnerAssistantContactView,
  type PartnerAssistantStatus,
} from "./assistant";
import { partnerAssistantFixtureRows, partnerFixtureId, partnerFixtureRows } from "./fixtures";
import {
  PARTNER_DETAIL_ACTIVITY_LIMIT,
  PARTNER_DETAIL_REVISION_LIMIT,
  PartnerUnavailableError,
  executePartnerCommand,
  loadPartnerAssistantRules,
  loadPartnerAssistantStatus,
  loadPartnerData,
  loadPartnerDetail,
  loadPartnerIdsByCo,
  loadPartnerRules,
  loadPartnerWorkspace,
  previewPartnerDeviceFile,
} from "./server";

// Letture complete o niente, membro verificato prima di ogni comando (spec 02 §6, §7.1).
const TODAY = "2026-10-22";
const NOW = new Date("2026-10-22T10:00:00Z");
const MEMBER = partnerFixtureId(901);
type Row = Record<string, unknown>;
type Call = { table: string; columns: string; head: boolean; ops: [string, ...unknown[]][] };

function project(row: Row, columns: string): Row {
  const result: Row = {};
  for (const column of columns.split(",")) {
    const alias = /^(\w+):(\w+)->>(\w+)$/.exec(column);
    if (alias) {
      const json = row[alias[2]] as Row | null;
      const value = json?.[alias[3]];
      result[alias[1]] = typeof value === "string" ? value : null;
    } else result[column] = row[column];
  }
  return result;
}

function fakeSupabase(
  tables: Record<string, Row[]>,
  options: {
    user?: string | null;
    rpc?: (name: string, args: Record<string, unknown>) => unknown;
    failTable?: string;
    /** Codice dell'errore di `failTable` (PostgREST o PostgreSQL); senza, solo il messaggio. */
    failCode?: string;
    /** Toglie una riga dalla prima pagina di questa tabella, lasciando il conteggio. */
    truncate?: string;
  } = {},
) {
  const calls: Call[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const order: string[] = [];
  const client = {
    auth: {
      getUser: async () => {
        order.push("getUser");
        const user = options.user === undefined ? MEMBER : options.user;
        return { data: { user: user ? { id: user } : null }, error: null };
      },
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      order.push(`rpc:${name}`);
      rpcCalls.push({ name, args });
      const result = options.rpc?.(name, args);
      if (result instanceof Error) throw result;
      return result ?? { data: null, error: null };
    },
    from(table: string) {
      const call: Call = { table, columns: "", head: false, ops: [] };
      calls.push(call);
      const filters: ((row: Row) => boolean)[] = [];
      const sorts: [string, boolean][] = [];
      let limit = Infinity;
      let single = false;
      let count = false;
      const query = {
        select(columns: string, opts?: { count?: string; head?: boolean }) {
          call.columns = columns;
          call.head = opts?.head === true;
          count = opts?.count === "exact";
          return query;
        },
        eq(column: string, value: unknown) {
          call.ops.push(["eq", column, value]);
          filters.push((row) => row[column] === value);
          return query;
        },
        is(column: string, value: unknown) {
          call.ops.push(["is", column, value]);
          filters.push((row) => row[column] === value);
          return query;
        },
        in(column: string, values: unknown[]) {
          call.ops.push(["in", column, values]);
          filters.push((row) => values.includes(row[column]));
          return query;
        },
        gt(column: string, value: unknown) {
          call.ops.push(["gt", column, value]);
          filters.push((row) => String(row[column]) > String(value));
          return query;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          sorts.push([column, opts?.ascending !== false]);
          return query;
        },
        limit(n: number) {
          call.ops.push(["limit", n]);
          limit = n;
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
          if (options.failTable === table)
            return Promise.resolve({
              data: null,
              error: { message: "boom", ...(options.failCode ? { code: options.failCode } : {}) },
              count: null,
            }).then(resolve, reject);
          const rows = (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
          rows.sort((a, b) => {
            for (const [column, ascending] of sorts) {
              const x = String(a[column]);
              const y = String(b[column]);
              if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
            }
            return 0;
          });
          let data: unknown = rows.slice(0, limit).map((row) => project(row, call.columns));
          if (options.truncate === table && !call.ops.some(([op]) => op === "gt"))
            data = (data as Row[]).slice(1);
          if (single) data = (data as Row[])[0] ?? null;
          if (call.head) data = null;
          return Promise.resolve({ data, error: null, count: count ? rows.length : null }).then(
            resolve,
            reject,
          );
        },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, calls, rpcCalls, order };
}

function tables(extra: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  const r = partnerFixtureRows(TODAY);
  const a = partnerAssistantFixtureRows(TODAY);
  return {
    partner_assistant_contacts: a.switches,
    partner_assistant_jobs: a.jobs,
    partner_assistant_notes: a.notes,
    partner_assistant_drafts: a.drafts,
    partner_assistant_rules: a.rules,
    partners: r.partners,
    partner_contacts: r.contacts,
    partner_message_variants: r.variants,
    partner_message_revisions: r.revisions,
    partner_activities: r.activities,
    partner_import_differences: r.differences.map((d) => ({ ...d, status: "open" })),
    partner_do_not_contact: r.blocks.map((b) => ({ ...b, active: true })),
    partner_research_imports: r.imports,
    partner_device_imports: r.deviceImports,
    profiles: r.profiles,
    memberships: r.memberships.map((m) => ({ ...m, role: "founder", finance_access: true })),
    ...extra,
  } as Record<string, Row[]>;
}

describe("lettura della lista", () => {
  it("legge tutto a pagine complete, anche oltre 200 contatti", async () => {
    const base = partnerFixtureRows(TODAY).partners[0];
    const many = Array.from({ length: 450 }, (_, i) => ({
      ...base,
      id: partnerFixtureId(10000 + i),
      co: 100 + i,
      source_key: `X${i}`,
    }));
    const fake = fakeSupabase(
      tables({
        partners: many,
        partner_contacts: [],
        partner_message_variants: [],
        partner_import_differences: [],
        partner_do_not_contact: [],
      }),
    );
    const workspace = await loadPartnerWorkspace(fake.client);
    expect(workspace.partners).toHaveLength(450);
    expect(workspace.partners[0].co).toBe(100);
    expect(fake.calls.filter((call) => call.table === "partners")).toHaveLength(3);
  });

  it("dati sintetici completi: sei contatti, membri, ultimo import", async () => {
    const fake = fakeSupabase(tables());
    const workspace = await loadPartnerWorkspace(fake.client);
    expect(workspace.partners.map((partner) => partner.co)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(workspace.partners[0].route).toBe(
      "Email al titolare. Poi una telefonata dopo una settimana.",
    );
    expect(workspace.members).toHaveLength(5);
    expect(workspace.lastImport?.sourceCommit).toBe("0a1b2c3d");
    const filters = (table: string) => fake.calls.find((call) => call.table === table)!.ops;
    expect(filters("partner_contacts")).toContainEqual(["is", "erased_at", null]);
    expect(filters("partner_import_differences")).toContainEqual(["eq", "status", "open"]);
    expect(filters("partner_do_not_contact")).toContainEqual(["eq", "active", true]);
  });

  it("nessun testo dei messaggi, della ricerca o dei recapiti nella lettura della lista", async () => {
    const fake = fakeSupabase(tables());
    await loadPartnerWorkspace(fake.client);
    const columns = (table: string) =>
      fake.calls.filter((call) => call.table === table).flatMap((call) => call.columns.split(","));
    for (const column of columns("partner_message_variants"))
      expect(column).not.toMatch(
        /subject|body|follow_up|confirm_email|to_text|cc_text|gist|notes|form_fields/,
      );
    expect(columns("partner_contacts")).not.toContain("value");
    expect(columns("partners").filter((column) => column.includes("research"))).toEqual([
      "research_removed_at",
      "route:research->>route",
      "followers:research->>followers",
    ]);
    expect(columns("partner_import_differences")).not.toContain("team_value");
    expect(columns("partner_research_imports")).not.toContain("context_md");
  });

  it("pagina troncata o errore di una tabella: errore, nessun dato parziale", async () => {
    await expect(
      loadPartnerWorkspace(fakeSupabase(tables(), { truncate: "partners" }).client),
    ).rejects.toThrow(PartnerUnavailableError);
    await expect(
      loadPartnerWorkspace(fakeSupabase(tables(), { failTable: "partner_contacts" }).client),
    ).rejects.toThrow(
      "Partner non disponibile. Ricarica la pagina tra poco; nessun dato parziale viene mostrato.",
    );
    const broken = tables();
    broken.partners[2].stage = "perso";
    await expect(loadPartnerWorkspace(fakeSupabase(broken).client)).rejects.toThrow(
      PartnerUnavailableError,
    );
  });
});

describe("dettaglio di un contatto", () => {
  it("CO inesistente: null; CO non valido: nessuna lettura", async () => {
    const fake = fakeSupabase(tables());
    expect(await loadPartnerDetail(fake.client, 99)).toBeNull();
    expect(await loadPartnerDetail(fake.client, 0)).toBeNull();
    expect(fake.calls.filter((call) => call.table === "partners")).toHaveLength(1);
  });

  it("legge recapiti, varianti con revisioni, registro, differenze e blocchi", async () => {
    const fake = fakeSupabase(tables());
    const detail = (await loadPartnerDetail(fake.client, 1))!;
    expect(detail.partner.co).toBe(1);
    expect(detail.contacts).toHaveLength(4);
    expect(detail.variants.find((v) => v.approach === "collab")?.currentRevision?.revisionNo).toBe(
      2,
    );
    expect(detail.activities.length).toBe(5);
    expect(detail.differences).toHaveLength(1);
    const revisions = fake.calls.filter((call) => call.table === "partner_message_revisions");
    expect(revisions).toHaveLength(2);
    for (const call of revisions)
      expect(call.ops).toContainEqual(["limit", PARTNER_DETAIL_REVISION_LIMIT]);
    expect(fake.calls.find((call) => call.table === "partner_activities")?.ops).toContainEqual([
      "limit",
      PARTNER_DETAIL_ACTIVITY_LIMIT,
    ]);
    const domainBlocks = fake.calls.filter(
      (call) => call.table === "partner_do_not_contact" && call.ops.some(([op]) => op === "in"),
    );
    expect(domainBlocks[0].ops).toContainEqual(["in", "domain", ["garage-uno.example.test"]]);
  });

  it("righe dal file con il dispositivo; blocco per dominio di un altro contatto", async () => {
    const data = tables();
    data.partner_do_not_contact.push({
      id: partnerFixtureId(899),
      partner_id: null,
      domain: "club-tre.example.test",
      reason: "Dominio bloccato per prova.",
      created_at: "2026-10-20T10:00:00Z",
      active: true,
    });
    const detail = (await loadPartnerDetail(fakeSupabase(data).client, 3))!;
    expect(detail.activities.find((activity) => activity.origin === "file")?.device).toBe(
      "telefono",
    );
    expect(detail.differences[0].device).toBe("telefono");
    expect(detail.blocks.map((block) => block.domain)).toEqual(["club-tre.example.test"]);
  });

  it("registro troncato: errore", async () => {
    await expect(
      loadPartnerDetail(fakeSupabase(tables(), { truncate: "partner_activities" }).client, 1),
    ).rejects.toThrow(PartnerUnavailableError);
  });
});

describe("assistente nella scheda", () => {
  it("bozza pronta con le colonne dichiarate: niente lease, tentativi o motivo dell'interruttore", async () => {
    const fake = fakeSupabase(tables());
    const detail = (await loadPartnerDetail(fake.client, 2))!;
    const assistant = detail.assistant as PartnerAssistantContactView;
    expect(assistant.job?.status).toBe("pronta");
    expect(assistant.draft?.toAddress).toBe("info@raduno-due.example.test");
    expect(assistant.research?.sources).toEqual(["https://raduno-due.example.test/espositori"]);
    const columns = (table: string) =>
      fake.calls.filter((call) => call.table === table).flatMap((call) => call.columns.split(","));
    expect(columns("partner_assistant_jobs")).not.toContain("lease_token");
    expect(columns("partner_assistant_jobs")).not.toContain("attempts");
    expect(columns("partner_assistant_contacts")).not.toContain("reason");
    expect(columns("partner_assistant_drafts")).not.toContain("sha256");
    // Solo le note e la bozza citate dal lavoro, solo di questo contatto.
    const notes = fake.calls.find((call) => call.table === "partner_assistant_notes")!;
    expect(notes.ops).toContainEqual(["eq", "partner_id", partnerFixtureId(2)]);
    expect(notes.ops.find(([op]) => op === "in")?.[2]).toHaveLength(2);
    const fermo = await loadPartnerDetail(fakeSupabase(tables()).client, 4);
    expect(fermo?.assistant).toMatchObject({ active: false, switchVersion: 1, job: null });
  });

  it("contatto senza lavoro: blocco vuoto e attivo (non null), senza leggere note e bozze", async () => {
    const fake = fakeSupabase(tables());
    const detail = (await loadPartnerDetail(fake.client, 3))!;
    expect(detail.assistant).toEqual({
      active: true,
      switchVersion: null,
      job: null,
      research: null,
      choice: null,
      draft: null,
    });
    expect(fake.calls.some((call) => call.table === "partner_assistant_notes")).toBe(false);
    expect(fake.calls.some((call) => call.table === "partner_assistant_drafts")).toBe(false);
  });

  it("errore sulle tabelle dell'assistente, anche prima delle migrazioni: assistant null, scheda leggibile", async () => {
    for (const table of [
      "partner_assistant_contacts",
      "partner_assistant_jobs",
      "partner_assistant_notes",
      "partner_assistant_drafts",
    ]) {
      const detail = await loadPartnerDetail(
        fakeSupabase(tables(), { failTable: table }).client,
        2,
      );
      expect(detail?.partner.co, table).toBe(2);
      expect(detail?.contacts, table).toHaveLength(4);
      expect(detail?.assistant, table).toBeNull();
    }
    // Riga non valida (proposta sconosciuta): solo il blocco diventa null.
    const data = tables();
    const choice = data.partner_assistant_notes.find(
      (note) => note.partner_id === partnerFixtureId(2) && note.kind === "scelta",
    )!;
    choice.content = { ...(choice.content as Row), request: "conto_vendita" };
    const detail = await loadPartnerDetail(fakeSupabase(data).client, 2);
    expect(detail?.assistant).toBeNull();
    expect(detail?.variants).toHaveLength(1);
    // Un errore del resto della scheda resta un errore.
    await expect(
      loadPartnerDetail(fakeSupabase(tables(), { failTable: "partner_contacts" }).client, 2),
    ).rejects.toThrow(PartnerUnavailableError);
  });

  it("tabelle dell'assistente che non ci sono ancora: blocco non attivo, senza avviso", async () => {
    for (const failCode of ["PGRST205", "42P01"])
      for (const table of ["partner_assistant_contacts", "partner_assistant_jobs"]) {
        const fake = fakeSupabase(tables(), { failTable: table, failCode });
        const detail = await loadPartnerDetail(fake.client, 2);
        expect(detail?.assistant, `${table} ${failCode}`).toBe(PARTNER_ASSISTANT_INACTIVE);
        expect(detail?.contacts, table).toHaveLength(4);
        // Senza le tabelle non si leggono note e bozze.
        expect(fake.calls.some((call) => call.table === "partner_assistant_notes")).toBe(false);
      }
    // Un altro codice resta «non leggibile».
    const other = await loadPartnerDetail(
      fakeSupabase(tables(), { failTable: "partner_assistant_jobs", failCode: "57014" }).client,
      2,
    );
    expect(other?.assistant).toBeNull();
  });
});

describe("stato e regole dell'assistente", () => {
  const status = partnerAssistantFixtureRows(TODAY).status;

  it("stato dalla RPC read_partner_assistant_status", async () => {
    const fake = fakeSupabase(tables(), { rpc: () => ({ data: status, error: null }) });
    const loaded = (await loadPartnerAssistantStatus(fake.client)) as PartnerAssistantStatus;
    expect(fake.rpcCalls.map((call) => call.name)).toEqual(["read_partner_assistant_status"]);
    expect(loaded.mode).toBe("prepara");
    expect(loaded.toReview[0]).toMatchObject({ co: 1, reason: "fatto_mancante" });
  });

  it("funzione dell'assistente che non c'è ancora: stato non attivo, non un errore", async () => {
    for (const code of ["PGRST202", "42883", "PGRST205", "42P01"]) {
      const fake = fakeSupabase(tables(), {
        rpc: () => ({ data: null, error: { code, message: "sintetico" } }),
      });
      expect(await loadPartnerAssistantStatus(fake.client), code).toBe(PARTNER_ASSISTANT_INACTIVE);
    }
  });

  it("errore della RPC o risposta non valida: Partner non disponibile", async () => {
    for (const rpc of [
      () => ({ data: null, error: { code: "57014", message: "statement timeout" } }),
      () => ({ data: null, error: { message: "boom" } }),
      () => ({ data: { ...status, extra: true }, error: null }),
      () => new Error("rete"),
    ])
      await expect(
        loadPartnerAssistantStatus(fakeSupabase(tables(), { rpc }).client),
      ).rejects.toThrow(PartnerUnavailableError);
  });

  it("regole: quella in vigore con il testo, la cronologia con gli autori", async () => {
    const fake = fakeSupabase(tables());
    const rules = await loadPartnerAssistantRules(fake.client);
    expect(rules.current).toMatchObject({ version: 2, author: "Ada Prova" });
    expect(rules.current.body).toContain("Regole sintetiche");
    expect(rules.history.map((item) => [item.version, item.author])).toEqual([
      [2, "Ada Prova"],
      [1, "Regole iniziali"],
    ]);
    // La cronologia non legge i testi.
    const history = fake.calls.filter(
      (call) => call.table === "partner_assistant_rules" && !call.ops.some(([op]) => op === "eq"),
    );
    expect(history.flatMap((call) => call.columns.split(","))).not.toContain("body");
    await expect(
      loadPartnerAssistantRules(
        fakeSupabase(tables(), { failTable: "partner_assistant_rules" }).client,
      ),
    ).rejects.toThrow(PartnerUnavailableError);
    await expect(
      loadPartnerAssistantRules(fakeSupabase(tables({ partner_assistant_rules: [] })).client),
    ).rejects.toThrow(PartnerUnavailableError);
  });

  it("«Ridai all'assistente»: l'id della scheda dal CO, solo id e CO", async () => {
    const fake = fakeSupabase(tables());
    expect(await loadPartnerIdsByCo(fake.client, [2, 1])).toEqual({
      1: partnerFixtureId(1),
      2: partnerFixtureId(2),
    });
    expect(fake.calls).toEqual([
      { table: "partners", columns: "id,co", head: false, ops: [["in", "co", [2, 1]]] },
    ]);
    // CO senza scheda: manca anche nella risposta, e la pagina non offre il pulsante.
    expect(await loadPartnerIdsByCo(fakeSupabase(tables()).client, [1, 999])).toEqual({
      1: partnerFixtureId(1),
    });
  });

  it("nessun CO da vedere: nessuna lettura; errore o riga non valida: Partner non disponibile", async () => {
    const fake = fakeSupabase(tables());
    expect(await loadPartnerIdsByCo(fake.client, [])).toEqual({});
    expect(fake.calls).toEqual([]);
    await expect(
      loadPartnerIdsByCo(fakeSupabase(tables(), { failTable: "partners" }).client, [1]),
    ).rejects.toThrow(PartnerUnavailableError);
    const partners = partnerFixtureRows(TODAY).partners;
    // Id non valido o due schede con lo stesso CO.
    for (const broken of [
      [{ ...partners[0], id: "non-un-id" }],
      [partners[0], { ...partners[1], co: 1 }],
    ])
      await expect(
        loadPartnerIdsByCo(fakeSupabase(tables({ partners: broken })).client, [1]),
      ).rejects.toThrow(PartnerUnavailableError);
  });
});

describe("dati e regole", () => {
  it("import, file importati e differenze aperte", async () => {
    const data = await loadPartnerData(fakeSupabase(tables()).client);
    expect(data.imports).toHaveLength(1);
    expect(data.deviceImports[0].device).toBe("telefono");
    expect(data.openDifferences).toBe(2);
  });

  it("regole dall'ultimo import, null se non c'è", async () => {
    expect((await loadPartnerRules(fakeSupabase(tables()).client))?.contextMd).toContain("Tono");
    expect(
      await loadPartnerRules(fakeSupabase(tables({ partner_research_imports: [] })).client),
    ).toBeNull();
  });
});

const stateCommand = {
  kind: "set_partner_state",
  operationId: partnerFixtureId(9001),
  payload: {
    schema_version: 1,
    partner_id: partnerFixtureId(1),
    expected_version: 4,
    stage: "risposto",
  },
};

describe("comandi del team", () => {
  it("verifica il membro prima di tutto, anche con input non valido", async () => {
    const fake = fakeSupabase(tables());
    const result = await executePartnerCommand(fake.client, { kind: "nulla" }, NOW);
    expect(result).toMatchObject({ status: "rejected", code: "invalid_partner_payload" });
    expect(fake.order[0]).toBe("getUser");
    expect(fake.rpcCalls).toEqual([]);
    const outsider = fakeSupabase(tables(), { user: partnerFixtureId(999) });
    expect(await executePartnerCommand(outsider.client, { kind: "nulla" }, NOW)).toMatchObject({
      status: "rejected",
      code: "partner_access_required",
      message: "I permessi del tuo account sono cambiati. Accedi di nuovo.",
    });
    const signedOut = fakeSupabase(tables(), { user: null });
    expect((await executePartnerCommand(signedOut.client, stateCommand, NOW)).status).toBe(
      "rejected",
    );
    expect(signedOut.rpcCalls).toEqual([]);
  });

  it("chiama la RPC con operation_id e payload, senza autore", async () => {
    const fake = fakeSupabase(tables(), {
      rpc: () => ({
        data: {
          id: partnerFixtureId(1),
          version: 5,
          stage: "risposto",
          activity_id: partnerFixtureId(2),
          replayed: false,
        },
        error: null,
      }),
    });
    const result = await executePartnerCommand(fake.client, stateCommand, NOW);
    expect(result).toMatchObject({
      status: "success",
      version: 5,
      message: "Salvato. Stato: Ha risposto.",
    });
    expect(fake.rpcCalls).toEqual([
      {
        name: "set_partner_state",
        args: { p_operation_id: stateCommand.operationId, p_payload: stateCommand.payload },
      },
    ]);
    expect(JSON.stringify(fake.rpcCalls)).not.toMatch(/created_by|actor/);
    expect(fake.order).toEqual(["getUser", "rpc:set_partner_state"]);
  });

  it("mappa 42501, 22023, 40001, 23505 e 55000", async () => {
    const cases: [string, string, string][] = [
      [
        "42501",
        "partner_access_required",
        "I permessi del tuo account sono cambiati. Accedi di nuovo.",
      ],
      ["22023", "invalid_partner_payload", "Controlla i campi: un valore non è valido."],
      [
        "40001",
        "partner_changed",
        "Un collega ha appena modificato questo contatto. Ricarico i dati: controlla e riprova.",
      ],
      [
        "23505",
        "partner_idempotency_conflict",
        "Operazione già usata con dati diversi. Ricarica la pagina.",
      ],
      ["55000", "partner_do_not_contact", "Questo contatto è nella lista «Non contattare»."],
    ];
    for (const [code, message, text] of cases) {
      const fake = fakeSupabase(tables(), {
        rpc: () => ({ data: null, error: { code, message } }),
      });
      expect(await executePartnerCommand(fake.client, stateCommand, NOW)).toEqual({
        status: "rejected",
        code: message,
        message: text,
        refresh: code === "40001",
      });
    }
  });

  it("conflitto di versione su modalità e regole: lo dice per l'assistente, non per il contatto", async () => {
    const assistantCommand = (kind: string, payload: Record<string, unknown>) => ({
      kind,
      operationId: "93000000-0000-4000-8000-000000000009",
      payload: { schema_version: 1, ...payload },
      retry: false,
    });
    const cases: [ReturnType<typeof assistantCommand>, string][] = [
      [
        assistantCommand("set_partner_assistant_mode", { mode: "prepara", expected_version: 2 }),
        "impostazioni dell'assistente",
      ],
      [
        assistantCommand("save_partner_assistant_rules", {
          body: "Regole sintetiche.",
          expected_version: 2,
        }),
        "regole",
      ],
    ];
    for (const [command, words] of cases) {
      const fake = fakeSupabase(tables(), {
        rpc: () => ({ data: null, error: { code: "40001", message: "partner_changed" } }),
      });
      const result = await executePartnerCommand(fake.client, command, NOW);
      expect(result, command.kind).toMatchObject({
        status: "rejected",
        code: "partner_changed",
        refresh: true,
      });
      const message = (result as { message: string }).message;
      expect(message, command.kind).toContain(words);
      expect(message, command.kind).not.toContain("contatto");
    }
  });

  it("rete caduta, risposta strana o errore sconosciuto: esito da verificare", async () => {
    for (const rpc of [
      () => new Error("rete"),
      () => ({ data: { ok: true }, error: null }),
      () => ({ data: null, error: { code: "XX000", message: "internal" } }),
    ]) {
      const result = await executePartnerCommand(
        fakeSupabase(tables(), { rpc }).client,
        stateCommand,
        NOW,
      );
      expect(result).toEqual({
        status: "uncertain",
        message: "Salvataggio non confermato. Verifica prima di riprovare.",
      });
    }
  });

  it("ogni Server Action accetta solo il suo comando: un altro tipo non arriva al database", async () => {
    const fake = fakeSupabase(tables());
    const result = await executePartnerCommand(fake.client, stateCommand, NOW, {
      kind: "record_partner_activity",
    });
    expect(result).toMatchObject({ status: "rejected", code: "invalid_partner_payload" });
    expect(fake.order).toEqual(["getUser"]);
    expect(fake.rpcCalls).toEqual([]);
    const same = fakeSupabase(tables(), {
      rpc: () => ({
        data: {
          id: partnerFixtureId(1),
          version: 5,
          stage: "risposto",
          activity_id: partnerFixtureId(2),
          replayed: false,
        },
        error: null,
      }),
    });
    expect(
      await executePartnerCommand(same.client, stateCommand, NOW, { kind: "set_partner_state" }),
    ).toMatchObject({ status: "success" });
    expect(same.rpcCalls.map((call) => call.name)).toEqual(["set_partner_state"]);
  });

  it("«Verifica»: senza accesso resta non confermato e la risposta ripetuta torna come già registrata", async () => {
    const retry = { ...stateCommand, retry: true };
    const outsider = fakeSupabase(tables(), { user: null });
    expect((await executePartnerCommand(outsider.client, retry, NOW)).status).toBe("uncertain");
    const replay = fakeSupabase(tables(), {
      rpc: () => ({
        data: {
          id: partnerFixtureId(1),
          version: 5,
          stage: "risposto",
          activity_id: partnerFixtureId(2),
          replayed: true,
        },
        error: null,
      }),
    });
    const result = await executePartnerCommand(replay.client, retry, NOW);
    expect(result).toMatchObject({ status: "success", replayed: true });
    expect(replay.rpcCalls[0].args.p_operation_id).toBe(stateCommand.operationId);
  });
});

describe("«Segna inviato»: la conferma dice quando scade il sollecito", () => {
  const activity = partnerFixtureId(2),
    task = partnerFixtureId(3);
  const sent = (kind = "inviato") => ({
    kind: "record_partner_activity",
    operationId: partnerFixtureId(77),
    payload: {
      schema_version: 1,
      partner_id: partnerFixtureId(1),
      kind,
      ...(kind === "inviato" ? { message_kind: "primo", channel: "email" } : {}),
    },
    retry: false,
  });
  const rpc = () => ({
    data: {
      id: partnerFixtureId(1),
      version: 6,
      stage: "contattato",
      activity_id: activity,
      occurred_at: "2026-10-22T10:00:00.000Z",
      replayed: false,
    },
    error: null,
  });
  // Invio del 22 ottobre: sollecito alla mezzanotte di Roma del 29 (ora solare, UTC+1).
  const followUp = (extra: Partial<Row> = {}) => ({
    partner_work_links: [{ kind: "follow_up", activity_id: activity, task_id: task }],
    tasks: [
      {
        id: task,
        due_at: "2026-10-28T23:00:00+00:00",
        assigned_to: MEMBER,
        status: "todo",
        ...extra,
      },
    ],
  });

  it("legge il sollecito creato dall'invio e lo scrive nella conferma", async () => {
    const fake = fakeSupabase(tables(followUp()), { rpc });
    const result = await executePartnerCommand(fake.client, sent(), NOW);
    expect(result).toMatchObject({
      status: "success",
      message: "Registrato. Stato: Contattato. Sollecito per te giovedì 29 ottobre.",
    });
    expect(fake.order[0]).toBe("getUser");
    expect(fake.order[1]).toBe("rpc:record_partner_activity");
    const link = fake.calls.find((call) => call.table === "partner_work_links")!;
    expect(link.ops).toContainEqual(["eq", "activity_id", activity]);
    expect(link.ops).toContainEqual(["eq", "kind", "follow_up"]);
  });

  it("senza sollecito (contatto chiuso o da non contattare) la conferma resta quella", async () => {
    const none = fakeSupabase(tables(), { rpc });
    expect((await executePartnerCommand(none.client, sent(), NOW)).message).toBe(
      "Registrato. Stato: Contattato.",
    );
    const closed = fakeSupabase(tables(followUp({ status: "done" })), { rpc });
    expect((await executePartnerCommand(closed.client, sent(), NOW)).message).toBe(
      "Registrato. Stato: Contattato.",
    );
  });

  it("se la lettura non riesce l'invio resta confermato, senza data", async () => {
    const broken = fakeSupabase(tables(followUp()), { rpc, failTable: "tasks" });
    expect(await executePartnerCommand(broken.client, sent(), NOW)).toMatchObject({
      status: "success",
      message: "Registrato. Stato: Contattato.",
    });
    const strange = fakeSupabase(tables(followUp({ due_at: "domani" })), { rpc });
    expect((await executePartnerCommand(strange.client, sent(), NOW)).status).toBe("success");
  });

  it("«Ha risposto» e le altre attività non leggono solleciti", async () => {
    const fake = fakeSupabase(tables(followUp()), { rpc });
    await executePartnerCommand(fake.client, sent("risposta"), NOW);
    expect(fake.calls.some((call) => call.table === "partner_work_links")).toBe(false);
  });
});

describe("anteprima del file del dispositivo", () => {
  const payload = {
    schema_version: 1,
    file_sha256: "b".repeat(64),
    device: "computer",
    exported_at: "2026-10-21T08:00:00.000Z",
    stages: { L001: "risposto" },
    texts: {},
    approaches: {},
    names: { L001: "Garage Sintetico Uno" },
  };

  it("piano senza scritture, dopo la verifica del membro", async () => {
    const fake = fakeSupabase(tables(), {
      rpc: () => ({
        data: {
          file_sha256: payload.file_sha256,
          device: "computer",
          exported_at: "2026-10-21T08:00:00+00:00",
          already_imported: false,
          device_import_id: null,
          file: { stages: 1, texts: 0, approaches: 0 },
          plan: {
            stages_applied: 0,
            texts_applied: 0,
            approaches_applied: 0,
            differences: 1,
            ignored: 0,
            unknown: 0,
          },
          differences: [
            {
              kind: "stage",
              source_key: "L001",
              co: 1,
              approach: null,
              from: "contattato",
              to: "risposto",
            },
          ],
          names_changed: [],
          unknown_keys: [],
        },
        error: null,
      }),
    });
    const result = await previewPartnerDeviceFile(fake.client, payload, NOW);
    expect(result.status).toBe("ready");
    expect(fake.order).toEqual(["getUser", "rpc:preview_partner_device_file"]);
  });

  it("non membro o payload non valido: nessuna chiamata", async () => {
    const outsider = fakeSupabase(tables(), { user: partnerFixtureId(999) });
    expect((await previewPartnerDeviceFile(outsider.client, payload, NOW)).status).toBe("rejected");
    const fake = fakeSupabase(tables());
    expect(
      await previewPartnerDeviceFile(fake.client, { ...payload, device: "tablet" }, NOW),
    ).toMatchObject({
      status: "rejected",
      code: "invalid_partner_payload",
    });
    expect(fake.rpcCalls).toEqual([]);
  });
});
