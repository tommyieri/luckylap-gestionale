import { describe, expect, it } from "vitest";
import {
  composePartnerAssistantMessage,
  PARTNER_ASSISTANT_OPT_OUT_LINES,
  partnerAssistantMessageId,
  partnerAssistantMessageText,
  partnerAssistantOptOutLine,
  type PartnerAssistantOutgoing,
} from "./mail-compose";
import type { PartnerAssistantLanguage, PartnerAssistantRegister } from "./types";

// Appendice A del piano, copiata così com'è: è il riferimento byte per byte.
const APPENDIX_A = {
  it_voi:
    "Se non è il momento, o preferite non ricevere altre email, scrivetemelo pure: non vi ricontatterò.",
  it_lei:
    "Se non è il momento, o preferisce non ricevere altre email, me lo scriva pure: non la ricontatterò.",
  en: "If the timing isn't right, or you'd rather not hear from me again, just let me know and I won't write again.",
  de: "Falls es gerade nicht passt oder Sie keine weiteren E-Mails wünschen, schreiben Sie mir einfach, dann melde ich mich nicht mehr.",
  fr: "Si ce n'est pas le bon moment, ou si vous préférez ne plus recevoir d'e-mails de ma part, dites-le-moi simplement : je ne vous écrirai plus.",
  es: "Si no es el momento, o prefiere no recibir más correos, dígamelo sin problema: no volveré a escribirle.",
} as const;

// Solo dati sintetici.
const first: PartnerAssistantOutgoing = {
  messageId: "<11111111-1111-4111-8111-111111111111@luckylap.example.test>",
  from: { name: "Tommaso | LuckyLap", address: "casella@luckylap.example.test" },
  to: "info@club-951.example.test",
  subject: "Club Sintetico 951 e LuckyLap",
  text: partnerAssistantMessageText({
    body: "Buongiorno,\nvi scrivo per LuckyLap: un'idea per l'Österreich-Treffen del Club Sintetico 951, con una riga abbastanza lunga da essere spezzata dal quoted-printable.",
    signature: "Tommaso\nLuckyLap\n+39 000 000 0000",
    optOut: APPENDIX_A.it_voi,
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

describe("frasi di uscita", () => {
  it("le sei frasi di uscita, byte per byte", () =>
    expect(PARTNER_ASSISTANT_OPT_OUT_LINES).toEqual(APPENDIX_A));
  it("non si possono cambiare in esecuzione", () =>
    expect(Object.isFrozen(PARTNER_ASSISTANT_OPT_OUT_LINES)).toBe(true));
  it.each([
    ["it", "voi", "it_voi"],
    ["it", "lei", "it_lei"],
    ["it", "you", "it_voi"],
    ["it", "sie", "it_voi"],
    ["en", "you", "en"],
    ["en", "lei", "en"],
    ["de", "sie", "de"],
    ["de", "you", "de"],
    ["fr", "vous", "fr"],
    ["es", "usted", "es"],
  ] as const)("%s/%s → %s", (l, r, k) =>
    expect(
      partnerAssistantOptOutLine(l as PartnerAssistantLanguage, r as PartnerAssistantRegister),
    ).toBe(APPENDIX_A[k]),
  );
  it("frasi senza ? né !, senza link né cifre né @", () => {
    for (const l of Object.values(PARTNER_ASSISTANT_OPT_OUT_LINES))
      expect(l).toMatch(/^[^\r\n<>@0-9?!]{20,240}$/);
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
    expect(decodeBody(raw)).toBe(first.text);
    expect(decodeBody(raw).endsWith(APPENDIX_A.it_voi)).toBe(true);
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
  it("rifiuta un Message-ID che non resterebbe su una riga", async () =>
    await expect(
      composePartnerAssistantMessage({
        ...first,
        messageId: `<11111111-1111-4111-8111-111111111111@${"casella-molto-lunga.".repeat(4)}example.test>`,
      }),
    ).rejects.toThrow());
});
