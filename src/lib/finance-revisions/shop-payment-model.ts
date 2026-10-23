import { localReportDate } from "../finance/model";
import { financeAccountLabel } from "../finance/dashboard";
import { romeInputToIso } from "../sales/model";
import {
  parseShopCommand,
  type PaymentMethod,
  type PaymentFinanceMetadata,
  type ShopCommand,
  type PaymentUpdatePayload,
} from "../consignment/shop-model";
import { revisionUuid } from "./model";
export type ShopPaymentFinanceVersion = {
  version: number;
  amountCents: number;
  paidAt: string;
  method: PaymentMethod;
  accountLabel: string | null;
  reference: string | null;
  voided: boolean;
  direction: "income" | "expense";
  category: string | null;
  description: string;
  pending: boolean;
  reason: string | null;
  createdBy: string;
  createdAt: string;
};
export type ShopPaymentFinanceHistory = {
  paymentId: string;
  reportId: string;
  locationId: string;
  version: number;
  current: ShopPaymentFinanceVersion;
  revisions: ShopPaymentFinanceVersion[];
};
export type ShopPaymentFinanceValues = {
  date: string;
  direction: "income" | "expense";
  amountCents: number;
  account: string | null;
  category: string | null;
  description: string;
  pending: boolean;
};
export type ShopPaymentFinanceCommand = {
  operationId: string;
  kind: "update_consignment_payment";
  payload: PaymentUpdatePayload;
  retry?: boolean;
};
export function buildShopPaymentFinanceCommand(input: {
  history: ShopPaymentFinanceHistory;
  action: "update" | "delete" | "restore";
  reason: string;
  operationId: string;
  values?: ShopPaymentFinanceValues;
  restoreVersion?: number;
}): ShopPaymentFinanceCommand | null {
  const { history, action } = input;
  if (
    !revisionUuid(history.paymentId) ||
    !revisionUuid(input.operationId) ||
    history.current.version !== history.version
  )
    return null;
  const source =
    action === "restore"
      ? history.revisions.find((r) => r.version === input.restoreVersion)
      : history.current;
  if (!source || (action === "update" && source.voided)) return null;
  const values = input.values;
  let paidAt = source.paidAt;
  if (action === "update") {
    if (!values) return null;
    const day = localReportDate(new Date(source.paidAt));
    if (values.date !== day) {
      const changed = romeInputToIso(`${values.date}T12:00:00`);
      if (!changed) return null;
      paidAt = changed;
    }
  }
  const finance: PaymentFinanceMetadata =
    action === "update" && values
      ? {
          direction: values.direction,
          category: values.category,
          description: values.description,
          pending: values.pending,
        }
      : {
          direction: source.direction,
          category: source.category,
          description: source.description,
          pending: source.pending,
        };
  const command: ShopCommand | null = parseShopCommand({
    operationId: input.operationId,
    kind: "update_consignment_payment",
    payload: {
      schema_version: 1,
      payment_id: history.paymentId,
      expected_version: history.version,
      amount_cents: action === "update" ? values!.amountCents : source.amountCents,
      paid_at: paidAt,
      method: source.method,
      account_label: financeAccountLabel(
        action === "update" ? values!.account : source.accountLabel,
      ),
      reference: source.reference,
      voided: action === "delete",
      reason: input.reason,
      finance,
    },
  });
  return command?.kind === "update_consignment_payment" ? command : null;
}
