"use client";
import { useEffect,useId,useRef,useState,useTransition,type FormEvent,type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { runFinanceWork } from "@/app/finance/work/actions";
import { centsLabel,parseFinanceWorkCommand,type FinanceWorkCommand,type FinanceWorkKind } from "@/lib/finance-work/model";
import { FINANCE_WORK_EVENT,financeWorkPrefix,readFinanceWorkPending } from "@/lib/finance-work/pending";
import styles from "./finance-work.module.css";
import { FINANCE_ACCOUNT_SUGGESTIONS, FINANCE_CATEGORY_GROUPS } from "@/lib/finance/categories";

export function FinanceWorkForm({userId,scope,kind,build,label,disabled=false,children}:{userId:string;scope:string;kind:FinanceWorkKind;build:(form:FormData)=>Record<string,unknown>;label:string;disabled?:boolean;children:ReactNode}){
  const key=`${financeWorkPrefix(userId)}${scope}`,router=useRouter(),sending=useRef(false);
  const [command,setCommand]=useState<FinanceWorkCommand|null>(null),[notice,setNotice]=useState(""),[success,setSuccess]=useState(false),[blocked,setBlocked]=useState(false),[loaded,setLoaded]=useState(false),[epoch,setEpoch]=useState(0);
  const [pending,startTransition]=useTransition();
  useEffect(()=>{try{const saved=sessionStorage.getItem(key);if(saved){const parsed=parseFinanceWorkCommand(JSON.parse(saved));if(!parsed||parsed.kind!==kind){setBlocked(true);setNotice("Il tentativo salvato non è leggibile. Verifica il registro prima di aggiungere la stessa voce.");}else{setCommand(parsed);setNotice("C’è un invio senza esito certo. Verifica lo stesso tentativo prima di continuare.");}}}catch{setBlocked(true);setNotice("La conservazione dei tentativi non è disponibile in questa scheda. Riattivala prima di registrare voci.");}setLoaded(true);},[key,kind]);
  function send(next:FinanceWorkCommand){
    if(sending.current)return;sending.current=true;
    try{sessionStorage.setItem(key,JSON.stringify(next));window.dispatchEvent(new Event(FINANCE_WORK_EVENT));}catch{sending.current=false;setNotice("Il tentativo non può essere conservato. Nessun nuovo invio eseguito.");return;}
    setCommand(next);setSuccess(false);
    startTransition(async()=>{try{const result=await runFinanceWork(next);setNotice(result.message);if(result.status==="success"){setSuccess(true);try{sessionStorage.removeItem(key);window.dispatchEvent(new Event(FINANCE_WORK_EVENT));setCommand(null);setEpoch(value=>value+1);}catch{setNotice(`${result.message} Verifica di nuovo questo tentativo prima di crearne un altro.`);}router.refresh();}else if(result.status==="rejected"&&result.code!=="idempotency_conflict"){try{sessionStorage.removeItem(key);window.dispatchEvent(new Event(FINANCE_WORK_EVENT));setCommand(null);}catch{/* Frozen payload remains available. */}}}catch{setNotice("Connessione interrotta: la voce potrebbe essere già registrata. Riprova lo stesso invio senza crearne uno nuovo.");}finally{sending.current=false;}});
  }
  function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!loaded||pending||sending.current||blocked||command||disabled)return;try{const next=parseFinanceWorkCommand({operationId:crypto.randomUUID(),kind,payload:build(new FormData(event.currentTarget))});if(!next){setNotice("Controlla i dati e la conferma di verifica delle altre fonti.");return;}send(next);}catch(error){setNotice(error instanceof Error?error.message:"Controlla i dati del modulo.");}}
  return <form onSubmit={submit} className={styles.form}>{notice&&<p role={success?"status":"alert"} className={success?styles.success:styles.feedback}>{notice}</p>}{command&&<div className={styles.pending}><strong>Invio conservato, da verificare</strong><p>{typeof command.payload.entry_date==="string"&&<>Data {command.payload.entry_date} · </>}{typeof command.payload.amount_cents==="number"&&<>Importo {centsLabel(command.payload.amount_cents)} · </>}{String(command.payload.description??command.payload.reason??"")}</p><button type="button" className="button button-primary" disabled={pending} onClick={()=>send({...command,retry:true})}>{pending?"Verifica in corso…":"Verifica lo stesso invio"}</button><small>Riferimento {command.operationId}</small></div>}<fieldset key={epoch} disabled={!loaded||pending||blocked||command!==null||disabled}>{children}<button type="submit" className="button button-primary">{pending?"Registrazione in corso…":label}</button></fieldset></form>;
}

