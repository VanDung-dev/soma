import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { unzipSync, zipSync } from "fflate";

const archiveLimit = 512 * 1024;
const entryLimit = 256 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const digest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));

export function packLesson(lesson: { steps?: object[] }) {
  const content = encoder.encode(JSON.stringify(lesson));
  if (content.length > entryLimit) throw new Error("Lesson content exceeds 256 KiB");
  const manifest = encoder.encode(JSON.stringify({
    format: "jsoma", formatVersion: lesson.steps?.some(step => "view" in step && step.view) ? 2 : 1, kind: "lesson", sha256: digest(content),
  }));
  return zipSync({ "manifest.json": manifest, "content.json": content }, { mtime: new Date(1980, 0, 1) });
}

export function unpackLesson(bytes: Uint8Array): unknown {
  if (bytes.length < 22 || bytes.length > archiveLimit) throw new Error("Invalid JSoma archive size");
  const entries = new Set<string>();
  const files = unzipSync(bytes, { filter({ name, originalSize, size }) {
    if ((name !== "manifest.json" && name !== "content.json") || entries.has(name) || originalSize > entryLimit || size > entryLimit) {
      throw new Error(`Invalid JSoma entry: ${name}`);
    }
    entries.add(name);
    return true;
  } });
  const manifestBytes = files["manifest.json"];
  const content = files["content.json"];
  if (!manifestBytes || !content) throw new Error("Missing JSoma manifest or content");
  const manifest = JSON.parse(decoder.decode(manifestBytes));
  if (manifest?.format !== "jsoma" || ![1, 2].includes(manifest.formatVersion) || manifest.kind !== "lesson") {
    throw new Error("Unsupported JSoma format or kind");
  }
  if (manifest.sha256 !== digest(content)) throw new Error("JSoma content checksum mismatch");
  return JSON.parse(decoder.decode(content));
}
