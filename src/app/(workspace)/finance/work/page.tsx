import { redirect } from "next/navigation";

/** Compatibilità con i segnalibri: il gate e i dati restano nella pagina Finance. */
export default function FinanceWorkPage() {
  redirect("/finance?vista=movements&nuovo=expense");
}
