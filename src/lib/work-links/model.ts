import { isTeamId } from "../team/model";

export const WORK_LINK_KINDS = [
  "follow_up",
  "event",
  "deadline",
  "project",
  "shop_review",
] as const;
export type WorkLinkKind = (typeof WORK_LINK_KINDS)[number];
export type WorkOutcome = "event" | "project" | "shop_review";
export type WorkOrder = {
  id: string;
  reference: string | null;
  occurredAt: string;
  channel: string;
};
export type PartnerEventSale = { eventId: string; orderId: string; partnerId: string };
export type WorkPartner = {
  id: string;
  co: number;
  name: string;
  sections: string[];
  eventStartsOn: string | null;
  eventEndsOn: string | null;
  applicationDeadline: string | null;
  stage: string;
};
export type PartnerWorkLink = {
  id: string;
  partnerId: string;
  kind: WorkLinkKind;
  taskId: string | null;
  calendarEventId: string | null;
  projectId: string | null;
  version: number;
  needsReview: boolean;
  detached: boolean;
};
export type PartnerWorkSnapshot = {
  partners: WorkPartner[];
  links: PartnerWorkLink[];
  orders: WorkOrder[];
  eventSales: PartnerEventSale[];
};
export type PartnerWorkPayload =
  | { schema_version: 1; kind: WorkOutcome; partner_id: string }
  | { schema_version: 1; kind: "link_sale"; partner_id: string; event_id: string; order_id: string }
  | {
      schema_version: 1;
      kind: "resolve";
      link_id: string;
      expected_version: number;
      keep_manual: boolean;
    };
