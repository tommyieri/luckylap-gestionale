import { describe, expect, it } from "vitest";
import { getSupabasePublicConfig } from "./config";

describe("Supabase configuration fails closed", () => {
  const valid = { NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
  it("accepts a publishable key and HTTPS project address", () => {
    expect(getSupabasePublicConfig(valid).url).toBe("https://test.supabase.co");
  });
  it("rejects missing, privileged and ambiguous credentials", () => {
    expect(() => getSupabasePublicConfig({})).toThrow();
    expect(() => getSupabasePublicConfig({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" })).toThrow();
    expect(() => getSupabasePublicConfig({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "eyJservice_role" })).toThrow();
    expect(() => getSupabasePublicConfig({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://test.supabase.co" })).toThrow();
    expect(() => getSupabasePublicConfig({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "https://user:password@test.supabase.co" })).toThrow();
    expect(() => getSupabasePublicConfig({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co/wrong-path" })).toThrow();
  });
});
