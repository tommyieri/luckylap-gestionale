import "server-only";
import { ImapFlow, type ImapFlowOptions, type ListResponse, type SearchObject } from "imapflow";
import { PARTNER_ASSISTANT_IMAP_PORT, type PartnerAssistantMailConfig } from "./mail-config";

// La casella dell'assistente nella 2a: solo il controllo dei 12 mesi (EXAMINE, in sola lettura) e
// la copia in «Posta inviata». Un client per giro, creato qui e mai a livello di modulo (Fluid
// compute riusa i moduli tra le richieste). Nessun log: imapflow con `logger: false`, gli errori
// diventano codici `imap_…`, mai il testo del server.

export type PartnerAssistantFolders = { inbox: string; sent: string | null; junk: string | null };
export type PartnerAssistantImapError = {
  kind: "credenziali" | "attesa" | "fallito";
  code: string;
};
export type PartnerAssistantMailbox = {
  /** INBOX e le cartelle `\Sent` e `\Junk` della LIST; null se la LIST fallisce. Una cartella
   * che manca o non è univoca è null. */
  folders(): Promise<PartnerAssistantFolders | null>;
  /** true: un messaggio da, a o in copia all'indirizzo dal `since` in una delle tre cartelle;
   * false: nessuno, con la connessione verificata; null: «non so», mai «non c'è». */
  correspondence(
    folders: PartnerAssistantFolders,
    address: string,
    since: Date,
  ): Promise<boolean | null>;
  /** Gli UID con quel Message-ID; [] solo con la connessione verificata; null: «non so». */
  findMessageId(path: string, messageId: string): Promise<number[] | null>;
  /** Copia letta (`\Seen`) con la data d'invio; false se il server non l'ha confermata. */
  append(path: string, raw: string, date: Date): Promise<boolean>;
  /** LOGOUT, oppure la chiusura del socket se il LOGOUT fallisce; mai un'eccezione. */
  close(): Promise<void>;
};
export type PartnerAssistantMailboxOpening =
  { ok: true; mailbox: PartnerAssistantMailbox } | { ok: false; error: PartnerAssistantImapError };

type ImapErrorFields = {
  code?: unknown;
  serverResponseCode?: unknown;
  authenticationFailed?: unknown;
  tlsFailed?: unknown;
};

// Rete, timeout e limiti del server: la casella può rispondere al giro dopo.
const WAIT = new Set([
  "ETHROTTLE",
  "CONNECT_TIMEOUT",
  "GREETING_TIMEOUT",
  "UPGRADE_TIMEOUT",
  "ETIMEOUT",
  "NoConnection",
  "EConnectionClosed",
  "ClosedAfterConnectText",
  "ClosedAfterConnectTLS",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ECONNRESET",
]);

// Gli usi speciali di RFC 6154 e RFC 8457.
const SPECIAL_USES = [
  "\\All",
  "\\Archive",
  "\\Drafts",
  "\\Flagged",
  "\\Junk",
  "\\Sent",
  "\\Trash",
  "\\Important",
];

/** Un codice `imap_…` (al massimo 80 caratteri, `[a-z0-9_]`) da un codice di imapflow o di Node. */
function imapCode(value: string): string {
  const code = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .slice(0, 75);
  return code ? `imap_${code}` : "imap_sconosciuto";
}

/** Le credenziali rifiutate fermano gli invii; il resto è «non so». Mai `response`. */
export function classifyPartnerAssistantImapError(error: unknown): PartnerAssistantImapError {
  const fields = (typeof error === "object" && error !== null ? error : {}) as ImapErrorFields;
  if (fields.authenticationFailed === true)
    return { kind: "credenziali", code: "imap_autenticazione" };
  const code = typeof fields.code === "string" ? fields.code : "";
  const serverCode = typeof fields.serverResponseCode === "string" ? fields.serverResponseCode : "";
  return {
    kind: WAIT.has(code) || fields.tlsFailed === true ? "attesa" : "fallito",
    code: imapCode(code || serverCode),
  };
}

