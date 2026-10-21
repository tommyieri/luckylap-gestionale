"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowLeft, Boxes, Plus, RefreshCw, Save } from "lucide-react";
import { saveDevelopment } from "../app/development/actions";
import { DEVELOPMENT_STAGES, stageLabels, type DevelopmentProject, type DevelopmentState } from "../lib/development/model";
import type { TeamMember } from "../lib/team/model";
import shared from "./team-workspace.module.css";
import styles from "./development.module.css";

const initialState: DevelopmentState = {};
function Feedback({ state }: { state: DevelopmentState }) { return <div aria-live="polite">{state.error && <p role="alert" className={styles.error}>{state.error}</p>}{state.success && <p role="status" className={styles.success}>{state.success}</p>}</div>; }

function ProjectForm({ project, members, initialOperationId }: { project?: DevelopmentProject; members: TeamMember[]; initialOperationId?: string }) {
  const [state, action, pending] = useActionState(saveDevelopment, initialState);
  const submitLock = useRef(false);
  useEffect(() => { submitLock.current = false; }, [state.revision]);
  const [operationId, setOperationId] = useState(initialOperationId ?? "");
  useEffect(() => { if (state.success && !project) setOperationId(crypto.randomUUID()); }, [state.revision, state.success, project]);
  const value = (name: string, fallback = "") => state.values?.[name] ?? fallback;
  return <form key={state.revision ?? "initial"} action={action} onSubmit={event => { if (submitLock.current) { event.preventDefault(); return; } submitLock.current = true; }} className={styles.form} aria-label={project ? `Modifica ${project.name}` : "Nuovo progetto prodotto"}><fieldset disabled={pending}>
    <legend>{project ? "Modifica scheda" : "Nuovo prodotto"}</legend><input type="hidden" name="id" value={project?.id ?? value("id", operationId)} /><input type="hidden" name="version" value={project ? String(project.version) : ""} />
    <label>Nome<input name="name" maxLength={240} required defaultValue={value("name", project?.name)} placeholder="Es. Nuova grafica o variante" /></label>
    <label>Brief<textarea name="brief" rows={5} maxLength={8000} defaultValue={value("brief", project?.brief)} placeholder="Obiettivo, materiali, dettagli e prossimi passi" /></label>
    <div className={styles.fieldPair}><label>Fase<select name="stage" defaultValue={value("stage", project?.stage ?? "idea")}>{DEVELOPMENT_STAGES.map(stage => <option key={stage} value={stage}>{stageLabels[stage]}</option>)}</select></label><label>Referente<select name="ownerId" defaultValue={value("ownerId", project?.ownerId ?? "")}><option value="">Da assegnare</option>{members.filter(member => member.active || member.id === project?.ownerId).map(member => <option key={member.id} value={member.id}>{member.name}{member.active ? "" : " · non attivo"}</option>)}</select></label></div>
    <label>Data obiettivo <span>facoltativa</span><input type="date" name="targetDate" defaultValue={value("targetDate", project?.targetDate ?? "")} /></label>
    <button className="button button-primary" type="submit">{project ? <Save size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}{pending ? "Salvataggio…" : project ? "Salva modifiche" : "Crea scheda prodotto"}</button>
  </fieldset><Feedback state={state} /></form>;
}
function ArchiveProject({ project }: { project: DevelopmentProject }) {
  const [state, action, pending] = useActionState(saveDevelopment, initialState);
  const submitLock = useRef(false);
  useEffect(() => { submitLock.current = false; }, [state.revision]);
  return <details className={styles.archive}><summary><Archive size={13} aria-hidden="true" />Archivia</summary><form action={action} onSubmit={event => { if (submitLock.current) { event.preventDefault(); return; } submitLock.current = true; }}><input type="hidden" name="id" value={project.id} /><input type="hidden" name="version" value={String(project.version)} /><input type="hidden" name="name" value={project.name} /><input type="hidden" name="brief" value={project.brief} /><input type="hidden" name="stage" value="archived" /><input type="hidden" name="targetDate" value={project.targetDate ?? ""} /><input type="hidden" name="ownerId" value={project.ownerId ?? ""} /><p>La scheda resta salvata e sarà visibile filtrando i progetti archiviati.</p><button type="submit" className="button button-secondary" disabled={pending}>{pending ? "Archiviazione…" : "Archivia scheda"}</button></form><Feedback state={state} /></details>;
}

