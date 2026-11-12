import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../app/(workspace)/partner/actions", () => {
  const action = vi.fn();
  return {
    setPartnerState: action,
    savePartner: action,
    recordPartnerActivity: action,
    savePartnerMessage: action,
    restorePartnerMessage: action,
    savePartnerContact: action,
    removePartnerContact: action,
    setPartnerDoNotContact: action,
    resolvePartnerDifference: action,
    setPartnerAssistantMode: action,
    setPartnerAssistantContact: action,
    savePartnerAssistantRules: action,
    startPartnerAssistantTest: action,
    confirmPartnerAssistantTest: action,
    setPartnerAssistantSendPriority: action,
    resumePartnerAssistantSend: action,
    setPartnerAssistantSettings: action,
  };
});
vi.mock("../../app/(workspace)/partner/dati/actions", () => ({
  importPartnerDeviceFile: vi.fn(),
  previewPartnerDeviceFile: vi.fn(),
}));

import { PartnerDataView } from "./partner-data-view";
import { PartnerDatabaseDrawer, type PartnerDatabaseTab } from "./partner-database-drawer";
import { PartnerProvider } from "./partner-context";
import { PartnerWorkspace, type PartnerWorkspaceProps } from "./partner-workspace";
import { buildPartnerDatabaseRows } from "../../lib/partner/database";
import {
  PARTNER_FIXTURE_MEMBER_ID,
  partnerFixtureId,
  partnerAssistantFixture,
  partnerFixtureData,
  partnerFixtureDetail,
  partnerFixtureWorkspace,
} from "../../lib/partner/fixtures";

const TODAY = "2026-10-22";

function render(query: Record<string, string> = {}, options: Partial<PartnerWorkspaceProps> = {}) {
  const assistant = partnerAssistantFixture(TODAY);
  return renderToStaticMarkup(
    <PartnerWorkspace
      workspace={partnerFixtureWorkspace(TODAY)}
      detail={query.co ? partnerFixtureDetail(Number(query.co), TODAY) : null}
      assistant={assistant.status}
      send={assistant.send}
      mailConfigured
      founder={false}
      today={TODAY}
      memberId={PARTNER_FIXTURE_MEMBER_ID}
      preview={false}
      query={query}
      {...options}
    />,
  );
}

function renderDrawer(
  co: number,
  tab: PartnerDatabaseTab,
  options: { preview?: boolean; detail?: PartnerWorkspaceProps["detail"] } = {},
) {
  const workspace = partnerFixtureWorkspace(TODAY);
  const row = buildPartnerDatabaseRows(workspace, TODAY, []).find(
    ({ partner }) => partner.co === co,
  );
  return renderToStaticMarkup(
    <PartnerProvider
      preview={options.preview ?? false}
      userId={options.preview ? null : PARTNER_FIXTURE_MEMBER_ID}
      today={TODAY}
      members={workspace.members}
      partners={workspace.partners}
    >
      <PartnerDatabaseDrawer
        targetCo={co}
        row={row ?? null}
        detail={options.detail ?? partnerFixtureDetail(co, TODAY)}
        initialTab={tab}
        onClose={() => {}}
      />
    </PartnerProvider>,
  );
}

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const contacts = (html: string) =>
  [...html.matchAll(/<li[^>]*id="lead-(\d+)"/g)]
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);

const row = (html: string, co: number) =>
  html.match(new RegExp(`<li[^>]*id="lead-${co}"[^>]*>[\\s\\S]*?</li>`))?.[0] ?? "";

const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => ({
    tag: match[0],
    text: text(match[1]).trim(),
  }));

