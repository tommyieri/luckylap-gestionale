import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  composePartnerAssistantLookbookTestMessage,
  composePartnerAssistantMessage,
  partnerAssistantMessageId,
  partnerAssistantMessageText,
  partnerAssistantOptOutLine,
  type PartnerAssistantOutgoing,
} from "./mail-compose";
import { PARTNER_ASSISTANT_TEST_MIME_MAX_BYTES } from "./test-lookbook-metadata";

const REQUIRED_OPT_OUT =
  "Si ce n'est pas le bon moment, ou si vous préférez ne plus recevoir d'e-mails de ma part, dites-le-moi simplement : je ne vous écrirai plus.";

// Solo dati sintetici.
const first: PartnerAssistantOutgoing = {
  messageId: "<11111111-1111-4111-8111-111111111111@luckylap.example.test>",
  from: { name: "Tommaso | LuckyLap", address: "casella@luckylap.example.test" },
  to: "info@club-951.example.test",
  subject: "Club Sintetico 951 e LuckyLap",
  text: partnerAssistantMessageText({
    body: "Buongiorno,\nvi scrivo per LuckyLap: un'idea per l'Österreich-Treffen del Club Sintetico 951, con una riga abbastanza lunga da essere spezzata dal quoted-printable.",
    signature: "Tommaso\nLuckyLap\n+39 000 000 0000",
    optOut: partnerAssistantOptOutLine(),
  }),
  date: new Date("2026-10-29T08:40:00Z"),
};

