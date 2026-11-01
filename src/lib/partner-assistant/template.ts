// Modalità modello per i club (decisione di Tommi del 31 ottobre 2026): per i contatti della sezione
// Club la prima email non la scrive Claude. Il codice la compone dal testo fisso approvato da Tommaso,
// tradotto una volta in cinque lingue, con il nome del club e, dalla versione 2 (1° novembre 2026),
// i modelli che abbiamo già della marca del club; Claude fa solo la seconda lettura. La versione va
// nella nota di ricerca sostitutiva: per cambiare il testo si cambia anche la versione.
import type {
  PartnerAssistantContext,
  PartnerAssistantLanguage,
  PartnerAssistantPartner,
  PartnerAssistantRegister,
} from "./types";

export const PARTNER_ASSISTANT_TEMPLATE_VERSION = 2;

/** Il registro di ogni lingua, come lo controlla complete_partner_assistant_template. */
export const PARTNER_ASSISTANT_TEMPLATE_REGISTER: Record<
  PartnerAssistantLanguage,
  PartnerAssistantRegister
> = { it: "voi", en: "you", de: "sie", fr: "vous", es: "usted" };

// ---------------------------------------------------------------------------
// Il nome del club nella frase
// ---------------------------------------------------------------------------

const VOWEL = /^[aeiouàèéìòùáíóúâêîôûh]/iu;

/** «del Porsche Club Wien», «dell'Automobile…», «della Scuderia…». */
function italianOf(club: string): string {
  if (/^(?:scuderia|associazione|federazione|squadra)\b/iu.test(club)) return `della ${club}`;
  return /^[aeiouàèéìòù]/iu.test(club) ? `dell'${club}` : `del ${club}`;
}
const FRENCH_FEMININE = /^(?:fédération|federation|scuderia|association|section)\b/iu;
/** «du Club Porsche…», «de l'Amicale…», «de la Fédération…», «de la Section SL…». */
function frenchOf(club: string): string {
  if (VOWEL.test(club)) return `de l'${club}`;
  if (FRENCH_FEMININE.test(club)) return `de la ${club}`;
  return `du ${club}`;
}
function frenchWith(club: string): string {
  if (VOWEL.test(club)) return `l'${club}`;
  if (FRENCH_FEMININE.test(club)) return `la ${club}`;
  return `le ${club}`;
}
const SPANISH_FEMININE =
  /^(?:asociación|asociacion|escudería|escuderia|federación|federacion|scuderia)\b/iu;
const spanishOf = (club: string) => (SPANISH_FEMININE.test(club) ? `de la ${club}` : `del ${club}`);
const spanishWith = (club: string) => (SPANISH_FEMININE.test(club) ? `la ${club}` : `el ${club}`);
/** Femminile se il nome comincia con «Scuderia» o contiene un sostantivo femminile come parola a sé
 * («Mercedes-Benz Interessengemeinschaft e.V.», «Porsche 356 IG Deutschland», «… Community»). */
const GERMAN_FEMININE =
  /^scuderia(?=\s)|(?:^|[\s-])(?:vereinigung|interessengemeinschaft|ig|gemeinschaft|community)(?=[\s.,]|$)/iu;
/** Un aggettivo iniziale si declina dopo l'articolo: «des Württembergischen Porsche Club». */
const germanAdjective = (club: string) => club.replace(/^(\p{Lu}\p{Ll}*isch)er(?=\s)/u, "$1en");
const germanOf = (club: string) =>
  GERMAN_FEMININE.test(club) ? `der ${club}` : `des ${germanAdjective(club)}`;
const germanWith = (club: string) =>
  GERMAN_FEMININE.test(club) ? `der ${club}` : `dem ${germanAdjective(club)}`;
/** Il punto di fine frase, senza raddoppiarlo dopo «Inc.», «e.V.» o «r.y.». */
const stop = (text: string) => (text.endsWith(".") ? text : `${text}.`);

/** La marca del club: decide i modelli nominati nel testo. null: nessuna delle tre, frase generica. */
export type PartnerAssistantTemplateBrand = "porsche" | "ferrari" | "mercedes" | null;

/** I modelli LuckyLap della marca, con l'articolo della lingua (Magazzino › Giacenze, «Magliette
 * disponibili»): 964 e GT3 RS, F40 e 512 TR, 300 SL. */
