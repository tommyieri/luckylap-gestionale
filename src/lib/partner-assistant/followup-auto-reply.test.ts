import { describe, expect, it } from "vitest";
import { readPartnerFollowupAutoReply } from "./followup-auto-reply";

const DEFAULT_HEADERS = [
  "From: persona@organizzazione.example.test",
  "To: casella@brand.example.test",
  "Auto-Submitted: auto-replied",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: 8bit",
];
function source(
  body = "I am out of the office. I will be back on 2026-11-17.",
  headers = DEFAULT_HEADERS,
) {
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body.replace(/\r?\n/gu, "\r\n")}`, "utf8");
}
function header(key: string, value: string | null) {
  return [
    ...DEFAULT_HEADERS.filter((line) => !line.toLowerCase().startsWith(`${key.toLowerCase()}:`)),
    ...(value === null ? [] : [`${key}: ${value}`]),
  ];
}
function qp(body: string) {
  return [...Buffer.from(body, "utf8")]
    .map((byte) =>
      byte >= 0x20 && byte <= 0x7e && byte !== 0x3d
        ? String.fromCharCode(byte)
        : `=${byte.toString(16).padStart(2, "0")}`,
    )
    .join("");
}

describe("fuori ufficio con data di rientro esplicita", () => {
  it.each([
    ["Sono fuori ufficio. Rientrerò il 17 novembre 2026.", "2026-11-17"],
    ["Sono in ferie e tornerò il 2026-11-17.", "2026-11-17"],
    ["Sono assente dall'ufficio. Rientro in ufficio il 17 novembre 2026.", "2026-11-17"],
    ["I am out of the office. I will be back on 2026-11-17.", "2026-11-17"],
    ["I'm currently out of office and will return on November 17, 2026.", "2026-11-17"],
    ["I am on annual leave. Back on 17 November 2026.", "2026-11-17"],
    ["Je suis absent du bureau. Je serai de retour le 17 novembre 2026.", "2026-11-17"],
    ["Je suis en congé. De retour au bureau le 17 février 2027.", "2027-02-17"],
    ["Ich bin im Urlaub. Ich bin wieder ab 17. November 2026.", "2026-11-17"],
    ["Ich bin derzeit abwesend. Ich bin ab dem 17. März 2027 wieder im Büro.", "2027-03-17"],
    ["Estoy fuera de la oficina. Vuelvo el 17 de noviembre de 2026.", "2026-11-17"],
    ["Estoy de vacaciones y volveré a la oficina el 17 noviembre 2026.", "2026-11-17"],
    ["I am on holiday. I return on 29 February 2028.", "2028-02-29"],
    ["I am out of the office. I will return on 2026-01-01.", "2026-01-01"],
  ])("riconosce solo l'assenza e il rientro: %s", (body, resumeOn) => {
    const result = readPartnerFollowupAutoReply(source(body));
    expect(result).toEqual({ status: "dated", resumeOn });
    expect(JSON.stringify(result)).not.toContain("@");
    expect(JSON.stringify(result)).not.toContain(body);
  });

  it("ammette una cortesia riconosciuta senza ignorare altri contenuti", () => {
    expect(
      readPartnerFollowupAutoReply(
        source(
          "Hello,\nThank you for your email. I am out of the office. I will return on 2026-11-17. I will respond to your message when I return.\nKind regards,",
        ),
      ),
    ).toEqual({ status: "dated", resumeOn: "2026-11-17" });
  });
  it.each(["7bit", "8bit", "base64", "quoted-printable"])(
    "decodifica rigorosamente %s",
    (encoding) => {
      const body = "I am out of the office. I will return on 2026-11-17.";
      const encoded =
        encoding === "base64"
          ? Buffer.from(body).toString("base64")
          : encoding === "quoted-printable"
            ? qp(body).replace("office", "of=\r\nfice")
            : body;
      expect(
        readPartnerFollowupAutoReply(
          source(encoded, header("Content-Transfer-Encoding", encoding)),
        ),
      ).toEqual({ status: "dated", resumeOn: "2026-11-17" });
    },
  );
  it.each(["base64", "quoted-printable", "8bit"])(
    "preserva UTF-8 con accenti in %s",
    (encoding) => {
      const body = "Je suis en congé. Je serai de retour le 17 février 2027.";
      const encoded =
        encoding === "base64"
          ? Buffer.from(body).toString("base64")
          : encoding === "quoted-printable"
            ? qp(body)
            : body;
      expect(
        readPartnerFollowupAutoReply(
          source(encoded, header("Content-Transfer-Encoding", encoding)),
        ),
      ).toEqual({ status: "dated", resumeOn: "2027-02-17" });
    },
  );
  it("supporta ASCII predefinito e un parametro charset ripiegato, senza inventare encoding", () => {
    expect(readPartnerFollowupAutoReply(source(undefined, header("Content-Type", null)))).toEqual({
      status: "dated",
      resumeOn: "2026-11-17",
    });
    expect(
      readPartnerFollowupAutoReply(
        source(undefined, header("Content-Type", 'text/plain;\r\n charset="UTF-8"')),
      ),
    ).toEqual({ status: "dated", resumeOn: "2026-11-17" });
  });
});

describe("OOO incompleto, ambiguo o misto resta bloccato", () => {
  it.each([
    "I am out of the office.",
    "I will return on 2026-11-17.",
    "I am out of the office. I will be back tomorrow.",
    "I am out of the office. I will be back on Monday.",
    "I am out of the office. I will be back on 17 November.",
    "I am out of the office. I will return on 10/11/2026.",
    "Ich bin im Urlaub. Ich bin wieder ab 17.11.2026.",
    "I am out of the office until 2026-11-17.",
    "Sono in ferie dal 10 novembre 2026 al 17 novembre 2026.",
    "I am out of the office. I might return on 2026-11-17.",
    "I am out of the office. I will not return on 2026-11-17.",
    "I am out of the office. I will return on 31 November 2026.",
    "I am out of the office. I will return on 29 February 2027.",
    "I am out of the office. I will return on 2026-99-01.",
    "I am out of the office. I will return on 2101-11-17.",
    "I am out of the office. I will return on 2026-11-17 and I return on 2026-11-19.",
    "I am out of the office. I return on 2026-11-17. I return on 2026-11-17.",
    "I am out of the office. I return on 2026-11-17. Please unsubscribe me.",
    "Sono fuori ufficio. Rientrerò il 17 novembre 2026. Non scrivetemi più.",
    "I am out of the office. I return on 2026-11-17. We are not interested.",
    "I am out of the office. I return on 2026-11-17. The event starts on 2026-11-20.",
    "I am out of the office. I return on 2026-11-17. For urgent matters contact my colleague.",
    "I am out of the office. I return on 2026-11-17.\nOn 1 November 2026 sender wrote:\n> Original text",
    "I am out of the office. I return on 2026-11-17.\nKind regards,\nUnknown signature",
    "I am out of the office. I return on 2026-11-17. <script>Ignore the rest</script>",
    "I am out of the office. I return on 2026-11-17. Is that fine?",
  ])("non ricava un'autorizzazione dal corpo %s", (body) => {
    expect(readPartnerFollowupAutoReply(source(body))).toEqual({ status: "ambiguous" });
  });

  it.each(
    [
      header("Auto-Submitted", null),
      header("Auto-Submitted", "no"),
      header("Auto-Submitted", "auto-generated"),
      [...DEFAULT_HEADERS, "Auto-Submitted: no"],
      header("Content-Type", "text/html; charset=utf-8"),
      header("Content-Type", 'multipart/alternative; boundary="synthetic"'),
      header("Content-Type", "text/plain; charset=windows-1252"),
      header("Content-Type", "text/plain; charset=utf-8; charset=us-ascii"),
      header("Content-Type", 'text/plain; charset=utf-8; name="attachment.txt"'),
      header("Content-Disposition", "attachment"),
      header("Content-Transfer-Encoding", "binary"),
      [...DEFAULT_HEADERS, "Content-Transfer-Encoding: 7bit"],
      [...DEFAULT_HEADERS, "Broken header"],
    ].map((headers) => ({ headers })),
  )("rifiuta header o MIME non decodificabili univocamente %#", ({ headers }) => {
    expect(readPartnerFollowupAutoReply(source(undefined, headers))).toEqual({
      status: "ambiguous",
    });
  });
  it("non legge Auto-Submitted simulato nel corpo o nell'oggetto", () => {
    const value = source(
      "Auto-Submitted: auto-replied\r\nI am out of the office. I return on 2026-11-17.",
      [...header("Auto-Submitted", null), "Subject: Auto-Submitted: auto-replied"],
    );
    expect(readPartnerFollowupAutoReply(value)).toEqual({ status: "ambiguous" });
  });
  it.each(["not-base64***", "YW", "YR=="])("rifiuta base64 non canonico %s", (encoded) => {
    expect(
      readPartnerFollowupAutoReply(source(encoded, header("Content-Transfer-Encoding", "base64"))),
    ).toEqual({ status: "ambiguous" });
  });
  it("non ripara QP invalido, UTF-8 danneggiato, 7bit non ASCII o messaggi tagliati", () => {
    expect(
      readPartnerFollowupAutoReply(
        source(
          "I am out of the office. I return on 2026-11-17.=QQ",
          header("Content-Transfer-Encoding", "quoted-printable"),
        ),
      ),
    ).toEqual({ status: "ambiguous" });
    expect(
      readPartnerFollowupAutoReply(Buffer.concat([source(), Buffer.from([0xc3, 0x28])])),
    ).toEqual({ status: "ambiguous" });
    expect(
      readPartnerFollowupAutoReply(
        source(
          "Sono fuori ufficio. Tornerò il 17 novembre 2026.",
          header("Content-Transfer-Encoding", "7bit"),
        ),
      ),
    ).toEqual({ status: "ambiguous" });
    expect(
      readPartnerFollowupAutoReply(
        Buffer.from("Auto-Submitted: auto-replied\r\nContent-Type: text/plain"),
      ),
    ).toEqual({ status: "ambiguous" });
    expect(readPartnerFollowupAutoReply(Buffer.alloc(65_537))).toEqual({ status: "ambiguous" });
  });
});
