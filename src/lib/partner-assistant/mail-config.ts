import "server-only";
import { partnerAssistantConfig, type PartnerAssistantEnvironment } from "./config";

export const PARTNER_ASSISTANT_SMTP_PORT = 587;
export const PARTNER_ASSISTANT_IMAP_PORT = 993;
export const PARTNER_ASSISTANT_FROM_NAME_DEFAULT = "Tommaso | LuckyLap";
export const PARTNER_ASSISTANT_SMTP_HOST_DEFAULT = "smtp.ionos.it";
export const PARTNER_ASSISTANT_IMAP_HOST_DEFAULT = "imap.ionos.it";

export type PartnerAssistantMailEnvironment = {
  PARTNER_MAIL_USER?: string;
  PARTNER_MAIL_PASSWORD?: string;
  PARTNER_MAIL_FROM_NAME?: string;
  PARTNER_TEST_TO?: string;
  PARTNER_MAIL_SMTP_HOST?: string;
  PARTNER_MAIL_IMAP_HOST?: string;
};
export type PartnerAssistantMailConfig = {
  user: string;
  password: string;
  fromName: string;
  smtpHost: string;
  imapHost: string;
  testTo: string[];
  domain: string;
};
/** Solo quali gruppi di variabili sono validi: nessun valore, nessuna lunghezza. */
export type PartnerAssistantEnvironmentReport = {
  assistente: boolean;
  casella: boolean;
  prova: boolean;
  indirizziProva: number;
};

// La regex stretta dei vincoli globali: niente virgolette, spazi, `;`, `<`, `>`, apostrofi.
const ADDRESS = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const PASSWORD = /^[\x20-\x7e]{1,512}$/;
const FROM_NAME = /^[^\x00-\x1f\x7f<>@"\\]{1,80}$/;
const TEST_TO_MAX = 5;

/** L'indirizzo in minuscolo, senza spazi ai lati, oppure null se non passa la regex stretta. */
export function partnerAssistantMailAddress(value: string): string | null {
  const address = value.trim().toLowerCase();
  if (address.length > 254 || !ADDRESS.test(address)) return null;
  return address;
}

function mailEnvironment(): PartnerAssistantMailEnvironment {
  return {
    PARTNER_MAIL_USER: process.env.PARTNER_MAIL_USER,
    PARTNER_MAIL_PASSWORD: process.env.PARTNER_MAIL_PASSWORD,
    PARTNER_MAIL_FROM_NAME: process.env.PARTNER_MAIL_FROM_NAME,
    PARTNER_TEST_TO: process.env.PARTNER_TEST_TO,
    PARTNER_MAIL_SMTP_HOST: process.env.PARTNER_MAIL_SMTP_HOST,
    PARTNER_MAIL_IMAP_HOST: process.env.PARTNER_MAIL_IMAP_HOST,
  };
}

/** Un valore assente o vuoto prende il predefinito; uno presente deve passare il controllo. */
function optional(value: string | undefined, valid: RegExp, fallback: string): string | null {
  if (value === undefined || value === "") return fallback;
  return valid.test(value) ? value : null;
}

/** Da 1 a 5 indirizzi distinti separati da virgole; assente o vuoto: nessuno. */
function testAddresses(value: string | undefined): string[] | null {
  if (value === undefined || value === "") return [];
  const parts = value.split(",");
  if (parts.length > TEST_TO_MAX) return null;
  const addresses: string[] = [];
  for (const part of parts) {
    const address = partnerAssistantMailAddress(part);
    if (address === null || addresses.includes(address)) return null;
    addresses.push(address);
  }
  return addresses;
}

/** Fallimento chiuso, separato da partnerAssistantConfig: senza casella l'assistente prepara soltanto.
 * Un PARTNER_TEST_TO scritto male spegne anche la casella. Mai un log. */
export function partnerAssistantMailConfig(
  environment: PartnerAssistantMailEnvironment = mailEnvironment(),
): PartnerAssistantMailConfig | null {
  const user = partnerAssistantMailAddress(environment.PARTNER_MAIL_USER ?? "");
  const password = environment.PARTNER_MAIL_PASSWORD ?? "";
  const fromName = optional(
    environment.PARTNER_MAIL_FROM_NAME,
    FROM_NAME,
    PARTNER_ASSISTANT_FROM_NAME_DEFAULT,
  );
  const smtpHost = optional(
    environment.PARTNER_MAIL_SMTP_HOST,
    HOST,
    PARTNER_ASSISTANT_SMTP_HOST_DEFAULT,
  );
  const imapHost = optional(
    environment.PARTNER_MAIL_IMAP_HOST,
    HOST,
    PARTNER_ASSISTANT_IMAP_HOST_DEFAULT,
  );
  const testTo = testAddresses(environment.PARTNER_TEST_TO);
  if (
    user === null ||
    !PASSWORD.test(password) ||
    fromName === null ||
    smtpHost === null ||
    imapHost === null ||
    testTo === null
  )
    return null;
  return {
    user,
    password,
    fromName,
    smtpHost,
    imapHost,
    testTo,
    domain: user.slice(user.indexOf("@") + 1),
  };
}

/** Per la riga «Variabili» della pagina: quali gruppi sono validi, mai i valori. */
export function partnerAssistantEnvironmentReport(
  environment: PartnerAssistantEnvironment & PartnerAssistantMailEnvironment = {
    PARTNER_ASSISTANT_ENABLED: process.env.PARTNER_ASSISTANT_ENABLED,
    PARTNER_ASSISTANT_SECRET: process.env.PARTNER_ASSISTANT_SECRET,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: process.env.PARTNER_ASSISTANT_SUPABASE_SECRET_KEY,
    PARTNER_ASSISTANT_PHONE: process.env.PARTNER_ASSISTANT_PHONE,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    ...mailEnvironment(),
  },
): PartnerAssistantEnvironmentReport {
  const assistente = partnerAssistantConfig(environment) !== null;
  const casella =
    partnerAssistantMailConfig({ ...environment, PARTNER_TEST_TO: undefined }) !== null;
  const testTo = partnerAssistantMailConfig(environment)?.testTo ?? [];
  const prova = Boolean(environment.PARTNER_TEST_TO) && testTo.length > 0;
  return { assistente, casella, prova, indirizziProva: prova ? testTo.length : 0 };
}
