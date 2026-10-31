import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PARTNER_DEVICE_FILE_MAX_BYTES,
  PartnerDeviceFileError,
  describePartnerDeviceFile,
  describePartnerDeviceImport,
  describePartnerDevicePlan,
  parsePartnerDevicePreview,
  parsePartnerDeviceText,
  validatePartnerDevicePayload,
  readPartnerDeviceFile,
  sha256Hex,
  type PartnerDeviceFileSummary,
} from "./device-file";

// File «Esporta» del vecchio sito: forma in spec 02 §4.1. Solo dati sintetici.
const EXPORTS = join(__dirname, "../../../supabase/tests/fixtures/partner/exports");
const NOW = new Date("2026-10-22T10:00:00Z");
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const base = () => ({
  formato: "luckylap-partner-export",
  versione: 1,
  esportato: "2026-10-20T17:30:00.000Z",
  dispositivo: "telefono",
  contatti: { L014: "Garage Sintetico" } as Record<string, unknown>,
  stato: { L014: "contattato" } as Record<string, unknown>,
  testi: { "L014|collab|body": "Testo sintetico" } as Record<string, unknown>,
  approccio: { L014: "collab" } as Record<string, unknown>,
  vista: {} as unknown,
});
const read = (value: unknown) => readPartnerDeviceFile(encode(value), NOW);
const rejects = (value: unknown, message: RegExp | string) =>
  expect(read(value)).rejects.toThrow(message);

