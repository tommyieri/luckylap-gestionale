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

/**
 * Modalità dell'assistente: «prova» e «invio» solo a Tommi, con la posta dell'assistente
 * configurata; «invio» dopo una prova confermata.
 */
export async function setPartnerAssistantMode(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("set_partner_assistant_mode", command);
}

/** «Assistente su questo contatto: attivo / fermo». */
export async function setPartnerAssistantContact(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("set_partner_assistant_contact", command);
}

export async function savePartnerAssistantRules(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("save_partner_assistant_rules", command);
}

/** «Manda la prova»: da 1 a 3 bozze pronte verso ogni indirizzo di prova. Solo Tommi. */
export async function startPartnerAssistantTest(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("start_partner_assistant_test", command);
}

/** «La prova è arrivata in posta in arrivo». Solo Tommi. */
export async function confirmPartnerAssistantTest(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("confirm_partner_assistant_test", command);
}

/** «Manda per primo»: la precedenza d'invio del contatto, da 0 a 9. Solo Tommi. */
export async function setPartnerAssistantSendPriority(
  command: unknown,
): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("set_partner_assistant_send_priority", command);
}

/** «Riprendi l'invio» dopo un fermo della casella o dei rifiuti. Solo Tommi. */
export async function resumePartnerAssistantSend(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("resume_partner_assistant_send", command);
}

/** Il limite delle prime email al giorno dopo la prima settimana. Solo Tommi. */
export async function setPartnerAssistantSettings(command: unknown): Promise<PartnerCommandResult> {
  return runPartnerCommandAction("set_partner_assistant_settings", command);
}
