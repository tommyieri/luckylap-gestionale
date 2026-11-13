"use client";

import { useId, useState, type ReactNode } from "react";
import {
  BarChart3,
  CalendarDays,
  Clock3,
  CreditCard,
  Hash,
  Hourglass,
  ListChecks,
  MapPin,
  Repeat2,
  Tag,
  UserRound,
  WalletCards,
} from "lucide-react";
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
type Field =
  | "type"
  | "amount"
  | "date"
  | "description"
  | "account"
  | "targetAccount"
  | "category"
  | "confirmed";
type Errors = Partial<Record<Field, string>>;
const directions = [
  ["expense", "Uscita"],
  ["income", "Entrata"],
  ["transfer", "Trasferimento"],
] as const;
type Direction = (typeof directions)[number][0];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function Row({
  icon: Icon,
  color,
  label,
  children,
}: {
  icon: typeof Tag;
  color: "blue" | "green" | "red" | "purple" | "brown";
  label: string;
  children: ReactNode;
}) {
  return (
    <label className={styles.row}>
      <span className={styles.icon} data-color={color}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function FinanceNewMovement({
  actorId,
  today,
  accounts,
  selectedAccount,
  categories = [],
  direction,
  readOnly = false,
  onSaved,
  onDirtyChange,
}: {
  actorId: string;
  today: string;
  accounts: readonly string[];
  selectedAccount?: string;
  categories?: readonly string[];
  direction: "income" | "expense";
  readOnly?: boolean;
  onSaved: (saved: FinanceNewMovementSaved) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const id = useId();
  const [type, setType] = useState<Direction>(direction);
  const defaultAccount =
    selectedAccount ?? (accounts.includes("Revolut Business") ? "Revolut Business" : "");
  const [account, setAccount] = useState(defaultAccount);
  const [category, setCategory] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [repeat, setRepeat] = useState("");
  const transfer = type === "transfer";
  const accountNames = [...new Set([...accounts.filter(Boolean), ...FINANCE_ACCOUNT_SUGGESTIONS])];
  const groups = [...FINANCE_CATEGORY_GROUPS].sort((left, right) => {
    const priority = (group: (typeof FINANCE_CATEGORY_GROUPS)[number]) =>
      (group.id === "income") === (type === "income") ? 0 : 1;
    return priority(left) - priority(right);
  });
  const customCategories = categories.filter(
    (name) =>
      name !== "Senza categoria" &&
      !groups.some((group) => (group.categories as readonly string[]).includes(name)),
  );
  const errorId = (field: Field) => `${id}-${field}-error`;
  const error = (field: Field) =>
    errors[field] ? (
      <p id={errorId(field)} className={styles.error}>
        {errors[field]}
      </p>
    ) : null;

  function build(data: FormData) {
    const text = (name: string) => String(data.get(name) ?? "").trim();
    const next: Errors = {};
    if (!directions.some(([value]) => value === text("type")))
      next.type = "Scegli il tipo di movimento.";
    if (!euroCents(text("amount"), 99999999999999))
      next.amount = "Inserisci un importo positivo con al massimo due decimali.";
    if (!calendarDay(text("date"))) next.date = "Scegli una data valida.";
    const movingFunds = text("type") === "transfer";
    const description =
      text("description") ||
      text("payee") ||
      text("category") ||
      (movingFunds ? "Trasferimento" : "");
    if (description.length < 3 || description.length > 2000)
      next.description =
        "Scrivi una descrizione di almeno 3 caratteri o indica il beneficiario o la categoria.";
    if (
      text("account").length > 120 ||
      ((account === "__custom" || movingFunds) && !text("account"))
    )
      next.account = "Indica il conto di partenza.";
    if (
      movingFunds &&
      (!text("targetAccount") ||
        text("targetAccount").toLowerCase() === text("account").toLowerCase())
    )
      next.targetAccount = "Scegli un conto di destinazione diverso.";
    if (text("category").length > 120 || (category === "__custom" && !text("category")))
      next.category = "Scrivi una categoria, fino a 120 caratteri.";
    if (data.get("confirmed") !== "on")
      next.confirmed = "Verifica che il movimento non sia già presente e conferma.";
    setErrors(next);
    if (Object.keys(next).length) throw new Error("Controlla i campi indicati.");
    return financeEntryForm(data, true);
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
        label="Salva"
        saveAtTop
        secondaryLabel="Salva e aggiungi un movimento"
        disabled={readOnly}
        showRecordHelp={false}
        successMessage="Movimento registrato."
        invalidMessage="Controlla i dati e verifica eventuali duplicati."
        onDirtyChange={onDirtyChange}
        onSaved={(receipt, context) => {
          setErrors({});
          setAccount(defaultAccount);
          setCategory("");
          setRepeat("");
          onSaved({
            entryId: receipt.entryId,
            movementId: `manual:${receipt.entryId}`,
            addAnother: context.addAnother,
          });
        }}
      >
        <div className={styles.amountCard}>
          <label>
            <span className="sr-only">Importo</span>
            <input
              name="amount"
              inputMode="decimal"
              placeholder="0,00"
              required
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? errorId("amount") : undefined}
            />
            <span>EUR</span>
          </label>
          {error("amount")}
          <div className={styles.segment} role="group" aria-label="Tipo di movimento">
            {directions.map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {error("type")}
        </div>
        <Group title="Assegnazione">
          <Row icon={CreditCard} color="green" label={transfer ? "Conto di partenza" : "Conto"}>
            <select
              name={account === "__custom" ? undefined : "account"}
              value={account}
              onChange={(event) => setAccount(event.target.value)}
            >
              <option value="">Da attribuire</option>
              {accountNames.map((name) => (
                <option key={name}>{name}</option>
              ))}
              <option value="__custom">Altro conto…</option>
            </select>
          </Row>
          {account === "__custom" && (
            <Row icon={CreditCard} color="green" label="Nome del conto">
              <input
                name="account"
                maxLength={120}
                required
                aria-invalid={Boolean(errors.account)}
                aria-describedby={errors.account ? errorId("account") : undefined}
              />
            </Row>
          )}
          {error("account")}
          {transfer ? (
            <Row icon={CreditCard} color="green" label="Conto di destinazione">
              <select name="targetAccount" required aria-invalid={Boolean(errors.targetAccount)}>
                <option value="">Seleziona</option>
                {accountNames
                  .filter((name) => name !== account)
                  .map((name) => (
                    <option key={name}>{name}</option>
                  ))}
              </select>
            </Row>
          ) : (
            <>
              <Row icon={Tag} color="blue" label="Categoria">
                <select
                  name={category === "__custom" ? undefined : "category"}
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="">Da classificare</option>
                  {groups.map((group) => (
                    <optgroup key={group.id} label={group.label}>
                      {group.categories.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </optgroup>
                  ))}
                  {customCategories.length > 0 && (
                    <optgroup label="Altre categorie">
                      {customCategories.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </optgroup>
                  )}
                  <option value="__custom">Altra categoria…</option>
                </select>
              </Row>
              {category === "__custom" && (
                <Row icon={Tag} color="blue" label="Nome della categoria">
                  <input
                    name="category"
                    maxLength={120}
                    required
                    aria-invalid={Boolean(errors.category)}
                    aria-describedby={errors.category ? errorId("category") : undefined}
                  />
                </Row>
              )}
              {error("category")}
            </>
          )}
          {error("targetAccount")}
          <Row icon={UserRound} color="blue" label="Beneficiario">
            <input name="payee" maxLength={240} placeholder="Facoltativo" />
          </Row>
          <Row icon={Hash} color="blue" label="Tag">
            <input name="tags" maxLength={1200} placeholder="Separati da virgole" />
          </Row>
        </Group>
        <Group title="Scadenza">
          <Row icon={CalendarDays} color="red" label="Data">
            <input
              name="date"
              type="date"
              defaultValue={today}
              required
              aria-invalid={Boolean(errors.date)}
              aria-describedby={errors.date ? errorId("date") : undefined}
            />
          </Row>
          {error("date")}
          <Row icon={Clock3} color="red" label="Ora">
            <input name="time" type="time" />
          </Row>
          <Row icon={Repeat2} color="purple" label="Ripeti">
            <select
              name="repeat"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            >
              <option value="">Mai</option>
              <option value="weekly">Ogni settimana</option>
              <option value="monthly">Ogni mese</option>
              <option value="yearly">Ogni anno</option>
            </select>
          </Row>
          {repeat && (
            <Row icon={Repeat2} color="purple" label="Numero di occorrenze">
              <input name="repeatCount" type="number" min={2} max={60} defaultValue={12} required />
            </Row>
          )}
        </Group>
        <Group title="Pagamento">
          <Row icon={Hourglass} color="purple" label="In sospeso">
            <input name="pending" type="checkbox" className={styles.toggle} />
          </Row>
        </Group>
        <p className={styles.help}>
          I movimenti in sospeso entrano nei saldi dopo la conferma. Le date future appaiono tra i
          pianificati.
        </p>
        <Group title="Includi in">
          <Row icon={BarChart3} color="purple" label="Statistiche">
            <input name="statistics" type="checkbox" className={styles.toggle} defaultChecked />
          </Row>
          <Row icon={ListChecks} color="purple" label="Budget">
            <input name="budgets" type="checkbox" className={styles.toggle} defaultChecked />
          </Row>
        </Group>
        <Group title="Luogo">
          <Row icon={MapPin} color="brown" label="Luogo">
            <input name="location" maxLength={240} placeholder="Facoltativo" />
          </Row>
        </Group>
        <Group title="Dettagli">
          <Row icon={WalletCards} color="blue" label="Descrizione">
            <input
              name="description"
              maxLength={2000}
              placeholder="Per cosa"
              aria-invalid={Boolean(errors.description)}
              aria-describedby={errors.description ? errorId("description") : undefined}
            />
          </Row>
          {error("description")}
          <label className={styles.notes}>
            Note
            <textarea name="notes" rows={3} maxLength={2000} placeholder="Facoltative" />
          </label>
        </Group>
        <Group title="Allegati">
          <p className={styles.attachmentHint}>
            Salva il movimento per allegare fatture e ricevute dalla sua scheda.
          </p>
        </Group>
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
      </FinanceWorkForm>
    </div>
  );
}
