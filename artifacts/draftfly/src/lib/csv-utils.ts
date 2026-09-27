export function csvCell(value: string | null | undefined): string {
  let str = value ?? "";
  str = str.replace(/\r\n|\r|\n/g, " ");
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `\t${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

export interface CsvRow {
  received: string;
  leadName: string | null | undefined;
  leadEmail: string | null | undefined;
  campaign: string;
  status: string;
  draftText: string | null | undefined;
  actionedAt: string;
}

export const CSV_HEADERS = [
  "Received",
  "Lead Name",
  "Lead Email",
  "Campaign",
  "Status",
  "Draft Text",
  "Actioned At",
] as const;

export function buildCSV(rows: CsvRow[]): string {
  const BOM = "\uFEFF";
  const headerLine = CSV_HEADERS.map(csvCell).join(",");
  const dataLines = rows.map((r) =>
    [
      csvCell(r.received),
      csvCell(r.leadName),
      csvCell(r.leadEmail),
      csvCell(r.campaign),
      csvCell(r.status),
      csvCell(r.draftText),
      csvCell(r.actionedAt),
    ].join(","),
  );
  return BOM + [headerLine, ...dataLines].join("\r\n");
}
