// Controlli nel codice sulle bozze dell'assistente Partner: non dipendono dal modello e valgono
// anche se la seconda lettura di Claude approva. Tutte le regex hanno il flag `u`; i confini di
// parola sono `(?<![\p{L}\p{N}])` e `(?![\p{L}\p{N}])`, perché `\b` in JavaScript è solo ASCII.
import { createHash } from "node:crypto";
import { partnerAssistantTemplateSignature } from "./template";
import type { PartnerAssistantDraft, PartnerAssistantLanguage } from "./types";

/** I codici dei controlli, nell'ordine in cui si riportano. */
export const PARTNER_ASSISTANT_CHECK_CODES = [
  "parola_vietata",
  "segnaposto",
  "domande",
  "esclamativo",
  "emoji",
  "link",
  "telefono",
  "firma",
  "modello_porsche",
  "lunghezza",
  "oggetto",
  "regole_superate",
] as const;
export type PartnerAssistantCheckCode = (typeof PARTNER_ASSISTANT_CHECK_CODES)[number];

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

const CLUB_SPACE = String.raw`[\s\p{Pd}]*`;
const PORSCHE_CLUB = String.raw`(?:Porsche${CLUB_SPACE}Clubs?|Clubs?${CLUB_SPACE}Porsche)`;
const TUSCAN_REGION = String.raw`(?:Toscana|Toscane|Tuscany|Tuscan|Toskana)`;
const RETIRED_CLUB_NAME = new RegExp(
  `${B}(?:${PORSCHE_CLUB}${CLUB_SPACE}(?:(?:di|della|in|of|de|du|der|the)\\s+)?${TUSCAN_REGION}|${TUSCAN_REGION}\\s+${PORSCHE_CLUB})${E}`,
  "iu",
);
const RETIRED_QUANTITY = String.raw`(?:150|cento[\s\p{Pd}]*cinquanta|(?:one|a)[\s\p{Pd}]+hundred[\s\p{Pd}]+(?:and[\s\p{Pd}]+)?fifty|(?:ein)?hundertf(?:ü|ue|u)nfzig|cent[\s\p{Pd}]+cinquante|ciento[\s\p{Pd}]+cincuenta)`;
const RETIRED_SHIRT_COUNT = new RegExp(
  `(?<![\\p{L}\\p{N}.,])${RETIRED_QUANTITY}${E}\\s+((?:\\p{L}[\\p{L}\\p{M}'’\\p{Pd}]{0,30}\\s+){0,4}?)(?:magliett[ae]|(?:club[\\s\\p{Pd}]*)?(?:t[\\s\\p{Pd}]*shirts?|tee[\\s\\p{Pd}]*shirts?|shirts?)|camisetas?|(?:bespoke|custom[\\s\\p{Pd}]+made)\\s+ones)${E}`,
  "giu",
);
const ANNIVERSARY_WORD =
  /(?:^|\s)(?:ann[io]|years?|jahre?n?|ans?|años?|anniversari\p{L}*|anniversar\p{L}*|aniversari\p{L}*|jubilä\p{L}*)(?=\s|$)/iu;

/** Il caso commerciale ritirato non va ripreso dalle bozze o dagli esempi storici.
 * Un nome ufficiale del destinatario puo comparire come identita; la quantita della commessa
 * resta vietata anche quando quel destinatario e proprio il club nominato. */
export function partnerAssistantHasRetiredSocialProof(
  text: string,
  names: readonly string[] = [],
): boolean {
  const normalized = text.normalize("NFKC");
  const identityFree = withoutNames(
    [normalized.toLowerCase()],
    names
      .map((name) => name.normalize("NFKC").toLowerCase())
      .filter((name) => RETIRED_CLUB_NAME.test(name)),
  )[0];
  return (
    RETIRED_CLUB_NAME.test(identityFree) ||
    [...normalized.matchAll(RETIRED_SHIRT_COUNT)].some((match) => !ANNIVERSARY_WORD.test(match[1]))
  );
}

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

