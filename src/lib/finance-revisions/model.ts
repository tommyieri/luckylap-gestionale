import { financeAccountLabel } from "../finance/dashboard";

/** Stable identities reference existing immutable rows, never client-created sources. */
export const FINANCE_REVISION_SOURCES = [
  "budgetflow",
  "manual",
  "payment",
  "refund",
  "consignment_settlement",
] as const;
export type FinanceRevisionSource = (typeof FINANCE_REVISION_SOURCES)[number];
/**
 * Incassi delle vendite e rimborsi Shopify appartengono alla vendita (spec 04 B.1):
 * da Finance si correggono e si ripristinano, ma non si eliminano. Una vendita
 * sbagliata si annulla in Vendite. Stessa regola di `revise_finance_movement`.
 */
export const financeRevisionDeletable = (kind: FinanceRevisionSource) =>
  kind !== "payment" && kind !== "refund";
/**
 * La motivazione è facoltativa nell'app. Il database la vuole di 3–500 caratteri
 * (vincolo della tabella `finance_movement_revisions`): se resta vuota l'app
 * manda una motivazione neutra, la stessa che lo storico mostrerà.
 */
export const FINANCE_REVISION_DEFAULT_REASON = {
  update: "Correzione",
  delete: "Eliminazione",
  restore: "Ripristino",
} as const;
export type FinanceRevisionAction = keyof typeof FINANCE_REVISION_DEFAULT_REASON;
/** Motivazione rifilata, oppure quella neutra se vuota; `null` se 1–2 o oltre 500 caratteri. */
export function financeRevisionReason(value: unknown, action: FinanceRevisionAction) {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  if (!reason) return FINANCE_REVISION_DEFAULT_REASON[action];
  return reason.length < 3 || reason.length > 500 ? null : reason;
}
export type FinanceRevisionRef = { sourceKind: FinanceRevisionSource; sourceId: string };
export type FinanceRevisionValues = {
  date: string;
  direction: "income" | "expense";
  amountCents: number;
  account: string | null;
  targetAccount: string | null;
  category: string | null;
  description: string;
  pending: boolean;
};
export type FinanceRevisionRecord = FinanceRevisionRef & {
  id: string;
  operationId: string;
  version: number;
  previousVersion: number;
  action: "update" | "delete" | "restore";
  restoredFromVersion: number | null;
  values: FinanceRevisionValues;
  deleted: boolean;
  reason: string;
  createdBy: string;
  createdAt: string;
};
export type FinanceRevisionOriginal = FinanceRevisionRef & {
  values: FinanceRevisionValues;
  deleted: boolean;
  orderId: string | null;
};
export type FinanceRevisionHistory = {
  original: FinanceRevisionOriginal;
  revisions: FinanceRevisionRecord[];
};
export type FinanceRevisionPayload = {
  schema_version: 1;
  source_kind: FinanceRevisionSource;
  source_id: string;
  expected_version: number;
  reason: string;
} & (
  | {
      action: "update";
      values: {
        date: string;
        direction: "income" | "expense";
        amount_cents: number;
        account: string | null;
        target_account: string | null;
        category: string | null;
        description: string;
        pending: boolean;
      };
    }
  | { action: "delete" }
  | { action: "restore"; restore_version: number }
);
export type FinanceRevisionCommand = {
  operationId: string;
  payload: FinanceRevisionPayload;
  retry?: boolean;
};
export type FinanceRevisionReceipt = FinanceRevisionRef & {
  operationId: string;
  revisionId: string;
  version: number;
  replayed: boolean;
};
export type FinanceRevisionResult =
  | { status: "success"; receipt: FinanceRevisionReceipt; message: string }
  | { status: "rejected"; code: string; message: string }
  | { status: "uncertain"; message: string };

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export const revisionUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const sourceKind = (value: unknown): value is FinanceRevisionSource =>
  typeof value === "string" && (FINANCE_REVISION_SOURCES as readonly string[]).includes(value);
