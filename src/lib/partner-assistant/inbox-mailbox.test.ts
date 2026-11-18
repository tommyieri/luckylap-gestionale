import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { FetchMessageObject, ImapFlow, ImapFlowOptions } from "imapflow";
import {
  checkPartnerAssistantInboxMailbox,
  readPartnerInboxMessage,
  type PartnerInboxMailboxInput,
} from "./inbox-mailbox";
import type { PartnerInboxCandidate } from "./inbox-store";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const activated = "2026-11-18T10:00:00Z";
const own = "mail@brand.example.test";
const peer = "person@event.example.test";
const mail = {
  user: own,
  password: "synthetic-password",
  fromName: "Nome sintetico",
  smtpHost: "smtp.example.test",
  imapHost: "imap.example.test",
  testTo: [],
  domain: "brand.example.test",
};
const candidate: PartnerInboxCandidate = {
  partner_id: "94000000-0000-4000-8000-000000000001",
  co: 951,
  name: "Expo Sintetica 2027",
  addresses: [peer],
  first_contact_at: "2026-11-17T08:00:00Z",
  last_contact_at: "2026-11-17T08:00:00Z",
  subject_alias: "expo sintetica",
};
function message(uid: number, changes: Partial<FetchMessageObject> = {}): FetchMessageObject {
  const subject = "Expo Sintetica 2027";
  const id = `<synthetic-${uid}@event.example.test>`;
  return {
    uid,
    seq: uid,
    internalDate: new Date("2026-11-18T10:35:00Z"),
    size: 200,
    envelope: {
      from: [{ address: peer, name: "Persona Sintetica" }],
      to: [{ address: own }],
      subject,
      messageId: id,
    },
    headers: Buffer.from(
      `From: Persona Sintetica <${peer}>\r\nTo: ${own}\r\nMessage-ID: ${id}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n`,
    ),
    ...changes,
  };
}
function header(row: FetchMessageObject, name: string, value: string) {
  row.headers = Buffer.from(
    row
      .headers!.toString()
      .split("\r\n")
      .filter((line) => !line.toLowerCase().startsWith(`${name.toLowerCase()}:`))
      .filter(Boolean)
      .concat(`${name}: ${value}`)
      .join("\r\n") + "\r\n",
  );
  return row;
}
class FakeImap extends EventEmitter {
  usable = false;
  mailbox:
    | { path: string; readOnly: boolean; uidValidity: bigint; uidNext: number; exists: number }
    | false = false;
  uidValidity = 42n;
  readonly bodies = new Map<number, Buffer>();
  release = vi.fn();
  constructor(readonly messages: FetchMessageObject[]) {
    super();
  }
  connect = vi.fn(async () => {
    this.usable = true;
  });
  getMailboxLock = vi.fn(async (path: string, options: { readOnly: boolean }) => {
    this.mailbox = {
      path,
      readOnly: options.readOnly,
      uidValidity: this.uidValidity,
      uidNext: Math.max(0, ...this.messages.map((row) => row.uid)) + 1,
      exists: this.messages.length,
    };
    return { path, release: this.release };
  });
  search = vi.fn(
    async (query: { uid: string; since: Date }, _options: unknown): Promise<number[] | false> => {
      const [lower, upper] = query.uid.split(":").map(Number);
      return this.messages
        .filter(
          (row) =>
            row.uid >= lower &&
            row.uid <= upper &&
            row.internalDate instanceof Date &&
            row.internalDate >= query.since,
        )
        .map((row) => row.uid);
    },
  );
  fetchAll = vi.fn(async (uids: number[], _query: unknown, _options: unknown) =>
    this.messages.filter((row) => uids.includes(row.uid)),
  );
  fetchOne = vi.fn(
    async (uid: number, query: { bodyParts: { key: string }[] }, _options: unknown) => {
      const bytes = this.bodies.get(uid);
      return bytes
        ? { uid, seq: uid, bodyParts: new Map([[query.bodyParts[0].key.toLowerCase(), bytes]]) }
        : false;
    },
  );
  noop = vi.fn(async () => {});
  close = vi.fn(() => {
    this.usable = false;
  });
}
function setup(rows: FetchMessageObject[] = []) {
  const fake = new FakeImap(rows);
  const create = vi.fn((_options: ImapFlowOptions) => fake as unknown as ImapFlow);
  const input: PartnerInboxMailboxInput = {
    activated_at: activated,
    cursor: { path: "INBOX", uid_validity: null, last_uid: 0 },
    candidates: [candidate],
  };
  const run = () =>
    checkPartnerAssistantInboxMailbox(mail, input, new AbortController().signal, {
      createImapFlow: create,
      now: () => NOW,
    });
  return { fake, create, input, run };
}
describe("lettura incrementale IONOS", () => {
  it("legge anche una risposta senza References a un contatto manuale e usa EXAMINE", async () => {
    const t = setup([message(7)]);
    const result = await t.run();
    expect(result.status).toBe("complete");
    if (result.status !== "complete") return;
    expect(result.batch.folder).toEqual({
      path: "INBOX",
      uid_validity: "42",
      expected_last_uid: 0,
      last_uid: 7,
    });
    expect(result.batch.messages).toEqual([
      {
        message_id: "<synthetic-7@event.example.test>",
        from_address: peer,
        received_at: "2026-11-18T10:35:00.000Z",
        subject: "Expo Sintetica 2027",
        automatic: false,
      },
    ]);
    expect(t.fake.getMailboxLock).toHaveBeenCalledWith("INBOX", { readOnly: true });
    expect(t.fake.release).toHaveBeenCalledOnce();
    expect(t.fake.close).toHaveBeenCalledOnce();
    expect(t.create.mock.calls[0][0]).toMatchObject({
      logger: false,
      secure: true,
      tls: { minVersion: "TLSv1.2" },
    });
  });
  it("inizia dall'attivazione e non importa vecchie risposte dello stesso giorno", async () => {
    const t = setup([message(6, { internalDate: new Date("2026-11-18T09:59:59Z") }), message(7)]);
    const result = await t.run();
    if (result.status !== "complete") throw new Error("expected_complete");
    expect(result.batch.messages).toHaveLength(1);
    expect(result.batch.messages[0].message_id).toBe("<synthetic-7@event.example.test>");
    expect(result.batch.folder.last_uid).toBe(7);
  });
  it("limita a 50 messaggi e non salta il successivo", async () => {
    const t = setup(Array.from({ length: 51 }, (_, index) => message(index + 1)));
    const first = await t.run();
    if (first.status !== "complete") throw new Error("expected_complete");
    expect(first.batch.messages).toHaveLength(50);
    expect(first.batch.folder.last_uid).toBe(50);
    t.input.cursor = { path: "INBOX", uid_validity: "42", last_uid: 50 };
    const second = await t.run();
    if (second.status !== "complete") throw new Error("expected_complete");
    expect(second.batch.messages).toHaveLength(1);
    expect(second.batch.folder.last_uid).toBe(51);
  });
  it("un cambio UIDVALIDITY riparte dall'attivazione e conserva il confronto sul vecchio cursore", async () => {
    const t = setup([message(7)]);
    t.input.cursor = { path: "INBOX", uid_validity: "41", last_uid: 999 };
    const result = await t.run();
    if (result.status !== "complete") throw new Error("expected_complete");
    expect(result.batch.folder).toEqual({
      path: "INBOX",
      uid_validity: "42",
      expected_last_uid: 999,
      last_uid: 7,
    });
  });
  it("SEARCH fallita o FETCH incompleto non producono un cursore nuovo", async () => {
    const t = setup([message(7)]);
    t.fake.search.mockResolvedValueOnce(false);
    expect(await t.run()).toEqual({ status: "uncertain", reason: "inbox_lettura_incompleta" });
    expect(t.fake.fetchAll).not.toHaveBeenCalled();
    t.fake.fetchAll.mockResolvedValueOnce([]);
    expect(await t.run()).toEqual({ status: "uncertain", reason: "inbox_lettura_incompleta" });
  });
  it("verifica la connessione anche dopo una ricerca vuota", async () => {
    const t = setup([message(7)]);
    t.fake.search.mockResolvedValue([]);
    t.fake.noop.mockRejectedValueOnce(new Error("synthetic_socket_error"));
    expect(await t.run()).toEqual({ status: "uncertain", reason: "inbox_lettura_incompleta" });
  });
  it("un errore socket notificato durante il controllo invalida anche un risultato vuoto", async () => {
    const t = setup([]);
    t.fake.noop.mockImplementationOnce(async () => {
      t.fake.emit("error", new Error("synthetic_error"));
    });
    expect(await t.run()).toEqual({ status: "uncertain", reason: "inbox_lettura_incompleta" });
  });
  it("non legge corpi di newsletter o ricevute automatiche", async () => {
    const row = header(message(7), "List-Unsubscribe", "<https://event.example.test/unsubscribe>");
    const t = setup([row]);
    const result = await t.run();
    if (result.status !== "complete") throw new Error("expected_complete");
    expect(result.batch.messages[0].automatic).toBe(true);
    expect(t.fake.fetchOne).not.toHaveBeenCalled();
  });
  it("legge una parte HTML pertinente da nuovo mittente senza scaricare gli allegati", async () => {
    const bytes = Buffer.from(
      "<html><style>hidden synthetic text</style><p>Buongiorno, disponibilità dello stand.</p><p>Un saluto.</p></html>",
    );
    const row = message(7, {
      bodyStructure: {
        type: "multipart/mixed",
        childNodes: [
          {
            type: "text/html",
            part: "1",
            size: bytes.length,
            encoding: "8bit",
            parameters: { charset: "utf-8" },
          },
          { type: "application/pdf", part: "2", size: 200_000, disposition: "attachment" },
        ],
      },
    });
    row.envelope!.from = [{ address: "new-person@agency.example.test" }];
    header(row, "From", "Persona Nuova <new-person@agency.example.test>");
    const t = setup([row]);
    t.fake.bodies.set(7, bytes);
    const result = await t.run();
    if (result.status !== "complete") throw new Error("expected_complete");
    expect(result.batch.messages[0].body_excerpt).toBe(
      "Buongiorno, disponibilità dello stand. Un saluto.",
    );
    expect(t.fake.fetchOne).toHaveBeenCalledWith(
      7,
      { uid: true, bodyParts: [{ key: "1", start: 0, maxLength: 32769 }] },
      { uid: true },
    );
    expect(t.fake.fetchOne).toHaveBeenCalledOnce();
  });
  it("preferisce il testo semplice e decodifica quoted-printable senza conservare il thread completo", async () => {
    const bytes = Buffer.from("Disponibilit=C3=A0 dello stand sintetico.\r\nUn saluto.");
    const row = message(7, {
      bodyStructure: {
        type: "multipart/alternative",
        childNodes: [
          { type: "text/html", part: "1", size: 20, encoding: "8bit" },
          {
            type: "text/plain",
            part: "2",
            size: bytes.length,
            encoding: "quoted-printable",
            parameters: { charset: "utf-8" },
          },
        ],
      },
    });
    const t = setup([row]);
    t.fake.bodies.set(7, bytes);
    const result = await t.run();
    if (result.status !== "complete") throw new Error("expected_complete");
    expect(result.batch.messages[0].body_excerpt).toBe(
      "Disponibilità dello stand sintetico. Un saluto.",
    );
    expect(t.fake.fetchOne.mock.calls[0][1].bodyParts[0].key).toBe("2");
  });
  it("un errore nel recupero della parte impedisce di avanzare oltre quel messaggio", async () => {
    const t = setup([
      message(7, { bodyStructure: { type: "text/plain", part: "1", size: 10, encoding: "7bit" } }),
    ]);
    expect(await t.run()).toEqual({ status: "uncertain", reason: "inbox_lettura_incompleta" });
  });
  it("legge il testo semplice alla radice con la chiave minuscola restituita da ImapFlow", async () => {
    const bytes = Buffer.from("Testo sintetico senza multipart.");
    const t = setup([
      message(7, { bodyStructure: { type: "text/plain", size: bytes.length, encoding: "7bit" } }),
    ]);
    t.fake.fetchOne.mockResolvedValueOnce({
      uid: 7,
      seq: 7,
      bodyParts: new Map([["text", bytes]]),
    });
    const result = await t.run();
    if (result.status !== "complete") throw new Error("expected_complete");
    expect(result.batch.messages[0].body_excerpt).toBe("Testo sintetico senza multipart.");
    expect(t.fake.fetchOne).toHaveBeenCalledWith(
      7,
      { uid: true, bodyParts: [{ key: "TEXT", start: 0, maxLength: 32769 }] },
      { uid: true },
    );
  });
  it("un cambio UIDVALIDITY durante la scansione rende il batch inutilizzabile", async () => {
    const t = setup([message(7)]);
    t.fake.fetchAll.mockImplementationOnce(async () => {
      if (t.fake.mailbox) t.fake.mailbox.uidValidity = 43n;
      return t.fake.messages;
    });
    expect(await t.run()).toEqual({ status: "uncertain", reason: "inbox_lettura_incompleta" });
  });
});
describe("riconoscimento dei metadati", () => {
  const read = (row: FetchMessageObject) =>
    readPartnerInboxMessage(row, own, Date.parse(activated), NOW);
  it.each([
    ["Auto-Submitted", "auto-generated"],
    ["Precedence", "bulk"],
    ["List-Id", "synthetic-newsletter"],
    ["Return-Path", "<>"],
  ])("marca come automatico %s", (name, value) =>
    expect(read(header(message(7), name, value))?.automatic).toBe(true),
  );
  it("non confonde la conferma di ricezione di un modulo con una risposta umana", () => {
    const row = message(7);
    row.envelope!.subject = "Formulaire : votre demande a bien été reçue !";
    header(row, "Subject", row.envelope!.subject!);
    expect(read(row)?.automatic).toBe(true);
  });
  it("riconosce una risposta umana che conserva l'oggetto di un vecchio fuori ufficio", () => {
    const row = message(7);
    row.envelope!.subject = "Re: Risposta automatica: Synthetic Winter Event";
    header(row, "Subject", row.envelope!.subject!);
    header(row, "In-Reply-To", "<outbound@brand.example.test>");
    expect(read(row)?.automatic).toBe(false);
  });
  it("gli header automatici restano vincolanti anche con oggetto e riferimenti ereditati", () => {
    const row = message(7);
    row.envelope!.subject = "AW: Risposta automatica: Synthetic Winter Event";
    header(row, "Subject", row.envelope!.subject!);
    header(row, "In-Reply-To", "<outbound@brand.example.test>");
    header(row, "Auto-Submitted", "auto-replied");
    expect(read(row)?.automatic).toBe(true);
  });
  it("senza continuità al thread conserva l'euristica sul titolo automatico", () => {
    const row = message(7);
    row.envelope!.subject = "Risposta automatica: Synthetic Winter Event";
    header(row, "Subject", row.envelope!.subject!);
    expect(read(row)?.automatic).toBe(true);
  });
  it("un riferimento malformato non esenta il titolo automatico dalla verifica", () => {
    const row = message(7);
    row.envelope!.subject = "Re: Risposta automatica: Synthetic Winter Event";
    header(row, "Subject", row.envelope!.subject!);
    header(row, "In-Reply-To", "not a valid reference");
    expect(read(row)?.automatic).toBe(true);
  });
  it("confronta gli indirizzi From e To reali con l'envelope", () => {
    expect(read(header(message(7), "From", "other@event.example.test"))).toBeNull();
    expect(read(header(message(7), "To", "other@brand.example.test"))).toBeNull();
  });
  it("non tratta l'indirizzo nel nome visualizzato come destinatario", () => {
    expect(read(header(message(7), "To", `"${own}" <other@brand.example.test>`))).toBeNull();
  });
  it("accetta il proprio indirizzo in Cc insieme a una lista semplice coerente", () => {
    const row = message(7);
    row.envelope!.to = [{ address: "other@brand.example.test" }];
    row.envelope!.cc = [{ address: own }, { address: "third@brand.example.test" }];
    header(row, "To", "Other <other@brand.example.test>");
    header(row, "Cc", `"Synthetic, Name" <${own}>, third@brand.example.test`);
    expect(read(row)?.automatic).toBe(false);
  });
  it("non ricostruisce Message-ID assenti, duplicati o discordanti", () => {
    const row = message(7);
    row.envelope!.messageId = "<different@event.example.test>";
    expect(read(row)).toBeNull();
    const duplicate = message(8);
    duplicate.headers = Buffer.concat([
      duplicate.headers!,
      Buffer.from("Message-ID: <duplicate@event.example.test>\r\n"),
    ]);
    expect(read(duplicate)).toBeNull();
  });
  it("trasmette riferimenti esatti per il confronto SMTP nel database", () => {
    const row = header(message(7), "In-Reply-To", "<outbound@brand.example.test>");
    header(row, "References", "<earlier@brand.example.test> <outbound@brand.example.test>");
    expect(read(row)?.references).toEqual([
      "<earlier@brand.example.test>",
      "<outbound@brand.example.test>",
    ]);
  });
});
