export type Invitation = { token_hash: string; type: "invite" | "recovery" };
export type InvitationState = { error?: string };
export type PasswordState = { error?: string; mfaRequired?: boolean; passwordUpdated?: boolean };

export function parseInvitation(tokenHash: unknown, type: unknown): Invitation | null {
  if ((type !== "invite" && type !== "recovery") || typeof tokenHash !== "string"
    || !/^[A-Za-z0-9_-]{32,256}$/.test(tokenHash)) return null;
  return { token_hash: tokenHash, type };
}

export function validateNewPassword(password: unknown, confirmation: unknown):
  { ok: true; password: string } | { ok: false; error: string } {
  if (typeof password !== "string" || password.length < 12 || password.length > 128 || !password.trim()) {
    return { ok: false, error: "Scegli una password fra 12 e 128 caratteri, oppure una frase lunga." };
  }
  if (typeof confirmation !== "string" || confirmation !== password) return { ok: false, error: "Le due password devono coincidere." };
  return { ok: true, password };
}
