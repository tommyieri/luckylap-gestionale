import type { TeamMember } from "../team/model";
import type { DevelopmentProject } from "./model";
import type { DevelopmentPhoto } from "./photos";

/*
 * Anteprima locale di Nuovi prodotti (00-sequenza §1.5): soli dati sintetici, mai Supabase. Le
 * immagini sono segnaposto disegnati per l'anteprima (public/anteprima/nuovi-prodotti), non foto
 * vere. Il file .heic contiene solo l'intestazione del formato: nessun browser lo mostra, così si
 * vede il riquadro con il nome al posto dell'immagine.
 */
export const PREVIEW_DEVELOPMENT_NOTICE =
  "Anteprima locale: dati sintetici. Le foto che aggiungi o togli restano in questa pagina e non vengono inviate.";
export const PREVIEW_DEVELOPMENT_USER = "00000000-0000-4000-8000-0000000000d1";
const id = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
const projectId = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const SOURCE = "/anteprima/nuovi-prodotti";

export function previewDevelopmentMembers(): TeamMember[] {
  return [
    { id: PREVIEW_DEVELOPMENT_USER, name: "Referente sintetico", active: true },
    { id: "00000000-0000-4000-8000-0000000000d2", name: "Produzione sintetica", active: true },
  ];
}

export function previewDevelopmentProjects(): DevelopmentProject[] {
  return [
    {
      id: projectId(1),
      name: "Collab sintetica con un club",
      brief:
        "Maglietta in edizione limitata per un club sintetico: grafica sul retro, logo piccolo sul petto, cartellino dedicato.",
      stage: "sampling",
      targetDate: "2026-12-05",
      ownerId: "00000000-0000-4000-8000-0000000000d2",
      version: 3,
      updatedAt: "2026-10-23T09:00:00Z",
    },
    {
      id: projectId(2),
      name: "Felpa sintetica invernale",
      brief: "Prima felpa del brand: tessuto pesante, ricamo tono su tono.",
      stage: "design",
      targetDate: null,
      ownerId: PREVIEW_DEVELOPMENT_USER,
      version: 1,
      updatedAt: "2026-10-22T15:30:00Z",
    },
    {
      id: projectId(3),
      name: "Cappellino sintetico",
      brief: "",
      stage: "idea",
      targetDate: null,
      ownerId: null,
      version: 1,
      updatedAt: "2026-10-20T11:00:00Z",
    },
  ];
}

const photo = (
  n: number,
  project: number,
  position: number,
  file: string,
  contentType: string,
  size: number,
): DevelopmentPhoto => ({
  id: id(n),
  projectId: projectId(project),
  position,
  originalName: file,
  contentType,
  size,
  createdAt: `2026-10-${String(15 + n).padStart(2, "0")}T10:00:00Z`,
  createdBy: PREVIEW_DEVELOPMENT_USER,
  previewSrc: `${SOURCE}/${file}`,
});

export function previewDevelopmentPhotos(): DevelopmentPhoto[] {
  return [
    photo(1, 1, 1, "fronte-sintetico.png", "image/png", 41_000),
    photo(2, 1, 2, "retro-sintetico.png", "image/png", 44_000),
    photo(3, 1, 3, "cartellino-sintetico.png", "image/png", 23_000),
    photo(4, 1, 4, "campione-iphone.heic", "image/heic", 2_400_000),
    photo(5, 2, 1, "ricamo-sintetico.png", "image/png", 36_000),
  ];
}