export function DevelopmentView({ projects, members, displayName, operationId }: { projects: DevelopmentProject[]; members: TeamMember[]; displayName: string; operationId: string }) {
  const [stage, setStage] = useState("active"), [owner, setOwner] = useState(""), [query, setQuery] = useState("");
  const [refreshing, startRefresh] = useTransition(); const router = useRouter();
  const visible = projects.filter(project => (stage === "active" ? project.stage !== "archived" : !stage || project.stage === stage) && (!owner || (owner === "unassigned" ? !project.ownerId : project.ownerId === owner)) && `${project.name} ${project.brief}`.toLocaleLowerCase("it").includes(query.trim().toLocaleLowerCase("it")));
  return <div className={shared.page}><a href="#development-content" className="skip-link">Vai ai prodotti in sviluppo</a><header className={shared.header}><Link href="/" className={shared.brand}>LuckyLap</Link><span className={shared.area}><Boxes size={15} aria-hidden="true" />Sviluppo prodotti</span><Link href="/auth/account" className={shared.account}>{displayName}<span>Il tuo account</span></Link></header>
    <main id="development-content" className={shared.main} tabIndex={-1}><Link href="/" className={shared.back}><ArrowLeft size={14} aria-hidden="true" />Torna al workspace</Link><div className={shared.heading}><div><h1>Le prossime idee, in produzione.</h1><p>Dall’idea al campione, fino al prodotto pronto.</p></div><button className="button button-secondary" onClick={() => startRefresh(() => router.refresh())} disabled={refreshing}><RefreshCw size={14} aria-hidden="true" />{refreshing ? "Aggiornamento…" : "Aggiorna"}</button></div>
      <p className={styles.notice}>Le schede sono condivise con il team. Il passaggio a “Pronto” descrive lo sviluppo del prodotto: non crea SKU o quantità di magazzino.</p>
      <div className={styles.layout}><section className={styles.projects} aria-labelledby="projects-title"><h2 id="projects-title">Schede prodotto <span>{projects.length}</span></h2><div className={styles.filters}><label>Cerca<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome o brief" /></label><label>Fase<select value={stage} onChange={event => setStage(event.target.value)}><option value="active">Progetti aperti</option><option value="">Tutte le fasi</option>{DEVELOPMENT_STAGES.map(value => <option key={value} value={value}>{stageLabels[value]}</option>)}</select></label><label>Referente<select value={owner} onChange={event => setOwner(event.target.value)}><option value="">Tutti</option><option value="unassigned">Da assegnare</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>
        {visible.length === 0 ? <div className={styles.empty}><h3>{projects.length ? "Nessuna scheda corrisponde ai filtri." : "La prossima novità parte da qui."}</h3><p>Crea una scheda con l’idea, il brief e il referente. Il team potrà aggiornarla durante lo sviluppo.</p></div> : <ul className={styles.list}>{visible.map(project => <li key={project.id} className={styles.project}><div className={styles.projectTop}><span className={styles.stage}>{stageLabels[project.stage]}</span><span>{members.find(member => member.id === project.ownerId)?.name ?? (project.ownerId ? "Membro non disponibile" : "Da assegnare")}</span></div><h3>{project.name}</h3>{project.brief && <p className={styles.brief}>{project.brief}</p>}{project.targetDate && <p className={styles.target}>Obiettivo: <time dateTime={project.targetDate}>{new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${project.targetDate}T12:00:00Z`))}</time></p>}<div className={styles.projectActions}><details className={styles.edit}><summary>Modifica scheda</summary><ProjectForm project={project} members={members} /></details>{project.stage !== "archived" && <ArchiveProject project={project} />}</div></li>)}</ul>}
      </section><aside className={styles.newProject}><ProjectForm members={members} initialOperationId={operationId} /></aside></div><footer className={shared.footer}><span>LuckyLap · Sviluppo prodotti</span><span>Brief e avanzamento condivisi</span></footer></main></div>;
}
