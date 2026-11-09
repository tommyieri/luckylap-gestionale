import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { partnerAssistantDraftSha256 } from "./checks";
import { partnerAssistantTemplateSignature } from "./template";
import { runPartnerAssistantFollowup, type PartnerFollowupDependencies } from "./followup";
import type { PartnerFollowupCandidate, PartnerFollowupStore } from "./followup-store";
import type { PartnerAssistantSendStore } from "./send-store";
import type { PartnerAssistantSmtp } from "./smtp";
import type { PartnerAssistantFollowupMailboxResult } from "./followup-mailbox";

const id = (n: number) => `93000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const config = {
  workerSecret: "synthetic-worker-secret-0000000000000",
  anthropicApiKey: "sk-ant-synthetic-0000000000000000",
  supabaseUrl: "https://synthetic.supabase.co",
  supabaseSecretKey: "sb_secret_synthetic-partner",
  phone: "+39 000 000 0000",
};
const mail = {
  user: "casella@luckylap.example.test",
  password: "synthetic-password",
  fromName: "Tommaso | LuckyLap",
  smtpHost: "smtp.example.test",
  imapHost: "imap.example.test",
  testTo: [],
  domain: "luckylap.example.test",
};
const NOW = Date.parse("2026-11-09T09:00:00Z");
const yes = <T>(value: T) => ({ ok: true, value }) as const;
const body =
  "Buongiorno,\nIl calendario del vostro club comprende un nuovo incontro dedicato alla passione per le auto. Può essere una buona occasione per offrire ai soci un capo legato alle attività della community. Riprendo quindi la proposta di una maglietta realizzata insieme, con un ricamo dedicato al club. È un progetto che potrebbe interessarvi?\nUn cordiale saluto,";
const subject = "Re: Club Sintetico e LuckyLap";
const signature = partnerAssistantTemplateSignature("it", config.phone);
const candidate = (): PartnerFollowupCandidate => ({
  id: id(1),
  version: 1,
  partner_id: id(2),
  co: 951,
  name: "Club Sintetico",
  porsche_community: false,
  flow_template: true,
  contact_id: id(3),
  address: "segreteria@club-sintetico.example.test",
  addresses: ["segreteria@club-sintetico.example.test"],
  message_ids: [`<${id(4)}@luckylap.example.test>`],
  first_subject: "Club Sintetico e LuckyLap",
  first_sent_at: "2026-11-01T09:00:00Z",
  language: "it",
  register: "voi",
  timezone: "Europe/Rome",
  country: "Italia",
  followups_sent: 0,
  next_due_on: "2026-11-08",
  send_allowed: true,
  send_not_after: "2099-12-31T23:59:59Z",
  draft: {
    draft_id: id(5),
    number: 1,
    language: "it",
    subject,
    body,
    signature,
    sha256: partnerAssistantDraftSha256({ subject, body, signature }),
    rules_version: 3,
    created_at: "2026-11-08T09:00:00Z",
  },
});
const clear = (): PartnerAssistantFollowupMailboxResult => ({
  status: "clear",
  checkedAt: new Date(NOW).toISOString(),
  proofSha256: "a".repeat(64),
  folderCount: 6,
  messageCount: 40,
});

function setup(c = candidate(), mode: "invio" | "osserva" = "invio") {
  const events: string[] = [];
  let checks = 0,
    uuids = 80;
  const store: PartnerFollowupStore = {
    claim: vi.fn(async () =>
      yes({ status: "claimed" as const, lease_token: id(6), mode, candidate: c }),
    ),
    recordCheck: vi.fn(async (_lease, _candidate, payload) => {
      events.push(`record:${payload.result}`);
      checks++;
      return payload.result === "clear"
        ? yes({
            status: "clear" as const,
            proof_id: id(10 + checks),
            expires_at: "2026-11-09T09:00:30Z",
          })
        : payload.result === "deferred"
          ? yes({ status: "deferred" as const, resume_on: payload.resume_on! })
          : payload.result === "found"
            ? yes({ status: "blocked" as const, reason: "risposta_rilevata" })
            : yes({ status: "retry" as const, reason: "casella_incerta" });
    }),
    prepare: vi.fn(async () => {
      events.push("prepare");
      return yes({ status: "pronto" as const, message_row_id: id(7), replayed: false });
    }),
    start: vi.fn(async () => {
      events.push("start");
      return yes({ status: "in_invio" as const });
    }),
    finish: vi.fn(async (_lease, _op, input) => {
      events.push(`finish:${input.outcome}`);
      return yes({ status: "done" as const, send_status: input.outcome, replayed: false });
    }),
  };
  const release = vi.fn(async () => yes({ status: "done" as const }));
  const pause = vi.fn(async () => yes({ status: "done" as const }));
  const sendStore = { release, pause } as unknown as PartnerAssistantSendStore;
  const checkMailbox = vi.fn(async () => {
    events.push("scan");
    return clear();
  });
  const compose = vi.fn(async () => "Message-ID: synthetic\r\n\r\nsynthetic body\r\n");
  const smtp: PartnerAssistantSmtp = {
    send: vi.fn(async (input) => {
      events.push("smtp:login");
      if (!(await input.beforeSend?.()))
        return {
          outcome: { kind: "non_partito" as const, code: "smtp_verifica_preinvio" },
          login: "ok",
        };
      events.push("smtp:bytes");
      return { outcome: { kind: "inviato" as const, responseCode: 250 as const }, login: "ok" };
    }),
  };
  const run = (extra: Partial<PartnerFollowupDependencies> = {}) =>
    runPartnerAssistantFollowup(config, mail, new AbortController().signal, {
      store,
      sendStore,
      smtp,
      checkMailbox,
      compose,
      now: () => NOW,
      uuid: () => id(uuids++),
      ...extra,
    });
  return { run, store, release, pause, sendStore, checkMailbox, compose, smtp, events, c };
}

describe("solleciti: scansioni complete e autorizzazione prima dei byte SMTP", () => {
  it.each([true, false])(
    "attende start pendente dopo chiusura SMTP, esito certo=%s",
    async (certain) => {
      vi.useFakeTimers();
      const t = setup();
      let completeStart!: (result: Awaited<ReturnType<PartnerFollowupStore["start"]>>) => void;
      vi.mocked(t.store.start).mockImplementation(
        () =>
          new Promise((resolve) => {
            completeStart = resolve;
          }),
      );
      vi.mocked(t.smtp.send).mockImplementation(async (input) => {
        void input.beforeSend!();
        await vi.waitFor(() => expect(completeStart).toBeTypeOf("function"));
        t.events.push("smtp:closed");
        return { login: "ok", outcome: { kind: "non_partito", code: "smtp_econnreset" } };
      });
      try {
        const running = t.run();
        await vi.waitFor(() => expect(t.events).toContain("smtp:closed"));
        expect(t.store.finish).not.toHaveBeenCalled();
        expect(t.release).not.toHaveBeenCalled();
        completeStart(certain ? yes({ status: "in_invio" }) : { ok: false });
        expect(await running).toEqual({ status: certain ? "complete" : "uncertain" });
        expect(t.events).not.toContain("smtp:bytes");
        if (certain) {
          expect(t.store.finish).toHaveBeenCalledWith(
            id(6),
            expect.any(String),
            expect.objectContaining({ outcome: "scartato", reason: "smtp_non_partito" }),
            expect.any(AbortSignal),
          );
          expect(vi.mocked(t.store.finish).mock.invocationCallOrder[0]).toBeLessThan(
            t.release.mock.invocationCallOrder[0],
          );
        } else {
          expect(t.store.finish).not.toHaveBeenCalled();
          expect(t.release).not.toHaveBeenCalled();
        }
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("non prepara un invio con la scadenza assoluta già raggiunta", async () => {
    const t = setup({ ...candidate(), send_not_after: new Date(NOW).toISOString() });
    expect(await t.run()).toEqual({ status: "observed" });
    expect(t.store.prepare).not.toHaveBeenCalled();
    expect(t.smtp.send).not.toHaveBeenCalled();
  });
  it("lo scadere dell'orario durante la seconda scansione impedisce start e DATA", async () => {
    let wall = NOW;
    const t = setup({ ...candidate(), send_not_after: new Date(NOW + 1000).toISOString() });
    t.checkMailbox.mockResolvedValueOnce(clear()).mockImplementationOnce(async () => {
      wall = NOW + 1000;
      return clear();
    });
    await t.run({ now: () => wall });
    expect(t.store.recordCheck).toHaveBeenCalledTimes(2);
    expect(t.store.start).not.toHaveBeenCalled();
    expect(t.events).not.toContain("smtp:bytes");
  });
  it("interrompe SMTP al termine assoluto conservando l'esito incerto senza ritentare", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = setup({ ...candidate(), send_not_after: new Date(NOW + 40).toISOString() });
    let abortedAt: number | null = null;
    vi.mocked(t.smtp.send).mockImplementation(async (input) => {
      if (!(await input.beforeSend!()))
        return { login: "ok", outcome: { kind: "non_partito", code: "smtp_preinvio" } };
      return new Promise((resolve) =>
        input.signal.addEventListener(
          "abort",
          () => {
            abortedAt = Date.now();
            resolve({ login: "ok", outcome: { kind: "incerto", code: "smtp_scadenza" } });
          },
          { once: true },
        ),
      );
    });
    try {
      const running = t.run({ now: () => Date.now() });
      await vi.advanceTimersByTimeAsync(39);
      expect(abortedAt).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(await running).toEqual({ status: "uncertain" });
      expect(abortedAt).toBe(NOW + 40);
      expect(t.smtp.send).toHaveBeenCalledTimes(1);
      expect(t.store.finish).toHaveBeenCalledWith(
        id(6),
        expect.any(String),
        expect.objectContaining({ outcome: "incerto" }),
        expect.any(AbortSignal),
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("rinvia un fuori ufficio con data certa senza sopprimerlo come una risposta umana", async () => {
    const t = setup();
    vi.mocked(t.checkMailbox).mockResolvedValueOnce({
      status: "deferred",
      resumeOn: "2026-11-17",
      checkedAt: new Date(NOW).toISOString(),
      proofSha256: "b".repeat(64),
      folderCount: 6,
      messageCount: 41,
    });
    expect(await t.run()).toEqual({ status: "observed" });
    expect(t.store.recordCheck).toHaveBeenCalledWith(
      id(6),
      t.c,
      expect.objectContaining({
        result: "deferred",
        reason: "fuori_ufficio",
        resume_on: "2026-11-17",
        folder_count: 6,
        message_count: 41,
      }),
      expect.any(AbortSignal),
    );
    expect(t.smtp.send).not.toHaveBeenCalled();
    expect(t.store.prepare).not.toHaveBeenCalled();
  });
  it("un fuori ufficio certo arrivato prima dei byte rinvia anche un MIME già preparato", async () => {
    const t = setup();
    vi.mocked(t.checkMailbox)
      .mockResolvedValueOnce(clear())
      .mockResolvedValueOnce({
        status: "deferred",
        resumeOn: "2026-11-17",
        checkedAt: new Date(NOW).toISOString(),
        proofSha256: "b".repeat(64),
        folderCount: 6,
        messageCount: 41,
      });
    await t.run();
    expect(t.store.prepare).toHaveBeenCalledTimes(1);
    expect(t.store.start).not.toHaveBeenCalled();
    expect(t.events).not.toContain("smtp:bytes");
    expect(t.store.finish).toHaveBeenCalledWith(
      id(6),
      expect.any(String),
      expect.objectContaining({ outcome: "scartato", reason: "verifica_preinvio" }),
      expect.any(AbortSignal),
    );
  });
  it("esegue seconda scansione dopo login e prima di start e send, senza allegati o nuova ricerca pagata", async () => {
    const t = setup();
    expect(await t.run()).toEqual({ status: "complete" });
    expect(t.events).toEqual([
      "scan",
      "record:clear",
      "prepare",
      "smtp:login",
      "scan",
      "record:clear",
      "start",
      "smtp:bytes",
      "finish:inviato",
    ]);
    expect(t.checkMailbox).toHaveBeenCalledTimes(2);
    expect(t.compose).toHaveBeenCalledWith(
      expect.objectContaining({
        inReplyTo: t.c.message_ids[0],
        references: t.c.message_ids,
        to: t.c.address,
      }),
    );
    expect(t.store.start).toHaveBeenCalledWith(id(6), id(7), id(12), expect.any(AbortSignal));
    expect(t.release).toHaveBeenCalledWith(
      id(6),
      expect.objectContaining({ outcome: "sollecito_inviato" }),
      expect.any(AbortSignal),
    );
    expect(t.store.finish).toHaveBeenCalledTimes(1);
  });
  it.each(["osserva", "senza_bozza", "quota_piena"])(
    "legge le risposte in %s senza iniziare un invio",
    async (scenario) => {
      const c = candidate();
      if (scenario === "senza_bozza") c.draft = null;
      if (scenario === "quota_piena") c.send_allowed = false;
      const t = setup(c, scenario === "osserva" ? "osserva" : "invio");
      expect(await t.run()).toEqual({ status: "observed" });
      expect(t.checkMailbox).toHaveBeenCalledTimes(1);
      expect(t.store.prepare).not.toHaveBeenCalled();
      expect(t.smtp.send).not.toHaveBeenCalled();
      expect(t.release).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["found", "uncertain"] as const)(
    "non prepara alcuna mail quando il primo controllo è %s",
    async (status) => {
      const t = setup();
      vi.mocked(t.checkMailbox).mockResolvedValueOnce(
        status === "found"
          ? { status, reason: "reply", checkedAt: new Date(NOW).toISOString() }
          : { status, reason: "followup_cartella" },
      );
      expect(await t.run()).toEqual({ status: "observed" });
      expect(t.store.prepare).not.toHaveBeenCalled();
      expect(t.smtp.send).not.toHaveBeenCalled();
    },
  );
  it.each(["found", "uncertain"] as const)(
    "una risposta o un dubbio nel secondo controllo %s impediscono la consegna dei byte",
    async (status) => {
      const t = setup();
      vi.mocked(t.checkMailbox)
        .mockResolvedValueOnce(clear())
        .mockResolvedValueOnce(
          status === "found"
            ? { status, reason: "reply", checkedAt: new Date(NOW).toISOString() }
            : { status, reason: "followup_connessione" },
        );
      expect(await t.run()).toEqual({ status: "complete" });
      expect(t.store.prepare).toHaveBeenCalledTimes(1);
      expect(t.store.start).not.toHaveBeenCalled();
      expect(t.events).not.toContain("smtp:bytes");
      expect(t.store.finish).toHaveBeenCalledWith(
        id(6),
        expect.any(String),
        expect.objectContaining({ outcome: "scartato", reason: "verifica_preinvio" }),
        expect.any(AbortSignal),
      );
    },
  );
  it("non riusa la prima proof per lo start anche se il database la restituisce due volte", async () => {
    const t = setup();
    vi.mocked(t.store.recordCheck).mockResolvedValue(
      yes({ status: "clear", proof_id: id(11), expires_at: "2026-11-09T09:00:30Z" }),
    );
    await t.run();
    expect(t.store.start).not.toHaveBeenCalled();
    expect(t.events).not.toContain("smtp:bytes");
  });
  it("un rifiuto SQL dopo la seconda scansione blocca i byte anche con IMAP valido", async () => {
    const t = setup();
    vi.mocked(t.store.start).mockResolvedValueOnce(
      yes({ status: "stop", reason: "risposta_rilevata" }),
    );
    await t.run();
    expect(t.events).not.toContain("smtp:bytes");
    expect(t.store.finish).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ outcome: "scartato" }),
      expect.any(AbortSignal),
    );
  });
  it("una bozza cambiata dopo la preparazione editoriale è invalidata e non arriva all'SMTP", async () => {
    const c = candidate();
    c.draft!.body += " Testo modificato.";
    const t = setup(c);
    await t.run();
    expect(t.smtp.send).not.toHaveBeenCalled();
    expect(t.store.recordCheck).toHaveBeenLastCalledWith(
      id(6),
      c,
      expect.objectContaining({ result: "uncertain", reason: "bozza_non_valida" }),
      expect.any(AbortSignal),
    );
  });
  it("un testo con un invito a telefonare è respinto anche con impronta corretta", async () => {
    const c = candidate();
    c.draft!.body = c.draft!.body.replace(
      "È un progetto",
      "Potete telefonare per parlarne? È un progetto",
    );
    c.draft!.sha256 = partnerAssistantDraftSha256(c.draft!);
    const t = setup(c);
    await t.run();
    expect(t.smtp.send).not.toHaveBeenCalled();
    expect(t.store.prepare).not.toHaveBeenCalled();
  });
  it("non ritenta un SMTP incerto e mantiene la registrazione dell'esito", async () => {
    const t = setup();
    vi.mocked(t.smtp.send).mockImplementation(async (input) => {
      await input.beforeSend?.();
      return { outcome: { kind: "incerto", code: "smtp_scadenza" }, login: "ok" };
    });
    expect(await t.run()).toEqual({ status: "uncertain" });
    expect(t.smtp.send).toHaveBeenCalledTimes(1);
    expect(t.store.finish).toHaveBeenCalledWith(
      id(6),
      expect.any(String),
      expect.objectContaining({ outcome: "incerto" }),
      expect.any(AbortSignal),
    );
  });
  it("un finish senza risposta certa lascia la lease al recupero e non manda altre mail", async () => {
    const t = setup();
    vi.mocked(t.store.finish).mockResolvedValueOnce({ ok: false });
    expect(await t.run()).toEqual({ status: "uncertain" });
    expect(t.release).not.toHaveBeenCalled();
    expect(t.smtp.send).toHaveBeenCalledTimes(1);
  });
  it("un prepare senza risposta certa non tenta SMTP e non libera una lease di esito sconosciuto", async () => {
    const t = setup();
    vi.mocked(t.store.prepare).mockResolvedValueOnce({ ok: false });
    expect(await t.run()).toEqual({ status: "uncertain" });
    expect(t.smtp.send).not.toHaveBeenCalled();
    expect(t.release).not.toHaveBeenCalled();
  });
  it("se la lease è persa alla prima scansione non viene tentata la consegna", async () => {
    const t = setup();
    vi.mocked(t.store.recordCheck).mockResolvedValueOnce(yes({ status: "lease_persa" }));
    expect(await t.run()).toEqual({ status: "uncertain" });
    expect(t.smtp.send).not.toHaveBeenCalled();
    expect(t.release).not.toHaveBeenCalled();
  });
  it("un SMTP che dichiara successo saltando la guardia non genera un successo ripetibile", async () => {
    const t = setup();
    vi.mocked(t.smtp.send).mockResolvedValueOnce({
      outcome: { kind: "inviato", responseCode: 250 },
      login: "ok",
    });
    expect(await t.run()).toEqual({ status: "uncertain" });
    expect(t.store.finish).not.toHaveBeenCalled();
    expect(t.release).not.toHaveBeenCalled();
  });
  it("idle non apre la casella e non acquisisce o rilascia lease inventate", async () => {
    const t = setup();
    vi.mocked(t.store.claim).mockResolvedValueOnce(yes({ status: "idle", reason: "vuota" }));
    expect(await t.run()).toEqual({ status: "idle" });
    expect(t.checkMailbox).not.toHaveBeenCalled();
    expect(t.release).not.toHaveBeenCalled();
  });
});
