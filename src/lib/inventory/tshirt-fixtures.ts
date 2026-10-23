import type { InventoryItem } from "../types";
import {
  MAGADZINO_CODE,
  SIZE_ORDER,
  isTshirtCategory,
  tshirtLineForModel,
  type MagadzinoAvailability,
} from "./tshirt-lines";

/*
 * Anteprima locale di Giacenze: numeri sintetici per i riquadri «Magliette disponibili».
 * Non vengono dall'inventario: servono a vedere ogni caso (una grafica esaurita, taglie a
 * zero, pezzi riservati, una sola taglia mancante, un colore con tutte le taglie).
 * Per taglia, da XS a XXL: [fisico, riservato].
 */
type Sizes = readonly (readonly [number, number])[];
const SYNTHETIC: Record<string, Sizes> = {
  "964|Bianco": [
    [3, 0],
    [5, 1],
    [6, 0],
    [4, 0],
    [2, 0],
    [1, 0],
  ],
  "964|Blu": [
    [2, 0],
    [4, 0],
    [7, 2],
    [0, 0],
    [5, 0],
    [3, 0],
  ],
  "GT3RS|Bianco": [
    [0, 0],
    [2, 0],
    [3, 0],
    [2, 2],
    [1, 0],
    [0, 0],
  ],
  "GT3RS|Blu": [
    [1, 0],
    [3, 0],
    [4, 1],
    [2, 0],
    [2, 0],
    [1, 0],
  ],
  "SENNA|Bianco": [
    [4, 0],
    [6, 0],
    [8, 1],
    [5, 0],
    [3, 0],
    [2, 0],
  ],
  "F40|Bianco": [
    [0, 0],
    [0, 0],
    [1, 1],
    [0, 0],
    [0, 0],
    [0, 0],
  ],
  "TESTAROSSA|Bianco": [
    [0, 0],
    [0, 0],
    [0, 0],
    [2, 0],
    [3, 0],
    [1, 0],
  ],
  "SL|Azzurro": [
    [2, 0],
    [3, 0],
    [1, 0],
    [2, 0],
    [0, 0],
    [0, 0],
  ],
};

/** Una riga sintetica del Magadzino per ogni T-shirt delle sei grafiche dell'anteprima. */
export function previewMagadzinoAvailability(
  items: readonly InventoryItem[],
): MagadzinoAvailability[] {
  return items.flatMap((item) => {
    const line = tshirtLineForModel(item.model);
    const sizes = SYNTHETIC[`${line?.model}|${item.color}`];
    const index = SIZE_ORDER.indexOf(item.size as (typeof SIZE_ORDER)[number]);
    if (!line || !isTshirtCategory(item.category) || !sizes || index < 0) return [];
    const [onHand, reserved] = sizes[index];
    return [{ stockItemId: item.id, locationCode: MAGADZINO_CODE, onHand, reserved }];
  });
}
