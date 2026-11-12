// Status text colour that goes with each pastel panel colour.
// Supplier colours are stored in the database (suppliers.colour).

const onPastel: Record<string, string> = {
  "#FBBDAB": "#A3260C", // salmon
  "#B9D6FB": "#1D4ED8", // sky blue
  "#CDBDF2": "#5B21B6", // lavender
  "#BDEBD3": "#1E7A44", // mint
  "#FDE68A": "#92400E", // butter yellow
  "#E9EBEF": "#4A5368", // grey
};

/** Panel colour for files with no known supplier. */
export const UNKNOWN_PANEL = "#E9EBEF";

export function textOnPastel(panel: string): string {
  return onPastel[panel.toUpperCase()] ?? "#1B2440";
}
