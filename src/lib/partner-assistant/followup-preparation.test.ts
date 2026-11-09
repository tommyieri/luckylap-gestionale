import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

// Solo dati sintetici. Questi testi verificano il validatore, non sono modelli editoriali da usare.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = join(ROOT, "scripts/prepare-partner-followups.mjs");
const DAY = "2026-11-09";
const PHONE = "+39 000 000 0000";
const BODY =
  "Buongiorno,\nho letto del nuovo percorso espositivo dedicato alle automobili storiche e alla loro relazione con il design. Riprendo la mia proposta per LuckyLap: le nostre magliette ricamate potrebbero offrire ai visitatori un ricordo quotidiano di questa passione, anche dopo la visita. Vi interessa approfondire questa idea via email?\nUn saluto,";
const FIRST_BODY = "Buongiorno,\nUn primo messaggio sintetico già inviato.\nUn saluto,";
const RESEARCH =
  "Ricerca sintetica del nuovo percorso espositivo pubblicato sul sito ufficiale dell'organizzazione.";
const SOURCE = "https://museo-sintetico.example.test/novita/percorso";
const uuid = (number: number) => `70000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const temps = new Set<string>();

function candidate(co = 951) {
  return {
    id: uuid(co),
    version: 4,
    partner_id: uuid(co + 1000),
    co,
    name: `Museo Sintetico ${co}`,
    porsche_community: false,
    flow_template: false,
    contact_id: uuid(co + 2000),
    contact_version: 3,
    address_sha256: createHash("sha256").update(`recapito-sintetico-${co}`).digest("hex"),
    partner_version: 7,
    rules_version: 2,
    number: 1,
    next_due_on: DAY,
    language: "it",
    register: "voi",
    timezone: "Europe/Rome",
    country: "Italia",
    first_subject: `Una proposta per il Museo Sintetico ${co}`,
    first_sent_at: "2026-11-02T09:00:00+00:00",
    first_body: FIRST_BODY,
    previous_bodies: [] as string[],
  };
}
type Candidate = ReturnType<typeof candidate>;
function textRow(co = 951) {
  return {
    co,
    conversation_id: uuid(co),
    number: 1,
    body: BODY,
    research_text: RESEARCH,
    sources: [SOURCE],
    verified_on: DAY,
  };
}
type TextRow = ReturnType<typeof textRow>;
function fixture(items = [candidate()], rows = [textRow()]) {
  const directory = mkdtempSync(join(tmpdir(), "luckylap-followup-cli-test-"));
  chmodSync(directory, 0o700);
  temps.add(directory);
  const paths = {
    snapshot: join(directory, "snapshot.json"),
    texts: join(directory, "texts.json"),
    signature: join(directory, "signature-private.json"),
    output: join(directory, "batch.sql"),
  };
  writeFileSync(paths.snapshot, JSON.stringify({ items }), { mode: 0o600 });
  writeFileSync(paths.texts, JSON.stringify(rows), { mode: 0o600 });
  writeFileSync(paths.signature, JSON.stringify({ phone: PHONE }), { mode: 0o600 });
  return { directory, paths };
}
type Fixture = ReturnType<typeof fixture>;
function args(f: Fixture, day = DAY) {
  return [
    "--snapshot",
    f.paths.snapshot,
    "--texts",
    f.paths.texts,
    "--signature-config",
    f.paths.signature,
    "--output",
    f.paths.output,
    "--day",
    day,
  ];
}
function run(f: Fixture, overrides: string[] = args(f)) {
  return spawnSync(process.execPath, ["--conditions=react-server", SCRIPT, ...overrides], {
    cwd: f.directory,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 128 * 1024,
    // Il CLI deve funzionare senza token, credenziali, telefono o endpoint nell'ambiente.
    env: { PATH: process.env.PATH ?? "", NODE_NO_WARNINGS: "1", NODE_ENV: "test" },
  });
}
type BatchEntry = {
  partner_id: string;
  operation_id: string;
  payload: {
    schema_version: number;
    conversation_id: string;
    expected_version: number;
    number: number;
    partner_version: number;
    contact_version: number;
    address_sha256: string;
    rules_version: number;
    language: string;
    subject: string;
    body: string;
    signature: string;
    research_text: string;
    sources: string[];
  };
};
function batch(f: Fixture): BatchEntry[] {
  const sql = readFileSync(f.paths.output, "utf8");
  const match = sql.match(/jsonb_to_recordset\((\$partner_followups_\d+\$)([\s\S]*?)\1::jsonb\)/u);
  expect(match).not.toBeNull();
  return JSON.parse(match![2]);
}
function rejected(f: Fixture, code?: string, argv?: string[]) {
  const result = run(f, argv);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  const report = JSON.parse(result.stderr);
  expect(Object.keys(report).sort()).toEqual(report.co ? ["co", "error"] : ["error"]);
  if (code) expect(report.error).toBe(code);
  expect(result.stderr).not.toContain(PHONE);
  expect(result.stderr).not.toContain(BODY);
  expect(result.stderr).not.toContain(SOURCE);
  expect(result.stderr).not.toContain(f.directory);
  expect(existsSync(f.paths.output)).toBe(false);
  return report;
}
function editJson(path: string, transform: (value: any) => unknown) {
  const next = transform(JSON.parse(readFileSync(path, "utf8")));
  writeFileSync(path, JSON.stringify(next));
}
function changeCandidate(f: Fixture, changes: Record<string, unknown>) {
  editJson(f.paths.snapshot, (value) => {
    Object.assign(value.items[0], changes);
    return value;
  });
}
function changeText(f: Fixture, changes: Record<string, unknown>) {
  editJson(f.paths.texts, (value) => {
    Object.assign(value[0], changes);
    return value;
  });
}
afterEach(() => {
  for (const path of temps) rmSync(path, { recursive: true, force: true });
  temps.clear();
});

describe("CLI offline di preparazione dei solleciti", () => {
  it("genera solo il payload CAS atteso, firma dal file privato e SQL con ROLLBACK", () => {
    const f = fixture();
    const before = [f.paths.snapshot, f.paths.texts, f.paths.signature].map((path) =>
      readFileSync(path, "utf8"),
    );
    const result = run(f);
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      snapshot: 1,
      preparati: 1,
      co: [951],
      transazione: "rollback",
    });
    expect(result.stdout).not.toContain(PHONE);
    expect(result.stdout).not.toContain(BODY);
    const prepared = batch(f);
    expect(prepared).toHaveLength(1);
    expect(prepared[0].operation_id).toMatch(/^[0-9a-f-]{14}8[0-9a-f-]{21}$/u);
    expect(prepared[0].payload).toEqual({
      schema_version: 1,
      conversation_id: candidate().id,
      expected_version: 4,
      number: 1,
      partner_version: 7,
      contact_version: 3,
      address_sha256: candidate().address_sha256,
      rules_version: 2,
      language: "it",
      subject: "Re: Una proposta per il Museo Sintetico 951",
      body: BODY,
      signature: `Tommaso\nFondatore, LuckyLap\n${PHONE}\nhttps://luckylap.com | Instagram @lucky.lap`,
      research_text: `Data di verifica dichiarata nel lotto: ${DAY}.\n\n${RESEARCH}`,
      sources: [SOURCE],
    });
    expect(statSync(f.paths.output).mode & 0o777).toBe(0o600);
    expect(readFileSync(f.paths.output, "utf8")).toMatch(/\nROLLBACK;\n$/u);
    expect(readFileSync(f.paths.output, "utf8")).not.toMatch(/^COMMIT;/mu);
    // I lock restano dentro la RPC (mail_state → config), senza inversione nel chiamante.
    expect(readFileSync(f.paths.output, "utf8")).not.toMatch(/FOR SHARE|FOR UPDATE/u);
    expect(
      [f.paths.snapshot, f.paths.texts, f.paths.signature].map((p) => readFileSync(p, "utf8")),
    ).toEqual(before);
  });

  it("accetta un sottoinsieme del queue e ordina i lock per partner UUID", () => {
    const f = fixture(
      [candidate(953), candidate(952), candidate(951)],
      [textRow(953), textRow(951)],
    );
    expect(run(f).status).toBe(0);
    expect(batch(f).map((entry) => entry.partner_id)).toEqual([uuid(1951), uuid(1953)]);
  });

  it("il replay è deterministico e cambia quando cambia telefono, CAS o testo", () => {
    const first = fixture();
    const same = fixture();
    expect(run(first).status).toBe(0);
    expect(run(same).status).toBe(0);
    expect(readFileSync(first.paths.output, "utf8")).toBe(readFileSync(same.paths.output, "utf8"));
    const id = batch(first)[0].operation_id;
    for (const kind of ["phone", "cas", "body"]) {
      const changed = fixture();
      if (kind === "phone")
        writeFileSync(changed.paths.signature, JSON.stringify({ phone: "+39 000 000 0001" }));
      if (kind === "cas") changeCandidate(changed, { contact_version: 4 });
      if (kind === "body") changeText(changed, { body: BODY.replace("quotidiano", "personale") });
      expect(run(changed).status).toBe(0);
      expect(batch(changed)[0].operation_id).not.toBe(id);
    }
  });

  it.each([1, 2, 3, 4])(
    "mantiene il numero %i e richiede l'intera cronologia precedente",
    (number) => {
      const row = {
        ...candidate(),
        number,
        first_sent_at: "2026-07-01T09:00:00Z",
        previous_bodies: Array.from(
          { length: number - 1 },
          (_, i) => `Corpo sintetico precedente ${i + 1}.`,
        ),
      };
      const f = fixture([row], [{ ...textRow(), number }]);
      expect(run(f).status).toBe(0);
      expect(batch(f)[0].payload.number).toBe(number);
    },
  );

  it.each([
    ["it", "voi", "Fondatore"],
    ["it", "lei", "Fondatore"],
    ["en", "you", "Founder"],
    ["de", "sie", "Gründer"],
    ["fr", "vous", "Fondateur"],
    ["es", "usted", "Fundador"],
  ])(
    "metadati %s/%s: firma del percorso originale e oggetto Unicode conservato",
    (language, register, role) => {
      for (const template of [true, false]) {
        const f = fixture();
        changeCandidate(f, {
          language,
          register,
          flow_template: template,
          first_subject: "RE: re : Una proposta per il Museo Österreich",
        });
        expect(run(f).status).toBe(0);
        const payload = batch(f)[0].payload;
        expect(payload.language).toBe(language);
        expect(payload.subject).toBe("Re: Una proposta per il Museo Österreich");
        expect(payload.signature.split("\n")).toEqual([
          template ? "Tommaso Ieri" : "Tommaso",
          `${role}, LuckyLap`,
          PHONE,
          "https://luckylap.com | Instagram @lucky.lap",
        ]);
      }
    },
  );

  it("usa il giorno di Roma per il limite minimo ed ammette la preparazione di domani", () => {
    const f = fixture();
    // Il primo invio è già 3 novembre a Roma: il primo sollecito non può scadere il 9.
    changeCandidate(f, { first_sent_at: "2026-11-02T23:30:00Z", next_due_on: "2026-11-10" });
    expect(run(f).status).toBe(0);
    const early = fixture();
    changeCandidate(early, { first_sent_at: "2026-11-02T23:30:00Z" });
    rejected(early, "snapshot_scadenza_non_valida");
  });

  it("espone solo guida statica per --help", () => {
    const f = fixture();
    const result = run(f, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--signature-config FIRMA_PRIVATA.json");
    expect(existsSync(f.paths.output)).toBe(false);
  });
});

