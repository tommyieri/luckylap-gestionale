import Link from "next/link";
import { financeRevisionTarget } from "../lib/finance-revisions/model";

export function financeMovementEditorHref(source: string, sourceId: string): string | null {
  const target = financeRevisionTarget(source, sourceId);
  if (!target) return null;
  return target.type === "consignment-payment"
    ? `/finance/incasso/${target.paymentId}`
    : `/finance/movimento?source_kind=${target.ref.sourceKind}&source_id=${target.ref.sourceId}`;
}
export function FinanceMovementActions({
  source,
  sourceId,
  readOnly = false,
  deleted = false,
}: {
  source: string;
  sourceId: string;
  readOnly?: boolean;
  deleted?: boolean;
}) {
  const href = financeMovementEditorHref(source, sourceId);
  if (readOnly) return <span>Anteprima · modifiche non disponibili</span>;
  if (!href) return null;
  return (
    <Link className="button button-secondary" href={href} prefetch={false}>
      {deleted ? "Ripristina / storico" : "Modifica / storico"}
    </Link>
  );
}