const integer = (value: unknown, maximum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const day = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const maybeText = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
const fields = [
  "date",
  "direction",
  "amount_cents",
  "account",
  "target_account",
  "category",
  "description",
  "pending",
];

export function revisionValuesFromDatabase(value: unknown): FinanceRevisionValues | null {
  const row = object(value);
  if (
    !row ||
    !exact(row, fields) ||
    !day(row.date) ||
    !["income", "expense"].includes(String(row.direction)) ||
    !integer(row.amount_cents, 9_000_000_000_000_000) ||
    !maybeText(row.account) ||
    !maybeText(row.target_account) ||
    !maybeText(row.category) ||
    typeof row.description !== "string" ||
    typeof row.pending !== "boolean"
  )
    return null;
  return {
    date: row.date,
    direction: row.direction as "income" | "expense",
    amountCents: row.amount_cents,
    account: row.account,
    targetAccount: row.target_account,
    category: row.category,
    description: row.description,
    pending: row.pending,
  };
}
export function revisionValuesPayload(value: FinanceRevisionValues) {
  return {
    date: value.date,
    direction: value.direction,
    amount_cents: value.amountCents,
    account: value.account,
    target_account: value.targetAccount,
    category: value.category,
    description: value.description,
    pending: value.pending,
  };
}

export function parseFinanceRevisionCommand(value: unknown): FinanceRevisionCommand | null {
  const row = object(value),
    payload = object(row?.payload);
  if (
    !row ||
    !payload ||
    !revisionUuid(row.operationId) ||
    !Object.keys(row).every((key) => ["operationId", "payload", "retry"].includes(key)) ||
    (row.retry !== undefined && typeof row.retry !== "boolean") ||
    payload.schema_version !== 1 ||
    !sourceKind(payload.source_kind) ||
    !revisionUuid(payload.source_id) ||
    !integer(payload.expected_version, 2_147_483_645) ||
    !Object.hasOwn(FINANCE_REVISION_DEFAULT_REASON, String(payload.action))
  )
    return null;
  const reason = financeRevisionReason(payload.reason, payload.action as FinanceRevisionAction);
  if (reason === null) return null;
  const shared = {
    schema_version: 1 as const,
    source_kind: payload.source_kind,
    source_id: payload.source_id.toLowerCase(),
    expected_version: payload.expected_version,
    reason,
  };
  const baseKeys = [
    "schema_version",
    "source_kind",
    "source_id",
    "expected_version",
    "action",
    "reason",
  ];
  let normalized: FinanceRevisionPayload;
  if (payload.action === "update") {
    const values = revisionValuesFromDatabase(payload.values);
    if (!exact(payload, [...baseKeys, "values"]) || !values) return null;
    const account = financeAccountLabel(values.account),
      target = financeAccountLabel(values.targetAccount),
      category = values.category?.trim() || null;
    if (
      (account?.length ?? 0) > 240 ||
      (target?.length ?? 0) > 240 ||
      (category?.length ?? 0) > 240 ||
      values.description.trim().length > 2000 ||
      (target !== null && (shared.source_kind !== "budgetflow" || !account || account === target))
    )
      return null;
    normalized = {
      ...shared,
      action: "update",
      values: revisionValuesPayload({
        ...values,
        account,
        targetAccount: target,
        category,
        description: values.description.trim(),
      }),
    };
  } else if (payload.action === "delete") {
    if (!exact(payload, baseKeys)) return null;
    normalized = { ...shared, action: "delete" };
  } else if (payload.action === "restore") {
    if (
      !exact(payload, [...baseKeys, "restore_version"]) ||
      !integer(payload.restore_version, payload.expected_version)
    )
      return null;
    normalized = { ...shared, action: "restore", restore_version: payload.restore_version };
  } else return null;
  return {
    operationId: row.operationId.toLowerCase(),
    payload: normalized,
    ...(row.retry === true ? { retry: true } : {}),
  };
}

export function revisionOriginalFromDatabase(value: unknown): FinanceRevisionOriginal | null {
  const row = object(value),
    values = revisionValuesFromDatabase(row?.values);
  if (
    !row ||
    !values ||
    !sourceKind(row.source_kind) ||
    !revisionUuid(row.source_id) ||
    typeof row.deleted !== "boolean" ||
    !(row.order_id === null || revisionUuid(row.order_id))
  )
    return null;
  return {
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    values,
    deleted: row.deleted,
    orderId: row.order_id,
  };
}
export function revisionFromDatabase(value: unknown): FinanceRevisionRecord | null {
  const row = object(value),
    values = revisionValuesFromDatabase(row?.value_snapshot);
  if (
    !row ||
    !values ||
    !revisionUuid(row.id) ||
    !revisionUuid(row.operation_id) ||
    !sourceKind(row.source_kind) ||
    !revisionUuid(row.source_id) ||
    !integer(row.version, 2_147_483_646) ||
    row.version === 0 ||
    row.previous_version !== row.version - 1 ||
    !["update", "delete", "restore"].includes(String(row.action)) ||
    typeof row.deleted !== "boolean" ||
    (row.action === "delete") !== row.deleted ||
    (row.action === "restore"
      ? !integer(row.restored_from_version, row.previous_version as number)
      : row.restored_from_version !== null) ||
    typeof row.reason !== "string" ||
    !revisionUuid(row.created_by) ||
    typeof row.created_at !== "string" ||
    !Number.isFinite(Date.parse(row.created_at))
  )
    return null;
  return {
    id: row.id,
    operationId: row.operation_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    version: row.version,
    previousVersion: row.previous_version as number,
    action: row.action as FinanceRevisionRecord["action"],
    restoredFromVersion: row.restored_from_version as number | null,
    values,
    deleted: row.deleted,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}
export function revisionReceiptFromDatabase(value: unknown): FinanceRevisionReceipt | null {
  const row = object(value);
  if (
    !row ||
    !revisionUuid(row.operation_id) ||
    !sourceKind(row.source_kind) ||
    !revisionUuid(row.source_id) ||
    !revisionUuid(row.revision_id) ||
    !integer(row.version, 2_147_483_646) ||
    row.version === 0 ||
    typeof row.replayed !== "boolean"
  )
    return null;
  return {
    operationId: row.operation_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    revisionId: row.revision_id,
    version: row.version,
    replayed: row.replayed,
  };
}
export const financeRevisionKey = (ref: FinanceRevisionRef) =>
  `${ref.sourceKind}:${ref.sourceId.toLowerCase()}`;

/** The P3 payment owns its own CAS/history; never create a second revision ledger. */
export function financeRevisionTarget(
  source: string,
  sourceId: string,
):
  | { type: "revision"; ref: FinanceRevisionRef }
  | { type: "consignment-payment"; paymentId: string; command: "update_consignment_payment" }
  | null {
  if (!revisionUuid(sourceId)) return null;
  if (source === "shop_payment")
    return {
      type: "consignment-payment",
      paymentId: sourceId,
      command: "update_consignment_payment",
    };
  const kind = source === "consignment" ? "consignment_settlement" : source;
  return sourceKind(kind) ? { type: "revision", ref: { sourceKind: kind, sourceId } } : null;
}
