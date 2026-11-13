// Turns a quote file into content the model can read. The model does the
// reading itself: PDFs and scans go in as document blocks, spreadsheets as
// CSV text (one block per tab), emails as plain text. No PDF parser or text
// recognition here.
//
// If a provider ever can't take a file type directly, handle it in this file
// only, for that provider only (see `provider`).
import type { FilePart, ImagePart, TextPart } from "ai";
import * as XLSX from "xlsx";
import type { Provider } from "@/lib/ai/model";
import type { SourceFileType } from "@/lib/db";

export type QuoteContent = Array<TextPart | FilePart | ImagePart>;

export type ConvertedFile = {
  content: QuoteContent;
  /** Plain-English summary for the "read_file" step, e.g. "scanned PDF". */
  description: string;
};

const TYPE_LABEL: Record<SourceFileType, string> = {
  email: "email",
  pdf: "PDF",
  scan: "scanned PDF",
  spreadsheet: "spreadsheet",
};

function mediaTypeFor(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/pdf";
}

function spreadsheetToText(bytes: Uint8Array): { text: string; tabs: number } {
  const workbook = XLSX.read(bytes, { type: "array" });
  const blocks = workbook.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    return `### Tab: ${name}\n${csv.trim()}`;
  });
  return { text: blocks.join("\n\n"), tabs: workbook.SheetNames.length };
}

export function convertFile(
  bytes: Uint8Array,
  fileName: string,
  type: SourceFileType,
  // Kept for provider-specific conversions; both providers currently take
  // PDFs and images directly.
  _provider: Provider, // eslint-disable-line @typescript-eslint/no-unused-vars
): ConvertedFile {
  const label = TYPE_LABEL[type];

  if (type === "email") {
    const text = new TextDecoder("utf-8").decode(bytes);
    return {
      content: [{ type: "text", text: `Email file "${fileName}":\n\n${text}` }],
      description: label,
    };
  }

  if (type === "spreadsheet") {
    const { text, tabs } = spreadsheetToText(bytes);
    return {
      content: [
        {
          type: "text",
          text: `Spreadsheet file "${fileName}" converted to CSV, one block per tab:\n\n${text}`,
        },
      ],
      description: `${label}, ${tabs} ${tabs === 1 ? "tab" : "tabs"}`,
    };
  }

  // pdf or scan. An uploaded photo (PNG/JPG) is stored as a scan but goes
  // to the model as an image part, not as a document.
  const mediaType = mediaTypeFor(fileName);
  if (mediaType.startsWith("image/")) {
    return {
      content: [
        { type: "text", text: `Photo of a quote "${fileName}":` },
        { type: "image", image: bytes, mediaType },
      ],
      description: "photo",
    };
  }
  return {
    content: [
      { type: "text", text: `${label === "PDF" ? "PDF" : "Scanned"} file "${fileName}":` },
      { type: "file", mediaType, data: bytes, filename: fileName },
    ],
    description: label,
  };
}
