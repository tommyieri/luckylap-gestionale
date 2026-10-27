import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { validWorkerSupabaseUrl } from "../shopify/worker-config";
import { partnerAssistantConfig, type PartnerAssistantEnvironment } from "./config";

// Solo valori sintetici: segreti inventati, numero di telefono finto.
const env = (): PartnerAssistantEnvironment => ({
  PARTNER_ASSISTANT_ENABLED: "true",
  PARTNER_ASSISTANT_SECRET: "synthetic-partner-assistant-secret-0000",
  ANTHROPIC_API_KEY: "sk-ant-synthetic-0000000000000000",
  PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: "sb_secret_synthetic-partner-assistant",
  PARTNER_ASSISTANT_PHONE: "+39 000 000 0000",
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic-shopify-worker",
});
const expected = {
  workerSecret: "synthetic-partner-assistant-secret-0000",
  anthropicApiKey: "sk-ant-synthetic-0000000000000000",
  supabaseUrl: "https://synthetic.supabase.co",
  supabaseSecretKey: "sb_secret_synthetic-partner-assistant",
  phone: "+39 000 000 0000",
};
const wrong: Record<string, Partial<PartnerAssistantEnvironment>> = {
  ENABLED: { PARTNER_ASSISTANT_ENABLED: "TRUE" },
  SECRET: { PARTNER_ASSISTANT_SECRET: "corto" },
  ANTHROPIC: { ANTHROPIC_API_KEY: "sk-synthetic-0000000000000000" },
  SUPABASE_KEY: { PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: "sb_publishable_synthetic-key" },
  URL: { NEXT_PUBLIC_SUPABASE_URL: "http://synthetic.supabase.co" },
  PHONE: { PARTNER_ASSISTANT_PHONE: "39 000 000 0000" },
};
const broken = (k: string): PartnerAssistantEnvironment => ({ ...env(), ...wrong[k] });
afterEach(() => vi.unstubAllEnvs());

describe("configurazione dell'assistente Partner", () => {
  it("si accende solo con tutto valido", () =>
    expect(partnerAssistantConfig(env())).toEqual(expected));
  it.each(["ENABLED", "SECRET", "ANTHROPIC", "SUPABASE_KEY", "URL", "PHONE"])(
    "rifiuta %s sbagliato",
    (k) => expect(partnerAssistantConfig(broken(k))).toBeNull(),
  );
  it("rifiuta la chiave Supabase di Shopify", () =>
    expect(
      partnerAssistantConfig({
        ...env(),
        SUPABASE_SECRET_KEY: env().PARTNER_ASSISTANT_SUPABASE_SECRET_KEY,
      }),
    ).toBeNull());
  it("senza variabili resta spento", () => expect(partnerAssistantConfig({})).toBeNull());
  it.each<Partial<PartnerAssistantEnvironment>>([
    { PARTNER_ASSISTANT_ENABLED: undefined },
    { PARTNER_ASSISTANT_ENABLED: "1" },
    { PARTNER_ASSISTANT_ENABLED: " true" },
    { PARTNER_ASSISTANT_SECRET: undefined },
    { PARTNER_ASSISTANT_SECRET: "a".repeat(31) },
    { PARTNER_ASSISTANT_SECRET: "a".repeat(257) },
    { PARTNER_ASSISTANT_SECRET: "synthetic partner assistant secret 0000" },
    { ANTHROPIC_API_KEY: undefined },
    { ANTHROPIC_API_KEY: "sk-ant-" + "0".repeat(15) },
    { ANTHROPIC_API_KEY: "sk-ant-synthetic 0000000000000000" },
    { PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: undefined },
    { PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: "sb_secret_short" },
    { PARTNER_ASSISTANT_SUPABASE_SECRET_KEY: "legacy-jwt-is-not-this-contract" },
    { NEXT_PUBLIC_SUPABASE_URL: undefined },
    { NEXT_PUBLIC_SUPABASE_URL: "non un url" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://user:password@synthetic.supabase.co" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co/rest/v1" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co/?a=1" },
    { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co/#a" },
    { PARTNER_ASSISTANT_PHONE: undefined },
    { PARTNER_ASSISTANT_PHONE: "" },
    { PARTNER_ASSISTANT_PHONE: "+0000000" },
    { PARTNER_ASSISTANT_PHONE: "+0000000000000000" },
    { PARTNER_ASSISTANT_PHONE: "+39  000 000 0000" },
    { PARTNER_ASSISTANT_PHONE: " +39 000 000 0000" },
    { PARTNER_ASSISTANT_PHONE: "+39 000 000 0000 " },
    { PARTNER_ASSISTANT_PHONE: "+39-000-000-0000" },
    { PARTNER_ASSISTANT_PHONE: "+ 39 000 000 0000" },
  ])("resta spento con %j", (change) =>
    expect(partnerAssistantConfig({ ...env(), ...change })).toBeNull(),
  );
  it.each(["+00000000", "+000000000000000", "+39 0000000000", "+41 00 000 00 00"])(
    "accetta il telefono %s e lo conserva com'è",
    (phone) =>
      expect(partnerAssistantConfig({ ...env(), PARTNER_ASSISTANT_PHONE: phone })?.phone).toBe(
        phone,
      ),
  );
  it("accetta Supabase locale in http", () =>
    expect(
      partnerAssistantConfig({ ...env(), NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" })
        ?.supabaseUrl,
    ).toBe("http://127.0.0.1:54321"));
  it.each([
    "https://synthetic.supabase.co",
    "https://synthetic.supabase.co:8443",
    "http://localhost:54321",
    "http://[::1]:54321",
    "http://remote.test",
    "https://user@synthetic.supabase.co",
    "https://synthetic.supabase.co/path",
    "https://synthetic.supabase.co/?a=1",
    "https://synthetic.supabase.co/#a",
    "non un url",
  ])("controlla l'URL %s come il worker Shopify", (url) =>
    expect(partnerAssistantConfig({ ...env(), NEXT_PUBLIC_SUPABASE_URL: url }) !== null).toBe(
      validWorkerSupabaseUrl(url),
    ),
  );
  it("legge le variabili del server una per una", () => {
    for (const [key, value] of Object.entries(env())) vi.stubEnv(key, value);
    expect(partnerAssistantConfig()).toEqual(expected);
    vi.stubEnv("PARTNER_ASSISTANT_PHONE", "");
    expect(partnerAssistantConfig()).toBeNull();
  });
});
