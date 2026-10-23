import { stockRecord as record, stockUuid as uuid } from "../stock/model";

/*
 * Riassortimento (docs/riassortimento.md): stati, destinazioni, comandi e testi.
 * Le regole dei comandi sono le stesse delle funzioni SQL di
 * 20261023160000_riassortimento.sql; il database resta l'autorità.
 */

export const RESTOCK_HREF = "/stock/riassortimento";
export const restockHref = (orderId?: string | null) =>
  orderId && uuid(orderId) ? `${RESTOCK_HREF}/${orderId.toLowerCase()}` : RESTOCK_HREF;

export const RESTOCK_STATES = [
  "discussion",
  "supplier",
  "embroiderer",
  "quality",
  "in_hand",
] as const;
export type RestockState = (typeof RESTOCK_STATES)[number];
/** I quattro stati prima dell'arrivo: si va avanti e indietro liberamente. */
export type OpenState = Exclude<RestockState, "in_hand">;
export const isRestockState = (v: unknown): v is RestockState =>
  RESTOCK_STATES.includes(v as RestockState);
export const STATE_LABEL: Record<RestockState, string> = {
  discussion: "Discussione su cosa riordinare",
  supplier: "Ordine magliette a Marco",
  embroiderer: "Dal ricamatore",
  quality: "Da Antonella",
  in_hand: "In mano nostra",
};
/** Nomi brevi del passo, per la riga dell'elenco e il segnapassi. */
export const STATE_SHORT: Record<RestockState, string> = {
  discussion: "Discussione",
  supplier: "Da Marco",
  embroiderer: "Dal ricamatore",
  quality: "Da Antonella",
  in_hand: "In mano nostra",
};
/** Dove sono adesso le magliette, per «Da Antonella dal 23 ottobre». */
const STATE_SINCE: Record<RestockState, string> = {
  discussion: "In discussione",
  supplier: "Ordinate a Marco",
  embroiderer: "Dal ricamatore",
  quality: "Da Antonella",
  in_hand: "In mano nostra",
};
export const stateStep = (state: RestockState) => RESTOCK_STATES.indexOf(state) + 1;

export const TIME_ZONE = "Europe/Rome";
const dayFormat = new Intl.DateTimeFormat("it-IT", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
});
const momentFormat = new Intl.DateTimeFormat("it-IT", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** «23 ottobre» all'ora di Roma. */
export const restockDay = (iso: string) => dayFormat.format(new Date(iso));
/** «23 ott 2026, 10:12» all'ora di Roma. */
export const restockMoment = (iso: string) => momentFormat.format(new Date(iso));
/** «Da Antonella dal 23 ottobre». */
export const stateSince = (state: RestockState, since: string) =>
  `${STATE_SINCE[state]} dal ${restockDay(since)}`;

export const DESTINATIONS = ["warehouse", "shop", "customer"] as const;
export type Destination = (typeof DESTINATIONS)[number];
export const isDestination = (v: unknown): v is Destination =>
  DESTINATIONS.includes(v as Destination);

/**
 * Nome corto del negozio per «Per LCM»: le iniziali quando il nome ha almeno tre
 * parole («Libreria Concessionaria Milano» → «LCM»), altrimenti il nome intero.
 */
export function shopShortName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length < 3) return name.trim();
  return words.map((word) => Array.from(word)[0].toLocaleUpperCase("it")).join("");
}
export function destinationLabel(destination: Destination, shopName: string | null): string {
  if (destination === "warehouse") return "Per noi";
  if (destination === "customer") return "Per il cliente";
  return shopName ? `Per ${shopShortName(shopName)}` : "Per il negozio";
}

/** Ordine delle taglie nelle colonne: le altre dopo, in ordine alfabetico. */
export const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "UNICA"];
export const sizeRank = (size: string) => {
  const rank = SIZE_ORDER.indexOf(size);
  return rank < 0 ? SIZE_ORDER.length : rank;
};
export const bySize = (a: string, b: string) => sizeRank(a) - sizeRank(b) || a.localeCompare(b);
/** Taglie per il cliente che non sono a catalogo: una colonna in più per le T-shirt. */
export const CUSTOMER_EXTRA_SIZES = ["XXXL"];
export const SIZE_PATTERN = /^[A-Z0-9]{1,10}$/;

