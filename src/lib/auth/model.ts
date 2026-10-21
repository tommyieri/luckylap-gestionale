export const MEMBER_ROLES = ["founder", "production", "logistics", "finance", "consultant"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export type VerifiedMember = { userId: string; displayName: string; role: MemberRole; financeAccess: boolean };

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Only call with the ID returned by Auth getUser and rows read under that caller's RLS. */
export function memberFromDatabase(userId: string, membershipValue: unknown, profileValue: unknown): VerifiedMember | null {
  const membership = record(membershipValue);
  const profile = record(profileValue);
  if (!userId || membership?.user_id !== userId || membership.active !== true || profile?.user_id !== userId) return null;
  if (!MEMBER_ROLES.includes(membership.role as MemberRole) || typeof membership.finance_access !== "boolean") return null;
  if (typeof profile.display_name !== "string" || profile.display_name.trim().length < 1 || profile.display_name.trim().length > 120) return null;
  return { userId, displayName: profile.display_name.trim(), role: membership.role as MemberRole, financeAccess: membership.finance_access };
}

/** UI guidance only. PostgreSQL RLS is the authority for every sensitive query. */
export function canReadSensitiveArea(member: VerifiedMember, area: "finance" | "audit", verifiedAal: string | null): boolean {
  if (verifiedAal !== "aal2") return false;
  if (area === "audit") return member.role === "founder";
  return member.role === "founder" || (member.financeAccess && (member.role === "production" || member.role === "finance"));
}

export function parseCredentials(email: unknown, password: unknown): { email: string; password: string } | null {
  if (typeof email !== "string" || typeof password !== "string") return null;
  const address = email.trim();
  if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || password.length < 1 || password.length > 1024) return null;
  return { email: address, password };
}
