import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { boundedPhase } from "../shopify/worker-io";
import { partnerAssistantDraftSha256 } from "./checks";
import type { PartnerAssistantConfig } from "./config";
import {
  checkPartnerAssistantFollowupDraft,
  composePartnerAssistantFollowupMessage,
} from "./followup-compose";
import {
  checkPartnerAssistantFollowupMailbox,
  type PartnerAssistantFollowupMailboxResult,
} from "./followup-mailbox";
import {
  createPartnerFollowupStore,
  type PartnerFollowupCandidate,
  type PartnerFollowupCheck,
  type PartnerFollowupCheckInput,
  type PartnerFollowupStore,
} from "./followup-store";
import {
  partnerAssistantMessageId,
  partnerAssistantMessageText,
  partnerAssistantOptOutLine,
} from "./mail-compose";
import type { PartnerAssistantMailConfig } from "./mail-config";
import { createPartnerAssistantSendStore, type PartnerAssistantSendStore } from "./send-store";
import type { PartnerAssistantFinishInput } from "./send-types";
import {
  createPartnerAssistantSmtp,
  type PartnerAssistantSmtp,
  type PartnerAssistantSmtpOutcome,
} from "./smtp";
import type { StoreResult } from "./types";

/** Un giro di posta con due scansioni complete e un solo SMTP; nessuna chiamata a modelli. */
export const PARTNER_FOLLOWUP_BUDGET_MS = 150_000;
export const PARTNER_FOLLOWUP_SCAN_MS = 30_000;
export type PartnerFollowupRun = { status: "idle" | "observed" | "complete" | "uncertain" };
export type PartnerFollowupDependencies = {
  store?: PartnerFollowupStore;
  sendStore?: PartnerAssistantSendStore;
  smtp?: PartnerAssistantSmtp;
  checkMailbox?: typeof checkPartnerAssistantFollowupMailbox;
  compose?: typeof composePartnerAssistantFollowupMessage;
  now?: () => number;
  clock?: () => number;
  uuid?: () => string;
};

function finishInput(
  messageRowId: string,
  outcome: PartnerAssistantSmtpOutcome,
): PartnerAssistantFinishInput {
  const base = { messageRowId, smtpCode: null, enhancedCode: null, spam: false };
  switch (outcome.kind) {
    case "inviato":
      return { ...base, outcome: "inviato", smtpCode: 250, reason: null };
    case "incerto":
      return { ...base, outcome: "incerto", reason: "smtp_incerto" };
    case "respinto":
      return {
        ...base,
        outcome: "respinto",
        smtpCode: outcome.responseCode,
        enhancedCode: outcome.enhanced,
        spam: outcome.spam,
        reason: "smtp_respinto",
      };
    case "bloccato":
      return {
        ...base,
        outcome: "scartato",
        smtpCode: outcome.responseCode,
        enhancedCode: outcome.enhanced,
        spam: true,
        reason: "smtp_bloccato",
      };
    case "temporaneo":
      return {
        ...base,
        outcome: "scartato",
        smtpCode: outcome.responseCode,
        reason: "smtp_temporaneo",
      };
    case "credenziali":
      return { ...base, outcome: "scartato", reason: "smtp_credenziali" };
    case "non_partito":
      return { ...base, outcome: "scartato", reason: "smtp_non_partito" };
  }
}

