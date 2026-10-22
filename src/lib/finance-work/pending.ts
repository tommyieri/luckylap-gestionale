import { parseFinanceWorkCommand, type FinanceWorkCommand } from "./model";
export const FINANCE_WORK_EVENT = "luckylap-finance-work-pending";
export const financeWorkPrefix = (userId: string) => `luckylap.finance.work:${userId}:`;
export function readFinanceWorkPending(
  storage: Pick<Storage, "length" | "key" | "getItem">,
  userId: string,
  activeScopes: string[],
) {
  const prefix = financeWorkPrefix(userId),
    entries: { key: string; scope: string; command: FinanceWorkCommand }[] = [];
  let unreadable = false;
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const scope = key.slice(prefix.length);
    if (activeScopes.includes(scope)) continue;
    try {
      const raw = storage.getItem(key),
        command = raw && raw.length <= 16000 ? parseFinanceWorkCommand(JSON.parse(raw)) : null;
      if (command) entries.push({ key, scope, command });
      else unreadable = true;
    } catch {
      unreadable = true;
    }
  }
  return { entries, unreadable };
}
