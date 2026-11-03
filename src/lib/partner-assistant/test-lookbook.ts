import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isPdfBytes } from "../partner/lookbook";
import {
  partnerAssistantTestLookbook,
  type PartnerAssistantTestLookbook,
} from "./test-lookbook-metadata";

const FILES = { porsche_club: "porsche_club.pdf", club: "club.pdf" } as const;

export type PartnerAssistantLoadedTestLookbook = PartnerAssistantTestLookbook & {
  content: Buffer;
};

/** I soli due lookbook Club, dal repository: nessun percorso o URL arriva dal chiamante.
 * La versione prenotata per il messaggio deve corrispondere ai byte del file distribuito. */
export async function loadPartnerAssistantTestLookbook(
  lookbook: PartnerAssistantTestLookbook,
): Promise<PartnerAssistantLoadedTestLookbook> {
  const expected = partnerAssistantTestLookbook(lookbook);
  if (expected === null) throw new Error("Lookbook del messaggio non valido.");
  const content = await readFile(
    join(process.cwd(), "data", "partner-lookbooks", FILES[expected.code]),
  );
  if (
    content.byteLength !== expected.bytes ||
    !isPdfBytes(content) ||
    createHash("sha256").update(content).digest("hex") !== expected.sha256
  )
    throw new Error("Il lookbook distribuito non corrisponde alla versione prenotata.");
  return { ...expected, content };
}