function partnerAssistantMailbox(client: ImapFlow): PartnerAssistantMailbox {
  /** La cartella aperta è proprio `path`. */
  const selected = (path: string) => {
    const mailbox = client.mailbox;
    return Boolean(mailbox) && mailbox !== false && mailbox.path === path;
  };

  /** UID SEARCH dentro un EXAMINE di `path`. Gli UID trovati, `[]` solo se subito dopo la
   * ricerca la cartella aperta è ancora `path`, null se la ricerca non ha risposto. In imapflow
   * 2.4.2 una SEARCH non completata può risolvere `[]` (corretto in 2.4.3, 2.5.1 e 2.5.6): per
   * questo un `[]` non basta da solo. Le eccezioni salgono al chiamante. */
  async function search(path: string, query: SearchObject): Promise<number[] | null> {
    const lock = await client.getMailboxLock(path, { readOnly: true });
    try {
      if (!selected(path)) return null;
      const result = await client.search(query, { uid: true });
      if (!Array.isArray(result)) return null;
      if (result.length > 0) return [...result];
      return selected(path) ? [] : null;
    } finally {
      lock.release();
    }
  }

  /** Dopo le ricerche vuote la connessione è ancora usabile e risponde a un NOOP. */
  async function verified(): Promise<boolean> {
    if (client.usable !== true) return false;
    await client.noop();
    return client.usable === true;
  }

  return {
    async folders() {
      try {
        // Senza `listOnly`: solo così imapflow 2.4.2 assegna specialUse, che serve al ripiego
        // per nome sui server senza flag. Su IONOS bastano i flag di LIST e LSUB (verificati il
        // 30 ottobre). Il ripiego per nome è un rischio accettato per i server senza
        // SPECIAL-USE: con più nomi concorrenti sceglie imapflow.
        const entries = await client.list();
        if (!Array.isArray(entries)) return null;
        // I flag sono atomi: si confrontano senza maiuscole, come in imapflow. Le cartelle
        // \Noselect o \NonExistent non contengono messaggi.
        const has = (entry: ListResponse, flag: string) =>
          entry.flags instanceof Set &&
          [...entry.flags].some(
            (value) => typeof value === "string" && value.toLowerCase() === flag.toLowerCase(),
          );
        const selectable = (entry: ListResponse) =>
          !has(entry, "\\Noselect") && !has(entry, "\\NonExistent");
        // Vale il flag del server, anche contro il nome riconosciuto da imapflow in un'altra
        // cartella; senza flag, lo specialUse di imapflow. Ogni dubbio è «non so» (null), mai
        // una ricerca nella cartella sbagliata, che vuota direbbe «non c'è»: due cartelle con
        // lo stesso flag; il flag solo su cartelle che non si aprono, senza indovinarne
        // un'altra dal nome; uno specialUse su una cartella che il server dà per un altro uso.
        const folder = (flag: string) => {
          const flagged = entries.filter((entry) => has(entry, flag));
          const candidates = flagged.filter(selectable);
          if (candidates.length > 1) return null;
          if (candidates[0]) return candidates[0].path;
          if (flagged.length > 0) return null;
          const otherUse = (entry: ListResponse) =>
            SPECIAL_USES.some((use) => use.toLowerCase() !== flag.toLowerCase() && has(entry, use));
          return (
            entries.find(
              (entry) => entry.specialUse === flag && selectable(entry) && !otherUse(entry),
            )?.path ?? null
          );
        };
        const sent = folder("\\Sent");
        const junk = folder("\\Junk");
        // La stessa cartella per inviata e spam: «non so» per tutte e due.
        if (sent !== null && sent === junk) return { inbox: "INBOX", sent: null, junk: null };
        return { inbox: "INBOX", sent, junk };
      } catch {
        return null;
      }
    },

    async correspondence(folders, address, since) {
      // Senza posta inviata o spam la ricerca non può dire «non c'è».
      if (folders.sent === null || folders.junk === null) return null;
      try {
        for (const path of [folders.inbox, folders.sent, folders.junk]) {
          const uids = await search(path, {
            since,
            or: [{ from: address }, { to: address }, { cc: address }],
          });
          if (uids === null) return null;
          if (uids.length > 0) return true;
        }
        return (await verified()) ? false : null;
      } catch {
        return null;
      }
    },

    async findMessageId(path, messageId) {
      try {
        const uids = await search(path, { header: { "message-id": messageId } });
        if (uids === null) return null;
        if (uids.length > 0) return uids;
        return (await verified()) ? [] : null;
      } catch {
        return null;
      }
    },

    async append(path, raw, date) {
      try {
        return Boolean(await client.append(path, raw, ["\\Seen"], date));
      } catch {
        return false;
      }
    },

    async close() {
      try {
        await client.logout();
      } catch {
        try {
          client.close();
        } catch {
          // già chiusa
        }
      }
    },
  };
}

/** Una connessione IMAP con TLS sulla 993. Le credenziali rifiutate e gli altri errori tornano
 * come codici, senza eccezioni e senza log. */
export async function openPartnerAssistantMailbox(
  mail: PartnerAssistantMailConfig,
  create: (options: ImapFlowOptions) => ImapFlow = (options) => new ImapFlow(options),
): Promise<PartnerAssistantMailboxOpening> {
  const options: ImapFlowOptions = {
    host: mail.imapHost,
    port: PARTNER_ASSISTANT_IMAP_PORT,
    secure: true,
    servername: mail.imapHost,
    tls: { minVersion: "TLSv1.2" },
    auth: { user: mail.user, pass: mail.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  };
  let client: ImapFlow | null = null;
  try {
    client = create(options);
    // Gli errori di socket arrivano come evento: senza un listener farebbero cadere il processo.
    client.on("error", () => {});
    await client.connect();
  } catch (error) {
    try {
      client?.close();
    } catch {
      // già chiusa
    }
    return { ok: false, error: classifyPartnerAssistantImapError(error) };
  }
  return { ok: true, mailbox: partnerAssistantMailbox(client) };
}
