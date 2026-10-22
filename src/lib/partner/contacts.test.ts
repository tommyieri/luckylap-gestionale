import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAILTO_BODY_LIMIT,
  contactHref,
  hostLabel,
  messageMailto,
  partnerActions,
  partnerDomain,
  partnerLinkValue,
  routeText,
  shortRoute,
} from "./contacts";
import { partnerFixtureId } from "./fixtures";
import type { PartnerChannel, PartnerContactKind, PartnerContactLink } from "./model";

// Spec 02 §2.2, §5.4, §5.6. Solo recapiti sintetici: example.test e +39 000 000 00xx.
const MIGRATIONS = join(__dirname, "../../../supabase/migrations");
const migration = readFileSync(
  join(
    MIGRATIONS,
    readdirSync(MIGRATIONS).find((name) => name.endsWith("_partner_module.sql")) ?? "",
  ),
  "utf8",
);
const sqlFunction = (name: string) => {
  const start = migration.indexOf(`create function private.${name}(`);
  const end = migration.indexOf("$$;", start);
  if (start < 0 || end < 0) throw new Error(`Funzione ${name} non trovata.`);
  return migration.slice(start, end + 3);
};

let db: PGlite;
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(
    `create schema private; ${sqlFunction("partner_link_value")} ${sqlFunction("partner_domain")}`,
  );
});
afterAll(async () => {
  await db?.close();
});

const SAMPLES: [PartnerContactKind, string][] = [
  ["email", "info@garage-uno.example.test"],
  [
    "email",
    "info@raduno-due.example.test, stampa@raduno-due.example.test; booking@raduno-due.example.test",
  ],
  ["email", "Scrivere a: Ufficio Stampa <press.office+eu@club-sei.example.test>"],
  ["email", "nessuna email qui"],
  ["email", "a@b"],
  ["phone", "Sede +39 000 000 0001; Magazzino +39 000 000 0002"],
  ["phone", "+39 (000) 000-0003"],
  ["phone", "solo su appuntamento"],
  ["phone", "tel. 000.000.0004 int. 2"],
  ["phone", "123"],
  ["whatsapp", "+39 000 000 0004"],
  ["instagram", "@garage_uno"],
  ["instagram", "@radunodue (circa 12k follower, profilo ufficiale)"],
  ["instagram", "@creator.quattro."],
  ["instagram", "https://www.instagram.com/club_registro_tre/"],
  ["instagram", "https://instagram.com/p/AbCdEf/"],
  ["instagram", "email@garage.example.test"],
  ["instagram", "profilo privato"],
  ["form", "https://raduno-due.example.test/espositori"],
  ["form", "  https://raduno-due.example.test/espositori?tipo=stand#modulo  "],
  ["brand_page", "https://brand.example.test/quattro"],
  ["web", "sito in costruzione"],
  ["web", "https://user@phish.example.test/"],
  ["web", "javascript:alert(1)"],
  ["web", "HTTPS://upper.example.test/"],
  ["web", "https://www.garage-uno.example.test/ e anche altro"],
];

describe("valore pulito dei recapiti", () => {
  it("lo stesso di private.partner_link_value su ogni caso della ricerca", async () => {
    for (const [kind, value] of SAMPLES) {
      const { rows } = await db.query<{ v: string | null }>(
        "select private.partner_link_value($1, $2) as v",
        [kind, value],
      );
      expect(partnerLinkValue(kind, value), `${kind}: ${value}`).toBe(rows[0].v);
    }
  });

  it("primo valore valido: telefoni multipli, Instagram con note, email multipla", () => {
    expect(partnerLinkValue("phone", "Sede +39 000 000 0001; Magazzino +39 000 000 0002")).toBe(
      "+390000000001",
    );
    expect(
      partnerLinkValue("instagram", "@radunodue (circa 12k follower, profilo ufficiale)"),
    ).toBe("@radunodue");
    expect(partnerLinkValue("instagram", "@creator.quattro.")).toBe("@creator.quattro");
    expect(partnerLinkValue("email", SAMPLES[1][1])).toBe("info@raduno-due.example.test");
    expect(partnerLinkValue("phone", "solo su appuntamento")).toBeNull();
    expect(partnerLinkValue("web", "javascript:alert(1)")).toBeNull();
    expect(partnerLinkValue("email", null)).toBeNull();
  });

  it("dominio per la lista «Non contattare», come private.partner_domain", async () => {
    const values = [
      "https://www.garage-uno.example.test/chi-siamo",
      "https://shop.Negozio.example.test",
      "info@store.club-sei.example.test",
      "http://localhost/",
      "sito in costruzione",
      "https://raduno-due.example.test.",
    ];
    for (const value of values) {
      const { rows } = await db.query<{ v: string | null }>(
        "select private.partner_domain($1) as v",
        [value],
      );
      expect(partnerDomain(value), value).toBe(rows[0].v);
    }
    expect(partnerDomain("https://www.garage-uno.example.test/x")).toBe("garage-uno.example.test");
    expect(partnerDomain(null)).toBeNull();
  });
});

