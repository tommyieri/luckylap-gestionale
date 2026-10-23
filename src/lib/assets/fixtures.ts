import type { BrandAsset } from "./model";

/*
 * Anteprima locale di «Grafica e foto» (00-sequenza §1.5): soli dati sintetici, mai Supabase.
 * Nessun file vero: link di esempio e un SVG senza anteprima, così la pagina non chiede byte
 * alla route privata. Uno dei contenuti è archiviato, per provare «Mostra archiviati».
 */
export const PREVIEW_ASSETS_NOTICE = "Anteprima locale: dati sintetici, salvataggio disattivato.";
export const PREVIEW_ASSETS_USER = "00000000-0000-4000-8000-0000000000a1";
const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const link = (n: number, fields: Partial<BrandAsset>): BrandAsset => ({
  id: id(n),
  name: `Contenuto sintetico ${n}`,
  assetType: "photo",
  description: "",
  externalUrl: `https://example.test/contenuto-${n}`,
  storagePath: null,
  originalName: null,
  contentType: null,
  size: null,
  createdAt: `2026-10-${String(10 + n).padStart(2, "0")}T09:00:00Z`,
  archivedAt: null,
  ...fields,
});

export function previewBrandAssets(): BrandAsset[] {
  return [
    link(6, {
      name: "Logo sintetico su fondo chiaro",
      assetType: "logo",
      externalUrl: null,
      storagePath: `system/${id(6)}/logo-sintetico.svg`,
      originalName: "logo-sintetico.svg",
      contentType: "image/svg+xml",
      size: 48_000,
    }),
    link(5, {
      name: "Foto sintetica del box",
      description: "Scatti di prova per la pagina prodotto.",
    }),
    link(4, { name: "Mockup sintetico della maglietta", assetType: "mockup" }),
    link(3, { name: "Video sintetico della giornata in pista", assetType: "video" }),
    link(2, {
      name: "Foto sintetica caricata per sbaglio",
      archivedAt: "2026-10-22T16:40:00Z",
    }),
    // Foto di un progetto di Nuovi prodotti: compare solo con il filtro «Nuovi prodotti». HEIC,
    // quindi senza anteprima: la pagina non chiede byte alla route privata.
    link(7, {
      name: "Campione sintetico dal telefono",
      externalUrl: null,
      storagePath: `${PREVIEW_ASSETS_USER}/${id(7)}/campione-sintetico.heic`,
      originalName: "campione-sintetico.heic",
      contentType: "image/heic",
      size: 2_400_000,
      developmentPhoto: true,
    }),
  ];
}
