import { parseSalesCommand, type SalesCommand } from "./model";
export const PENDING_SALES_EVENT = "luckylap-sales-pending";
export const pendingSalesPrefix = (userId: string) => `luckylap.sales.pending:${userId}:`;
export function recoverPendingSales(
  storage: Pick<Storage, "length" | "key" | "getItem">,
  userId: string,
  activeScopes: string[],
) {
  const prefix = pendingSalesPrefix(userId),
    entries: { key: string; scope: string; command: SalesCommand }[] = [],
    // Chiavi dei tentativi illeggibili: si possono solo scartare (06 R11).
    unreadableKeys: string[] = [];
  let unreadable = false;
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const scope = key.slice(prefix.length);
    if (activeScopes.includes(scope)) continue;
    try {
      const raw = storage.getItem(key);
      const command = raw && raw.length <= 64000 ? parseSalesCommand(JSON.parse(raw)) : null;
      if (command) entries.push({ key, scope, command });
      else {
        unreadable = true;
        unreadableKeys.push(key);
      }
    } catch {
      unreadable = true;
      unreadableKeys.push(key);
    }
  }
  return { entries, unreadable, unreadableKeys };
}
