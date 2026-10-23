import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditView } from "./audit-view";
import type { ActivityFeedPage, ActivityItem, ActivityQuery } from "../lib/audit/feed-model";

const actor = "10000000-0000-4000-8000-000000000001";
const cursor = {
  occurredAt: "2026-10-21T21:59:59.123456Z",
  id: "20000000-0000-4000-8000-000000000002",
};
const query: ActivityQuery = { actor, area: "team", before: cursor };
const item: ActivityItem = {
  id: "20000000-0000-4000-8000-000000000001",
  occurredAt: "2026-10-21T22:05:00Z",
  actorId: actor,
  actorName: "Persona sintetica",
  area: "team",
  message: "Persona sintetica ha aggiunto una call.",
  href: "/team#evento-20000000-0000-4000-8000-000000000003",
};
const snapshot: ActivityFeedPage = {
  items: [item, { ...item, id: cursor.id, occurredAt: cursor.occurredAt, href: null }],
  actors: [
    { id: actor, name: "Persona sintetica" },
    { id: "system", name: "Automazioni" },
  ],
  nextCursor: cursor,
  hasCursor: true,
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("feed leggibile Controllo CEO", () => {
  it("raggruppa per giorno italiano a Roma e mostra frasi senza registro tecnico", () => {
    const html = renderToStaticMarkup(<AuditView snapshot={snapshot} query={query} />);
    expect(text(html)).toContain("giovedì 22 ottobre 2026");
    expect(text(html)).toContain("mercoledì 21 ottobre 2026");
    expect(text(html)).toContain("00:05");
    expect(text(html)).toContain(item.message);
    expect(html).toContain('dateTime="2026-10-21T22:05:00Z"');
    expect(html).toContain(`href="${item.href}"`);
    expect(html).not.toMatch(/<table|audit_logs|record_key|old_data|new_data|INSERT|Riferimenti/);
    expect(html).not.toContain(item.id);
    expect(html).not.toMatch(/<main|<aside/);
  });

  it("usa un form GET e conserva persona e area in entrambe le direzioni", () => {
    const html = renderToStaticMarkup(<AuditView snapshot={snapshot} query={query} />);
    expect(html).toContain('action="/audit" method="get"');
    expect(html).toContain('name="actor"');
    expect(html).toContain('name="area"');
    expect(html).toContain(`value="${actor}" selected=""`);
    expect(html).toContain('value="team" selected=""');
    const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
      match[1].replaceAll("&amp;", "&"),
    );
    const recent = links.find((href) => href.startsWith("/audit?") && !href.includes("beforeAt"));
    const previous = links.find((href) => href.includes("beforeAt"));
    for (const href of [recent, previous]) {
      const url = new URL(href!, "https://example.invalid");
      expect(url.searchParams.get("actor")).toBe(actor);
      expect(url.searchParams.get("area")).toBe("team");
    }
    expect(new URL(previous!, "https://example.invalid").searchParams.get("beforeAt")).toBe(
      cursor.occurredAt,
    );
    expect(html).not.toContain('name="beforeAt"');
  });

  it("parte da «Tutti», founder compreso, e dice che mostra le ultime 24 ore", () => {
    const html = renderToStaticMarkup(
      <AuditView snapshot={snapshot} query={{ actor: null, area: null, before: null }} />,
    );
    expect(text(html)).toContain(
      "Cosa ha fatto il team nelle ultime 24 ore, dalla più recente. Orari di Roma.",
    );
    expect(html).toContain('<option value="" selected="">Tutti</option>');
    expect(html).toContain('<option value="" selected="">Tutte</option>');
    expect(text(html)).not.toMatch(/escluse|Collaboratori e automazioni/);
    expect(html).toContain('value="system"');
    expect(html).toContain(`value="${actor}"`);
    expect(html).toContain('value="consignment"');
    expect(text(html)).toContain("Conto vendita");
    expect(text(html)).not.toContain("Anteprima locale");
  });

  it("in anteprima locale lo dice in cima", () => {
    const html = renderToStaticMarkup(<AuditView snapshot={snapshot} query={query} preview />);
    expect(text(html)).toContain("Anteprima locale: dati sintetici, salvataggio disattivato.");
  });

  it("su una pagina corta del confine spiega come continuare", () => {
    const html = renderToStaticMarkup(
      <AuditView
        snapshot={{
          ...snapshot,
          items: [],
          nextCursor: { ...cursor, id: "00000000-0000-0000-0000-000000000000" },
        }}
        query={query}
      />,
    );
    expect(text(html)).toContain("Niente in questo tratto delle 24 ore.");
    expect(text(html)).toContain("Attività precedenti");
  });

  it.each([
    null,
    "https://example.invalid",
    "//example.invalid",
    "/team?next=https://example.invalid",
    "javascript:alert(1)",
  ])("non crea collegamenti per destinazioni assenti o non canoniche (%s)", (href) => {
    const html = renderToStaticMarkup(
      <AuditView snapshot={{ ...snapshot, items: [{ ...item, href }] }} query={query} />,
    );
    expect(text(html)).toContain(item.message);
    expect(text(html)).not.toContain("Apri elemento");
    expect(html).not.toContain("example.invalid");
    expect(html).not.toContain("javascript:");
  });

  it("distingue assenza di risultati e fine delle pagine senza collegamenti inventati", () => {
    const filtered = renderToStaticMarkup(
      <AuditView snapshot={{ ...snapshot, items: [], nextCursor: null }} query={query} />,
    );
    expect(text(filtered)).toContain("Nelle ultime 24 ore non ci sono altre attività.");
    expect(text(filtered)).toContain("Più recenti");
    expect(text(filtered)).not.toContain("Attività precedenti");
    const initial = renderToStaticMarkup(
      <AuditView
        snapshot={{ ...snapshot, items: [], nextCursor: null, hasCursor: false }}
        query={{ actor: null, area: null, before: null }}
      />,
    );
    expect(text(initial)).toContain("Nelle ultime 24 ore nessuna attività.");
    const none = renderToStaticMarkup(
      <AuditView
        snapshot={{ ...snapshot, items: [], nextCursor: null, hasCursor: false }}
        query={{ ...query, before: null }}
      />,
    );
    expect(text(none)).toContain("Nelle ultime 24 ore nessuna attività per questi filtri.");
    expect(initial).not.toContain("Più recenti");
  });
});
