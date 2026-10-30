import "server-only";
import SMTPConnection, { type SMTPConnectionOptions } from "nodemailer/lib/smtp-connection";
import {
  PARTNER_ASSISTANT_SMTP_PORT,
  partnerAssistantMailAddress,
  type PartnerAssistantMailConfig,
} from "./mail-config";

// SMTP per fasi. In nodemailer 10.1.1 la connessione chiusa, l'errore di socket e il timeout del
// socket portano `command: "CONN"` in ogni fase: solo la fase in cui arriva l'errore dice se
// l'email può essere partita. Prima di `send` non può essere partita; durante `send` sì.

export type PartnerAssistantSmtpPhase = "connect" | "login" | "send";
export type PartnerAssistantSmtpOutcome =
  | { kind: "inviato"; responseCode: 250 }
  | { kind: "credenziali"; code: string }
  | { kind: "temporaneo"; code: string; responseCode: number | null }
  | { kind: "respinto"; code: string; responseCode: number; enhanced: string | null; spam: boolean }
  | { kind: "bloccato"; code: string; responseCode: number; enhanced: string | null }
  | { kind: "non_partito"; code: string }
  | { kind: "incerto"; code: string };
/** `login`: "ok" se l'accesso è riuscito, il codice dell'esito se connessione o accesso sono falliti,
 * null se la connessione non si è aperta. */
export type PartnerAssistantSmtpResult = {
  outcome: PartnerAssistantSmtpOutcome;
  login: string | null;
};
export type PartnerAssistantSmtp = {
  send(input: {
    raw: string;
    from: string;
    to: string;
    signal: AbortSignal;
  }): Promise<PartnerAssistantSmtpResult>;
};

type SmtpErrorFields = {
  code?: unknown;
  responseCode?: unknown;
  command?: unknown;
  response?: unknown;
  rejectedErrors?: unknown;
};

const ENHANCED = /\b5\.\d{1,3}\.\d{1,3}\b/;

/** Un codice `smtp_…` da un codice di nodemailer: minuscolo, mai testo del server. */
function smtpCode(value: unknown): string {
  const code =
    typeof value === "string"
      ? value
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_")
          .slice(0, 70)
      : "";
  return code ? `smtp_${code}` : "smtp_sconosciuto";
}

/** Le risposte del server dell'errore e dei destinatari rifiutati, nell'ordine. */
function responses(error: SmtpErrorFields): string[] {
  const list = typeof error.response === "string" ? [error.response] : [];
  if (Array.isArray(error.rejectedErrors))
    for (const rejected of error.rejectedErrors) {
      const response = (rejected as SmtpErrorFields | null)?.response;
      if (typeof response === "string") list.push(response);
    }
  return list;
}

/** L'esito di un errore di nodemailer nella fase in cui è arrivato. */
export function classifyPartnerAssistantSmtpError(
  error: unknown,
  phase: PartnerAssistantSmtpPhase,
): PartnerAssistantSmtpOutcome {
  const fields: SmtpErrorFields = typeof error === "object" && error !== null ? error : {};
  const responseCode =
    typeof fields.responseCode === "number" &&
    Number.isInteger(fields.responseCode) &&
    fields.responseCode >= 400 &&
    fields.responseCode <= 599
      ? fields.responseCode
      : null;
  const response = typeof fields.response === "string" ? fields.response : "";
  if (responseCode !== null && responseCode < 500)
    return {
      kind: "temporaneo",
      code: /send limit/i.test(response) ? "smtp_limite" : `smtp_${responseCode}`,
      responseCode,
    };
  if (phase === "login" && (fields.code === "EAUTH" || fields.code === "ENOAUTH"))
    return {
      kind: "credenziali",
      code: responseCode ? `smtp_${responseCode}` : smtpCode(fields.code),
    };
  if (responseCode !== null) {
    const code = `smtp_${responseCode}`;
    if (phase !== "send" || fields.command === "MAIL FROM") {
      // Il server rifiuta la casella, non il contatto.
      const enhanced = response.match(ENHANCED)?.[0] ?? null;
      return enhanced?.startsWith("5.7.") || /spam/i.test(response)
        ? { kind: "bloccato", code, responseCode, enhanced }
        : { kind: "non_partito", code };
    }
    const all = responses(fields);
    const enhanced = all.map((text) => text.match(ENHANCED)?.[0]).find(Boolean) ?? null;
    return {
      kind: "respinto",
      code,
      responseCode,
      enhanced,
      spam: all.some((text) => /spam/i.test(text)),
    };
  }
  // Senza risposta del server: prima di `send` l'email non è partita, durante `send` forse sì.
  return phase === "send"
    ? { kind: "incerto", code: smtpCode(fields.code) }
    : { kind: "non_partito", code: smtpCode(fields.code) };
}

