// POST /api/upload  (multipart form, one field "file")
// "Add quotes": stores one small uploaded quote as a source_files row
// (is_upload, already claimed as working) and runs the agent on it straight
// away, streaming progress back as NDJSON exactly like /api/agent. The file
// itself is never stored, so if the agent fails the row is deleted (the slot
// is freed and the visitor can try again).
//
// Refused before anything is stored: wrong type (415), too big (413), the
// 10-upload limit or today's upload limit (429), or a missing/empty file (400). Uploads are separate
// from the inbox run and never change its progress.
import { STALL_MINUTES } from "@/lib/agent/demo-run";
import type { AgentEvent } from "@/lib/agent/events";
import { runAgent } from "@/lib/agent/run";
import {
  MAX_UPLOADS,
  type SourceFileType,
  deleteStalledUploads,
  deleteUpload,
  getSourceFile,
  insertUpload,
} from "@/lib/db";
import { LIMIT_MESSAGES, dailyLimit } from "@/lib/limits";

// Same as /api/agent: one file can take a few minutes on a slow scan.
export const maxDuration = 300;

const MAX_BYTES = 4 * 1024 * 1024;

const ACCEPTED = "emails (.txt or .eml), PDFs, photos (.png or .jpg), and spreadsheets (.xlsx or .csv)";

const TYPES: Record<string, { type: SourceFileType; looksRight: (b: Uint8Array) => boolean; label: string }> = {
  txt: { type: "email", looksRight: isText, label: "text email" },
  eml: { type: "email", looksRight: isText, label: "email" },
  pdf: { type: "pdf", looksRight: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46]), label: "PDF" }, // %PDF
  png: { type: "scan", looksRight: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47]), label: "PNG photo" },
  jpg: { type: "scan", looksRight: (b) => startsWith(b, [0xff, 0xd8, 0xff]), label: "JPG photo" },
  jpeg: { type: "scan", looksRight: (b) => startsWith(b, [0xff, 0xd8, 0xff]), label: "JPG photo" },
  xlsx: { type: "spreadsheet", looksRight: (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]), label: "Excel file" }, // zip
  csv: { type: "spreadsheet", looksRight: isText, label: "CSV file" },
};

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

/** Readable UTF-8 text with no NUL bytes (binary files have plenty). */
function isText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 8192);
  if (head.includes(0)) return false;
  try {
    // stream: true tolerates a character cut off at the 8 KB boundary.
    new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** A tidy, safe display name: no folders, no control characters, not too long. */
function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  const tidy = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (tidy || "upload").slice(0, 120);
}

const refuse = (error: string, status: number) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return refuse("Choose a file to upload.", 400);

  const fileName = cleanName(file.name);
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const kind = TYPES[ext];
  if (!kind || !fileName.includes(".")) {
    return refuse(`That type of file can't be read. You can add ${ACCEPTED}.`, 415);
  }
  if (file.size > MAX_BYTES) {
    return refuse("That file is too big – the limit is 4 MB.", 413);
  }
  if (file.size === 0) return refuse("That file is empty.", 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!kind.looksRight(bytes)) {
    return refuse(
      `That file doesn't look like a real ${kind.label}. You can add ${ACCEPTED}.`,
      415,
    );
  }

  try {
    // Same occasion as the stall check: clear uploads whose request was cut off.
    await deleteStalledUploads(STALL_MINUTES);
    const inserted = await insertUpload({ fileName, type: kind.type }, dailyLimit("uploads"));
    if ("limit" in inserted) {
      return refuse(
        inserted.limit === "reset"
          ? `This demo takes up to ${MAX_UPLOADS} uploads. Reset the demo to add more.`
          : LIMIT_MESSAGES.uploads,
        429,
      );
    }
    const fileId = inserted.id;

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: AgentEvent) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          } catch {
            // The browser went away; the agent still finishes and saves its work.
          }
        };
        await runAgent(fileId, emit, { bytes });
        // A failed run leaves the file waiting, but the original isn't kept to
        // try again: remove it so it doesn't linger and its slot is freed.
        const after = await getSourceFile(fileId).catch(() => null);
        if (after?.status === "waiting") await deleteUpload(fileId).catch(() => {});
        try {
          controller.close();
        } catch {}
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    console.error("[upload] failed:", error);
    return refuse("Something went wrong adding this file – try again.", 500);
  }
}