describe("Database Partner", () => {
  it("apre l’elenco di tutti i periodi e conserva le quattro sezioni", () => {
    const html = render();
    expect(contacts(html)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(html).toContain('aria-label="Elenco dei contatti"');
    expect(html).toContain('aria-label="Numeri principali"');
    expect(
      buttons(html)
        .filter(({ tag }) => tag.includes("aria-pressed"))
        .slice(0, 5)
        .map(({ text }) => text),
    ).toEqual(["Tutti 6", "Vendita 3", "Eventi 3", "Collab 4", "Club 0"]);
    expect(text(row(html, 1))).toContain("Garage Sintetico Uno");
    expect(row(html, 1)).toContain('aria-label="Apri CO 001 · Garage Sintetico Uno"');
    expect(row(html, 1)).not.toMatch(/href="(mailto:|tel:)/);
  });

  it.each([
    ["elenco", "Elenco", 'aria-label="Elenco dei contatti"'],
    ["pipeline", "Pipeline", 'aria-label="Pipeline Partner"'],
    ["calendario", "Calendario", 'aria-label="Calendario Partner"'],
    ["mappa", "Mappa", "Dove sono i contatti"],
    ["andamento", "Andamento", "Invii e risposte registrati"],
  ])("apre %s dal suo indirizzo e lo indica nella navigazione", (screen, label, marker) => {
    const html = render({ vista: screen });
    expect(html).toContain("<h1>Partner</h1>");
    expect(html).toContain(marker);
    const views = html.match(/<nav[^>]*aria-label="Viste Partner"[^>]*>[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(views).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*>${label}</a>`));
    expect([...views.matchAll(/href="\/partner\?vista=/g)]).toHaveLength(5);
  });

  it("preserva i link per le risposte anche fuori periodo e con accordo fatto", () => {
    const workspace = partnerFixtureWorkspace(TODAY);
    const partner = workspace.partners[0];
    workspace.partners = [
      {
        ...partner,
        stage: "chiuso",
        contactMonth: "2028-01-01",
        nextAction: null,
        nextActionOn: null,
      },
    ];
    const reply = {
      id: partnerFixtureId(9801),
      partnerId: partner.id,
      kind: "risposta" as const,
      occurredAt: "2026-10-22T09:00:00Z",
      createdBy: PARTNER_FIXTURE_MEMBER_ID,
      origin: "team" as const,
      channel: "email" as const,
      body: "Risposta sintetica visibile nella scheda",
    };
    workspace.work = {
      assistantStatus: "ready",
      jobs: [],
      toggles: [],
      activities: [reply],
      replies: [reply],
      followUps: [],
    };
    const html = render({ vista: "risposte", periodo: "3", stato: "da_contattare" }, { workspace });
    expect(contacts(html)).toEqual([partner.co]);
    expect(text(row(html, partner.co))).toContain("Accordo fatto");
    expect(html).not.toContain(reply.body);
    expect(html).toContain('<option value="risposte" selected="">Risposte registrate</option>');
  });

  it("preserva il link degli accordi e quello del lavoro nel Team", () => {
    const html = render({ vista: "ci_siamo", periodo: "1", co: "6" });
    expect(contacts(html)).toEqual([6]);
    expect(html).toContain('<option value="accordo" selected="">Accordo fatto</option>');
    expect(html).toContain('href="/team/partner?co=6"');
    expect(text(html)).toContain("Apri in Partner nel Team");
    expect(render({ co: "3" })).not.toContain('href="/team/partner?co=3"');
  });

  it("il filtro legacy delle differenze esclude i vecchi testi", () => {
    const html = render({ stato: "da_controllare" });
    expect(contacts(html)).toEqual([3]);
    expect(html).toContain(
      '<option value="da_controllare" selected="">Differenze da controllare</option>',
    );
    expect(text(renderDrawer(3, "dati"))).toContain("Tieni il nostro");
    expect(text(renderDrawer(1, "dati"))).not.toContain("Tieni il nostro");
  });

  it("distingue l’assenza di risultati da un database vuoto", () => {
    const filtered = render({ q: "nessunrisultato" });
    expect(contacts(filtered)).toEqual([]);
    expect(text(filtered)).toContain("Togli i filtri");
    const empty = {
      ...partnerFixtureWorkspace(TODAY),
      partners: [],
      contacts: [],
      variants: [],
      differences: [],
      blocks: [],
      work: null,
    };
    const html = render({}, { workspace: empty });
    expect(text(html)).toContain("Nessun contatto nel database");
    expect(html).toContain('href="/partner/dati"');
  });

  it("mantiene Programma email, assistente, regole, dati e lookbook raggiungibili", () => {
    const html = render({ sezione: "eventi" });
    expect(html).toContain('href="/partner/email?sezione=eventi"');
    for (const path of ["/partner/assistente", "/partner/regole", "/partner/dati"])
      expect(html).toContain(`href="${path}"`);
    for (const code of ["negozi", "eventi", "collab", "porsche_club", "club"])
      expect(html).toContain(`href="/partner/lookbook/${code}"`);
    expect(text(html)).toContain("Ricerca del 20 ottobre 2026, importata il 21 ottobre");
  });

  it("mantiene l’elenco e la scheda leggibili se l’assistente non risponde", () => {
    const html = render({ co: "2" }, { assistant: null });
    expect(contacts(html)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(text(html)).toContain("Stato dell'assistente non leggibile");
    expect(html).toContain("<dialog");
    expect(text(html)).toContain("Raduno Sintetico Due");
  });

  it("nell’anteprima rende consultabile la scheda e disabilita le modifiche", () => {
    const html = render({ co: "1" }, { preview: true });
    expect(text(html)).toContain("Anteprima locale: dati sintetici, salvataggio disattivato.");
    expect(row(html, 1)).toMatch(/<select[^>]*disabled/);
    const drawer = renderDrawer(1, "breve", { preview: true });
    const phaseSelect = [...drawer.matchAll(/<select[^>]*>[\s\S]*?<\/select>/g)].find(([select]) =>
      select.includes('value="concluso"'),
    )?.[0];
    expect(phaseSelect).toMatch(/<select[^>]*disabled/);
  });

  it("separa le sei schede dal registro e non mostra i vecchi messaggi nella scheda Email", () => {
    const detail = partnerFixtureDetail(1, TODAY)!;
    expect(detail.variants.length).toBeGreaterThan(0);
    const marker = "Testo sintetico ritirato dal vecchio sito";
    const html = renderDrawer(1, "email", {
      detail: {
        ...detail,
        variants: detail.variants.map((variant) => ({
          ...variant,
          current: { ...variant.current, body: marker, subject: marker },
        })),
      },
    });
    expect(
      buttons(html)
        .filter(({ tag }) => tag.includes('role="tab"'))
        .map(({ text }) => text),
    ).toEqual(["In breve", "Email", "Registro", "Ricerca", "Recapiti", "Dati e tag"]);
    expect(html).toContain('role="tabpanel"');
    expect(text(html)).not.toContain("Messaggi pronti");
    expect(text(html)).not.toContain(marker);
    const brief = render({ co: "1" });
    expect(buttons(brief).some(({ text }) => text === "Segna inviato")).toBe(false);
    expect(buttons(renderDrawer(1, "registro")).some(({ text }) => text === "Segna inviato")).toBe(
      true,
    );
  });

  it("mantiene il blocco nei recapiti e permette solo risposta e nota nel registro", () => {
    const html = renderDrawer(4, "recapiti");
    expect(text(html)).toContain("Non contattare");
    expect(html).not.toMatch(/href="(mailto:|tel:|https:\/\/wa\.me)/);
    const register = buttons(renderDrawer(4, "registro"));
    for (const label of ["Segna inviato", "Segna sollecito inviato", "Chiamata", "Incontro"])
      expect(register.find((button) => button.text === label)?.tag, label).toContain("disabled");
    for (const label of ["Registra una risposta", "Nota"]) {
      const button = register.find((button) => button.text === label);
      expect(button, label).toBeDefined();
      expect(button?.tag, label).not.toContain("disabled");
    }
  });
});

describe("PartnerDataView", () => {
  it("file del vecchio sito: campo con un'etichetta sua e storico con un titolo visibile", () => {
    const html = renderToStaticMarkup(
      <PartnerDataView data={partnerFixtureData(TODAY)} today={TODAY} preview userId={null} />,
    );
    const t = text(html);
    expect(t).toContain("File del vecchio sito");
    expect(t).toContain("File esportato (.json)");
    expect(html).toMatch(/<h3[^>]*id="dati-file-importati"[^>]*>File già importati<\/h3>/);
    expect(html).toContain('aria-labelledby="dati-file-importati"');
    // Con una ricerca importata, l'ultimo import non dice più quanti messaggi ha portato.
    expect(partnerFixtureData(TODAY).imports.length).toBeGreaterThan(0);
    expect(t).not.toMatch(/\d+ messaggi/);
  });

  it("ricerca non ancora importata: arriva con l'import, senza dire «Claude»", () => {
    const html = renderToStaticMarkup(
      <PartnerDataView
        data={{ ...partnerFixtureData(TODAY), imports: [] }}
        today={TODAY}
        preview
        userId={null}
      />,
    );
    const research = text(html.slice(html.indexOf('id="dati-ricerca"'), html.indexOf("dati-file")));
    expect(research).toContain(
      "La ricerca Partner non è ancora stata importata: la carica Tommi con l'import.",
    );
    expect(research).not.toContain("Claude");
    expect(research).not.toContain("repository");
  });
});
