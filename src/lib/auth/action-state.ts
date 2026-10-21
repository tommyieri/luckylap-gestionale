export type SignInState = { error?: string };
export type MfaState = { error?: string; factorId?: string; qrCode?: string; secret?: string };