export const MAX_RESTOCK_LINES = 600;
export const MAX_QUANTITY = 100_000;

export const piecesLabel = (n: number) => (n === 1 ? "1 pezzo" : `${n} pezzi`);
const number = new Intl.NumberFormat("it-IT");
export const quantityText = (n: number | null) => (n === null ? "—" : number.format(n));

// ---------------------------------------------------------------------------
// Comandi.

export type RestockLineInput = {
  destination: Destination;
  product_id: string;
  color: string;
  size: string;
  quantity: number;
};
export type SaveOrderPayload = {
  schema_version: 1;
  order_id: string | null;
  expected_version: number | null;
  title: string;
  notes: string;
  shop_location_id: string | null;
};
export type LinesPayload = {
  schema_version: 1;
  order_id: string;
  expected_version: number;
  lines: RestockLineInput[];
};
export type MovePayload = {
  schema_version: 1;
  order_id: string;
  expected_version: number;
  state: OpenState;
  note: string;
};
export type ReceivePayload = {
  schema_version: 1;
  order_id: string;
  expected_version: number;
  expected_pieces: number;
  note: string;
};
export type UndoPayload = {
  schema_version: 1;
  order_id: string;
  expected_version: number;
  note: string;
};
export type ShopDonePayload = {
  schema_version: 1;
  order_id: string;
  expected_version: number;
  done: boolean;
};
export type RestockCommand = (
  | { kind: "save_restock_order"; payload: SaveOrderPayload }
  | { kind: "set_restock_lines"; payload: LinesPayload }
  | { kind: "move_restock_order"; payload: MovePayload }
  | { kind: "receive_restock_order"; payload: ReceivePayload }
  | { kind: "undo_restock_arrival"; payload: UndoPayload }
  | { kind: "set_restock_shop_done"; payload: ShopDonePayload }
) & { operationId: string; retry?: boolean };
export type RestockCommandKind = RestockCommand["kind"];
export const RESTOCK_COMMAND_KINDS: readonly RestockCommandKind[] = [
  "save_restock_order",
  "set_restock_lines",
  "move_restock_order",
  "receive_restock_order",
  "undo_restock_arrival",
  "set_restock_shop_done",
];
const PAYLOAD_KEYS: Record<RestockCommandKind, readonly string[]> = {
  save_restock_order: [
    "schema_version",
    "order_id",
    "expected_version",
    "title",
    "notes",
    "shop_location_id",
  ],
  set_restock_lines: ["schema_version", "order_id", "expected_version", "lines"],
  move_restock_order: ["schema_version", "order_id", "expected_version", "state", "note"],
  receive_restock_order: [
    "schema_version",
    "order_id",
    "expected_version",
    "expected_pieces",
    "note",
  ],
  undo_restock_arrival: ["schema_version", "order_id", "expected_version", "note"],
  set_restock_shop_done: ["schema_version", "order_id", "expected_version", "done"],
};

export type RestockTarget = {
  orderId: string;
  version: number;
  state?: RestockState;
  pieces?: number;
};
export type RestockResult =
  | {
      status: "success";
      kind: RestockCommandKind;
      operationId: string;
      replayed: boolean;
      message: string;
      target: RestockTarget;
    }
  | { status: "rejected"; code: string; message: string; itemId?: string }
  | { status: "uncertain"; message: string };

