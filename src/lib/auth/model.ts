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

export type SensitiveArea = "finance" | "audit";
export function sensitiveAreaFrom(value: unknown): SensitiveArea | null {
  return value === "finance" || value === "audit" ? value : null;
}
/** Role eligibility is separate from a password grant for the current session. */
export function isSensitiveAreaEligible(member: VerifiedMember, area: SensitiveArea): boolean {
  if (area === "audit") return member.role === "founder";
  if (area !== "finance") return false;
  return member.role === "founder" || (member.financeAccess && (member.role === "production" || member.role === "finance"));
}
/** UI guidance only. PostgreSQL RLS remains the authority for sensitive queries. */
export function canReadSensitiveArea(member: VerifiedMember, area: SensitiveArea, unlocked: boolean): boolean {
  return unlocked === true && isSensitiveAreaEligible(member, area);
}

export function isValidWorkspacePassword(value: unknown): value is string {
  return typeof value === "string" && Array.from(value).length >= 6 && new TextEncoder().encode(value).byteLength <= 72 && value.trim().length > 0;
}

export function parseCredentials(email: unknown, password: unknown): { email: string; password: string } | null {
  if (typeof email !== "string" || !isValidWorkspacePassword(password)) return null;
  const address = email.trim();
  if (address.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return null;
  return { email: address, password };
}