export async function runPartnerAssistantFollowup(
  config: PartnerAssistantConfig,
  mail: PartnerAssistantMailConfig,
  parentSignal: AbortSignal,
  dependencies: PartnerFollowupDependencies = {},
): Promise<PartnerFollowupRun> {
  const clock = dependencies.clock ?? (() => performance.now());
  const now = dependencies.now ?? Date.now;
  const uuid = dependencies.uuid ?? randomUUID;
  const startedAt = clock();
  const remaining = () => Math.max(0, PARTNER_FOLLOWUP_BUDGET_MS - (clock() - startedAt));
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener("abort", abort, { once: true });
  if (parentSignal.aborted) controller.abort();
  const timer = setTimeout(abort, PARTNER_FOLLOWUP_BUDGET_MS);
  const store = dependencies.store ?? createPartnerFollowupStore(config);
  const sendStore = dependencies.sendStore ?? createPartnerAssistantSendStore(config);
  const checkMailbox = dependencies.checkMailbox ?? checkPartnerAssistantFollowupMailbox;
  let lease: string | null = null;
  let releaseAllowed = true;
  let imapLogin: string | null = null;
  let smtpLogin: string | null = null;
  let outcome = "sollecito_osservato";
  async function db<T>(
    task: (signal: AbortSignal) => Promise<StoreResult<T>>,
    record = false,
  ): Promise<StoreResult<T>> {
    try {
      return await boundedPhase(
        record ? parentSignal : controller.signal,
        record ? 10_000 : Math.min(10_000, remaining()),
        task,
      );
    } catch {
      return { ok: false };
    }
  }
  async function scan(
    candidate: PartnerFollowupCandidate,
  ): Promise<PartnerAssistantFollowupMailboxResult> {
    try {
      return await boundedPhase(
        controller.signal,
        Math.min(PARTNER_FOLLOWUP_SCAN_MS, remaining()),
        (signal) =>
          checkMailbox(
            mail,
            {
              ownAddress: mail.user,
              addresses: candidate.addresses,
              messageIds: candidate.message_ids,
              firstSentAt: candidate.first_sent_at,
              subject: candidate.first_subject,
            },
            signal,
          ),
      );
    } catch {
      return { status: "uncertain", reason: "followup_scadenza" };
    }
  }
  async function record(
    candidate: PartnerFollowupCandidate,
    result: PartnerAssistantFollowupMailboxResult,
  ): Promise<PartnerFollowupCheck | null> {
    const checkedAt =
      result.status === "uncertain" ? new Date(now()).toISOString() : result.checkedAt;
    const complete = result.status === "clear" || result.status === "deferred";
    const payload: PartnerFollowupCheckInput = {
      result: result.status,
      reason:
        result.status === "clear"
          ? null
          : result.status === "deferred"
            ? "fuori_ufficio"
            : result.reason,
      checked_at: checkedAt,
      proof_sha256: complete
        ? result.proofSha256
        : createHash("sha256")
            .update(`${candidate.id}:${result.status}:${checkedAt}`)
            .digest("hex"),
      folder_count: complete ? result.folderCount : 0,
      message_count: complete ? result.messageCount : 0,
    };
    if (result.status === "deferred") payload.resume_on = result.resumeOn;
    const saved = await db((signal) => store.recordCheck(lease!, candidate, payload, signal), true);
    if (!saved.ok || saved.value.status === "lease_persa") {
      releaseAllowed = false;
      return null;
    }
    return saved.value;
  }
  try {
    const claimed = await db((signal) => store.claim(uuid(), 300, signal));
    if (!claimed.ok) return { status: "uncertain" };
    if (claimed.value.status === "idle") return { status: "idle" };
    lease = claimed.value.lease_token;
    const c = claimed.value.candidate;
    const firstResult = await scan(c);
    imapLogin = firstResult.status === "uncertain" ? "imap_verifica_incompleta" : "ok";
    const first = await record(c, firstResult);
    if (!first) return { status: "uncertain" };
    if (first.status !== "clear") return { status: "observed" };
    if (claimed.value.mode !== "invio" || !c.send_allowed || c.draft === null)
      return { status: "observed" };
    const d = c.draft;
    const draft = {
      language: d.language,
      subject: d.subject,
      body: d.body,
      signature: d.signature,
      rulesVersion: d.rules_version,
    };
    const checked = checkPartnerAssistantFollowupDraft(draft, {
      phone: config.phone,
      currentRulesVersion: d.rules_version,
      porscheCommunity: c.porsche_community,
      names: [c.name],
      template: c.flow_template,
      firstSubject: c.first_subject,
    });
    if (!checked.ok || partnerAssistantDraftSha256(draft) !== d.sha256) {
      outcome = "sollecito_bozza_non_valida";
      const saved = await record(c, { status: "uncertain", reason: "bozza_non_valida" });
      return { status: saved ? "observed" : "uncertain" };
    }
    // Il tempo comprende login SMTP, seconda lettura completa e autorizzazione prima dei byte.
    if (remaining() < 90_000) {
      outcome = "sollecito_budget";
      return { status: "observed" };
    }
    const optOut = partnerAssistantOptOutLine(c.language, c.register);
    const text = partnerAssistantMessageText({ body: d.body, signature: d.signature, optOut });
    const messageId = partnerAssistantMessageId(mail.domain, uuid());
    const raw = await (dependencies.compose ?? composePartnerAssistantFollowupMessage)({
      messageId,
      from: { name: mail.fromName, address: mail.user },
      to: c.address,
      subject: d.subject,
      text,
      date: new Date(now()),
      inReplyTo: c.message_ids[0],
      references: c.message_ids,
    });
    const prepared = await db((signal) =>
      store.prepare(
        lease!,
        uuid(),
        c.id,
        {
          expected_version: c.version,
          draft_id: d.draft_id,
          number: d.number,
          to_address: c.address,
          subject: d.subject,
          text,
          opt_out: optOut,
          raw,
          message_id: messageId,
          proof_id: first.proof_id,
        },
        signal,
      ),
    );
    if (!prepared.ok) {
      releaseAllowed = false;
      return { status: "uncertain" };
    }
    if (prepared.value.status !== "pronto") {
      outcome = "sollecito_preparazione_ferma";
      return { status: "observed" };
    }
    const rowId = prepared.value.message_row_id;
    let smtpStarted = false;
    let secondBlocked = false;
    const smtp = dependencies.smtp ?? createPartnerAssistantSmtp(mail);
    const result = await smtp.send({
      raw,
      from: mail.user,
      to: c.address,
      signal: controller.signal,
      beforeSend: async () => {
        const checkedAgain = await scan(c);
        const second = await record(c, checkedAgain);
        if (!second || second.status !== "clear" || second.proof_id === first.proof_id) {
          secondBlocked = true;
          return false;
        }
        const started = await db((signal) => store.start(lease!, rowId, second.proof_id, signal));
        if (!started.ok) {
          releaseAllowed = false;
          return false;
        }
        if (started.value.status !== "in_invio") {
          secondBlocked = true;
          return false;
        }
        smtpStarted = true;
        return true;
      },
    });
    smtpLogin = result.login;
    // Un trasporto incoerente non può trasformare una verifica saltata in un invio ripetibile.
    if (!smtpStarted && result.outcome.kind === "inviato") {
      releaseAllowed = false;
      return { status: "uncertain" };
    }
    const input = finishInput(rowId, result.outcome);
    if (secondBlocked) input.reason = "verifica_preinvio";
    const finished = await db((signal) => store.finish(lease!, uuid(), input, signal), true);
    if (!finished.ok || finished.value.status === "lease_persa") {
      releaseAllowed = false;
      return { status: "uncertain" };
    }
    if (result.outcome.kind === "credenziali")
      await db((signal) => sendStore.pause(lease!, signal), true);
    outcome = `sollecito_${input.outcome}`;
    // Il giro ordinario copia anche questi MIME immutabili in Posta inviata, con lo stesso APPEND.
    return { status: input.outcome === "incerto" ? "uncertain" : "complete" };
  } catch {
    // Non si stampano eccezioni IMAP/SMTP: possono includere testi e recapiti.
    outcome = "sollecito_esito_incerto";
    releaseAllowed = false;
    return { status: "uncertain" };
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener("abort", abort);
    controller.abort();
    if (lease !== null && releaseAllowed) {
      await db(
        (signal) => sendStore.release(lease!, { outcome, imapLogin, smtpLogin }, signal),
        true,
      );
    }
  }
}
