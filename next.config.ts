import type { NextConfig } from "next";

/**
 * Indirizzi vecchi del conto vendita (docs/consignment.md, «Pagine»): conta, ordini,
 * impostazioni e nuovo negozio sono passati in Magazzino › Conto vendita. Restano validi
 * per i segnalibri e i link già scritti; la query (`?riordine=`, `?da=`, `?consegna=1`,
 * `?nome=`) passa da sola. Temporanei (307): un 308 resterebbe nella cache del browser.
 * Le vendite del negozio e il resoconto (`/consignment/<CODICE>/resoconto/<AAAA-MM>`,
 * decisione 17) non cambiano indirizzo.
 */
export const CONSIGNMENT_REDIRECTS = [
  { source: "/consignment/nuovo", destination: "/stock/conto-vendita/nuovo", permanent: false },
  {
    source: "/consignment/:code/conta",
    destination: "/stock/conto-vendita/:code/conta",
    permanent: false,
  },
  {
    source: "/consignment/:code/impostazioni",
    destination: "/stock/conto-vendita/:code/impostazioni",
    permanent: false,
  },
  {
    source: "/consignment/:code/ordini/:order",
    destination: "/stock/conto-vendita/:code/ordini/:order",
    permanent: false,
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { root: process.cwd() },
  // I cinque lookbook Partner viaggiano con la route che li serve ai membri (00-sequenza §5, 02-2).
  outputFileTracingIncludes: {
    "/partner/lookbook/\\[code\\]": ["./data/partner-lookbooks/*.pdf"],
  },
  redirects: async () => CONSIGNMENT_REDIRECTS,
};

export default config;
