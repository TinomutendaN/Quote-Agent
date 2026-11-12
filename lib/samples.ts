// Small read-only helpers for the sample files in public/samples.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife } from "next/cache";

/**
 * The "Subject:" line of a sample email, e.g. "RE: Leeds run tmrw + evening slot".
 * Sample files never change, so the result is cached. Returns null if the file
 * can't be read or has no subject line.
 */
export async function readEmailSubject(filePath: string): Promise<string | null> {
  "use cache";
  cacheLife("max");
  if (!filePath.startsWith("/samples/") || filePath.includes("..")) return null;
  try {
    const text = await readFile(path.join(process.cwd(), "public", filePath), "utf8");
    const match = text.match(/^Subject:\s*(.+)$/m);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}