describe("input e controlli editoriali fail closed", () => {
  it.each([
    { version: 0 },
    { version: "4" },
    { partner_version: Number.MAX_SAFE_INTEGER + 1 },
    { contact_version: null },
    { rules_version: 0 },
    { rules_version: 2_147_483_648 },
    { co: 0 },
    { co: 100_000 },
    { id: "non-un-uuid" },
    { id: "00000000-0000-0000-0000-000000000000" },
    { partner_id: `${uuid(1)}');DROP TABLE x;--` },
    { contact_id: null },
    { address_sha256: "a".repeat(63) },
    { address_sha256: "A".repeat(64) },
    { flow_template: "false" },
    { porsche_community: null },
    { name: "" },
    { name: "Nome\nBcc: altro@example.test" },
    { country: "" },
    { language: "nl" },
    { language: "en", register: "voi" },
    { language: "it", register: "you" },
    { timezone: "Europa/Inventata" },
    { first_subject: "Oggetto\r\nBcc: altro@example.test" },
    { first_body: "" },
    { first_sent_at: "2026-02-30T09:00:00Z" },
    { first_sent_at: "2026-99-01T09:00:00Z" },
    { first_sent_at: "2026-11-02T09:00:00" },
    { first_sent_at: "2026-11-02T09:00:00+99:99" },
    { number: 0 },
    { number: 5 },
    { number: 2 },
    { previous_bodies: ["Un messaggio in più."] },
    { previous_bodies: null },
    { next_due_on: "2026-02-30" },
    { extra: "iniezione" },
    { address: "destinatario@example.test" },
  ])("rifiuta snapshot incompleto o incoerente %#", (changes) => {
    const f = fixture();
    changeCandidate(f, changes);
    rejected(f);
  });

  it.each(["name", "porsche_community", "version", "address_sha256", "first_sent_at"])(
    "richiede la chiave snapshot %s",
    (key) => {
      const f = fixture();
      editJson(f.paths.snapshot, (value) => {
        delete value.items[0][key];
        return value;
      });
      rejected(f, "snapshot_riga_non_valida");
    },
  );

  it.each(["co", "id", "partner_id", "contact_id", "address_sha256"])(
    "non ammette duplicati di %s nello snapshot",
    (key) => {
      const a = candidate();
      const b = candidate(952);
      Object.assign(b, { [key]: a[key as keyof Candidate] });
      rejected(fixture([a, b]), "snapshot_duplicato");
    },
  );

  it.each([
    { verified_on: "2026-11-08" },
    { verified_on: "2026-02-30" },
    { verified_on: null },
    { conversation_id: uuid(999) },
    { number: 2 },
    { number: "1" },
    { co: 952 },
    { research_text: " \n " },
    { research_text: "a".repeat(60_001) },
    { sources: [] },
    { sources: null },
    { sources: [SOURCE, SOURCE] },
    { sources: Array(41).fill(SOURCE) },
    { sources: ["http://museo-sintetico.example.test/news"] },
    { sources: ["https://utente:segreto@museo-sintetico.example.test/news"] },
    { sources: ["https://localhost/news"] },
    { sources: ["https://a..example.test/news"] },
    { sources: ["https://-a.example.test/news"] },
    { sources: ["https://127.0.0.1/news"] },
    { sources: ["https://[::1]/news"] },
    { sources: ["https://museo-sintetico.example.test:8443/news"] },
    { sources: ["https://museo-sintetico.example.test/news#frammento"] },
    { sources: ["https://museo-sintetico.example.test/news\nCOMMIT;"] },
    { body: "\n" + BODY },
    { body: BODY + "\n" },
    { body: BODY.replace("\n", "\r\n") },
    { body: BODY + "\u0000" },
    { body: BODY + "\ud800" },
    { research_text: RESEARCH + "\ud800" },
    { subject: "Oggetto controllato dal chiamante" },
    { signature: "Firma controllata dal chiamante" },
    { to_address: "altro@example.test" },
  ])("rifiuta testi, prove o mapping non validi %#", (changes) => {
    const f = fixture();
    changeText(f, changes);
    rejected(f);
  });

  it.each([
    ["conto vendita", "parola_vietata"],
    ["150 bespoke T-shirts", "prova_sociale"],
    ["Porsche Club Toscana", "prova_sociale"],
    ["Facciamo una chiamata", "invito_telefonata"],
    ["Prezzi e condizioni", "condizioni_commerciali"],
    ["https://tracking.example.test/pixel", "link"],
    [PHONE, "telefono"],
    ["Tommi", "parola_vietata"],
    ["[nome]", "segnaposto"],
    ["Ho allegato il lookbook PDF", "allegato"],
    ["🏁", "emoji"],
  ])("condivide i divieti del runner: %s", (line, failure) => {
    const f = fixture();
    changeText(f, { body: BODY.replace("\nUn saluto,", ` ${line}.\nUn saluto,`) });
    expect(rejected(f).error).toContain(failure);
  });

  it.each([39, 91])("rifiuta %i parole nel corpo conteggiato", (count) => {
    const f = fixture();
    changeText(f, { body: `Buongiorno,\n${"progetto ".repeat(count - 1)}insieme?\nUn saluto,` });
    expect(rejected(f).error).toContain("lunghezza");
  });
  it.each([40, 90])("accetta il limite di %i parole senza contare saluto/chiusura", (count) => {
    const f = fixture();
    changeText(f, { body: `Buongiorno,\n${"progetto ".repeat(count - 1)}insieme?\nUn saluto,` });
    expect(run(f).status).toBe(0);
  });
  it.each([BODY.replace("?", "."), BODY.replace("?", "? Un'altra domanda?")])(
    "richiede una e una sola domanda",
    (body) => {
      const f = fixture();
      changeText(f, { body });
      expect(rejected(f).error).toContain("domande");
    },
  );
  it("applica i limiti Porsche ricevuti dallo snapshot verificato", () => {
    const f = fixture();
    changeCandidate(f, { porsche_community: true });
    changeText(f, { body: BODY.replace("quotidiano", "quotidiano della 993") });
    expect(rejected(f).error).toContain("modello_porsche");
  });
  it("non ricicla il primo corpo o un sollecito precedente", () => {
    const first = fixture();
    changeCandidate(first, { first_body: BODY });
    rejected(first, "testo_gia_usato");
    const previous = fixture();
    changeCandidate(previous, {
      number: 2,
      first_sent_at: "2026-07-01T09:00:00Z",
      previous_bodies: [BODY.replace(/\s+/gu, " ")],
    });
    changeText(previous, { number: 2 });
    rejected(previous, "testo_gia_usato");
  });
  it("rifiuta doppio CO/conversazione e non scrive output parziali", () => {
    rejected(fixture([candidate()], [textRow(), textRow()]), "testo_duplicato");
    const f = fixture(
      [candidate(), candidate(952)],
      [textRow(), { ...textRow(952), body: "Non valida?" }],
    );
    rejected(f);
  });
  it.each(["2026-02-30", "2026-99-01", "2026-11-9", "1999-12-31", "2100-12-31"])(
    "rifiuta giorno CLI %s",
    (day) => {
      const f = fixture();
      rejected(f, "giorno_non_valido", args(f, day));
    },
  );
  it("rifiuta preparazioni oltre domani o prima della scadenza minima", () => {
    for (const next_due_on of ["2026-11-11", "2026-11-08"]) {
      const f = fixture();
      changeCandidate(f, { next_due_on });
      rejected(f, "snapshot_scadenza_non_valida");
    }
  });
});

