/** I soli due PDF ammessi per i Club. Il codice non accetta file o URL dal client. */
export type PartnerAssistantTestLookbook = {
  code: "porsche_club" | "club";
  bytes: number;
  sha256: string;
};

export const PARTNER_ASSISTANT_TEST_LOOKBOOKS = Object.freeze({
  porsche_club: Object.freeze({
    code: "porsche_club" as const,
    bytes: 2592305,
    sha256: "541ddb3b20f7daa46ef428c64ae5618996711409d1819e5dfd37e8cec8831f77",
  }),
  club: Object.freeze({
    code: "club" as const,
    bytes: 2444810,
    sha256: "923cf52ae33ba5dfc8e9271d1157a64719a925a14750ee96a0bd0eeb686942b1",
  }),
});

export const PARTNER_ASSISTANT_TEXT_MAX_BYTES = 65_536;
/** Giorno di Roma deciso da Tommi: le prove possono usare i PDF anche prima. */
export const PARTNER_ASSISTANT_CLUB_LOOKBOOKS_FROM = "2026-11-04";
export const PARTNER_ASSISTANT_TEST_MIME_MAX_BYTES = 4 * 1024 * 1024;
export const PARTNER_ASSISTANT_TEST_RPC_MAX_BYTES = 5 * 1024 * 1024;

export function partnerAssistantTestLookbook(value: unknown): PartnerAssistantTestLookbook | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "bytes,code,sha256") return null;
  if (row.code !== "porsche_club" && row.code !== "club") return null;
  const expected = PARTNER_ASSISTANT_TEST_LOOKBOOKS[row.code];
  return row.bytes === expected.bytes && row.sha256 === expected.sha256 ? expected : null;
}
