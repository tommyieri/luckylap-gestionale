"use client";

import { useId, useState } from "react";
import { calendarDay, financeEntryForm } from "../../lib/finance-work/model";
import { euroCents } from "../../lib/sales/model";
import { FINANCE_ACCOUNT_SUGGESTIONS, FINANCE_CATEGORY_GROUPS } from "../../lib/finance/categories";
import { FinanceWorkForm } from "../finance-work-form";
import styles from "./finance-new-movement.module.css";

export type FinanceNewMovementSaved = {
  entryId: string;
  movementId: `manual:${string}`;
  addAnother: boolean;
};
type Field = "type" | "amount" | "date" | "description" | "account" | "category" | "confirmed";
type Errors = Partial<Record<Field, string>>;

/** Il contenitore gestisce apertura, chiusura e focus; qui rimane un unico modulo. */
export function FinanceNewMovement({
  actorId,
  today,
  accounts,
  direction,
  readOnly = false,
  onSaved,
  onDirtyChange,
}: {
  actorId: string;
  today: string;
  accounts: readonly string[];
  direction: "income" | "expense";
  readOnly?: boolean;
  onSaved: (saved: FinanceNewMovementSaved) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const id = useId();
  const [type, setType] = useState(direction),
    [account, setAccount] = useState(""),
    [category, setCategory] = useState(""),
    [errors, setErrors] = useState<Errors>({});
  const accountNames = [...new Set([...accounts.filter(Boolean), ...FINANCE_ACCOUNT_SUGGESTIONS])];
  const groups = [...FINANCE_CATEGORY_GROUPS].sort((left, right) => {
    const priority = (group: (typeof FINANCE_CATEGORY_GROUPS)[number]) =>
      (group.id === "income") === (type === "income") ? 0 : 1;
    return priority(left) - priority(right);
  });
  const errorId = (field: Field) => `${id}-${field}-error`;
  const error = (field: Field) =>
    errors[field] ? (
      <span id={errorId(field)} className={styles.error}>
        {errors[field]}
      </span>
    ) : null;

  function build(data: FormData) {
    const text = (name: Field) => String(data.get(name) ?? "").trim();
    const next: Errors = {};
    if (!["income", "expense"].includes(text("type"))) next.type = "Scegli Uscita o Entrata.";
    if (!euroCents(text("amount"), 99999999999999))
      next.amount =
        "Inserisci un importo maggiore di zero, per esempio 34,90, senza separatori delle migliaia.";
    if (!calendarDay(text("date"))) next.date = "Scegli una data valida.";
    else if (text("date") > today)
      next.date =
        "La data è futura: usa un promemoria nel Calendario e registra qui il movimento quando avviene.";
    if (text("description").length < 3 || text("description").length > 2000)
      next.description = "Scrivi a chi o per cosa, da 3 a 2000 caratteri.";
    if (text("account").length > 120 || (account === "__custom" && !text("account")))
      next.account = "Scrivi un conto, fino a 120 caratteri.";
    if (text("category").length > 120 || (category === "__custom" && !text("category")))
      next.category = "Scrivi una categoria, fino a 120 caratteri.";
    if (data.get("confirmed") !== "on")
      next.confirmed = "Verifica che il movimento non sia già presente e conferma.";
    setErrors(next);
    if (Object.keys(next).length) throw new Error("Controlla i campi indicati.");
    return financeEntryForm(data);
  }

  return (
    <div className={styles.entry}>
      {readOnly && <p className={styles.help}>Anteprima: la registrazione è disabilitata.</p>}
      <FinanceWorkForm
        key={actorId}
        userId={actorId}
        scope="record"
        kind="record_finance_entry"
        build={build}
        label={type === "expense" ? "Registra uscita" : "Registra entrata"}
        secondaryLabel="Registra e aggiungi un’altra"
        disabled={readOnly}
        showRecordHelp={false}
        successMessage="Movimento registrato."
        invalidMessage="Controlla i campi e conferma la verifica dei duplicati."
        onDirtyChange={onDirtyChange}
        onSaved={(receipt, context) => {
          setErrors({});
          setAccount("");
          setCategory("");
          onSaved({
            entryId: receipt.entryId,
            movementId: `manual:${receipt.entryId}`,
            addAnother: context.addAnother,
          });
        }}
      >
        <div className={styles.grid}>
          <label className={styles.direction}>
            Uscita / Entrata
            <select
              name="type"
              value={type}
              onChange={(event) => setType(event.target.value as typeof type)}
            >
              <option value="expense">Uscita</option>
              <option value="income">Entrata</option>
            </select>
            {error("type")}
          </label>
          <label>
            Importo · EUR
            <input
              name="amount"
              inputMode="decimal"
              placeholder="0,00"
              required
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={`${id}-amount-help${errors.amount ? ` ${errorId("amount")}` : ""}`}
            />
            <span id={`${id}-amount-help`} className={styles.help}>
              Senza segno; usa la virgola per i centesimi.
            </span>
            {error("amount")}
          </label>
          <label>
            Data
            <input
              name="date"
              type="date"
              defaultValue={today}
              max={today}
              required
              aria-invalid={Boolean(errors.date)}
              aria-describedby={`${id}-date-help${errors.date ? ` ${errorId("date")}` : ""}`}
            />
            <span id={`${id}-date-help`} className={styles.help}>
              Per una data futura usa un promemoria nel Calendario; registra qui il movimento quando
              avviene.
            </span>
            {error("date")}
          </label>
          <label className={styles.description}>
            Descrizione
            <textarea
              name="description"
              rows={2}
              minLength={3}
              maxLength={2000}
              required
              placeholder="A chi / per cosa"
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? errorId("description") : undefined}
            />
            {error("description")}
          </label>
          <div className={styles.field}>
            <label>
              Conto · facoltativo
              <select
                name={account === "__custom" ? undefined : "account"}
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              >
                <option value="">Da attribuire</option>
                {accountNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                <option value="__custom">Altro conto…</option>
              </select>
            </label>
            {account === "__custom" && (
              <label>
                Nome del conto
                <input
                  name="account"
                  maxLength={120}
                  required
                  placeholder="Nome del conto"
                  aria-invalid={Boolean(errors.account)}
                  aria-describedby={errors.account ? errorId("account") : undefined}
                />
              </label>
            )}
            {error("account")}
          </div>
          <div className={styles.field}>
            <label>
              Categoria · facoltativa
              <select
                name={category === "__custom" ? undefined : "category"}
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">Da classificare</option>
                {groups.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.categories.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </optgroup>
                ))}
                <option value="__custom">Altra categoria…</option>
              </select>
            </label>
            {category === "__custom" && (
              <label>
                Nome della categoria
                <input
                  name="category"
                  maxLength={120}
                  required
                  placeholder="Nome della categoria"
                  aria-invalid={Boolean(errors.category)}
                  aria-describedby={errors.category ? errorId("category") : undefined}
                />
              </label>
            )}
            {error("category")}
          </div>
        </div>
        <label className={styles.confirmation}>
          <input
            name="confirmed"
            type="checkbox"
            required
            aria-invalid={Boolean(errors.confirmed)}
            aria-describedby={errors.confirmed ? errorId("confirmed") : undefined}
          />
          <span>Ho controllato che questo movimento non sia già registrato.</span>
        </label>
        {error("confirmed")}
        <p className={styles.help}>
          Per gli incassi del negozio usa i <a href="/consignment">resoconti del conto vendita</a>.
        </p>
      </FinanceWorkForm>
    </div>
  );
}