const BRAND_MODELS: Record<
  PartnerAssistantLanguage,
  Record<Exclude<PartnerAssistantTemplateBrand, null>, string>
> = {
  it: { porsche: "la 964 e la GT3 RS", ferrari: "la F40 e la 512 TR", mercedes: "la 300 SL" },
  en: {
    porsche: "the 964 and the GT3 RS",
    ferrari: "the F40 and the 512 TR",
    mercedes: "the 300 SL",
  },
  de: {
    porsche: "den 964 und den GT3 RS",
    ferrari: "den F40 und den 512 TR",
    mercedes: "den 300 SL",
  },
  fr: { porsche: "la 964 et la GT3 RS", ferrari: "la F40 et la 512 TR", mercedes: "la 300 SL" },
  es: { porsche: "el 964 y el GT3 RS", ferrari: "el F40 y el 512 TR", mercedes: "el 300 SL" },
};

/** La frase sulle grafiche: con la marca, i modelli che abbiamo già e qualsiasi auto il club voglia
 * (decisione di Tommi del 1° novembre 2026); senza, il modello che preferiscono. */
const DESIGN: Record<PartnerAssistantLanguage, (brand: PartnerAssistantTemplateBrand) => string> = {
  it: (brand) =>
    brand
      ? `Le grafiche le disegno personalmente: in collezione abbiamo già ${BRAND_MODELS.it[brand]}, ma possiamo disegnare qualsiasi auto vogliate.`
      : "Le grafiche le disegno personalmente, quindi possiamo partire dal modello che preferite.",
  en: (brand) =>
    brand
      ? `I draw the designs myself: our collection already includes ${BRAND_MODELS.en[brand]}, but we can design any car you would like.`
      : "I draw the designs myself, so we can start from the model you prefer.",
  de: (brand) =>
    brand
      ? `Die Motive zeichne ich selbst: In unserer Kollektion haben wir bereits ${BRAND_MODELS.de[brand]}, wir können aber jedes Auto gestalten, das Sie sich wünschen.`
      : "Die Motive zeichne ich selbst, wir können also von dem Modell ausgehen, das Ihnen am liebsten ist.",
  fr: (brand) =>
    brand
      ? `Je dessine moi-même les motifs : notre collection compte déjà ${BRAND_MODELS.fr[brand]}, mais nous pouvons dessiner n'importe quelle voiture de votre choix.`
      : "Je dessine moi-même les motifs, nous pouvons donc partir du modèle que vous préférez.",
  es: (brand) =>
    brand
      ? `Los diseños los dibujo yo mismo: en la colección ya tenemos ${BRAND_MODELS.es[brand]}, pero podemos diseñar cualquier automóvil que deseen.`
      : "Los diseños los dibujo yo mismo, así que podemos partir del modelo que prefieran.",
};

type TemplateText = {
  subject: (club: string) => string;
  body: (club: string, brand: PartnerAssistantTemplateBrand) => string;
};

/** Il testo approvato da Tommaso il 31 ottobre 2026 (versione accorciata), con le traduzioni e, dalla
 * versione 2, la frase sulle grafiche con la marca del club. La prima riga è il saluto e l'ultima la
 * chiusura: il conteggio delle parole le salta. */
