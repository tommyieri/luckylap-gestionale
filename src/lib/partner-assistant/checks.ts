// Controlli nel codice sulle bozze dell'assistente Partner: non dipendono dal modello e valgono
// anche se la seconda lettura di Claude approva. Tutte le regex hanno il flag `u`; i confini di
// parola sono `(?<![\p{L}\p{N}])` e `(?![\p{L}\p{N}])`, perché `\b` in JavaScript è solo ASCII.
import { createHash } from "node:crypto";
import type { PartnerAssistantDraft, PartnerAssistantLanguage } from "./types";

export type PartnerAssistantCheckCode =
  | "parola_vietata"
  | "segnaposto"
  | "domande"
  | "esclamativo"
  | "emoji"
  | "link"
  | "telefono"
  | "firma"
  | "modello_porsche"
  | "lunghezza"
  | "regole_superate";

const ROLE: Record<PartnerAssistantLanguage, string> = {
  it: "Fondatore",
  en: "Founder",
  de: "Gründer",
  fr: "Fondateur",
  es: "Fundador",
};

/** Firma su quattro righe; il telefono arriva da PARTNER_ASSISTANT_PHONE, com'è. */
export function partnerAssistantSignature(
  language: PartnerAssistantLanguage,
  phone: string,
): string {
  return [
    "Tommaso",
    `${ROLE[language]}, LuckyLap`,
    phone,
    "https://luckylap.com | Instagram @lucky.lap",
  ].join("\n");
}

export function partnerAssistantDraftSha256(draft: {
  subject: string;
  body: string;
  signature: string;
}): string {
  return createHash("sha256")
    .update(`${draft.subject}\n\n${draft.body}\n\n${draft.signature}`, "utf8")
    .digest("hex");
}

/** Parole del corpo senza la prima riga (saluto) e senza l'ultima riga non vuota (chiusura).
 * Una parola è un gruppo di caratteri senza spazi con almeno una lettera o una cifra: un trattino
 * isolato non conta. */
export function partnerAssistantBodyWords(body: string): number {
  return body
    .trim()
    .split(/\r?\n/u)
    .slice(1, -1)
    .join("\n")
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;

// Parole vietate, su oggetto e corpo. Valgono anche dentro una parola più lunga, così si fermano
// composti e plurali come «Mitgliederrabatt», «handmade in Italy», «Verkaufskommission» e
// «Rabattcode». Il confine a sinistra c'è solo dove una parola comune finisce con quella vietata
// («premise», «tienen depósito», «122 anni», «Halle 22», «leur»); a destra solo dove continua in
// una parola comune («heure», «Europe», «USDA», «alle 220»). `Tommi` è una parola intera.
const FORBIDDEN: RegExp[] = [
  /conto\s+vendita|consignment|sale[\s-]+or[\s-]+return|kommission|d[ée]p[ôo]t[\s-]+vente|made\s+in\s+italy/iu,
  new RegExp(`${B}en\\s+dep[oó]sito`, "iu"),
  new RegExp(`${B}Tommi${E}`, "u"),
  /[€$£]/u,
  new RegExp(`${B}(?:EUR|USD)${E}`, "iu"),
  /sconto|sconti|discount|Rabatt|descuento/iu,
  new RegExp(`${B}remise`, "iu"),
  /campione|campioni|sample|samples|échantillon|échantillons/iu,
  new RegExp(`${B}22\\s*(?:anni|years|Jahre|ans|años)`, "iu"),
  // Senza unità solo nelle frasi sull'età: «dalle 18 alle 22» e «all 22 cars» non contano.
  new RegExp(`${B}(?:(?:we[’']re|we\\s+are)\\s+all|tutti\\s+di)\\s+22${E}`, "iu"),
  /twenty[\s-]two/iu,
];

const PLACEHOLDERS: RegExp[] = [
  /\[[^\]]*\]/u,
  /\{\{/u,
  new RegExp(`${B}(?:first\\s+name|last\\s+name|Nachname|Vorname)${E}`, "iu"),
  // Maiuscole esatte: «todo» è spagnolo.
  new RegExp(`${B}(?:XXX|TODO)${E}`, "u"),
];

const LINK_TLDS = "com|it|de|fr|es|ch|at|uk|co|net|org|eu|io|shop|store|club";
// Un link è `https?://…`, `www.…` oppure un dominio con un TLD dell'elenco, con il percorso.
// «Gent.ma», «z.B.» e «1.000» non finiscono con un TLD dell'elenco e non contano.
const LINK = new RegExp(
  `https?://\\S+|www\\.\\S+|${B}[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)*\\.(?:${LINK_TLDS})${E}\\S*`,
  "giu",
);
const LINK_TRAILING_PUNCTUATION = /[.,;:)]+$/u;
const LUCKYLAP_HOME = /^(?:https:\/\/)?(?:www\.)?luckylap\.com\/?$/iu;

const PHONE_NUMBER = new RegExp(`${B}\\+?\\d(?: ?\\d){7,}${E}`, "u");

// Con una comunità Porsche si nominano solo la 964 e la GT3 RS. I numeri valgono interi, cioè
// non dentro un numero più lungo («1993» passa), ma anche con un suffisso («911er», «993RS»).
// I nomi con le maiuscole esatte: «la carrera de Le Mans» e «una targa ricordo» non sono modelli.
const PORSCHE_MODELS: RegExp[] = [
  new RegExp(
    `${B}(?:F40|512 ?TR|300 ?SL|Project\\s+88|Carrera|Cayman|Boxster|Macan|Cayenne|Taycan|Panamera|Speedster|Targa)${E}`,
    "u",
  ),
  new RegExp(`${B}(?:911|930|959|991|992|993|996|997|356|718)(?!\\p{N})`, "u"),
];

function anyMatch(patterns: RegExp[], texts: string[]): boolean {
  return patterns.some((pattern) => texts.some((text) => pattern.test(text)));
}

function onlyLuckyLapHome(text: string): boolean {
  return (text.match(LINK) ?? []).every((link) =>
    LUCKYLAP_HOME.test(link.replace(LINK_TRAILING_PUNCTUATION, "")),
  );
}

export function checkPartnerAssistantDraft(
  draft: Pick<
    PartnerAssistantDraft,
    "language" | "subject" | "body" | "signature" | "rulesVersion"
  >,
  context: { porscheCommunity: boolean; currentRulesVersion: number; phone: string },
): { ok: true } | { ok: false; failures: PartnerAssistantCheckCode[] } {
  const texts = [draft.subject, draft.body];
  const words = partnerAssistantBodyWords(draft.body);
  const checks: [PartnerAssistantCheckCode, boolean][] = [
    ["parola_vietata", anyMatch(FORBIDDEN, texts)],
    ["segnaposto", anyMatch(PLACEHOLDERS, texts)],
    ["domande", (draft.body.match(/\?/gu) ?? []).length !== 1],
    ["esclamativo", anyMatch([/[!¡]/u], texts)],
    ["emoji", anyMatch([/\p{Extended_Pictographic}/u], texts)],
    ["link", !texts.every(onlyLuckyLapHome)],
    ["telefono", PHONE_NUMBER.test(draft.body)],
    ["firma", draft.signature !== partnerAssistantSignature(draft.language, context.phone)],
    ["modello_porsche", context.porscheCommunity && anyMatch(PORSCHE_MODELS, texts)],
    ["lunghezza", words < 110 || words > 160],
    ["regole_superate", draft.rulesVersion !== context.currentRulesVersion],
  ];
  const failures = checks.filter(([, failed]) => failed).map(([code]) => code);
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
