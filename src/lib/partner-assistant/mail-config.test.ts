import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { PartnerAssistantEnvironment } from "./config";
import {
  PARTNER_ASSISTANT_FROM_NAME_DEFAULT,
  PARTNER_ASSISTANT_IMAP_HOST_DEFAULT,
  PARTNER_ASSISTANT_IMAP_PORT,
  PARTNER_ASSISTANT_SMTP_HOST_DEFAULT,
  PARTNER_ASSISTANT_SMTP_PORT,
  partnerAssistantEnvironmentReport,
  partnerAssistantMailAddress,
  partnerAssistantMailConfig,
  type PartnerAssistantMailEnvironment,
} from "./mail-config";

// Solo valori sintetici: casella e indirizzi example.test, segreti inventati.
const env = (over: PartnerAssistantMailEnvironment = {}): PartnerAssistantMailEnvironment => ({
  PARTNER_MAIL_USER: "casella@luckylap.example.test",
  PARTNER_MAIL_PASSWORD: "synthetic-password",
  ...over,
});
const assistantEnv: PartnerAssistantEnvironment = {
  PARTNER_ASSISTANT_ENABLED: "true",
  PARTNER_ASSISTANT_SECRET: "synthetic-partner-assistant-secret-0000",
  ANTHROPIC_API_KEY: "sk-ant-synthetic-0000000000000000",
  PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: "sb_secret_synthetic-partner-assistant",
  PARTNER_ASSISTANT_PHONE: "+39 000 000 0000",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic-shopify-worker",
};
const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;
let consoleSpy: ReturnType<typeof vi.fn<(...args: unknown[]) => void>>;
beforeEach(() => {
  consoleSpy = vi.fn<(...args: unknown[]) => void>();
  for (const method of consoleMethods) vi.spyOn(console, method).mockImplementation(consoleSpy);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("configurazione della posta dell'assistente Partner", () => {
  it("porte e predefiniti", () => {
    expect(PARTNER_ASSISTANT_SMTP_PORT).toBe(587);
    expect(PARTNER_ASSISTANT_IMAP_PORT).toBe(993);
    expect(PARTNER_ASSISTANT_FROM_NAME_DEFAULT).toBe("Tommaso | LuckyLap");
    expect(PARTNER_ASSISTANT_SMTP_HOST_DEFAULT).toBe("smtp.ionos.it");
    expect(PARTNER_ASSISTANT_IMAP_HOST_DEFAULT).toBe("imap.ionos.it");
  });
  it("solo utente e password: i predefiniti", () =>
    expect(partnerAssistantMailConfig(env())).toEqual({
      user: "casella@luckylap.example.test",
      password: "synthetic-password",
      fromName: "Tommaso | LuckyLap",
      smtpHost: "smtp.ionos.it",
      imapHost: "imap.ionos.it",
      testTo: [],
      domain: "luckylap.example.test",
    }));
  it("valori vuoti: i predefiniti", () =>
    expect(
      partnerAssistantMailConfig(
        env({
          PARTNER_MAIL_FROM_NAME: "",
          PARTNER_MAIL_SMTP_HOST: "",
          PARTNER_MAIL_IMAP_HOST: "",
          PARTNER_TEST_TO: "",
        }),
      ),
    ).toMatchObject({
      fromName: "Tommaso | LuckyLap",
      smtpHost: "smtp.ionos.it",
      imapHost: "imap.ionos.it",
      testTo: [],
    }));
  it("valori presenti e validi", () =>
    expect(
      partnerAssistantMailConfig(
        env({
          PARTNER_MAIL_FROM_NAME: "Tommaso Sintetico",
          PARTNER_MAIL_SMTP_HOST: "smtp.example.test",
          PARTNER_MAIL_IMAP_HOST: "imap.example.test",
          PARTNER_TEST_TO: "prova1@example.test",
        }),
      ),
    ).toMatchObject({
      fromName: "Tommaso Sintetico",
      smtpHost: "smtp.example.test",
      imapHost: "imap.example.test",
      testTo: ["prova1@example.test"],
    }));
  it("utente con maiuscole e spazi: minuscolo, dominio dell'utente", () =>
    expect(
      partnerAssistantMailConfig(env({ PARTNER_MAIL_USER: " Casella@LuckyLap.Example.Test " })),
    ).toMatchObject({ user: "casella@luckylap.example.test", domain: "luckylap.example.test" }));
  it("indirizzi di prova con spazi e maiuscole", () =>
    expect(
      partnerAssistantMailConfig(
        env({ PARTNER_TEST_TO: " Prova1@Example.Test, prova2@example.test" }),
      )?.testTo,
    ).toEqual(["prova1@example.test", "prova2@example.test"]));
  it("cinque indirizzi di prova sono ammessi", () =>
    expect(
      partnerAssistantMailConfig(
        env({
          PARTNER_TEST_TO:
            "a@example.test,b@example.test,c@example.test,d@example.test,e@example.test",
        }),
      )?.testTo,
    ).toHaveLength(5));
  it.each(["PARTNER_MAIL_USER", "PARTNER_MAIL_PASSWORD"])("senza %s: null", (k) =>
    expect(partnerAssistantMailConfig({ ...env(), [k]: undefined })).toBeNull(),
  );
  it.each([
    [
      "PARTNER_TEST_TO",
      "a@example.test,b@example.test,c@example.test,d@example.test,e@example.test,f@example.test",
    ],
    ["PARTNER_TEST_TO", "a@example.test,a@example.test"],
    ["PARTNER_TEST_TO", "a@example.test,A@Example.Test"],
    ["PARTNER_TEST_TO", "a;b@example.test"],
    ["PARTNER_TEST_TO", "a@example.test,"],
    ["PARTNER_MAIL_FROM_NAME", "Tommaso\r\nBcc: x"],
    ["PARTNER_MAIL_FROM_NAME", "x@y"],
    ["PARTNER_MAIL_FROM_NAME", '"Tommaso"'],
    ["PARTNER_MAIL_FROM_NAME", "Tommaso <x>"],
    ["PARTNER_MAIL_FROM_NAME", "a".repeat(81)],
    ["PARTNER_MAIL_SMTP_HOST", "smtp://smtp.ionos.it"],
    ["PARTNER_MAIL_SMTP_HOST", "smtp.ionos.it:465"],
    ["PARTNER_MAIL_SMTP_HOST", "SMTP.IONOS.IT"],
    ["PARTNER_MAIL_SMTP_HOST", "localhost"],
    ["PARTNER_MAIL_IMAP_HOST", "imap.ionos.it/"],
    ["PARTNER_MAIL_PASSWORD", "è"],
    ["PARTNER_MAIL_PASSWORD", ""],
    ["PARTNER_MAIL_PASSWORD", "synthetic\npassword"],
    ["PARTNER_MAIL_PASSWORD", "a".repeat(513)],
    ["PARTNER_MAIL_USER", "casella"],
    ["PARTNER_MAIL_USER", ""],
  ])("%s = %j: null", (k, v) => expect(partnerAssistantMailConfig(env({ [k]: v }))).toBeNull());
  it.each([
    "info;bcc@club.example.test",
    "a<b@club.example.test",
    '"a"@club.example.test',
    "a b@club.example.test",
    "o'neil@club-963.example.test",
    "info@club",
    "info@club..example.test",
    "info@@club.example.test",
    "info@club.example.test\r\nBcc: x@example.test",
    `${"a".repeat(65)}@club.example.test`,
    `a@${"b".repeat(250)}.test`,
    "",
  ])("indirizzo %j rifiutato", (v) => expect(partnerAssistantMailAddress(v)).toBeNull()); // Fuoco 2
  it("maiuscole e spazi", () =>
    expect(partnerAssistantMailAddress(" Info@Club-962.Example.Test ")).toBe(
      "info@club-962.example.test",
    )); // Fuoco 2
  it("254 caratteri ammessi, 255 no", () => {
    const at254 = `a@${"b".repeat(247)}.test`;
    expect(at254).toHaveLength(254);
    expect(partnerAssistantMailAddress(at254)).toBe(at254);
    expect(partnerAssistantMailAddress(`a${at254}`)).toBeNull();
  });
  it("nessun log", () => {
    partnerAssistantMailConfig(env({ PARTNER_MAIL_PASSWORD: "" }));
    partnerAssistantMailConfig(env({ PARTNER_TEST_TO: "a;b@example.test" }));
    partnerAssistantMailConfig(env());
    partnerAssistantEnvironmentReport({ ...assistantEnv, ...env() });
    expect(consoleSpy).not.toHaveBeenCalled();
  });
  it("senza argomenti legge le sei variabili da process.env", () => {
    vi.stubEnv("PARTNER_MAIL_USER", "casella@luckylap.example.test");
    vi.stubEnv("PARTNER_MAIL_PASSWORD", "synthetic-password");
    vi.stubEnv("PARTNER_MAIL_FROM_NAME", "Tommaso Sintetico");
    vi.stubEnv("PARTNER_TEST_TO", "prova1@example.test");
    vi.stubEnv("PARTNER_MAIL_SMTP_HOST", "smtp.example.test");
    vi.stubEnv("PARTNER_MAIL_IMAP_HOST", "imap.example.test");
    expect(partnerAssistantMailConfig()).toEqual({
      user: "casella@luckylap.example.test",
      password: "synthetic-password",
      fromName: "Tommaso Sintetico",
      smtpHost: "smtp.example.test",
      imapHost: "imap.example.test",
      testTo: ["prova1@example.test"],
      domain: "luckylap.example.test",
    });
  });
});

describe("gruppi di variabili dell'assistente Partner", () => {
  it("gruppi di variabili senza valori", () => {
    expect(
      partnerAssistantEnvironmentReport({
        ...assistantEnv,
        ...env({ PARTNER_TEST_TO: "a@example.test,b@example.test" }),
      }),
    ).toEqual({ assistente: true, casella: true, prova: true, indirizziProva: 2 });
    expect(
      partnerAssistantEnvironmentReport({
        ...assistantEnv,
        ...env({ PARTNER_TEST_TO: "a;b@example.test" }),
      }),
    ).toEqual({ assistente: true, casella: true, prova: false, indirizziProva: 0 });
    expect(partnerAssistantEnvironmentReport(env({ PARTNER_MAIL_PASSWORD: "" }))).toEqual({
      assistente: false,
      casella: false,
      prova: false,
      indirizziProva: 0,
    });
  });
  it("casella senza indirizzi di prova; prova senza casella", () => {
    expect(partnerAssistantEnvironmentReport({ ...assistantEnv, ...env() })).toEqual({
      assistente: true,
      casella: true,
      prova: false,
      indirizziProva: 0,
    });
    expect(
      partnerAssistantEnvironmentReport({
        ...env({ PARTNER_MAIL_USER: "casella", PARTNER_TEST_TO: "a@example.test" }),
      }),
    ).toEqual({ assistente: false, casella: false, prova: false, indirizziProva: 0 });
  });
  it("il rapporto non contiene valori", () =>
    expect(
      JSON.stringify(
        partnerAssistantEnvironmentReport({
          ...assistantEnv,
          ...env({ PARTNER_TEST_TO: "prova1@example.test" }),
        }),
      ),
    ).not.toMatch(/casella@|prova1@|synthetic|sk-ant|sb_secret/));
  it("senza argomenti legge process.env", () => {
    for (const [k, v] of Object.entries({ ...assistantEnv, ...env() })) vi.stubEnv(k, v);
    vi.stubEnv("PARTNER_TEST_TO", "prova1@example.test");
    expect(partnerAssistantEnvironmentReport()).toEqual({
      assistente: true,
      casella: true,
      prova: true,
      indirizziProva: 1,
    });
  });
});
