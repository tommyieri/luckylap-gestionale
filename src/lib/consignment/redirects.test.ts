import { describe, expect, it } from "vitest";
import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import config, { CONSIGNMENT_REDIRECTS } from "../../../next.config";

/*
 * Indirizzi vecchi del conto vendita (docs/consignment.md, «Pagine»): il feed del Controllo
 * CEO, Finance, Oggi, il Riassortimento e i segnalibri devono arrivare ancora alla pagina
 * giusta. Prova le regole vere di `next.config.ts` con lo strumento di test di Next.
 */
const ORIGIN = "https://gestionale.example";
const follow = async (path: string) => {
  const response = await unstable_getResponseFromNextConfig({
    url: `${ORIGIN}${path}`,
    nextConfig: config,
  });
  const to = getRedirectUrl(response);
  return { status: response.status, to: to ? to.replace(ORIGIN, "") : null };
};

describe("indirizzi vecchi del conto vendita", () => {
  it.each([
    ["/consignment/NEG01/conta", "/stock/conto-vendita/NEG01/conta"],
    ["/consignment/neg01/conta", "/stock/conto-vendita/neg01/conta"],
    ["/consignment/NEG01/impostazioni", "/stock/conto-vendita/NEG01/impostazioni"],
    ["/consignment/NEG01/ordini/3", "/stock/conto-vendita/NEG01/ordini/3"],
    ["/consignment/NEG01/ordini/nuovo", "/stock/conto-vendita/NEG01/ordini/nuovo"],
    [
      "/consignment/NEG01/ordini/nuovo?riordine=95000000-0000-4000-8000-000000000001",
      "/stock/conto-vendita/NEG01/ordini/nuovo?riordine=95000000-0000-4000-8000-000000000001",
    ],
    [
      "/consignment/NEG01/ordini/nuovo?da=2026-09",
      "/stock/conto-vendita/NEG01/ordini/nuovo?da=2026-09",
    ],
    ["/consignment/NEG01/ordini/2?consegna=1", "/stock/conto-vendita/NEG01/ordini/2?consegna=1"],
    ["/consignment/nuovo", "/stock/conto-vendita/nuovo"],
    [
      "/consignment/nuovo?nome=Sintetico&citta=Milano",
      "/stock/conto-vendita/nuovo?nome=Sintetico&citta=Milano",
    ],
  ])("%s → %s (307, temporaneo)", async (from, to) => {
    expect(await follow(from)).toEqual({ status: 307, to });
  });

  it.each([
    "/consignment",
    "/consignment/NEG01",
    "/consignment/NEG01/resoconto/2026-10",
    "/stock/conto-vendita",
    "/stock/conto-vendita/NEG01",
    "/stock/conto-vendita/NEG01/conta",
  ])("%s resta dov'è (decisione 17 e pagine nuove)", async (path) => {
    expect((await follow(path)).to).toBeNull();
  });

  it("solo redirect temporanei, verso Magazzino › Conto vendita", () => {
    expect(CONSIGNMENT_REDIRECTS).toHaveLength(4);
    for (const rule of CONSIGNMENT_REDIRECTS) {
      expect(rule.permanent).toBe(false);
      expect(rule.source.startsWith("/consignment/")).toBe(true);
      expect(rule.destination.startsWith("/stock/conto-vendita/")).toBe(true);
    }
  });
});