describe("file «Esporta» del vecchio sito", () => {
  it("normalizza un file valido nel payload del database, con lo SHA-256 dei byte", async () => {
    const bytes = encode(base());
    const { payload, summary } = await readPartnerDeviceFile(bytes, NOW);
    expect(payload).toEqual({
      schema_version: 1,
      file_sha256: sha(bytes),
      device: "telefono",
      exported_at: "2026-10-20T17:30:00.000Z",
      stages: { L014: "contattato" },
      texts: { "L014|collab|body": "Testo sintetico" },
      approaches: { L014: "collab" },
      names: { L014: "Garage Sintetico" },
    });
    expect(Object.keys(payload)).toEqual([
      "schema_version",
      "file_sha256",
      "device",
      "exported_at",
      "stages",
      "texts",
      "approaches",
      "names",
    ]);
    expect(summary).toEqual({
      device: "telefono",
      exportedAt: "2026-10-20T17:30:00.000Z",
      contacts: 1,
      stages: 1,
      texts: 1,
      approaches: 1,
    });
  });

  it("legge i due export sintetici del fixture come l'harness PGlite", async () => {
    for (const name of [
      "luckylap-partner-2026-10-20-telefono.json",
      "luckylap-partner-2026-10-21-computer.json",
    ]) {
      const bytes = readFileSync(join(EXPORTS, name));
      const file = JSON.parse(bytes.toString("utf8"));
      const { payload } = await readPartnerDeviceFile(bytes, NOW);
      expect(payload).toEqual({
        schema_version: 1,
        file_sha256: sha(bytes),
        device: file.dispositivo,
        exported_at: file.esportato,
        stages: file.stato,
        texts: file.testi,
        approaches: file.approccio,
        names: file.contatti,
      });
    }
  });

  it("conta i testi per contatto e approccio, come il database", async () => {
    const file = base();
    file.testi = {
      "L014|collab|subject": "Oggetto",
      "L014|collab|body": "Testo",
      "L014|vendita|body": "Altro testo",
      "n7|evento|follow_up": "Sollecito",
    };
    file.stato = { L014: "risposto", L020: "da_contattare" };
    const { summary } = await read(file);
    expect([summary.texts, summary.stages, summary.contacts]).toEqual([3, 2, 3]);
  });

  it("ignora «vista», qualsiasi valore JSON abbia, anche null o assente", async () => {
    for (const vista of [null, {}, { section: "tutti", sector: "subito" }, [1, 2], "x", 3]) {
      const { payload } = await read({ ...base(), vista });
      expect(payload).not.toHaveProperty("vista");
    }
    const { vista: _omitted, ...withoutView } = base();
    await expect(read(withoutView)).resolves.toBeTruthy();
  });

  it("accetta un file con la BOM: lo SHA-256 resta quello dei byte originali", async () => {
    const json = encode(base());
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...json]);
    const { payload } = await readPartnerDeviceFile(bytes.buffer, NOW);
    expect(payload.file_sha256).toBe(sha(bytes));
    expect(payload.file_sha256).not.toBe(sha(json));
  });

  it("rifiuta formato, versione o chiavi in testa diversi dall'export del sito", async () => {
    await rejects({ ...base(), formato: "altro-export" }, /non è un file «Esporta»/);
    await rejects({ ...base(), versione: 2 }, /non è un file «Esporta»/);
    await rejects({ ...base(), versione: "1" }, /non è un file «Esporta»/);
    await rejects({ ...base(), extra: true }, /non è un file «Esporta»/);
    await rejects([base()], /non è un file «Esporta»/);
    const { stato: _missing, ...withoutStages } = base();
    await rejects(withoutStages, /non è un file «Esporta»/);
    await rejects({ ...base(), testi: [] }, /non è un file «Esporta»/);
    await rejects({ ...base(), approccio: null }, /non è un file «Esporta»/);
  });

  it("rifiuta testo non JSON, UTF-8 non valido e file vuoto", async () => {
    await expect(
      readPartnerDeviceFile(new TextEncoder().encode("{non è json"), NOW),
    ).rejects.toThrow(/non è un file «Esporta»/);
    await expect(readPartnerDeviceFile(new Uint8Array([0x7b, 0xff, 0x7d]), NOW)).rejects.toThrow(
      /non è un file «Esporta»/,
    );
    await expect(readPartnerDeviceFile(new Uint8Array(), NOW)).rejects.toThrow("Il file è vuoto.");
  });

  it("rifiuta date di esportazione non valide o non plausibili", async () => {
    await rejects({ ...base(), esportato: "ieri" }, /data di esportazione .* non è valida/);
    await rejects({ ...base(), esportato: "2026-02-30T10:00:00Z" }, /non è valida/);
    await rejects({ ...base(), esportato: "2026-10-20T25:00:00Z" }, /non è valida/);
    await rejects({ ...base(), esportato: "2026-10-20" }, /non è valida/);
    await rejects({ ...base(), esportato: 1761000000000 }, /non è valida/);
    await rejects({ ...base(), esportato: "2019-12-31T23:00:00Z" }, /non è plausibile/);
    await rejects({ ...base(), esportato: "2026-10-24T10:00:00Z" }, /non è plausibile/);
    await expect(read({ ...base(), esportato: "2026-10-23T09:00:00+02:00" })).resolves.toBeTruthy();
  });

  it("rifiuta un dispositivo diverso da telefono o computer", async () => {
    await rejects({ ...base(), dispositivo: "tablet" }, /Dispositivo non valido/);
    await rejects({ ...base(), dispositivo: null }, /Dispositivo non valido/);
  });

  it("rifiuta stati e approcci sconosciuti", async () => {
    await rejects({ ...base(), stato: { L014: "chiamato" } }, "Stato non valido per L014.");
    await rejects({ ...base(), stato: { L014: null } }, "Stato non valido per L014.");
    await rejects({ ...base(), approccio: { L014: "eventi" } }, "Approccio non valido per L014.");
  });

  it("rifiuta codici contatto e chiavi dei testi non validi", async () => {
    await rejects({ ...base(), stato: { "L 014": "contattato" } }, /codice contatto non valido/);
    await rejects({ ...base(), contatti: { ["L".repeat(21)]: "Nome" } }, /codice contatto/);
    for (const key of [
      "L014|collab",
      "L014|eventi|body",
      "L014|collab|testo",
      "L014|collab|body|x",
      "|collab|body",
    ])
      await rejects({ ...base(), testi: { [key]: "x" } }, /chiave dei testi non valida/);
  });

  it("rifiuta __proto__, constructor e prototype a ogni livello", async () => {
    for (const text of [
      '{"__proto__":{"x":1},"formato":"luckylap-partner-export"}',
      JSON.stringify(base()).replace('"stato":{', '"stato":{"constructor":"contattato",'),
      JSON.stringify(base()).replace('"contatti":{', '"contatti":{"prototype":"Nome",'),
      JSON.stringify({ ...base(), vista: { nested: { __proto__x: 1 } } }).replace(
        "__proto__x",
        "__proto__",
      ),
    ])
      await expect(readPartnerDeviceFile(new TextEncoder().encode(text), NOW)).rejects.toThrow(
        "Il file contiene una chiave non ammessa.",
      );
  });

  it("rifiuta valori non testuali, testi oltre i limiti e caratteri di controllo", async () => {
    await rejects({ ...base(), testi: { "L014|collab|body": 12 } }, /deve essere un testo/);
    await rejects({ ...base(), contatti: { L014: ["Nome"] } }, /deve essere un testo/);
    await rejects(
      { ...base(), testi: { "L014|collab|subject": "x".repeat(301) } },
      "Testo L014 · collab · subject: supera 300 caratteri.",
    );
    await rejects(
      { ...base(), testi: { "L014|collab|body": "x".repeat(8001) } },
      /supera 8000 caratteri/,
    );
    await rejects({ ...base(), contatti: { L014: "N".repeat(241) } }, /supera 240 caratteri/);
    await rejects(
      { ...base(), testi: { "L014|collab|body": "riga\u0007campanello" } },
      /caratteri di controllo/,
    );
    // Caratteri come in PostgreSQL (char_length): un'emoji conta uno, non due.
    await expect(
      read({ ...base(), testi: { "L014|collab|subject": "🏁".repeat(300) } }),
    ).resolves.toBeTruthy();
    await expect(
      read({ ...base(), testi: { "L014|collab|body": "riga\r\n\tsotto" } }),
    ).resolves.toBeTruthy();
  });

  it("rifiuta più di 2000 voci in una mappa", async () => {
    const many = Object.fromEntries(
      Array.from({ length: 2001 }, (_, i) => [`L${i}`, "contattato"]),
    );
    await rejects({ ...base(), stato: many }, /troppe voci in «stato»: al massimo 2000/);
    const enough = Object.fromEntries(
      Array.from({ length: 2000 }, (_, i) => [`L${i}`, "contattato"]),
    );
    await expect(read({ ...base(), stato: enough })).resolves.toBeTruthy();
  });

  it("rifiuta un file oltre 900 KB prima di leggerlo", async () => {
    const big = { ...base(), vista: "x".repeat(PARTNER_DEVICE_FILE_MAX_BYTES) };
    await rejects(big, "Il file è troppo grande: al massimo 900 KB.");
    const text = JSON.stringify(big);
    expect(() => parsePartnerDeviceText(text, sha(text), NOW)).toThrow(/troppo grande/);
  });

  it("i messaggi d'errore non ripetono i testi del file", async () => {
    const secret = "Testo riservato del telefono";
    const error = await read({
      ...base(),
      testi: { "L014|collab|body": `${secret}\u0001` },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PartnerDeviceFileError);
    expect((error as Error).message).not.toContain(secret);
  });

  it("parsePartnerDeviceText richiede uno SHA-256 esadecimale", () => {
    const text = JSON.stringify(base());
    expect(() => parsePartnerDeviceText(text, "abc", NOW)).toThrow(/Impronta/);
    expect(parsePartnerDeviceText(text, sha(text), NOW).payload.file_sha256).toBe(sha(text));
  });

  it("sha256Hex coincide con node:crypto", async () => {
    const bytes = new TextEncoder().encode("LuckyLap");
    expect(await sha256Hex(bytes)).toBe(sha(bytes));
  });
});

