// How file names appear on screen. Shared by the Inbox, Agent run and the
// agent's own step lines. No imports, safe in the browser.

/**
 * Sample files start with their number ("06_..."), and the held-back file
 * with "16_HELD_BACK_"; the designs show the name without either.
 */
export function displayFileName(f: { file_name: string; is_upload: boolean }): string {
  return f.is_upload ? f.file_name : f.file_name.replace(/^\d+_(?:HELD_BACK_)?/, "");
}

/** "Swift Haul Ltd – Swift_Haul_rates_Nov.xlsx" or "Unknown sender – …". */
export function fileCardTitle(f: {
  file_name: string;
  is_upload: boolean;
  supplier_name: string | null;
}): string {
  return `${f.supplier_name ?? "Unknown sender"} – ${displayFileName(f)}`;
}