export const PARTNER_ASSISTANT_TEMPLATES: Record<PartnerAssistantLanguage, TemplateText> = {
  it: {
    subject: (club) => `Magliette dedicate ai soci ${italianOf(club)}`,
    body: (club, brand) =>
      [
        "Buongiorno,",
        "",
        "sono Tommaso, fondatore di LuckyLap, un brand italiano che trasforma la passione per le automobili in un capo da indossare ogni giorno: t-shirt in cotone biologico, con un design essenziale e la silhouette dell'auto ricamata sul petto. Qualcosa di discreto e riconoscibile, che racconta la passione anche lontano da un raduno o da un circuito.",
        "",
        `Abbiamo già avviato collaborazioni con alcuni Porsche Club in Italia: per il Porsche Club Toscana abbiamo realizzato 150 magliette dedicate ai soci, con il logo del club ricamato sulla manica. Vorremmo ora estendere il progetto ad altri club in Europa e nel resto del mondo, e ci farebbe piacere farlo con ${stop(club)}`,
        "",
        `Possiamo sviluppare insieme una versione esclusiva: l'auto da rappresentare, il colore della maglietta e del ricamo, la posizione del vostro logo. ${DESIGN.it(brand)} Ci appoggiamo a un ricamificio che ha già lavorato per i Porsche Club e seguiamo il progetto dalla grafica al confezionamento, con modelli da uomo e da donna.`,
        "",
        "Può essere un regalo per i soci, un ricordo di un anniversario o di un raduno, oppure una piccola collezione del club. Quantità e condizioni le definiamo insieme.",
        "",
        "Vi interesserebbe ricevere una prima proposta dedicata ai vostri soci?",
        "",
        "Grazie per l'attenzione e un saluto,",
      ].join("\n"),
  },
  en: {
    subject: (club) => `T-shirts for the members of ${club}`,
    body: (club, brand) =>
      [
        "Hello,",
        "",
        "I am Tommaso, founder of LuckyLap, an Italian brand that turns a passion for cars into something to wear every day: organic cotton T-shirts with an essential design and the car's silhouette embroidered on the chest. Something discreet and recognisable, which carries the passion well beyond a club meeting or a circuit.",
        "",
        `We have already started working with several Porsche Clubs in Italy: for the Porsche Club Toscana we made 150 T-shirts for its members, with the club logo embroidered on the sleeve. We would now like to take the project to other clubs in Europe and around the world, and we would be glad to do it with ${stop(club)}`,
        "",
        `We can develop an exclusive version together: the car to feature, the colour of the T-shirt and of the embroidery, the position of your logo. ${DESIGN.en(brand)} We work with an embroidery workshop that has already worked for Porsche Clubs, and we follow the project from the design to the finished, packed garment, with men's and women's cuts.`,
        "",
        "It can be a gift for members, a keepsake for an anniversary or a meeting, or a small collection for the club. Quantities and terms are agreed together.",
        "",
        "Would you be interested in receiving a first proposal for your members?",
        "",
        "Thank you for your time, and kind regards,",
      ].join("\n"),
  },
  de: {
    subject: (club) => `T-Shirts für die Mitglieder ${germanOf(club)}`,
    body: (club, brand) =>
      [
        "Sehr geehrte Damen und Herren,",
        "",
        "mein Name ist Tommaso, ich bin der Gründer von LuckyLap, einer italienischen Marke, die die Leidenschaft für Automobile in ein Kleidungsstück für jeden Tag verwandelt: T-Shirts aus Bio-Baumwolle mit schlichtem Design und der Silhouette des Autos auf der Brust gestickt. Etwas Dezentes und Wiedererkennbares, das die Leidenschaft auch fern von Treffen und Rennstrecke zeigt.",
        "",
        `Wir arbeiten bereits mit einigen Porsche Clubs in Italien zusammen: Für den Porsche Club Toscana haben wir 150 T-Shirts für die Mitglieder gefertigt, mit dem Clublogo auf dem Ärmel gestickt. Nun möchten wir das Projekt auf weitere Clubs in Europa und weltweit ausweiten, und wir würden es gern mit ${germanWith(club)} umsetzen.`,
        "",
        `Gemeinsam können wir eine exklusive Version entwickeln: das Auto, die Farbe des T-Shirts und der Stickerei, die Position Ihres Logos. ${DESIGN.de(brand)} Wir arbeiten mit einer Stickerei, die bereits für Porsche Clubs gearbeitet hat, und begleiten das Projekt vom Entwurf bis zur fertigen Verpackung, mit Schnitten für Damen und Herren.`,
        "",
        "Es kann ein Geschenk für die Mitglieder sein, eine Erinnerung an ein Jubiläum oder ein Treffen oder eine kleine Kollektion des Clubs. Mengen und Konditionen legen wir gemeinsam fest.",
        "",
        "Hätten Sie Interesse an einem ersten Vorschlag für Ihre Mitglieder?",
        "",
        "Vielen Dank für Ihre Aufmerksamkeit und freundliche Grüße",
      ].join("\n"),
  },
  fr: {
    subject: (club) => `Des t-shirts pour les membres ${frenchOf(club)}`,
    body: (club, brand) =>
      [
        "Bonjour,",
        "",
        "Je suis Tommaso, fondateur de LuckyLap, une marque italienne qui transforme la passion de l'automobile en un vêtement à porter au quotidien : des t-shirts en coton biologique, au design épuré, avec la silhouette de la voiture brodée sur la poitrine. Quelque chose de discret et de reconnaissable, qui raconte la passion même loin d'un rassemblement ou d'un circuit.",
        "",
        `Nous avons déjà lancé des collaborations avec plusieurs Porsche Clubs en Italie : pour le Porsche Club Toscana, nous avons réalisé 150 t-shirts dédiés aux membres, avec le logo du club brodé sur la manche. Nous aimerions maintenant étendre le projet à d'autres clubs en Europe et dans le monde, et nous serions heureux de le faire avec ${stop(frenchWith(club))}`,
        "",
        `Nous pouvons créer ensemble une version exclusive : la voiture à représenter, la couleur du t-shirt et de la broderie, l'emplacement de votre logo. ${DESIGN.fr(brand)} Nous travaillons avec un atelier de broderie qui a déjà travaillé pour des Porsche Clubs, et nous suivons le projet du dessin jusqu'à l'emballage, avec des coupes homme et femme.`,
        "",
        "Ce peut être un cadeau pour les membres, un souvenir d'anniversaire ou de rassemblement, ou une petite collection du club. Les quantités et les conditions se définissent ensemble.",
        "",
        "Seriez-vous intéressés par une première proposition dédiée à vos membres ?",
        "",
        "Merci de votre attention et bien cordialement,",
      ].join("\n"),
  },
  es: {
    subject: (club) => `Camisetas para los socios ${spanishOf(club)}`,
    body: (club, brand) =>
      [
        "Buenos días,",
        "",
        "Soy Tommaso, fundador de LuckyLap, una marca italiana que convierte la pasión por los automóviles en una prenda para llevar cada día: camisetas de algodón orgánico, con un diseño sencillo y la silueta del automóvil bordada en el pecho. Algo discreto y reconocible, que cuenta la pasión también lejos de una concentración o de un circuito.",
        "",
        `Ya hemos empezado a colaborar con varios Porsche Club en Italia: para el Porsche Club Toscana hicimos 150 camisetas dedicadas a los socios, con el logotipo del club bordado en la manga. Ahora nos gustaría llevar el proyecto a otros clubes de Europa y del resto del mundo, y nos encantaría hacerlo con ${stop(spanishWith(club))}`,
        "",
        `Podemos desarrollar juntos una versión exclusiva: el automóvil que se quiera representar, el color de la camiseta y del bordado, la posición de su logotipo. ${DESIGN.es(brand)} Trabajamos con un taller de bordado que ya ha trabajado para los Porsche Club y seguimos el proyecto desde el diseño hasta el embalaje, con modelos de hombre y de mujer.`,
        "",
        "Puede ser un regalo para los socios, un recuerdo de un aniversario o de una concentración, o una pequeña colección del club. Las cantidades y las condiciones las definimos juntos.",
        "",
        "¿Les interesaría recibir una primera propuesta dedicada a sus socios?",
        "",
        "Gracias por su atención y un saludo,",
      ].join("\n"),
  },
};