describe("descrizione dell'anteprima", () => {
  const summary: PartnerDeviceFileSummary = {
    device: "telefono",
    exportedAt: "2026-10-22T08:00:00Z",
    contacts: 14,
    stages: 12,
    texts: 3,
    approaches: 4,
  };
  it("data di Roma, plurali e singolari", () => {
    expect(describePartnerDeviceFile(summary, NOW)).toBe(
      "File del telefono esportato il 22 ottobre: 12 stati, 3 testi, 4 approcci.",
    );
    expect(
      describePartnerDeviceFile(
        { ...summary, device: "computer", stages: 1, texts: 1, approaches: 0 },
        NOW,
      ),
    ).toBe("File del computer esportato il 22 ottobre: 1 stato, 1 testo, 0 approcci.");
  });
  it("dopo la mezzanotte di Roma è già il giorno dopo; l'anno compare se è un altro", () => {
    expect(
      describePartnerDeviceFile({ ...summary, exportedAt: "2026-10-31T23:30:00Z" }, NOW),
    ).toMatch(/^File del telefono esportato il 1 novembre:/);
    expect(
      describePartnerDeviceFile({ ...summary, exportedAt: "2025-12-31T23:30:00Z" }, NOW),
    ).toMatch(/esportato il 1 gennaio:/);
    expect(
      describePartnerDeviceFile({ ...summary, exportedAt: "2025-12-30T10:00:00Z" }, NOW),
    ).toMatch(/esportato il 30 dicembre 2025:/);
  });
});

