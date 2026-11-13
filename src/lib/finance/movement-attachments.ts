import type { FinanceMovement } from "./dashboard";

export const FINANCE_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
export const financeAttachmentContentType = "application/pdf";

export const attachmentSourceKind = (source: FinanceMovement["source"]) =>
  source === "consignment" ? "consignment_settlement" : source;

export type FinanceAttachment = { id: string; fileName: string };

export function isAttachmentPdf(bytes: Uint8Array) {
  return [37, 80, 68, 70, 45].every((byte, index) => bytes[index] === byte);
}