export function FinanceWorkRecovery({userId,activeScopes}:{userId:string;activeScopes:string[]}){
  const [saved,setSaved]=useState<ReturnType<typeof readFinanceWorkPending>>({entries:[],unreadable:false}),[message,setMessage]=useState("");
  const [pending,startTransition]=useTransition(),router=useRouter(),sending=useRef(false),scopesKey=activeScopes.join("|");
  useEffect(()=>{const read=()=>{try{setSaved(readFinanceWorkPending(sessionStorage,userId,scopesKey.split("|")));}catch{setSaved({entries:[],unreadable:true});}};read();window.addEventListener(FINANCE_WORK_EVENT,read);window.addEventListener("storage",read);return()=>{window.removeEventListener(FINANCE_WORK_EVENT,read);window.removeEventListener("storage",read);};},[userId,scopesKey]);
  if(!saved.entries.length&&!saved.unreadable&&!message)return null;
  return <section className={styles.notice}><strong>Invii Finance da verificare</strong><p>Questi tentativi restano recuperabili anche quando la voce è stata annullata o non compare nella pagina corrente.</p>{saved.unreadable&&<p role="alert">Un tentativo non è leggibile. Verifica il registro con Tommi prima di reinserire la stessa voce.</p>}{message&&<p role="status">{message}</p>}{saved.entries.map(entry=><div key={entry.key} className={styles.pending}><strong>{entry.command.kind==="record_finance_entry"?"Voce manuale":"Annullamento"}</strong><p>{String(entry.command.payload.description??entry.command.payload.reason??"")}</p><button type="button" className="button button-primary" disabled={pending} onClick={()=>{if(sending.current)return;sending.current=true;startTransition(async()=>{try{const result=await runFinanceWork({...entry.command,retry:true});setMessage(result.message);if(result.status==="success"||result.status==="rejected"&&result.code!=="idempotency_conflict"){sessionStorage.removeItem(entry.key);window.dispatchEvent(new Event(FINANCE_WORK_EVENT));router.refresh();}}catch{setMessage("Esito non confermato. Il tentativo resta conservato: verifica lo stesso invio.");}finally{sending.current=false;}});}}>Verifica lo stesso invio</button><small>Riferimento {entry.command.operationId}</small></div>)}</section>;
}

/** Suggestions preserve the existing optional account/category payload contract. */
export function FinanceAccountCategoryFields({accounts=[]}:{accounts?:string[]}){
  const listId=useId(),[category,setCategory]=useState("");
  const names=[...new Set([...FINANCE_ACCOUNT_SUGGESTIONS,...accounts.filter(Boolean)])];
  return <>
    <label>Conto / cassa · facoltativo<input name="account" maxLength={120} list={listId} placeholder="Scegli o scrivi un conto"/><datalist id={listId}>{names.map(name=><option key={name} value={name}/>)}</datalist></label>
    <label>Categoria · facoltativa<select name={category==="__custom"?undefined:"category"} value={category} onChange={event=>setCategory(event.target.value)}><option value="">Da classificare</option>{FINANCE_CATEGORY_GROUPS.map(group=><optgroup key={group.id} label={group.label}>{group.categories.map(name=><option key={name} value={name}>{name}</option>)}</optgroup>)}<option value="__custom">Altra categoria…</option></select></label>
    {category==="__custom"&&<label>Nome della categoria<input name="category" maxLength={120} required placeholder="Categoria usata dal team"/></label>}
  </>;
}
