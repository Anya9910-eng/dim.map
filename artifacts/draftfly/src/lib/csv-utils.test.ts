import { describe, it, expect } from "vitest";
import { csvCell, buildCSV, CSV_HEADERS } from "./csv-utils";

describe("csvCell", () => {
  it("wraps a plain string in double quotes", () => {
    expect(csvCell("hello")).toBe('"hello"');
  });

  it("treats null as an empty string", () => {
    expect(csvCell(null)).toBe('""');
  });

  it("treats undefined as an empty string", () => {
    expect(csvCell(undefined)).toBe('""');
  });

  it("replaces a \\n newline with a space", () => {
    const result = csvCell("line one\nline two");
    expect(result).toBe('"line one line two"');
    expect(result).not.toContain("\n");
  });

  it("replaces a \\r\\n newline with a space", () => {
    const result = csvCell("line one\r\nline two");
    expect(result).toBe('"line one line two"');
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
  });

  it("replaces a bare \\r with a space", () => {
    const result = csvCell("line one\rline two");
    expect(result).toBe('"line one line two"');
    expect(result).not.toContain("\r");
  });

  it("escapes internal double quotes by doubling them", () => {
    expect(csvCell('say "hello"')).toBe('"say ""hello"""');
  });

  it("prefixes formula-injection characters with a tab", () => {
    for (const char of ["=", "+", "-", "@"]) {
      const result = csvCell(`${char}CMD`);
      expect(result.startsWith('"\t')).toBe(true);
    }
  });
});

describe("buildCSV", () => {
  it("starts with the UTF-8 BOM (\\uFEFF)", () => {
    const csv = buildCSV([]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("uses \\r\\n to separate rows", () => {
    const csv = buildCSV([
      {
        received: "Jan 1, 2026",
        leadName: "Alice",
        leadEmail: "alice@example.com",
        campaign: "Camp A",
        status: "sent",
        draftText: "Hello",
        actionedAt: "Jan 2, 2026",
      },
    ]);
    const withoutBom = csv.slice(1);
    const lines = withoutBom.split("\r\n");
    expect(lines.length).toBe(2);
  });

  it("does NOT use bare \\n as a row separator", () => {
    const csv = buildCSV([
      {
        received: "Jan 1, 2026",
        leadName: "Bob",
        leadEmail: "bob@example.com",
        campaign: "Camp B",
        status: "sent",
        draftText: "Hi",
        actionedAt: "",
      },
    ]);
    const withoutBom = csv.slice(1);
    const bareNewlines = withoutBom.replace(/\r\n/g, "").includes("\n");
    expect(bareNewlines).toBe(false);
  });

  it("includes the exact column headers unchanged", () => {
    const csv = buildCSV([]);
    const withoutBom = csv.slice(1);
    const headerLine = withoutBom.split("\r\n")[0];
    const expectedHeaders = CSV_HEADERS.map((h) => `"${h}"`).join(",");
    expect(headerLine).toBe(expectedHeaders);
  });

  it("serialises a cell containing \\n as a space, not a literal newline", () => {
    const csv = buildCSV([
      {
        received: "Jan 1, 2026",
        leadName: "Charlie",
        leadEmail: "c@example.com",
        campaign: "Camp C",
        status: "sent",
        draftText: "Line one\nLine two",
        actionedAt: "",
      },
    ]);
    expect(csv).toContain("Line one Line two");
    const withoutBom = csv.slice(1);
    const rows = withoutBom.split("\r\n");
    expect(rows.length).toBe(2);
  });

  it("produces two \\r\\n-separated rows for two data rows", () => {
    const csv = buildCSV([
      {
        received: "A",
        leadName: "Alice",
        leadEmail: "a@a.com",
        campaign: "C1",
        status: "sent",
        draftText: "Hi",
        actionedAt: "",
      },
      {
        received: "B",
        leadName: "Bob",
        leadEmail: "b@b.com",
        campaign: "C2",
        status: "pending",
        draftText: "Hey",
        actionedAt: "",
      },
    ]);
    const withoutBom = csv.slice(1);
    const lines = withoutBom.split("\r\n");
    expect(lines.length).toBe(3);
  });
});
