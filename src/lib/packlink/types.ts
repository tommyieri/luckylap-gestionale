export type PacklinkCanonicalTransaction = {
  provider_transaction_id: string;
  provider_type: "LABELS_ORDER" | "REFUND";
  amount_cents: number;
  currency: "EUR";
  occurred_at: string;
  shipment_references: string[];
  shopify_order_gid: string | null;
};

export type PacklinkReadFailureCode =
  | "invalid_input"
  | "account_mismatch"
  | "access_denied"
  | "malformed_response"
  | "response_too_large"
  | "pagination_changed"
  | "pagination_limit"
  | "duplicate_transaction"
  | "unsupported_transaction"
  | "unsupported_currency"
  | "invalid_amount"
  | "invalid_timestamp"
  | "invalid_reference"
  | "throttled"
  | "unavailable"
  | "aborted";

export type PacklinkReadResult =
  | {
      status: "ready";
      clientId: string;
      transactions: PacklinkCanonicalTransaction[];
    }
  | { status: "retry" | "review"; code: PacklinkReadFailureCode };

export type PacklinkClientInput = {
  apiKey: string;
  expectedClientId: string;
  cutoverAt: string;
  now: Date;
};

export type PacklinkClientOptions = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
  maxPages?: number;
};