describe("link sicuri", () => {
  it("un href per tipo, solo da valori puliti", () => {
    expect(contactHref("email", "press.office+eu@club-sei.example.test")).toBe(
      "mailto:press.office%2Beu@club-sei.example.test",
    );
    expect(contactHref("phone", "+390000000001")).toBe("tel:+390000000001");
    expect(contactHref("whatsapp", "+390000000004")).toBe("https://wa.me/390000000004");
    expect(contactHref("instagram", "@garage_uno")).toBe("https://www.instagram.com/garage_uno/");
    expect(contactHref("form", "https://raduno-due.example.test/espositori")).toBe(
      "https://raduno-due.example.test/espositori",
    );
    expect(contactHref("phone", "000 000")).toBeNull();
    expect(contactHref("instagram", "garage_uno")).toBeNull();
    expect(contactHref("email", null)).toBeNull();
  });

  it("mai javascript:, data: o altri schemi, nemmeno travestiti", () => {
    const hostile = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      " javascript:alert(1)",
      "vbscript:msgbox(1)",
      "https://x.example.test/\njavascript:alert(1)",
      "https://user@x.example.test/",
    ];
    const kinds: PartnerContactKind[] = [
      "email",
      "phone",
      "whatsapp",
      "instagram",
      "form",
      "brand_page",
      "web",
    ];
    for (const kind of kinds)
      for (const value of hostile) {
        const href = contactHref(kind, value);
        expect(href === null || /^(https:|http:|mailto:|tel:)/.test(href), `${kind} ${value}`).toBe(
          true,
        );
        expect(href ?? "").not.toMatch(/javascript:|data:|vbscript:/i);
      }
    expect(hostLabel("https://www.garage-uno.example.test/")).toBe("garage-uno.example.test");
  });
});

const link = (
  kind: PartnerContactKind,
  linkValue: string,
  fields: Partial<PartnerContactLink> = {},
): PartnerContactLink => ({
  id: partnerFixtureId(Math.floor(Math.random() * 1e9)),
  partnerId: partnerFixtureId(1),
  kind,
  linkValue,
  label: "",
  verified: false,
  active: true,
  position: 0,
  version: 1,
  ...fields,
});
const all = [
  link("email", "info@garage-uno.example.test", { position: 0 }),
  link("phone", "+390000000001", { position: 1 }),
  link("instagram", "@garage_uno", { position: 2 }),
  link("form", "https://garage-uno.example.test/contatti", { position: 3 }),
  link("web", "https://garage-uno.example.test/", { position: 4 }),
];
const actions = (channel: PartnerChannel, contacts = all, blocked = false) =>
  partnerActions({ preferredChannel: channel }, contacts, blocked);

