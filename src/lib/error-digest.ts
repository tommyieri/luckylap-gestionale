/**
 * Codice da mostrare nelle pagine di errore («Codice per Tommi: …»).
 * Solo il `digest` di Next, che collega l'errore ai log del server. Mai il messaggio:
 * in sviluppo contiene i dettagli dell'errore originale.
 */
export function errorDigest(error: unknown): string | null {
  if (!(error instanceof Error) || !("digest" in error)) return null;
  const digest = error.digest;
  return typeof digest === "string" && /^[\w-]{1,100}$/.test(digest) ? digest : null;
}
