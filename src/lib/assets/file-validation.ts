import "server-only";
import { createHash } from "node:crypto";
import { AssetInputError, parseUploadDescriptor, type UploadDescriptor } from "./model";

/** Bytes are inspected as stored; no conversion or mutation of the original file. */
export function verifyAssetBytes(bytes: Uint8Array, descriptor: UploadDescriptor): void {
  const file = parseUploadDescriptor(descriptor);
  if (
    bytes.byteLength !== file.size ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new AssetInputError(
      "Il file caricato non coincide con quello selezionato. Scegli un nuovo caricamento.",
    );
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  let valid = false;
  if (file.mime === "image/png") valid = starts(137, 80, 78, 71, 13, 10, 26, 10);
  if (file.mime === "image/jpeg") valid = starts(255, 216, 255);
  if (file.mime === "image/webp")
    valid = bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (file.mime === "video/mp4")
    valid =
      bytes.length >= 16 &&
      ascii(4, 8) === "ftyp" &&
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) >= 16;
  if (file.mime === "video/webm")
    valid =
      starts(0x1a, 0x45, 0xdf, 0xa3) &&
      Buffer.from(bytes.subarray(0, 4096)).includes(
        Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]),
      );
  if (file.mime === "image/svg+xml") {
    let text = "";
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      /* Invalid UTF-8 stays invalid. */
    }
    const leading = text
      .replace(/^\uFEFF/, "")
      .trimStart()
      .replace(/^<\?xml[^?]*\?>\s*/i, "")
      .replace(/^(?:<!--[\s\S]*?-->\s*)+/, "");
    valid = /^<svg(?:\s|\/?>)/i.test(leading) && !/<!DOCTYPE|<!ENTITY/i.test(text);
  }
  if (!valid)
    throw new AssetInputError(
      "Il contenuto del file non corrisponde al formato dichiarato. Il file resta privato e non è stato aggiunto alla libreria.",
    );
}