// Stesse regole di private.consignment_text, private.consignment_note e private.sale_integer.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
const codePoints = (value: string) => Array.from(value).length;
const MAX_VERSION = 9_000_000_000_000_000;
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
export function cleanText(v: unknown, min: number, max: number): string | null {
  if (typeof v !== "string") return null;
  const text = v.trim();
  const length = codePoints(text);
  return length >= min && length <= max && !CONTROL.test(text) ? text : null;
}
export function cleanNote(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const note = v.replace(/\r\n/g, "\n").replace(/^[ \n]+|[ \n]+$/g, "");
  return codePoints(note) <= max && !CONTROL_EXCEPT_NEWLINE.test(note) ? note : null;
}
const lowerUuid = (v: unknown): string | null => (uuid(v) ? v.toLowerCase() : null);
const exact = (p: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(p).length === keys.length && keys.every((k) => Object.hasOwn(p, k));
const OPEN_STATES: readonly OpenState[] = ["discussion", "supplier", "embroiderer", "quality"];
/** Chiave di una riga: destinazione, modello, colore, taglia. */
export const lineKey = (
  line: Pick<RestockLineInput, "destination" | "product_id" | "color" | "size">,
) => `${line.destination}|${line.product_id}|${line.color}|${line.size}`;

/** Righe valide, ordinate e senza doppioni (come il canonico del database), oppure `null`. */
export function parseRestockLines(value: unknown): RestockLineInput[] | null {
  if (!Array.isArray(value) || value.length > MAX_RESTOCK_LINES) return null;
  const lines: RestockLineInput[] = [];
  for (const raw of value) {
    const row = record(raw);
    if (!row || !exact(row, ["destination", "product_id", "color", "size", "quantity"]))
      return null;
    const product = lowerUuid(row.product_id),
      color = cleanText(row.color, 1, 120),
      size = cleanText(row.size, 1, 10);
    if (
      !isDestination(row.destination) ||
      !product ||
      color === null ||
      size === null ||
      !SIZE_PATTERN.test(size) ||
      !integer(row.quantity, 1, MAX_QUANTITY)
    )
      return null;
    lines.push({
      destination: row.destination,
      product_id: product,
      color,
      size,
      quantity: row.quantity,
    });
  }
  const keys = lines.map(lineKey);
  if (new Set(keys).size !== keys.length) return null;
  return lines.sort((a, b) => (lineKey(a) < lineKey(b) ? -1 : lineKey(a) > lineKey(b) ? 1 : 0));
}

function parsePayload(kind: RestockCommandKind, p: Record<string, unknown>) {
  const orderId = lowerUuid(p.order_id);
  switch (kind) {
    case "save_restock_order": {
      const order = p.order_id === null ? null : orderId,
        version =
          p.expected_version === null
            ? null
            : integer(p.expected_version, 1, MAX_VERSION)
              ? p.expected_version
              : undefined,
        title = cleanText(p.title, 3, 120),
        notes = cleanNote(p.notes, 2000),
        shop = p.shop_location_id === null ? null : lowerUuid(p.shop_location_id);
      if (
        (p.order_id !== null && order === null) ||
        version === undefined ||
        (order === null) !== (version === null) ||
        title === null ||
        notes === null ||
        (p.shop_location_id !== null && shop === null)
      )
        return null;
      return {
        schema_version: 1,
        order_id: order,
        expected_version: version,
        title,
        notes,
        shop_location_id: shop,
      } satisfies SaveOrderPayload;
    }
    case "set_restock_lines": {
      const lines = parseRestockLines(p.lines);
      if (!orderId || !integer(p.expected_version, 1, MAX_VERSION) || !lines) return null;
      return {
        schema_version: 1,
        order_id: orderId,
        expected_version: p.expected_version,
        lines,
      } satisfies LinesPayload;
    }
    case "move_restock_order": {
      const note = cleanNote(p.note, 500);
      if (
        !orderId ||
        !integer(p.expected_version, 1, MAX_VERSION) ||
        !OPEN_STATES.includes(p.state as OpenState) ||
        note === null
      )
        return null;
      return {
        schema_version: 1,
        order_id: orderId,
        expected_version: p.expected_version,
        state: p.state as OpenState,
        note,
      } satisfies MovePayload;
    }
    case "receive_restock_order": {
      const note = cleanNote(p.note, 500);
      if (
        !orderId ||
        !integer(p.expected_version, 1, MAX_VERSION) ||
        !integer(p.expected_pieces, 0, 100_000_000) ||
        note === null
      )
        return null;
      return {
        schema_version: 1,
        order_id: orderId,
        expected_version: p.expected_version,
        expected_pieces: p.expected_pieces,
        note,
      } satisfies ReceivePayload;
    }
    case "undo_restock_arrival": {
      const note = cleanNote(p.note, 500);
      if (!orderId || !integer(p.expected_version, 1, MAX_VERSION) || note === null) return null;
      return {
        schema_version: 1,
        order_id: orderId,
        expected_version: p.expected_version,
        note,
      } satisfies UndoPayload;
    }
    case "set_restock_shop_done":
      if (!orderId || !integer(p.expected_version, 1, MAX_VERSION) || typeof p.done !== "boolean")
        return null;
      return {
        schema_version: 1,
        order_id: orderId,
        expected_version: p.expected_version,
        done: p.done,
      } satisfies ShopDonePayload;
  }
}

/** Un comando del riassortimento: chiavi esatte, UUID minuscoli, righe ordinate. Altrimenti `null`. */
export function parseRestockCommand(value: unknown): RestockCommand | null {
  const row = record(value),
    p = record(row?.payload),
    operationId = lowerUuid(row?.operationId);
  if (
    !row ||
    !p ||
    !operationId ||
    Object.keys(row).some((k) => !["operationId", "kind", "payload", "retry"].includes(k)) ||
    (row.retry !== undefined && typeof row.retry !== "boolean") ||
    !RESTOCK_COMMAND_KINDS.includes(row.kind as RestockCommandKind)
  )
    return null;
  const kind = row.kind as RestockCommandKind;
  if (!exact(p, PAYLOAD_KEYS[kind]) || p.schema_version !== 1) return null;
  const payload = parsePayload(kind, p);
  if (!payload) return null;
  return {
    operationId,
    kind,
    payload,
    ...(row.retry === undefined ? {} : { retry: row.retry }),
  } as RestockCommand;
}

// ---------------------------------------------------------------------------
// Tentativi conservati nel browser.

export const restockPendingKey = (userId: string) => `luckylap.restock.pending:${userId}`;
/** Il tentativo conservato; lancia se c'è ma non si legge. */
export function restockPending(
  storage: Pick<Storage, "getItem">,
  userId: string,
): RestockCommand | null {
  const raw = storage.getItem(restockPendingKey(userId));
  if (raw === null) return null;
  const command = parseRestockCommand(JSON.parse(raw));
  if (!command) throw Error("Tentativo non leggibile.");
  return command;
}

export type AttemptSummary = { title: string; lines: string[] };
/** Riepilogo leggibile di un tentativo da verificare. Mai UUID o chiavi tecniche. */
export function restockAttemptSummary(
  command: RestockCommand,
  orderTitle: (orderId: string) => string | null,
): AttemptSummary {
  const named = (orderId: string) => {
    const title = orderTitle(orderId);
    return title ? `Riordine «${title}»` : "Riordine non più nell’elenco";
  };
  switch (command.kind) {
    case "save_restock_order":
      return command.payload.order_id === null
        ? { title: "Nuovo riordine da verificare", lines: [`Titolo: ${command.payload.title}`] }
        : {
            title: "Modifica del riordine da verificare",
            lines: [named(command.payload.order_id), `Titolo: ${command.payload.title}`],
          };
    case "set_restock_lines":
      return {
        title: "Quantità da verificare",
        lines: [
          named(command.payload.order_id),
          `Totale: ${piecesLabel(command.payload.lines.reduce((sum, l) => sum + l.quantity, 0))}`,
        ],
      };
    case "move_restock_order":
      return {
        title: "Cambio di stato da verificare",
        lines: [
          named(command.payload.order_id),
          `Nuovo stato: ${STATE_LABEL[command.payload.state]}`,
        ],
      };
    case "receive_restock_order":
      return {
        title: "Arrivo in magazzino da verificare",
        lines: [
          named(command.payload.order_id),
          `Da caricare: ${piecesLabel(command.payload.expected_pieces)}`,
        ],
      };
    case "undo_restock_arrival":
      return {
        title: "Annullo dell’arrivo da verificare",
        lines: [named(command.payload.order_id)],
      };
    case "set_restock_shop_done":
      return {
        title: "Consegna al negozio da verificare",
        lines: [
          named(command.payload.order_id),
          command.payload.done ? "Segnate come consegnate" : "Segno di consegna tolto",
        ],
      };
  }
}

export const PREVIEW_NOTICE = "Anteprima locale: dati sintetici, salvataggio disattivato.";