const ROLE: Record<PartnerAssistantLanguage, string> = {
  it: "Fondatore",
  en: "Founder",
  de: "Gründer",
  fr: "Fondateur",
  es: "Fundador",
};

/** La firma del modello, con il cognome come nella bozza di Tommaso. Il telefono arriva da
 * PARTNER_ASSISTANT_PHONE, com'è. */
export function partnerAssistantTemplateSignature(
  language: PartnerAssistantLanguage,
  phone: string,
): string {
  return [
    "Tommaso Ieri",
    `${ROLE[language]}, LuckyLap`,
    phone,
    "https://luckylap.com | Instagram @lucky.lap",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Lingua, fuso, Porsche
// ---------------------------------------------------------------------------

const normal = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

const COUNTRY_LANGUAGE: Record<string, PartnerAssistantLanguage> = {
  italia: "it",
  "san marino": "it",
  germania: "de",
  austria: "de",
  liechtenstein: "de",
  svizzera: "de",
  francia: "fr",
  monaco: "fr",
  belgio: "fr",
  lussemburgo: "fr",
  spagna: "es",
  messico: "es",
  argentina: "es",
  cile: "es",
  colombia: "es",
  peru: "es",
  venezuela: "es",
  guatemala: "es",
  honduras: "es",
  "el salvador": "es",
  "costa rica": "es",
  panama: "es",
  uruguay: "es",
  paraguay: "es",
  ecuador: "es",
  bolivia: "es",
  "repubblica dominicana": "es",
};

/** La lingua dalla ricerca importata («tedesco», «Français», «inglese americano»…), poi dal paese.
 * Le lingue che il modello non ha (olandese, portoghese, giapponese, cinese…) diventano inglese. */
export function partnerAssistantTemplateLanguage(
  partner: Pick<PartnerAssistantPartner, "country" | "research">,
): PartnerAssistantLanguage {
  const label = typeof partner.research.lang === "string" ? normal(partner.research.lang) : "";
  const first = label.match(
    /tedesc|german|deutsch|frances|french|francais|spagnol|spanish|espanol|castellano|italian|ingles|english|olandes|dutch|portoghes|giappones|cines|corean|svedes|norveges|danes|finland|polacc|ceco|ungheres|grec|turc/u,
  )?.[0];
  if (first) {
    if (/tedesc|german|deutsch/u.test(first)) return "de";
    if (/frances|french|francais/u.test(first)) return "fr";
    if (/spagnol|spanish|espanol|castellano/u.test(first)) return "es";
    if (/italian/u.test(first)) return "it";
    return "en";
  }
  return COUNTRY_LANGUAGE[normal(partner.country)] ?? "en";
}

/** Svizzera e Liechtenstein scrivono il tedesco senza «ß». */
export function partnerAssistantTemplateSwiss(
  partner: Pick<PartnerAssistantPartner, "country">,
  language: PartnerAssistantLanguage,
): boolean {
  return language === "de" && ["svizzera", "liechtenstein"].includes(normal(partner.country));
}

/** Un fuso per paese. Stati Uniti, Canada, Australia e Brasile hanno più fusi: li decide lo stato
 * scritto nella città o nel nome, con un fuso centrale se non c'è. */
const COUNTRY_TIMEZONE: Record<string, string> = {
  italia: "Europe/Rome",
  "san marino": "Europe/Rome",
  germania: "Europe/Berlin",
  austria: "Europe/Vienna",
  svizzera: "Europe/Zurich",
  liechtenstein: "Europe/Vaduz",
  francia: "Europe/Paris",
  monaco: "Europe/Monaco",
  belgio: "Europe/Brussels",
  lussemburgo: "Europe/Luxembourg",
  "paesi bassi": "Europe/Amsterdam",
  "regno unito": "Europe/London",
  "isola di man": "Europe/Isle_of_Man",
  jersey: "Europe/Jersey",
  guernsey: "Europe/Guernsey",
  irlanda: "Europe/Dublin",
  spagna: "Europe/Madrid",
  portogallo: "Europe/Lisbon",
  danimarca: "Europe/Copenhagen",
  svezia: "Europe/Stockholm",
  norvegia: "Europe/Oslo",
  finlandia: "Europe/Helsinki",
  islanda: "Atlantic/Reykjavik",
  estonia: "Europe/Tallinn",
  lettonia: "Europe/Riga",
  lituania: "Europe/Vilnius",
  polonia: "Europe/Warsaw",
  "repubblica ceca": "Europe/Prague",
  slovacchia: "Europe/Bratislava",
  ungheria: "Europe/Budapest",
  slovenia: "Europe/Ljubljana",
  croazia: "Europe/Zagreb",
  serbia: "Europe/Belgrade",
  montenegro: "Europe/Podgorica",
  romania: "Europe/Bucharest",
  bulgaria: "Europe/Sofia",
  grecia: "Europe/Athens",
  cipro: "Asia/Nicosia",
  malta: "Europe/Malta",
  turchia: "Europe/Istanbul",
  ucraina: "Europe/Kyiv",
  georgia: "Asia/Tbilisi",
  israele: "Asia/Jerusalem",
  libano: "Asia/Beirut",
  giordania: "Asia/Amman",
  "emirati arabi uniti": "Asia/Dubai",
  "arabia saudita": "Asia/Riyadh",
  qatar: "Asia/Qatar",
  bahrein: "Asia/Bahrain",
  bahrain: "Asia/Bahrain",
  kuwait: "Asia/Kuwait",
  oman: "Asia/Muscat",
  marocco: "Africa/Casablanca",
  sudafrica: "Africa/Johannesburg",
  india: "Asia/Kolkata",
  "sri lanka": "Asia/Colombo",
  thailandia: "Asia/Bangkok",
  malesia: "Asia/Kuala_Lumpur",
  singapore: "Asia/Singapore",
  indonesia: "Asia/Jakarta",
  filippine: "Asia/Manila",
  vietnam: "Asia/Ho_Chi_Minh",
  cina: "Asia/Shanghai",
  "hong kong": "Asia/Hong_Kong",
  taiwan: "Asia/Taipei",
  "corea del sud": "Asia/Seoul",
  giappone: "Asia/Tokyo",
  "nuova zelanda": "Pacific/Auckland",
  messico: "America/Mexico_City",
  guatemala: "America/Guatemala",
  honduras: "America/Tegucigalpa",
  "el salvador": "America/El_Salvador",
  "costa rica": "America/Costa_Rica",
  panama: "America/Panama",
  colombia: "America/Bogota",
  venezuela: "America/Caracas",
  ecuador: "America/Guayaquil",
  peru: "America/Lima",
  cile: "America/Santiago",
  argentina: "America/Argentina/Buenos_Aires",
  uruguay: "America/Montevideo",
  paraguay: "America/Asuncion",
  "porto rico (stati uniti)": "America/Puerto_Rico",
  "porto rico": "America/Puerto_Rico",
  "isole cayman": "America/Cayman",
  "isole cayman (regno unito)": "America/Cayman",
};

/** Un fuso con i nomi di stati e città (cercati in minuscolo, senza accenti) e le sigle (cercate solo
 * in maiuscolo e come parola isolata: «IN», «LA», «AL» minuscole sono parole comuni). */
type Zone = { names: RegExp; codes: string[]; timezone: string };
const US_ZONES: Zone[] = [
  { names: /\b(?:hawaii|honolulu)\b/u, codes: ["HI"], timezone: "Pacific/Honolulu" },
  { names: /\b(?:alaska|anchorage)\b/u, codes: ["AK"], timezone: "America/Anchorage" },
  {
    names: /\b(?:arizona|phoenix|scottsdale|tucson)\b/u,
    codes: ["AZ"],
    timezone: "America/Phoenix",
  },
  {
    names: /\b(?:washington dc|district of columbia)\b/u,
    codes: ["DC"],
    timezone: "America/New_York",
  },
  {
    names:
      /\b(?:california|oregon|washington|nevada|los angeles|san diego|san francisco|seattle|portland|las vegas|sacramento|san jose|spokane|north idaho|coeur d.alene)\b/u,
    codes: ["CA", "OR", "WA", "NV"],
    timezone: "America/Los_Angeles",
  },
  {
    names: /\b(?:colorado|utah|montana|wyoming|idaho|new mexico|denver|salt lake)\b/u,
    codes: ["CO", "UT", "MT", "WY", "ID", "NM"],
    timezone: "America/Denver",
  },
  {
    names:
      /\b(?:texas|oklahoma|kansas|nebraska|dakota|minnesota|iowa|missouri|arkansas|louisiana|mississippi|alabama|tennessee|wisconsin|illinois|chicago|dallas|houston|austin|san antonio|nashville|st\.? louis|new orleans|minneapolis|evansville|newburgh)\b/u,
    codes: [
      "TX",
      "OK",
      "KS",
      "NE",
      "SD",
      "ND",
      "MN",
      "IA",
      "MO",
      "AR",
      "LA",
      "MS",
      "AL",
      "TN",
      "WI",
      "IL",
    ],
    timezone: "America/Chicago",
  },
  {
    names:
      /\b(?:florida|georgia|carolina|virginia|maryland|delaware|new jersey|new york|pennsylvania|ohio|michigan|indiana|kentucky|connecticut|massachusetts|rhode island|vermont|new hampshire|maine|atlanta|miami|orlando|jacksonville|boston|philadelphia|pittsburgh|detroit|cincinnati|cleveland|columbus|charlotte|tampa|knoxville|chattanooga|kingsport|palm beach|treasure coast|fort pierce)\b/u,
    codes: [
      "FL",
      "GA",
      "NC",
      "SC",
      "VA",
      "WV",
      "MD",
      "DE",
      "NJ",
      "NY",
      "PA",
      "OH",
      "MI",
      "IN",
      "KY",
      "CT",
      "MA",
      "RI",
      "VT",
      "NH",
      "ME",
    ],
    timezone: "America/New_York",
  },
];
const CANADA_ZONES: Zone[] = [
  {
    names: /\b(?:british columbia|columbia britannica|vancouver|victoria|kelowna|okanagan)\b/u,
    codes: ["BC"],
    timezone: "America/Vancouver",
  },
  { names: /\b(?:alberta|calgary|edmonton)\b/u, codes: ["AB"], timezone: "America/Edmonton" },
  { names: /\b(?:saskatchewan|regina|saskatoon)\b/u, codes: ["SK"], timezone: "America/Regina" },
  { names: /\b(?:manitoba|winnipeg)\b/u, codes: ["MB"], timezone: "America/Winnipeg" },
  { names: /\b(?:terranova|newfoundland)\b/u, codes: ["NL"], timezone: "America/St_Johns" },
  {
    names:
      /\b(?:nuova scozia|nova scotia|new brunswick|prince edward|halifax|province marittime|maritimes)\b/u,
    codes: ["NS", "NB", "PEI", "PE"],
    timezone: "America/Halifax",
  },
  {
    names: /\b(?:ontario|toronto|ottawa|quebec|montreal)\b/u,
    codes: ["ON", "QC"],
    timezone: "America/Toronto",
  },
];
const AUSTRALIA_ZONES: Zone[] = [
  { names: /\b(?:western australia|perth)\b/u, codes: ["WA"], timezone: "Australia/Perth" },
  { names: /\b(?:south australia|adelaide)\b/u, codes: ["SA"], timezone: "Australia/Adelaide" },
  {
    names: /\b(?:queensland|brisbane|gold coast)\b/u,
    codes: ["QLD"],
    timezone: "Australia/Brisbane",
  },
  { names: /\b(?:northern territory|darwin)\b/u, codes: ["NT"], timezone: "Australia/Darwin" },
  { names: /\b(?:tasmania|hobart)\b/u, codes: ["TAS"], timezone: "Australia/Hobart" },
  { names: /\b(?:victoria|melbourne)\b/u, codes: ["VIC"], timezone: "Australia/Melbourne" },
  {
    names: /\b(?:new south wales|sydney|canberra)\b/u,
    codes: ["NSW", "ACT"],
    timezone: "Australia/Sydney",
  },
];
const BRAZIL_ZONES: Zone[] = [
  { names: /\b(?:manaus|amazonas)\b/u, codes: ["AM"], timezone: "America/Manaus" },
];
const MULTI_ZONE: Record<string, { zones: Zone[]; central: string }> = {
  "stati uniti": { zones: US_ZONES, central: "America/Chicago" },
  canada: { zones: CANADA_ZONES, central: "America/Toronto" },
  australia: { zones: AUSTRALIA_ZONES, central: "Australia/Sydney" },
  brasile: { zones: BRAZIL_ZONES, central: "America/Sao_Paulo" },
};

/** Le sigle scritte in maiuscolo come parola isolata: «Brea (CA)», «Tampa, FL», «Perth WA». */
const uppercaseCodes = (text: string) =>
  new Set(text.match(/(?<![A-Za-z])[A-Z]{2,3}(?![A-Za-z])/gu));

/** Il fuso per la finestra d'invio (9:30-11 del destinatario), oppure null se il paese non è
 * nell'elenco: allora il contatto passa a Tommi con fuso_mancante. Prima la città, poi il nome (per
 * esempio «Arizona Region – Porsche Club of America»); prima i nomi, poi le sigle. */
export function partnerAssistantTemplateTimezone(
  partner: Pick<PartnerAssistantPartner, "country" | "city" | "name">,
): string | null {
  const country = normal(partner.country);
  const multi = MULTI_ZONE[country];
  if (!multi) return COUNTRY_TIMEZONE[country] ?? null;
  for (const text of [partner.city, partner.name]) {
    const plain = normal(text)
      .replace(/[()/,;–-]/gu, " ")
      .replace(/\s+/gu, " ");
    const byName = multi.zones.find((zone) => zone.names.test(plain));
    if (byName) return byName.timezone;
    const codes = uppercaseCodes(text);
    const byCode = multi.zones.find((zone) => zone.codes.some((code) => codes.has(code)));
    if (byCode) return byCode.timezone;
  }
  return multi.central;
}

/** Porsche Club, registri e community Porsche: con loro si nominano solo 964 e GT3 RS. */
export function partnerAssistantTemplatePorsche(
  partner: Pick<PartnerAssistantPartner, "name" | "typeLabel">,
): boolean {
  return /porsche/iu.test(`${partner.name} ${partner.typeLabel}`);
}

/** La marca dal nome e dal tipo della scheda, Porsche per prima come sopra. Mercedes anche dai club
 * che nominano solo la 300 SL («Gull Wing Group International (club 300 SL)»). */
export function partnerAssistantTemplateBrand(
  partner: Pick<PartnerAssistantPartner, "name" | "typeLabel">,
): PartnerAssistantTemplateBrand {
  const text = `${partner.name} ${partner.typeLabel}`;
  if (partnerAssistantTemplatePorsche(partner)) return "porsche";
  if (/ferrari/iu.test(text)) return "ferrari";
  if (/mercedes|(?<!\p{L})benz(?!\p{L})|300\s?SL(?!\p{L})|gull\s?wing/iu.test(text))
    return "mercedes";
  return null;
}

// ---------------------------------------------------------------------------
// La bozza
// ---------------------------------------------------------------------------

export type PartnerAssistantTemplateDraft = {
  language: PartnerAssistantLanguage;
  register: PartnerAssistantRegister;
  timezone: string;
  porscheCommunity: boolean;
  brand: PartnerAssistantTemplateBrand;
  swiss: boolean;
  subject: string;
  body: string;
  signature: string;
};

/** Il nome del club nel testo: senza l'ultima parentesi, che nella scheda porta sigle, regioni o il
 * nome nella lingua del club («Porsche Club GB – Chiltern (R21)», «Porsche Club Deutschland (PCD)»). */
export function partnerAssistantTemplateClubName(name: string): string {
  const trimmed = name.trim();
  return trimmed.replace(/\s*\([^()]*\)$/u, "").trim() || trimmed;
}

/** Il contatto usa il modello: è nella sezione Club e non è anche un evento, che ha date e una
 * proposta sua (come private.partner_assistant_uses_template). */
export const partnerAssistantUsesTemplate = (context: Pick<PartnerAssistantContext, "partner">) =>
  context.partner.sections.includes("club") && !context.partner.sections.includes("eventi");

/** La rete Scuderia Ferrari Club: il regolamento vieta di far produrre a terzi oggetti con il nome o il
 * logo del club, quindi il testo per i club non si manda e il contatto passa a Tommi. */
export const partnerAssistantTemplateBlocked = (partner: Pick<PartnerAssistantPartner, "name">) =>
  /scuderia\s+ferrari\s+club/iu.test(partner.name);

/** Oggetto, corpo e firma per il club, oppure null se il fuso non si ricava dal paese. */
export function composePartnerAssistantTemplate(
  partner: Pick<PartnerAssistantPartner, "name" | "city" | "country" | "typeLabel" | "research">,
  phone: string,
): PartnerAssistantTemplateDraft | null {
  const timezone = partnerAssistantTemplateTimezone(partner);
  if (timezone === null) return null;
  const language = partnerAssistantTemplateLanguage(partner);
  const swiss = partnerAssistantTemplateSwiss(partner, language);
  const club = partnerAssistantTemplateClubName(partner.name);
  const brand = partnerAssistantTemplateBrand(partner);
  const text = PARTNER_ASSISTANT_TEMPLATES[language];
  const plain = (value: string) => (swiss ? value.replaceAll("ß", "ss") : value);
  return {
    language,
    register: PARTNER_ASSISTANT_TEMPLATE_REGISTER[language],
    timezone,
    porscheCommunity: partnerAssistantTemplatePorsche(partner),
    brand,
    swiss,
    subject: plain(text.subject(club)),
    body: plain(text.body(club, brand)),
    signature: partnerAssistantTemplateSignature(language, phone),
  };
}

/** Le bozze del modello hanno nella scelta questa frase, scritta da complete_partner_assistant_template:
 * il worker la riconosce per la seconda lettura. */
export const PARTNER_ASSISTANT_TEMPLATE_REASON =
  /^Testo fisso per i club, versione \d+, approvato da Tommaso\.$/u;
