/** Identificatori ASCII rappresentabili dal registro e dal controllo dei solleciti. */
const PARTNER_FOLLOWUP_MESSAGE_ID =
  /^<[\x21-\x3b\x3d\x3f\x41-\x7e]+@[\x21-\x3b\x3d\x3f\x41-\x7e]+>$/u;

const MAX_ID_LENGTH = 254;
const MAX_FIELD_LENGTH = 65_536;
const MAX_COMMENT_DEPTH = 64;
const DOT_ATOM =
  /^[a-z0-9!#$%&'*+\-/=?^_`{|}~\u00a0-\u{10ffff}]+(?:\.[a-z0-9!#$%&'*+\-/=?^_`{|}~\u00a0-\u{10ffff}]+)*$/iu;

export function isPartnerFollowupMessageId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_ID_LENGTH &&
    PARTNER_FOLLOWUP_MESSAGE_ID.test(value)
  );
}

export type PartnerFollowupIdentificationField = "message-id" | "in-reply-to" | "references";
export type PartnerFollowupIdentification = {
  ids: string[];
  form: "standard" | "legacy_phrase" | "legacy_cfws" | "bare";
};

/**
 * RFC 5322 §§3.2, 3.6.4, 4.4, 4.5.4. Le frasi obsolete sono ammesse solo nei
 * riferimenti e non aggiungono ID. La normalizzazione della quotatura segue RFC 5256 §2.4.
 * Le forme non rappresentabili restano incerte. `bare` è solo un indizio di rilevanza.
 */
export function parsePartnerFollowupIdentification(
  input: unknown,
  field: PartnerFollowupIdentificationField,
): PartnerFollowupIdentification | null {
  if (typeof input !== "string" || !input.isWellFormed() || input.length > MAX_FIELD_LENGTH)
    return null;
  const value = input.replace(/\r\n[ \t]+/gu, " ");
  if (/[\x00-\x08\x0a-\x1f\x7f-\x9f\u2028\u2029\ufffd]/u.test(value)) return null;
  const trimmed = value.replace(/^[ \t]+|[ \t]+$/gu, "");
  if (trimmed === "") return field === "message-id" ? null : { ids: [], form: "legacy_phrase" };
  const bareParts = trimmed.split("@");
  if (bareParts.length === 2 && bareParts.every((part) => DOT_ATOM.test(part))) {
    const id = `<${trimmed}>`;
    return isPartnerFollowupMessageId(id) ? { ids: [id], form: "bare" } : null;
  }

  const atom = /[a-z0-9!#$%&'*+\-/=?^_`{|}~\u00a0-\u{10ffff}]+/iuy;
  const ids: string[] = [];
  let cursor = 0;
  let legacyPhrase = false;
  let legacyId = false;
  let inPhrase = false;

  function skipCfws(): boolean {
    while (cursor < value.length) {
      if (value[cursor] === " " || value[cursor] === "\t") {
        cursor++;
      } else if (value[cursor] === "(") {
        let depth = 1;
        for (cursor++; cursor < value.length && depth > 0; cursor++) {
          if (value[cursor] === "\\") cursor++;
          else if (value[cursor] === ")") depth--;
          else if (value[cursor] === "(") {
            depth++;
            if (depth > MAX_COMMENT_DEPTH) return false;
          }
        }
        if (depth !== 0) return false;
      } else break;
    }
    return true;
  }

  function readWord(allowQuoted: boolean): string | null {
    if (allowQuoted && value[cursor] === '"') {
      let result = "";
      for (cursor++; cursor < value.length; cursor++) {
        if (value[cursor] === '"') {
          cursor++;
          return result;
        }
        if (value[cursor] === "\\") cursor++;
        if (cursor >= value.length) return null;
        result += value[cursor];
      }
      return null;
    }
    atom.lastIndex = cursor;
    const match = atom.exec(value);
    if (!match) return null;
    cursor = atom.lastIndex;
    return match[0];
  }

  function readDotted(allowQuoted: boolean): string | null {
    const words: string[] = [];
    do {
      if (words.length > 0) cursor++;
      if (!skipCfws()) return null;
      const word = readWord(allowQuoted);
      if (word === null || !skipCfws()) return null;
      words.push(word);
    } while (value[cursor] === ".");
    const joined = words.join(".");
    return DOT_ATOM.test(joined) ? joined : null;
  }

  function readId(): string | null {
    const start = cursor++;
    const left = readDotted(true);
    if (left === null || value[cursor++] !== "@" || !skipCfws()) return null;
    let right: string | null;
    if (value[cursor] === "[") {
      const end = value.indexOf("]", cursor + 1);
      if (end < 0) return null;
      right = value.slice(cursor, end + 1);
      if (!/^\[[\x21-\x5a\x5e-\x7e\u00a0-\u{10ffff}]*\]$/u.test(right)) return null;
      cursor = end + 1;
      if (!skipCfws()) return null;
    } else right = readDotted(false);
    if (right === null || value[cursor++] !== ">") return null;
    const id = `<${left}@${right}>`;
    // La lettura accetta anche ID lunghi o UTF-8. La registrazione ha vincoli più stretti.
    if (!/^<[^<>\s@]+@[^<>\s@]+>$/u.test(id)) return null;
    if (value.slice(start, cursor) !== id) legacyId = true;
    return id;
  }

  while (cursor < value.length) {
    if (!skipCfws()) return null;
    if (cursor === value.length) break;
    if (value[cursor] === "<") {
      const id = readId();
      if (id === null || (field === "message-id" && ids.length > 0)) return null;
      ids.push(id);
      inPhrase = false;
    } else {
      if (field === "message-id") return null;
      if (value[cursor] === "." && inPhrase) cursor++;
      else if (readWord(true) === null) return null;
      inPhrase = true;
      legacyPhrase = true;
    }
  }
  if ((field === "message-id" && ids.length !== 1) || (!ids.length && !legacyPhrase)) return null;
  return { ids, form: legacyPhrase ? "legacy_phrase" : legacyId ? "legacy_cfws" : "standard" };
}