describe("payload già normalizzato e anteprima del database", () => {
  it("ricontrolla sul server il payload con le regole di private.partner_device_payload", async () => {
    const { payload } = await readPartnerDeviceFile(encode(base()), NOW);
    expect(validatePartnerDevicePayload(payload, NOW)).toBe(payload);
    const broken: Record<string, unknown>[] = [
      { ...payload, schema_version: 2 },
      { ...payload, file_sha256: "ABC" },
      { ...payload, device: "tablet" },
      { ...payload, exported_at: "ieri" },
      { ...payload, exported_at: "2019-12-31T23:00:00Z" },
      { ...payload, exported_at: "2026-10-24T10:00:00Z" },
      { ...payload, stages: { L014: "perso" } },
      { ...payload, stages: { "L 14": "contattato" } },
      { ...payload, texts: { "L014|collab|titolo": "x" } },
      { ...payload, texts: { "L014|collab|subject": "x".repeat(301) } },
      { ...payload, names: { L014: "a\u0007b" } },
      { ...payload, approaches: [] },
      { ...payload, extra: true },
    ];
    for (const value of broken) expect(validatePartnerDevicePayload(value, NOW)).toBeNull();
    const { names: _names, ...missing } = payload;
    expect(validatePartnerDevicePayload(missing, NOW)).toBeNull();
    expect(validatePartnerDevicePayload(null, NOW)).toBeNull();
  });

  const preview = {
    file_sha256: "c".repeat(64),
    device: "telefono",
    exported_at: "2026-10-22T08:00:00+00:00",
    already_imported: false,
    device_import_id: null,
    file: { stages: 12, texts: 3, approaches: 4 },
    plan: {
      stages_applied: 10,
      texts_applied: 3,
      approaches_applied: 4,
      differences: 3,
      ignored: 2,
      unknown: 1,
    },
    differences: [
      {
        kind: "stage",
        source_key: "L014",
        co: 14,
        approach: null,
        from: "risposto",
        to: "contattato",
      },
      { kind: "stage", source_key: "L015", co: 15, approach: null, from: "chiuso", to: "risposto" },
      { kind: "text", source_key: "L016", co: 16, approach: "collab", from: null, to: null },
    ],
    names_changed: [{ source_key: "L014", co: 14, file_name: "Vecchio nome", name: "Nome nuovo" }],
    unknown_keys: ["X999"],
  };

  it("legge l'anteprima e la racconta come spec 02 §5.8", () => {
    const parsed = parsePartnerDevicePreview(preview)!;
    expect(parsed.plan).toEqual({
      stagesApplied: 10,
      textsApplied: 3,
      approachesApplied: 4,
      differences: 3,
      ignored: 2,
      unknown: 1,
    });
    expect(parsed.namesChanged).toEqual([
      { sourceKey: "L014", co: 14, fileName: "Vecchio nome", name: "Nome nuovo" },
    ]);
    expect(describePartnerDevicePlan(parsed)).toBe(
      "Applico 10 stati, 3 testi, 4 approcci. 2 stati sono diversi: restano quelli del gestionale e li trovi in «Da controllare». 1 testo è diverso da quello del team: resta quello del gestionale. 1 voce riguarda contatti o messaggi che il gestionale non conosce: la salto.",
    );
    // Testi diversi: restano quelli del gestionale, ma non vanno in «Da controllare» (31 ottobre 2026).
    const texts = parsed.differences.filter((item) => item.kind === "text");
    const onlyTexts = describePartnerDevicePlan({
      ...parsed,
      differences: [...texts, { ...texts[0], sourceKey: "L017", co: 17 }],
    });
    expect(onlyTexts).toBe(
      "Applico 10 stati, 3 testi, 4 approcci. 2 testi sono diversi da quelli del team: restano quelli del gestionale. 1 voce riguarda contatti o messaggi che il gestionale non conosce: la salto.",
    );
    expect(onlyTexts).not.toContain("Da controllare");
    expect(describePartnerDevicePlan({ ...parsed, alreadyImported: true })).toBe(
      "Questo file è già stato importato: importarlo di nuovo non cambia niente.",
    );
    expect(describePartnerDeviceImport(parsed.plan)).toBe(
      "File importato: 10 stati, 3 testi, 4 approcci. 3 differenze: restano i valori del gestionale.",
    );
    expect(describePartnerDeviceImport({ ...parsed.plan, differences: 1 })).toBe(
      "File importato: 10 stati, 3 testi, 4 approcci. 1 differenza: resta il valore del gestionale.",
    );
    expect(describePartnerDeviceImport({ ...parsed.plan, differences: 0, stagesApplied: 1 })).toBe(
      "File importato: 1 stato, 3 testi, 4 approcci.",
    );
  });

  it("anteprima con forma inattesa: null", () => {
    for (const value of [
      null,
      { ...preview, plan: { ...preview.plan, unknown: -1 } },
      { ...preview, device: "tablet" },
      { ...preview, differences: [{ ...preview.differences[0], from: "perso" }] },
      { ...preview, unknown_keys: ["../x"] },
      { ...preview, device_import_id: "x" },
    ])
      expect(parsePartnerDevicePreview(value)).toBeNull();
  });
});
