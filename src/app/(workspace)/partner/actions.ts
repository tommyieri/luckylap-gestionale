"use server";

import type { PartnerCommandResult } from "../../../lib/partner/commands";
import { runPartnerCommandAction } from "./command-runner";

/*
 * Server Action dei comandi del team su /partner (spec 02 §6). Ognuna accetta solo il suo
 * comando `{ kind, operationId, payload, retry? }`: verifica il membro, ricontrolla il payload,
 * chiama la RPC con il suo operation_id e rilegge /partner. L'autore lo decide il database.
 */

export async function setPartnerState(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("set_partner_state", command);
}

export async function savePartner(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("save_partner", command);
}

/** «Segna inviato», «Ha risposto», «Chiamata», «Incontro», «Nota». */
export async function recordPartnerActivity(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("record_partner_activity", command);
}

export async function savePartnerMessage(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("save_partner_message", command);
}

export async function restorePartnerMessage(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("restore_partner_message", command);
}

export async function savePartnerContact(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("save_partner_contact", command);
}

export async function removePartnerContact(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("remove_partner_contact", command);
}

export async function setPartnerDoNotContact(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("set_partner_do_not_contact", command);
}

export async function resolvePartnerDifference(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("resolve_partner_difference", command);
}
