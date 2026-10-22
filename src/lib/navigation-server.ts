import "server-only";
import { currentMember } from "./auth/current-member";
import { navAccessFrom, type NavAccess } from "./navigation";

/** Accesso per il menu, dalla stessa verifica (in cache) usata dalle pagine. */
export async function readNavAccess(): Promise<NavAccess> {
  return navAccessFrom(await currentMember());
}