/** Decodifica il corpo quoted-printable (o 7bit) del messaggio: righe CRLF in LF, senza il CRLF finale. */
function decodeBody(raw: string): string {
  const separator = raw.indexOf("\r\n\r\n");
  const headers = raw.slice(0, separator);
  let body = raw.slice(separator + 4);
  if (/^Content-Transfer-Encoding: quoted-printable$/im.test(headers)) {
    body = body.replace(/=\r\n/g, "");
    const bytes: number[] = [];
    for (let i = 0; i < body.length; i++) {
      const hex = body[i] === "=" ? body.slice(i + 1, i + 3) : "";
      if (/^[0-9A-F]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else bytes.push(body.charCodeAt(i));
    }
    body = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  }
  return body.replace(/\r\n$/, "").replace(/\r\n/g, "\n");
}

describe("frase di uscita", () => {
  it("usa la frase richiesta, byte per byte", () =>
    expect(partnerAssistantOptOutLine()).toBe(REQUIRED_OPT_OUT));
  it("rientra nei vincoli del messaggio", () => {
    expect(partnerAssistantOptOutLine()).toMatch(/^[^\r\n<>@0-9?!]{20,240}$/);
    expect(partnerAssistantOptOutLine()).not.toMatch(/http/i);
  });
});

describe("testo e Message-ID", () => {
  it("testo", () =>
    expect(partnerAssistantMessageText({ body: "B", signature: "S", optOut: "O" })).toBe(
      "B\n\nS\n\nO",
    ));
  it("Message-ID", () =>
    expect(
      partnerAssistantMessageId("luckylap.example.test", "11111111-1111-4111-8111-111111111111"),
    ).toBe("<11111111-1111-4111-8111-111111111111@luckylap.example.test>"));
  it("Message-ID con un uuid nuovo ogni volta", () => {
    const a = partnerAssistantMessageId("luckylap.example.test");
    const b = partnerAssistantMessageId("luckylap.example.test");
    expect(a).toMatch(
      /^<[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@luckylap\.example\.test>$/,
    );
    expect(a).not.toBe(b);
  });
});

describe("composizione MIME", () => {
  it("MIME: CRLF, solo ASCII, text/plain utf-8, niente multipart, X-Mailer, In-Reply-To, References", async () => {
    const raw = await composePartnerAssistantMessage(first);
    expect(raw).not.toMatch(/(?<!\r)\n/);
    expect(raw).toMatch(/^[\x00-\x7f]*$/);
    expect(raw).toMatch(/Content-Type: text\/plain; charset=utf-8/);
    expect(raw).not.toMatch(/multipart|X-Mailer|In-Reply-To|References|^Cc:|^Bcc:|^Reply-To:/im);
  });
  it("la riga che cerca la SQL", async () =>
    expect(`\r\n${await composePartnerAssistantMessage(first)}`).toContain(
      `\r\nMessage-ID: ${first.messageId}\r\n`,
    ));
  it("From con il nome, To con un solo indirizzo, Date passata", async () => {
    const raw = await composePartnerAssistantMessage(first);
    expect(raw).toMatch(/^From: .*Tommaso \| LuckyLap.*<casella@luckylap\.example\.test>/m);
    expect(raw).toMatch(/^To: <?info@club-951\.example\.test>?\r?$/m);
    expect(raw).toContain("Date: Thu, 29 Oct 2026 08:40:00 +0000");
  });
  it("oggetto con accenti in encoded word; corpo decodificato uguale al testo, frase in fondo", async () => {
    const raw = await composePartnerAssistantMessage({
      ...first,
      subject: "Club Sintetico 951 e LuckyLap: un'idea per l'Österreich-Treffen",
    });
    expect(raw).toMatch(/^Subject: =\?UTF-8\?/m);
    const decoded = decodeBody(raw);
    expect(decoded).toBe(first.text);
    expect(decoded.endsWith(REQUIRED_OPT_OUT)).toBe(true);
    expect(decoded.split(REQUIRED_OPT_OUT)).toHaveLength(2);
  });
  it("un a capo nell'oggetto non diventa un'intestazione", async () => {
    const raw = await composePartnerAssistantMessage({
      ...first,
      subject: "Club Sintetico 951\r\nBcc: x@example.test",
    });
    expect(raw).not.toMatch(/^Bcc:/im);
    expect(raw.split("\r\n\r\n")[0].match(/^[A-Za-z-]+:/gm)).toEqual([
      "From:",
      "To:",
      "Subject:",
      "Message-ID:",
      "Date:",
      "Content-Transfer-Encoding:",
      "MIME-Version:",
      "Content-Type:",
    ]);
  });
  it("lo stesso messaggio dà gli stessi byte", async () =>
    expect(await composePartnerAssistantMessage(first)).toBe(
      await composePartnerAssistantMessage(first),
    ));
  it("la composizione reale ignora qualsiasi opzione di allegato estranea", async () => {
    const raw = await composePartnerAssistantMessage({
      ...first,
      attachments: [{ path: "https://file.example.test/club.pdf" }],
    } as PartnerAssistantOutgoing);
    expect(raw).not.toMatch(/multipart|application\/pdf|Content-Disposition|file\.example\.test/);
    expect(decodeBody(raw)).toBe(first.text);
  });
  it("rifiuta un Message-ID che non resterebbe su una riga", async () =>
    await expect(
      composePartnerAssistantMessage({
        ...first,
        messageId: `<11111111-1111-4111-8111-111111111111@${"casella-molto-lunga.".repeat(4)}example.test>`,
      }),
    ).rejects.toThrow());
});

describe("composizione MIME della prova con lookbook", () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
  const digest = (content: Buffer) => createHash("sha256").update(content).digest("hex");

  it.each([
    ["porsche_club", "LuckyLap-Lookbook-Porsche-Clubs.pdf"],
    ["club", "LuckyLap-Lookbook-Clubs.pdf"],
  ] as const)(
    "%s: intestazioni e testo invariati, un solo PDF con byte e hash recuperabili",
    async (code, filename) => {
      const raw = await composePartnerAssistantLookbookTestMessage(first, { code, content: pdf });
      const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
      expect(boundary).toBeDefined();
      expect(raw).not.toMatch(/(?<!\r)\n/);
      expect(raw).toMatch(/^[\x00-\x7f]*$/);
      expect(raw).toMatch(/^Content-Type: multipart\/mixed;/m);
      expect(raw).not.toMatch(/X-Mailer|In-Reply-To|References|^Cc:|^Bcc:|^Reply-To:/im);
      const parts = raw
        .split(`--${boundary}`)
        .slice(1, -1)
        .map((part) => part.replace(/^\r\n/, ""));
      expect(parts).toHaveLength(2);
      expect(parts[0]).toMatch(/^Content-Type: text\/plain; charset=utf-8/m);
      expect(decodeBody(parts[0]!)).toBe(first.text);
      expect(parts[1]).toMatch(/^Content-Type: application\/pdf;/m);
      expect(parts[1]).toContain(`filename=${filename}`);
      expect(parts[1]).toMatch(/^Content-Disposition: attachment;/m);
      expect(parts[1]).toMatch(/^Content-Transfer-Encoding: base64/m);
      const attachment = Buffer.from(parts[1]!.split("\r\n\r\n")[1]!.replace(/\s/g, ""), "base64");
      expect(attachment).toEqual(pdf);
      expect(digest(attachment)).toBe(digest(pdf));
      const original = await composePartnerAssistantMessage(first);
      const headers = (mime: string) =>
        mime
          .split("\r\n\r\n")[0]!
          .split("\r\n")
          .filter((line) => /^(From|To|Subject|Message-ID|Date):/.test(line));
      expect(headers(raw)).toEqual(headers(original));
      expect(Buffer.byteLength(raw, "ascii")).toBeLessThan(PARTNER_ASSISTANT_TEST_MIME_MAX_BYTES);
    },
  );

  it.each([
    { code: "../../club", content: pdf },
    { code: "club", content: "https://file.example.test/club.pdf" },
    { code: "club", content: { path: "/tmp/club.pdf" } },
    { code: "club", content: Buffer.from("Documento sintetico che non è PDF") },
  ])("rifiuta percorsi, URL e contenuti diversi dai byte PDF", async (input) => {
    await expect(composePartnerAssistantLookbookTestMessage(first, input as never)).rejects.toThrow(
      "Allegato",
    );
  });

  it("applica il limite a tutto il MIME, compresa l'espansione base64", async () => {
    const large = Buffer.alloc(3_200_000, 0x61);
    large.write("%PDF-1.4\n", "ascii");
    await expect(
      composePartnerAssistantLookbookTestMessage(first, { code: "club", content: large }),
    ).rejects.toThrow("4 MiB");
  });
});