type SentInfo = {
  accepted?: unknown;
  rejected?: unknown;
  rejectedErrors?: unknown;
  response?: unknown;
};

/** L'esito di una callback di `send` senza errore. */
function sentOutcome(info: SentInfo | undefined, to: string): PartnerAssistantSmtpOutcome {
  const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
  if (rejected.length > 0) {
    const errors = Array.isArray(info?.rejectedErrors) ? info.rejectedErrors : [];
    const first = (errors[0] ?? {}) as SmtpErrorFields;
    return classifyPartnerAssistantSmtpError(
      {
        code: "EENVELOPE",
        command: "RCPT TO",
        responseCode: first.responseCode,
        response: first.response,
        rejectedErrors: errors,
      },
      "send",
    );
  }
  const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
  const response = typeof info?.response === "string" ? info.response : "";
  if (accepted.length === 1 && accepted[0] === to && /^250(?!\d)/.test(response))
    return { kind: "inviato", responseCode: 250 };
  return { kind: "incerto", code: "smtp_risposta_incerta" };
}

/** Una connessione per invio, in tre fasi: connessione con STARTTLS obbligatorio, accesso, invio. */
export function createPartnerAssistantSmtp(
  mail: PartnerAssistantMailConfig,
  createConnection: (options: SMTPConnectionOptions) => SMTPConnection = (options) =>
    new SMTPConnection(options),
): PartnerAssistantSmtp {
  const options: SMTPConnectionOptions = {
    host: mail.smtpHost,
    port: PARTNER_ASSISTANT_SMTP_PORT,
    secure: false,
    requireTLS: true,
    tls: { servername: mail.smtpHost, minVersion: "TLSv1.2" },
    name: mail.domain,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    dnsTimeout: 10_000,
    logger: false,
    debug: false,
  };
  return {
    send({ raw, from, to, signal }) {
      const recipient = partnerAssistantMailAddress(to);
      if (recipient === null)
        return Promise.resolve({
          outcome: { kind: "non_partito", code: "smtp_destinatario_non_valido" },
          login: null,
        });
      if (signal.aborted)
        return Promise.resolve({
          outcome: { kind: "non_partito", code: "smtp_scadenza" },
          login: null,
        });
      return new Promise((resolve) => {
        let phase: PartnerAssistantSmtpPhase = "connect";
        let settled = false;
        let conn: SMTPConnection | null = null;
        const onAbort = () =>
          settle(
            phase === "send"
              ? { kind: "incerto", code: "smtp_scadenza" }
              : { kind: "non_partito", code: "smtp_scadenza" },
            false,
          );
        // Un solo esito, il primo che arriva. QUIT solo da una callback, a comando finito: dopo
        // un evento `error` o una scadenza la connessione si chiude e basta.
        const settle = (outcome: PartnerAssistantSmtpOutcome, quit: boolean) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          try {
            if (quit) conn?.quit();
          } catch {
            // la connessione si chiude comunque qui sotto
          } finally {
            try {
              conn?.close();
            } catch {
              // già chiusa
            }
          }
          resolve({
            outcome,
            login: phase === "send" || outcome.kind === "inviato" ? "ok" : outcome.code,
          });
        };
        const fail = (error: unknown, quit: boolean) =>
          settle(classifyPartnerAssistantSmtpError(error, phase), quit);
        // Un'eccezione dentro una callback di nodemailer non deve uscire dal suo emettitore.
        const guarded = (step: () => void) => {
          try {
            step();
          } catch (error) {
            fail(error, false);
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        guarded(() => {
          const connection = createConnection(options);
          conn = connection;
          // Gli errori di connessione e di socket arrivano come evento: prima di connect.
          connection.on("error", (error: unknown) => fail(error, false));
          connection.connect((error) =>
            guarded(() => {
              if (settled) return;
              if (error) return fail(error, true);
              if (!connection.allowsAuth)
                return settle({ kind: "non_partito", code: "smtp_auth_assente" }, true);
              phase = "login";
              connection.login({ user: mail.user, pass: mail.password }, (error) =>
                guarded(() => {
                  if (settled) return;
                  if (error) return fail(error, true);
                  phase = "send";
                  connection.send({ from, to: [recipient] }, raw, (error, info) => {
                    if (settled) return;
                    if (error) return fail(error, true);
                    settle(sentOutcome(info, recipient), true);
                  });
                }),
              );
            }),
          );
        });
      });
    },
  };
}