describe("pulsanti della riga", () => {
  it("il canale preferito è il primo e il principale", () => {
    expect(actions("email").map((a) => [a.kind, a.primary])).toEqual([
      ["email", true],
      ["copy", false],
      ["form", false],
      ["instagram", false],
    ]);
    expect(actions("form").map((a) => a.kind)).toEqual(["form", "email", "copy", "instagram"]);
    expect(actions("form")[0].label).toBe("Apri il modulo");
    expect(actions("ig")[0]).toMatchObject({ kind: "instagram", label: "Scrivi su Instagram" });
    expect(actions("email").find((a) => a.kind === "instagram")?.label).toBe("Instagram");
    const email = actions("email")[0];
    expect(email.label).toBe("info@garage-uno.example.test");
    expect(email.href).toBe("mailto:info@garage-uno.example.test");
    expect(actions("email")[1]).toMatchObject({
      kind: "copy",
      copyText: "info@garage-uno.example.test",
      href: null,
      ariaLabel: "Copia l’indirizzo email",
    });
  });

  it("telefono solo con canale preferito telefono, con il numero come etichetta", () => {
    expect(actions("email").some((a) => a.kind === "phone")).toBe(false);
    expect(actions("phone")[0]).toMatchObject({
      kind: "phone",
      primary: true,
      label: "+390000000001",
      href: "tel:+390000000001",
    });
  });

  it("senza recapiti utili ripiega sul sito; senza sito nessun pulsante", () => {
    const webOnly = [link("web", "https://cinque.example.test/shop")];
    expect(actions("web", webOnly)).toEqual([
      expect.objectContaining({
        kind: "web",
        label: "Apri il sito",
        primary: true,
        external: true,
      }),
    ]);
    expect(actions("email", webOnly)[0].kind).toBe("web");
    expect(actions("web", [])).toEqual([]);
    // Il sito non compare se c'è già un altro pulsante, anche col canale preferito «web».
    expect(actions("web").map((a) => a.kind)).toEqual(["email", "copy", "form", "instagram"]);
    expect(actions("web")[0].primary).toBe(true);
  });

  it("pagina per i brand al posto del modulo; recapiti rimossi o inutilizzabili esclusi", () => {
    const contacts = [
      link("email", "info@garage-uno.example.test", { active: false }),
      link("brand_page", "https://brand.example.test/quattro", { position: 1 }),
      link("instagram", "non un profilo", { position: 2 }),
    ];
    expect(actions("form", contacts).map((a) => [a.kind, a.href])).toEqual([
      ["form", "https://brand.example.test/quattro"],
    ]);
  });

  it("contatto bloccato: nessun pulsante", () => {
    expect(actions("email", all, true)).toEqual([]);
  });

  it("nessun href pericoloso anche con valori puliti manomessi", () => {
    const tampered = [
      link("web", "javascript:alert(1)"),
      link("form", "data:text/html,x"),
      link("email", "x@y.example.test?body=ciao"),
    ];
    expect(actions("web", tampered)).toEqual([]);
  });
});

describe("percorso e email", () => {
  it("prima frase del percorso, come shortRoute del sito", () => {
    expect(
      shortRoute(
        "Modulo espositori su https://www.raduno-due.example.test/espositori. Poi una email allo staff.",
      ),
    ).toBe("Modulo espositori su raduno-due.example.test.");
    expect(shortRoute("Email al titolare.")).toBe("Email al titolare.");
    expect(
      shortRoute("Modulo su https://club.example.test/contatti?x=1 poi telefonata al club."),
    ).toBe("Modulo su club.example.test poi telefonata al club.");
    const long = `${"parola ".repeat(40)}fine`;
    const short = shortRoute(long);
    expect(short.endsWith("…")).toBe(true);
    expect(short.length).toBeLessThanOrEqual(181);
  });

  it("percorso di ripiego come routeText del sito", () => {
    expect(routeText("Telefonata in segreteria.", all)).toBe("Telefonata in segreteria.");
    expect(routeText("", all)).toBe("Email a info@garage-uno.example.test");
    expect(routeText("", [link("form", "https://x.example.test/f")])).toBe(
      "Modulo contatti sul sito",
    );
    expect(routeText(" ", [link("instagram", "@garage_uno")])).toBe(
      "Messaggio diretto su Instagram a @garage_uno",
    );
    expect(routeText("", [])).toBe("Contatto da trovare sul sito");
  });

  it("mailto con destinatari, cc, oggetto e testo codificati", () => {
    const { href, bodyIncluded } = messageMailto({
      to: "info@garage-uno.example.test, stampa@garage-uno.example.test",
      cc: "Ufficio <press@garage-uno.example.test>",
      subject: "Ciao & benvenuti?",
      body: "Riga uno\nRiga due",
    });
    expect(bodyIncluded).toBe(true);
    expect(href).toBe(
      "mailto:info@garage-uno.example.test,stampa@garage-uno.example.test?cc=press%40garage-uno.example.test&subject=Ciao%20%26%20benvenuti%3F&body=Riga%20uno%0D%0ARiga%20due",
    );
  });

  it("testo oltre 1800 caratteri: solo destinatario e oggetto", () => {
    const body = "x".repeat(MAILTO_BODY_LIMIT + 1);
    const { href, bodyIncluded } = messageMailto({
      to: "info@garage-uno.example.test",
      cc: "",
      subject: "Oggetto",
      body,
    });
    expect(bodyIncluded).toBe(false);
    expect(href).toBe("mailto:info@garage-uno.example.test?subject=Oggetto");
    expect(
      messageMailto({
        to: "info@garage-uno.example.test",
        cc: "",
        subject: "",
        body: "x".repeat(1800),
      }).bodyIncluded,
    ).toBe(true);
    expect(messageMailto({ to: "modulo sul sito", cc: "", subject: "", body: "" }).href).toBe(
      "mailto:",
    );
  });
});
