import "server-only";
import { randomUUID } from "node:crypto";
import { romeDay } from "../partner/dates";
import { abortable, boundedPhase, safeWorkerReason } from "../shopify/worker-io";
import type { PartnerAssistantConfig } from "./config";
import {
  openPartnerAssistantMailbox,
  type PartnerAssistantFolders,
  type PartnerAssistantMailbox,
} from "./imap";
import {
  composePartnerAssistantMessage,
  partnerAssistantMessageId,
  partnerAssistantMessageText,
  partnerAssistantOptOutLine,
} from "./mail-compose";
import { partnerAssistantMailAddress, type PartnerAssistantMailConfig } from "./mail-config";
import { partnerAssistantSendRecheck } from "./send-recheck";
import { createPartnerAssistantSendStore, type PartnerAssistantSendStore } from "./send-store";
import type {
  PartnerAssistantFinishInput,
  PartnerAssistantMailboxCheck,
  PartnerAssistantSendCandidate,
  PartnerAssistantSendSkipReason,
} from "./send-types";
import {
  createPartnerAssistantSmtp,
  type PartnerAssistantSmtp,
  type PartnerAssistantSmtpOutcome,
  type PartnerAssistantSmtpResult,
} from "./smtp";
import { PARTNER_ASSISTANT_RPC_TIMEOUT_MS } from "./store";
import type { StoreResult } from "./types";

/** Il tempo del passo d'invio, prima del passo con Claude nello stesso giro di 300 secondi. */
export const PARTNER_ASSISTANT_SEND_BUDGET_MS = 120_000;
/** Più lunga del budget: la casella non si libera mentre il passo lavora. */
export const PARTNER_ASSISTANT_SEND_LEASE_SECONDS = 300;
/** Sotto questo tempo rimasto un messaggio non si prepara. */
export const PARTNER_ASSISTANT_SMTP_MIN_MS = 75_000;
/** L'SMTP scade a tempo rimasto meno questo margine. */
export const PARTNER_ASSISTANT_SMTP_MARGIN_MS = 15_000;
/** finish, skip, pause e release hanno questo tempo proprio, fuori dal budget: un 250 arrivato tardi
 * va registrato, e così l'attesa di una casella che a budget finito non ha risposto (Fuoco 5). */
export const PARTNER_ASSISTANT_SEND_RECORD_MS = 10_000;
/** Il controllo dei 12 mesi nella casella. */
export const PARTNER_ASSISTANT_MAILBOX_DAYS = 365;
const DAY_MS = 86_400_000;

export type PartnerAssistantSendDependencies = {
  store?: PartnerAssistantSendStore;
  smtp?: PartnerAssistantSmtp;
  openMailbox?: typeof openPartnerAssistantMailbox;
  /** Misura solo il budget (predefinito performance.now). Mai per una data. */
  clock?: () => number;
  /** L'ora vera (predefinito Date.now): Date:, since e il giorno di Roma del ricontrollo. */
  now?: () => number;
  workerId?: () => string;
  uuid?: () => string;
};
export type PartnerAssistantSendRun = { status: "idle" | "complete" | "uncertain" | "stopped" };

/** L'esito SMTP come lo registra finish_partner_assistant_send. */
function finishInput(
  messageRowId: string,
  outcome: PartnerAssistantSmtpOutcome,
): PartnerAssistantFinishInput {
  const base = { messageRowId, smtpCode: null, enhancedCode: null, spam: false };
  switch (outcome.kind) {
    case "inviato":
      return { ...base, outcome: "inviato", smtpCode: 250, reason: null };
    case "credenziali":
      return { ...base, outcome: "scartato", reason: "smtp_credenziali" };
    case "temporaneo":
      return {
        ...base,
        outcome: "scartato",
        smtpCode: outcome.responseCode,
        reason: "smtp_temporaneo",
      };
    case "non_partito":
      return { ...base, outcome: "scartato", reason: "smtp_non_partito" };
    case "bloccato":
      return {
        ...base,
        outcome: "scartato",
        smtpCode: outcome.responseCode,
        enhancedCode: outcome.enhanced,
        reason: "smtp_bloccato",
      };
    case "respinto":
      return {
        ...base,
        outcome: "respinto",
        smtpCode: outcome.responseCode,
        enhancedCode: outcome.enhanced,
        spam: outcome.spam,
        reason: outcome.code,
      };
    case "incerto":
      return { ...base, outcome: "incerto", reason: outcome.code };
  }
}