export type PartnerWorkCommand = {
  operationId: string;
  actorId: string;
  payload: PartnerWorkPayload;
  retry?: boolean;
};
export type PartnerWorkReceipt = {
  operationId: string;
  actorId: string;
  partnerId: string;
  kind: WorkOutcome | "resolve" | "link_sale";
  targetId: string | null;
  replayed: boolean;
};
export type PartnerWorkResult =
  | { status: "success"; receipt: PartnerWorkReceipt; message: string }
  | { status: "rejected"; code: string; message: string }
  | { status: "uncertain"; message: string };
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const integer = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const optionalId = (value: unknown): value is string | null => value === null || isTeamId(value);
const day = (value: unknown): value is string | null => {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const fail = (): never => {
  throw new Error("I collegamenti Partner non sono disponibili. Rileggi la pagina.");
};

export function parsePartnerWorkCommand(value: unknown): PartnerWorkCommand | null {
  const row = object(value),
    payload = object(row?.payload);
  if (
    !row ||
    !payload ||
    !isTeamId(row.operationId) ||
    !isTeamId(row.actorId) ||
    !Object.keys(row).every((key) =>
      ["operationId", "actorId", "payload", "retry"].includes(key),
    ) ||
    (row.retry !== undefined && typeof row.retry !== "boolean") ||
    payload.schema_version !== 1
  )
    return null;
  let normalized: PartnerWorkPayload;
  if (payload.kind === "resolve") {
    if (
      !exact(payload, ["schema_version", "kind", "link_id", "expected_version", "keep_manual"]) ||
      !isTeamId(payload.link_id) ||
      !integer(payload.expected_version, 1, Number.MAX_SAFE_INTEGER) ||
      typeof payload.keep_manual !== "boolean"
    )
      return null;
    normalized = {
      schema_version: 1,
      kind: "resolve",
      link_id: payload.link_id,
      expected_version: payload.expected_version,
      keep_manual: payload.keep_manual,
    };
  } else if (payload.kind === "link_sale") {
    if (
      !exact(payload, ["schema_version", "kind", "partner_id", "event_id", "order_id"]) ||
      !isTeamId(payload.partner_id) ||
      !isTeamId(payload.event_id) ||
      !isTeamId(payload.order_id)
    )
      return null;
    normalized = {
      schema_version: 1,
      kind: "link_sale",
      partner_id: payload.partner_id,
      event_id: payload.event_id,
      order_id: payload.order_id,
    };
  } else {
    if (
      !exact(payload, ["schema_version", "kind", "partner_id"]) ||
      !["event", "project", "shop_review"].includes(String(payload.kind)) ||
      !isTeamId(payload.partner_id)
    )
      return null;
    normalized = {
      schema_version: 1,
      kind: payload.kind as WorkOutcome,
      partner_id: payload.partner_id,
    };
  }
  return {
    operationId: row.operationId,
    actorId: row.actorId,
    payload: normalized,
    ...(row.retry === true ? { retry: true } : {}),
  };
}

export function partnerWorkSnapshot(
  partnerRows: unknown[],
  linkRows: unknown[],
  orderRows: unknown[] = [],
  eventSaleRows: unknown[] = [],
): PartnerWorkSnapshot {
  const partners = partnerRows.map((value) => {
    const row = object(value);
    if (
      !row ||
      !isTeamId(row.id) ||
      !integer(row.co, 1, 99999) ||
      typeof row.name !== "string" ||
      !row.name.trim() ||
      row.name.length > 240 ||
      !Array.isArray(row.sections) ||
      row.sections.length < 1 ||
      row.sections.length > 4 ||
      !row.sections.every((section) => ["vendita", "eventi", "collab", "club"].includes(section)) ||
      new Set(row.sections).size !== row.sections.length ||
      !day(row.event_starts_on) ||
      !day(row.event_ends_on) ||
      !day(row.application_deadline) ||
      (row.event_ends_on !== null &&
        (row.event_starts_on === null || row.event_ends_on < row.event_starts_on)) ||
      !["da_contattare", "contattato", "risposto", "trattativa", "chiuso", "no"].includes(
        String(row.stage),
      )
    )
      return fail();
    return {
      id: row.id,
      co: row.co,
      name: row.name,
      sections: row.sections as string[],
      eventStartsOn: row.event_starts_on,
      eventEndsOn: row.event_ends_on,
      applicationDeadline: row.application_deadline,
      stage: row.stage as string,
    };
  });
  if (
    new Set(partners.map((partner) => partner.id)).size !== partners.length ||
    new Set(partners.map((partner) => partner.co)).size !== partners.length
  )
    return fail();
  const links = linkRows.map((value) => {
    const row = object(value);
    if (
      !row ||
      !isTeamId(row.id) ||
      !isTeamId(row.partner_id) ||
      !partners.some((partner) => partner.id === row.partner_id) ||
      !WORK_LINK_KINDS.includes(row.kind as WorkLinkKind) ||
      !optionalId(row.task_id) ||
      !optionalId(row.calendar_event_id) ||
      !optionalId(row.project_id) ||
      [row.task_id, row.calendar_event_id, row.project_id].filter((id) => id !== null).length > 1 ||
      !integer(row.version, 1, Number.MAX_SAFE_INTEGER) ||
      typeof row.needs_review !== "boolean" ||
      typeof row.detached !== "boolean"
    )
      return fail();
    return {
      id: row.id,
      partnerId: row.partner_id,
      kind: row.kind as WorkLinkKind,
      taskId: row.task_id,
      calendarEventId: row.calendar_event_id,
      projectId: row.project_id,
      version: row.version,
      needsReview: row.needs_review,
      detached: row.detached,
    };
  });
  if (new Set(links.map((link) => link.id)).size !== links.length) return fail();
  const orders = orderRows.map((value) => {
    const row = object(value);
    if (
      !row ||
      !isTeamId(row.id) ||
      !(
        row.external_reference === null ||
        (typeof row.external_reference === "string" && row.external_reference.length <= 240)
      ) ||
      typeof row.occurred_at !== "string" ||
      !Number.isFinite(Date.parse(row.occurred_at)) ||
      typeof row.channel !== "string" ||
      !["direct", "etsy", "manual_other", "shopify_web", "shopify_pos"].includes(row.channel)
    )
      return fail();
    return {
      id: row.id,
      reference: row.external_reference as string | null,
      occurredAt: row.occurred_at,
      channel: row.channel,
    };
  });
  const eventSales = eventSaleRows.map((value) => {
    const row = object(value);
    if (
      !row ||
      !isTeamId(row.event_id) ||
      !isTeamId(row.order_id) ||
      !isTeamId(row.partner_id) ||
      !partners.some((partner) => partner.id === row.partner_id) ||
      !orders.some((order) => order.id === row.order_id)
    )
      return fail();
    return { eventId: row.event_id, orderId: row.order_id, partnerId: row.partner_id };
  });
  if (
    new Set(orders.map((order) => order.id)).size !== orders.length ||
    new Set(eventSales.map((sale) => `${sale.eventId}:${sale.orderId}`)).size !== eventSales.length
  )
    return fail();
  return {
    partners: partners.sort((a, b) => a.co - b.co),
    links,
    orders: orders.sort(
      (a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id),
    ),
    eventSales,
  };
}

export function partnerWorkReceipt(
  value: unknown,
  command: PartnerWorkCommand,
): PartnerWorkReceipt | null {
  const row = object(value);
  if (
    !row ||
    !exact(row, ["operation_id", "partner_id", "kind", "target_id", "replayed"]) ||
    row.operation_id !== command.operationId ||
    row.kind !== command.payload.kind ||
    !isTeamId(row.partner_id) ||
    !optionalId(row.target_id) ||
    typeof row.replayed !== "boolean" ||
    (command.payload.kind !== "resolve" &&
      (row.partner_id !== command.payload.partner_id || row.target_id === null))
  )
    return null;
  if (command.payload.kind === "link_sale" && row.target_id !== command.payload.event_id)
    return null;
  return {
    operationId: command.operationId,
    actorId: command.actorId,
    partnerId: row.partner_id,
    kind: command.payload.kind,
    targetId: row.target_id,
    replayed: row.replayed,
  };
}
export function partnerHref(co: number): string {
  if (!integer(co, 1, 99999)) return fail();
  return `/partner?co=${co}#lead-${co}`;
}
export function workTargetHref(kind: WorkLinkKind, id: string | null): string | null {
  if (!isTeamId(id)) return null;
  if (kind === "project") return `/development#progetto-${id}`;
  return kind === "event" || kind === "deadline" ? `/team#evento-${id}` : `/team#attivita-${id}`;
}
export const workKindLabel = (kind: WorkLinkKind | "resolve" | "link_sale") =>
  ({
    follow_up: "Sollecito",
    event: "Evento",
    deadline: "Candidatura",
    project: "Progetto per Produzione",
    shop_review: "Apertura conto vendita",
    resolve: "Scelta sull’appuntamento",
    link_sale: "Vendita collegata all’evento",
  })[kind];
export const workOrderChannel = (channel: string): string =>
  (
    ({
      direct: "Diretta",
      etsy: "Etsy",
      manual_other: "Altro canale",
      shopify_web: "Shopify online",
      shopify_pos: "Shopify POS",
    }) as Record<string, string>
  )[channel] ?? "Altro canale";