describe("filesystem, privacy e sicurezza SQL del CLI", () => {
  it.each([{ argv: [] }, { argv: ["--phone", PHONE] }, { argv: ["--help", "extra"] }])(
    "rifiuta forma CLI non autorizzata %# senza esporre i valori",
    ({ argv }) => {
      rejected(fixture(), "argomenti_non_validi", argv);
    },
  );
  it("rifiuta chiavi CLI ripetute e flag aggiuntivi", () => {
    const f = fixture();
    const duplicated = args(f);
    duplicated[2] = "--snapshot";
    rejected(f, "argomenti_non_validi", duplicated);
    rejected(f, "argomenti_non_validi", [...args(f), "--execute", "true"]);
  });
  it("non ammette JSON malformato né byte UTF-8 danneggiati", () => {
    for (const input of [Buffer.from('{"items":'), Buffer.from([0xc3, 0x28])]) {
      const f = fixture();
      writeFileSync(f.paths.snapshot, input);
      rejected(f, "json_input_non_valido");
    }
  });
  it("richiede un file privato per il telefono, senza correggerne i permessi", () => {
    const f = fixture();
    chmodSync(f.paths.signature, 0o644);
    rejected(f, "config_firma_non_privata_o_non_valida");
    expect(statSync(f.paths.signature).mode & 0o777).toBe(0o644);
  });
  it.each([
    { phone: "+39 000 000 0000\nAltra riga" },
    { phone: "00000000" },
    { phone: PHONE, actor_id: uuid(123) },
    { PARTNER_ASSISTANT_PHONE: PHONE },
  ])("rifiuta configurazione firma iniettata o non valida %#", (config) => {
    const f = fixture();
    writeFileSync(f.paths.signature, JSON.stringify(config));
    rejected(f, "config_firma_non_valida");
  });
  it("non segue link simbolici per gli input", () => {
    const f = fixture();
    const linked = join(f.directory, "signature-link.json");
    symlinkSync(f.paths.signature, linked);
    const argv = args(f);
    argv[5] = linked;
    rejected(f, "lettura_input_fallita", argv);
  });
  it("non sovrascrive l'output, nemmeno un link simbolico", () => {
    for (const symbolic of [false, true]) {
      const f = fixture();
      const sentinel = join(f.directory, "sentinel.txt");
      writeFileSync(sentinel, "NON MODIFICARE", { mode: 0o600 });
      if (symbolic) symlinkSync(sentinel, f.paths.output);
      else writeFileSync(f.paths.output, "NON MODIFICARE", { mode: 0o600 });
      const result = run(f);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({ error: "scrittura_output_fallita" });
      expect(readFileSync(f.paths.output, "utf8")).toBe("NON MODIFICARE");
      expect(readFileSync(sentinel, "utf8")).toBe("NON MODIFICARE");
    }
  });
  it("ha errori sanitizzati anche quando mancano file", () => {
    const f = fixture();
    rmSync(f.paths.snapshot);
    rejected(f, "lettura_input_fallita");
  });
  it("blocca budget di file/righe e JSON root estranei senza creare output", () => {
    const config = fixture();
    writeFileSync(config.paths.signature, " ".repeat(4097));
    rejected(config, "config_firma_non_privata_o_non_valida");
    const extra = fixture();
    editJson(extra.paths.snapshot, (value) => ({ ...value, actor_id: uuid(99) }));
    rejected(extra, "snapshot_non_valido");
    const many = fixture(Array.from({ length: 101 }, (_, i) => candidate(i + 1)));
    rejected(many, "snapshot_non_valido");
  });

  it("usa dollar quote senza collisioni e il database interpreta ogni input come dato", async () => {
    const f = fixture([candidate(952), candidate(951)], [textRow(952), textRow(951)]);
    const malicious =
      "Ricerca sintetica: $partner_followups_0$ $partner_followups_1$ '); DROP TABLE private.seen; --\nCOMMIT;";
    editJson(f.paths.texts, (value: TextRow[]) => {
      value[0].research_text = malicious;
      return value;
    });
    expect(run(f).status).toBe(0);
    expect(readFileSync(f.paths.output, "utf8")).toContain(
      "jsonb_to_recordset($partner_followups_2$",
    );
    expect(batch(f)[1].payload.research_text).toContain(malicious);
    // PostgreSQL esclusivamente in memoria: prova parsing SQL, ordine e rollback reali.
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE SCHEMA private;
        CREATE TABLE private.partner_assistant_config (singleton boolean PRIMARY KEY, handoff_to uuid);
        INSERT INTO private.partner_assistant_config VALUES (true, '${uuid(1)}');
        CREATE TABLE private.seen (seq integer GENERATED ALWAYS AS IDENTITY, payload jsonb);
        CREATE FUNCTION private.save_partner_followup_draft_as_founder(actor uuid, operation uuid, body jsonb)
          RETURNS jsonb LANGUAGE plpgsql AS $$
          DECLARE v_seq integer;
          BEGIN
            IF actor IS NULL THEN RAISE EXCEPTION 'actor_required'; END IF;
            INSERT INTO private.seen(payload) VALUES (body) RETURNING seq INTO v_seq;
            RETURN jsonb_build_object('seq',v_seq,'payload',body,'actor',actor,'operation',operation);
          END $$;
      `);
      const results = await db.exec(readFileSync(f.paths.output, "utf8"));
      const saved = results
        .flatMap((result) => result.rows as { results?: unknown }[])
        .find((r) => r.results);
      const values = saved?.results as {
        seq: number;
        payload: BatchEntry["payload"];
        actor: string;
      }[];
      expect(values.map((value) => value.payload.conversation_id)).toEqual([uuid(951), uuid(952)]);
      expect(values[1].payload.research_text).toContain(malicious);
      expect(values.every((value) => value.actor === uuid(1))).toBe(true);
      expect(
        (await db.query<{ count: number }>("SELECT count(*)::integer AS count FROM private.seen"))
          .rows[0].count,
      ).toBe(0);
    } finally {
      await db.close();
    }
  }, 20_000);

  it("un singleton assente non diventa una riuscita silenziosa senza actor", async () => {
    const f = fixture();
    expect(run(f).status).toBe(0);
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE SCHEMA private;
        CREATE TABLE private.partner_assistant_config (singleton boolean PRIMARY KEY, handoff_to uuid);
        CREATE FUNCTION private.save_partner_followup_draft_as_founder(actor uuid, operation uuid, body jsonb)
          RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
            IF actor IS NULL THEN RAISE EXCEPTION 'actor_required'; END IF;
            RETURN '{}'::jsonb;
          END $$;
      `);
      await expect(db.exec(readFileSync(f.paths.output, "utf8"))).rejects.toThrow("actor_required");
      await db.exec("ROLLBACK");
    } finally {
      await db.close();
    }
  }, 20_000);
});