/** Il nome dell'errore, mai il messaggio: può contenere indirizzi o testi. */
const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);
const code = (value: string, fallback: string) => (safeWorkerReason(value) ? value : fallback);

/** Un giro d'invio: claim della casella, ricontrollo delle date, copie arretrate in «Posta
 * inviata», controllo dei 12 mesi, prepare, start, un solo SMTP, finish, copia, rilascio. Ogni
 * risposta incerta ferma il giro senza un secondo SMTP; la lease della casella fa il resto. */
export async function runPartnerAssistantSendStep(
  config: PartnerAssistantConfig,
  mail: PartnerAssistantMailConfig,
  parentSignal: AbortSignal,
  dependencies: PartnerAssistantSendDependencies = {},
): Promise<PartnerAssistantSendRun> {
  const clock = dependencies.clock ?? (() => performance.now());
  const now = dependencies.now ?? Date.now;
  const deadline = clock() + PARTNER_ASSISTANT_SEND_BUDGET_MS;
  // Un timer proprio: in after() nessuno interrompe il segnale da fuori.
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  parentSignal.addEventListener("abort", onAbort, { once: true });
  if (parentSignal.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), PARTNER_ASSISTANT_SEND_BUDGET_MS);
  const remaining = () => Math.max(0, deadline - clock());
  let phase = "claim";

  async function work(): Promise<PartnerAssistantSendRun> {
    const store = dependencies.store ?? createPartnerAssistantSendStore(config);
    const newId = dependencies.uuid ?? randomUUID;
    const workerId = (dependencies.workerId ?? randomUUID)();

    /** Una RPC entro il tempo rimasto (al più 10 secondi): senza risposta certa { ok: false }. */
    async function database<T>(
      task: (signal: AbortSignal) => Promise<StoreResult<T>>,
    ): Promise<StoreResult<T>> {
      try {
        return await boundedPhase(
          controller.signal,
          Math.min(PARTNER_ASSISTANT_RPC_TIMEOUT_MS, remaining()),
          task,
        );
      } catch {
        return { ok: false };
      }
    }
    /** Una registrazione con 10 secondi propri, fuori dal budget: finish, skip, pause e release. Un 250
     * arrivato tardi va registrato; uno skip dopo una casella rimasta ferma fino a budget finito
     * pure, altrimenti il giro dopo rifà il login e il passo con Claude resta fermo (Fuoco 5). */
    async function recordAfter<T>(
      task: (signal: AbortSignal) => Promise<StoreResult<T>>,
    ): Promise<StoreResult<T>> {
      try {
        return await boundedPhase(parentSignal, PARTNER_ASSISTANT_SEND_RECORD_MS, task);
      } catch {
        return { ok: false };
      }
    }
    /** Una chiamata alla casella entro il budget: a budget finito o con un'eccezione, «non so». */
    async function imap<T>(task: () => Promise<T>, unknown: T): Promise<T> {
      if (controller.signal.aborted || remaining() <= 0) return unknown;
      try {
        return await abortable(task(), controller.signal);
      } catch {
        return unknown;
      }
    }

    // 1. La casella per questo giro.
    const claimed = await database((signal) =>
      store.claim(workerId, PARTNER_ASSISTANT_SEND_LEASE_SECONDS, mail.testTo.length, signal),
    );
    if (!claimed.ok) return { status: "uncertain" };
    if (claimed.value.status === "idle") return { status: "idle" };
    const { leaseToken: lease, appends } = claimed.value;
    let candidate: PartnerAssistantSendCandidate | null = claimed.value.candidate;

    let outcome = "nessun_invio";
    let smtpLogin: string | null = null;
    let imapLogin: string | null = null;
    let status: PartnerAssistantSendRun["status"] = "complete";
    // Assegnata dentro round(): il tipo esplicito evita che TypeScript la restringa a null.
    let mailbox = null as PartnerAssistantMailbox | null;
    /** Una sola attesa di 15 minuti per giro (Fuoco 5). */
    let uncertainSkipped = false;
    let pendingUncertain = false;
    const uncertain = () => {
      status = "uncertain";
    };
    const skip = async (jobId: string | null, reason: PartnerAssistantSendSkipReason) => {
      if (reason === "casella_incerta") {
        if (uncertainSkipped) return;
        uncertainSkipped = true;
      }
      // Sempre con i suoi 10 secondi: una ricerca IMAP ferma si sblocca solo a budget finito, e
      // senza lo skip registrato il candidato tornerebbe al giro dopo, 2 minuti più tardi.
      const skipped = await recordAfter((signal) => store.skip(lease, jobId, reason, signal));
      if (!skipped.ok) uncertain();
    };

    async function round(): Promise<void> {
      // 2. Il ricontrollo delle date, solo in invio: senza aprire la casella.
      if (candidate && candidate.mode === "invio") {
        phase = "ricontrollo";
        let expired: boolean;
        try {
          const recheck = partnerAssistantSendRecheck(
            {
              choice: candidate.choice,
              body: candidate.draft.body,
              draftCreatedAt: candidate.draft.createdAt,
            },
            romeDay(new Date(now())),
          );
          expired = !recheck.ok;
        } catch (error) {
          // Un giorno o un momento non validi: mai un «ok» per sbaglio, il candidato resta.
          console.error("partner_assistant_send_bug", { phase, error: errorName(error) });
          outcome = "ricontrollo_non_valido";
          candidate = null;
          expired = false;
        }
        if (expired && candidate) {
          await skip(candidate.jobId, "bozza_scaduta");
          outcome = "bozza_scaduta";
          candidate = null;
        }
      }
      if (!candidate && appends.length === 0) return;

      // 3. Una sola connessione IMAP per giro.
      phase = "casella";
      const openMailbox = dependencies.openMailbox ?? openPartnerAssistantMailbox;
      const opening = openMailbox(mail);
      let opened: Awaited<typeof opening>;
      try {
        opened = await abortable(opening, controller.signal);
      } catch {
        // Una connessione arrivata dopo la scadenza si chiude da sola, senza aspettarla.
        void opening
          .then((late) => (late.ok ? late.mailbox.close() : undefined))
          .catch(() => undefined);
        opened = { ok: false, error: { kind: "attesa", code: "imap_scadenza" } };
      }
      if (!opened.ok) {
        imapLogin = code(opened.error.code, "imap_sconosciuto");
        outcome = imapLogin;
        if (opened.error.kind === "credenziali") {
          // Come finish, skip e release: con i suoi 10 secondi, anche a budget finito.
          const paused = await recordAfter((signal) => store.pause(lease, signal));
          if (paused.ok && paused.value.status === "done") status = "stopped";
          else uncertain();
          return;
        }
        await skip(candidate?.jobId ?? null, "casella_incerta");
        return;
      }
      imapLogin = "ok";
      mailbox = opened.mailbox;
      const box = mailbox;
      const folders = await imap(() => box.folders(), null as PartnerAssistantFolders | null);
      if (!folders) {
        outcome = "imap_cartelle";
        await skip(candidate?.jobId ?? null, "casella_incerta");
        return;
      }

      // 4. Le copie arretrate in «Posta inviata». Una che non si chiude lascia la casella incerta.
      phase = "copie";
      for (const pending of appends) {
        const sent = folders.sent;
        if (!sent) {
          pendingUncertain = true;
          continue;
        }
        const found = await imap(() => box.findMessageId(sent, pending.messageId), null);
        if (found === null) {
          pendingUncertain = true;
          continue;
        }
        if (found.length === 0) {
          const copied = await imap(
            () => box.append(sent, pending.raw, new Date(pending.sentAt)),
            false,
          );
          if (!copied) {
            pendingUncertain = true;
            continue;
          }
        }
        const recorded = await database((signal) =>
          store.recordAppend(lease, pending.messageRowId, found.length > 0, signal),
        );
        if (!recorded.ok) uncertain();
      }
      if (appends.length > 0) outcome = "copie";
      if (!candidate) return;
      const chosen = candidate;

      // 5. Il destinatario: in prova un indirizzo di PARTNER_TEST_TO, in invio quello della scheda.
      phase = "destinatario";
      const index = chosen.testIndex;
      const target =
        chosen.mode === "prova"
          ? index !== null && index >= 0 && index < mail.testTo.length
            ? mail.testTo[index]!
            : null
          : chosen.address;
      if (target === null && chosen.mode === "prova") {
        outcome = "prova_destinatario_mancante";
        return;
      }
      const to = target === null ? null : partnerAssistantMailAddress(target);
      if (to === null) {
        outcome = "destinatario_non_valido";
        return;
      }

      // 6. Il controllo dei 12 mesi sull'indirizzo vero, anche in prova.
      phase = "dodici_mesi";
      const since = new Date(now() - PARTNER_ASSISTANT_MAILBOX_DAYS * DAY_MS);
      const real = chosen.address;
      const found =
        real === null ? null : await imap(() => box.correspondence(folders, real, since), null);
      const mailboxCheck: PartnerAssistantMailboxCheck =
        found === true ? "trovata" : found === false ? "vuota" : "incerta";
      if (chosen.mode === "invio" && found !== false) {
        const reason = found === null ? "casella_incerta" : "conversazione_esistente";
        outcome = reason;
        await skip(chosen.jobId, reason);
        return;
      }

      // 7. Abbastanza tempo per l'SMTP.
      if (remaining() < PARTNER_ASSISTANT_SMTP_MIN_MS) {
        outcome = "tempo_insufficiente";
        return;
      }

      // 8. Il messaggio composto, poi prepare.
      phase = "composizione";
      const { draft } = chosen;
      const optOut = partnerAssistantOptOutLine(draft.language, chosen.register);
      const text = partnerAssistantMessageText({
        body: draft.body,
        signature: draft.signature,
        optOut,
      });
      const messageId = partnerAssistantMessageId(mail.domain, newId());
      let raw: string;
      try {
        raw = await composePartnerAssistantMessage({
          messageId,
          from: { name: mail.fromName, address: mail.user },
          to,
          subject: draft.subject,
          text,
          date: new Date(now()),
        });
      } catch (error) {
        console.error("partner_assistant_send_bug", { phase, error: errorName(error) });
        outcome = "composizione_fallita";
        return;
      }
      phase = "prepare";
      const prepared = await database((signal) =>
        store.prepare(
          lease,
          newId(),
          {
            jobId: chosen.jobId,
            draftId: draft.draftId,
            mode: chosen.mode,
            testRunId: chosen.testRunId,
            testIndex: chosen.testIndex,
            messageId,
            toAddress: to,
            subject: draft.subject,
            text,
            optOut,
            raw,
            mailboxCheck,
          },
          signal,
        ),
      );
      if (!prepared.ok) {
        outcome = "prepare_incerto";
        uncertain();
        return;
      }
      if (prepared.value.status !== "pronto") {
        outcome =
          prepared.value.status === "rifiutato"
            ? code(prepared.value.reason, "prepare_rifiutato")
            : "lease_persa";
        return;
      }
      const messageRowId = prepared.value.messageRowId;

      // 9. start: l'ultimo controllo prima dell'SMTP (Fuoco 3).
      phase = "start";
      const started = await database((signal) => store.start(lease, messageRowId, signal));
      if (!started.ok) {
        outcome = "start_incerto";
        uncertain();
        return;
      }
      if (started.value.status !== "in_invio") {
        outcome =
          started.value.status === "stop"
            ? code(started.value.reason, "start_fermato")
            : "lease_persa";
        return;
      }

      // 10. Un solo SMTP, con una scadenza rigida prima della fine del budget.
      phase = "smtp";
      const smtpController = new AbortController();
      const smtpTimer = setTimeout(
        () => smtpController.abort(),
        Math.max(0, remaining() - PARTNER_ASSISTANT_SMTP_MARGIN_MS),
      );
      const onParentAbort = () => smtpController.abort();
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
      let result: PartnerAssistantSmtpResult;
      try {
        const smtp = dependencies.smtp ?? createPartnerAssistantSmtp(mail);
        result = await smtp.send({ raw, from: mail.user, to, signal: smtpController.signal });
      } catch (error) {
        // Durante l'invio un'eccezione non dice se l'email è partita: incerto, mai un altro SMTP.
        console.error("partner_assistant_send_bug", { phase, error: errorName(error) });
        result = { outcome: { kind: "incerto", code: "smtp_sconosciuto" }, login: null };
      } finally {
        clearTimeout(smtpTimer);
        parentSignal.removeEventListener("abort", onParentAbort);
      }
      smtpLogin = result.login === null ? null : code(result.login, "smtp_sconosciuto");
      const input = finishInput(messageRowId, result.outcome);
      if (input.reason !== null) input.reason = code(input.reason, "smtp_sconosciuto");
      phase = "finish";
      const finished = await recordAfter((signal) => store.finish(lease, newId(), input, signal));
      if (!finished.ok) {
        // Fuoco 4: il messaggio resta in invio e il recupero lo passa a Tommaso.
        outcome = "finish_incerto";
        uncertain();
      } else {
        outcome =
          finished.value.status === "lease_persa"
            ? "lease_persa"
            : input.outcome === "inviato"
              ? "inviato"
              : (input.reason ?? input.outcome);
      }

      // 11. La copia in «Posta inviata»; se non si chiude, la riprende il giro dopo.
      if (result.outcome.kind === "inviato" && folders.sent) {
        phase = "copia";
        const sent = folders.sent;
        const copy = await imap(() => box.findMessageId(sent, messageId), null);
        if (copy !== null) {
          const copied =
            copy.length > 0 || (await imap(() => box.append(sent, raw, new Date(now())), false));
          if (copied) {
            const recorded = await database((signal) =>
              store.recordAppend(lease, messageRowId, copy.length > 0, signal),
            );
            if (!recorded.ok) uncertain();
          }
        }
      }
    }

    try {
      await round();
    } catch (error) {
      // Un errore nel codice: niente si ripete in questo giro. Un messaggio rimasto in invio lo
      // passa a Tommaso il recupero del giro dopo. Nel log solo la fase e il tipo dell'errore.
      console.error("partner_assistant_send_bug", { phase, error: errorName(error) });
      outcome = "errore_interno";
      uncertain();
    } finally {
      // Una copia arretrata che non si chiude: una sola attesa a fine giro (Fuoco 5).
      if (pendingUncertain) await skip(null, "casella_incerta");
      // 12. La casella chiusa e un solo rilascio, con gli accessi provati in questo giro.
      if (mailbox) {
        const open = mailbox;
        phase = "chiusura";
        await boundedPhase(parentSignal, PARTNER_ASSISTANT_SEND_RECORD_MS, () =>
          open.close(),
        ).catch(() => undefined);
      }
      phase = "rilascio";
      const released = await recordAfter((signal) =>
        store.release(
          lease,
          { outcome: code(outcome, "nessun_invio"), smtpLogin, imapLogin },
          signal,
        ),
      );
      if (!released.ok) uncertain();
    }
    return { status };
  }

  try {
    return await work();
  } catch (error) {
    console.error("partner_assistant_send_bug", { phase, error: errorName(error) });
    return { status: "uncertain" };
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