// Formule di richiesta e rimandi alla firma. I termini generici come «numero», «meeting» e
// «Termin» possono invece descrivere una rivista o un evento.
const PHONE_REQUESTS = [
  // Italiano
  String.raw`recapit[oi]\s+telefonic[oi]|numer[oi]\s+(?:di\s+telefono|telefonic[oi])|(?:al|per|via)\s+telefono`,
  String.raw`sentiamoci|(?:di|per)\s+sentirci|(?:mio|nostro)\s+numero[^.!?;\n]{0,40}(?:qui\s+sotto|in\s+firma)`,
  String.raw`(?:fissare|concordare|organizzare)\s+(?:(?:un[ao]?|una\s+breve)\s+)?(?:chiamata|telefonata|appuntamento)`,
  // Inglese
  String.raw`(?:phone|telephone|mobile)\s+number|(?:by|on\s+the|over\s+the)\s+phone|give\s+(?:me|us)\s+a\s+call`,
  String.raw`(?:my|our)\s+number\s+(?:(?:is|appears)\s+)?(?:below|in\s+(?:my|our|the)\s+signature)`,
  String.raw`(?:a|your)\s+number\s+so\s+we\s+can\s+(?:talk|speak|call)|(?:have|hop\s+on|jump\s+on)\s+a\s+(?:(?:quick|short)\s+)?call`,
  String.raw`(?:schedule|arrange|set\s+up|book)\s+(?:(?:a|an)\s+)?(?:(?:quick|short)\s+)?(?:call|appointment|meeting)`,
  // Tedesco
  String.raw`(?:Telefon|Mobil|Handy)nummer|(?:am|per)\s+Telefon|telefonieren`,
  String.raw`(?:meine|unsere)\s+Nummer\s+(?:(?:finden\s+Sie|steht)\s+)?(?:unten|in\s+der\s+Signatur)`,
  String.raw`(?:Anruf|Termin|Telefonat)\s+(?:vereinbaren|ausmachen)`,
  // Francese
  String.raw`num[ée]ro\s+de\s+(?:t[ée]l[ée]phone|portable)|(?:au|par)\s+t[ée]l[ée]phone|(?:nous|vous|m[’'])\s*appeler`,
  String.raw`(?:mon|notre)\s+num[ée]ro\s+(?:(?:figure|est)\s+)?(?:ci[-\s]dessous|dans\s+la\s+signature)`,
  String.raw`(?:fixer|organiser|pr[ée]voir|convenir\s+d[’'])\s*(?:(?:un|une)\s+)?(?:appel|rendez[-\s]vous)`,
  // Spagnolo
  String.raw`n[uú]mero\s+de\s+(?:tel[eé]fono|m[oó]vil)|(?:al|por)\s+tel[eé]fono`,
  String.raw`(?:mi|nuestro)\s+n[uú]mero\s+(?:(?:est[aá]|aparece)\s+)?(?:abajo|en\s+la\s+firma)`,
  String.raw`(?:concertar|programar|agendar|coordinar|hacer)\s+(?:un[ao]?\s+)?(?:llamada|cita|reuni[oó]n)`,
].map((pattern) => new RegExp(`${B}(?:${pattern})${E}`, "iu"));

export function partnerAssistantHasPhoneRequest(text: string): boolean {
  const normalized = text.normalize("NFKC");
  return PHONE_REQUESTS.some((pattern) => pattern.test(normalized));
}

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

/** I testi senza le occorrenze esatte dei nomi, dalla più lunga: le regole chiedono il loro nome
 * nell'oggetto, e un club o un evento può avere un modello nel nome. Al posto del nome uno spazio,
 * così le parole intorno restano separate. */
function withoutNames(texts: string[], names: readonly string[]): string[] {
  const filled = names.filter((name) => /\S/u.test(name)).sort((a, b) => b.length - a.length);
  return texts.map((text) => filled.reduce((rest, name) => rest.split(name).join(" "), text));
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
  context: {
    porscheCommunity: boolean;
    currentRulesVersion: number;
    phone: string;
    /** Il nome della scheda e quello dell'evento della scelta, se c'è. */
    names: string[];
    /** La bozza viene dal testo fisso per i club: firma con il cognome, da 180 a 260 parole, e il
     * nome del club (un dato inserito dal codice) fuori dai controlli sulle parole. */
    template?: boolean;
    /** Sollecito: cambia il numero di parole; il wrapper espone il riferimento ritirato come
     * prova_sociale. Firma e altri controlli del percorso restano uguali. */
    followup?: boolean;
  },
): { ok: true } | { ok: false; failures: PartnerAssistantCheckCode[] } {
  const template = context.template === true;
  const texts = template
    ? withoutNames([draft.subject, draft.body], context.names)
    : [draft.subject, draft.body];
  const body = texts[1];
  const words = partnerAssistantBodyWords(draft.body);
  const signature = template
    ? partnerAssistantTemplateSignature(draft.language, context.phone)
    : partnerAssistantSignature(draft.language, context.phone);
  const [minWords, maxWords] = context.followup ? [40, 90] : template ? [180, 260] : [110, 160];
  const checks: [PartnerAssistantCheckCode, boolean][] = [
    [
      "parola_vietata",
      anyMatch(FORBIDDEN, texts) ||
        // Il wrapper FU espone lo stesso divieto con il suo codice storico prova_sociale.
        (!context.followup &&
          partnerAssistantHasRetiredSocialProof(
            `${draft.subject}\n${draft.body}`,
            context.names.slice(0, 1),
          )),
    ],
    ["segnaposto", anyMatch(PLACEHOLDERS, texts)],
    ["domande", (body.match(/\?/gu) ?? []).length > 1],
    ["esclamativo", anyMatch([/[!¡]/u], texts)],
    ["emoji", anyMatch([/\p{Extended_Pictographic}/u], texts)],
    ["link", !texts.every(onlyLuckyLapHome)],
    [
      "telefono",
      PHONE_NUMBER.test(body) ||
        (!context.followup && [draft.subject, draft.body].some(partnerAssistantHasPhoneRequest)),
    ],
    ["firma", draft.signature !== signature],
    [
      "modello_porsche",
      context.porscheCommunity && anyMatch(PORSCHE_MODELS, withoutNames(texts, context.names)),
    ],
    ["lunghezza", words < minWords || words > maxWords],
    // Una riga sola: l'oggetto va nell'intestazione dell'email.
    ["oggetto", /[\n\r\t]/u.test(draft.subject)],
    ["regole_superate", draft.rulesVersion !== context.currentRulesVersion],
  ];
  const failures = checks.filter(([, failed]) => failed).map(([code]) => code);
  return failures.length === 0 ? { ok: true } : { ok: false, failures };
}
