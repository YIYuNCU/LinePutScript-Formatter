import * as assert from "assert";
import {
  collectNamesFromLines,
  formatLineRange,
  getCompletionItems,
  getDiagnosticsForLines,
  getDocumentSymbols,
  getHoverForPosition,
  getSymbolsForLines,
  LineReader,
  normalizeVisibleRanges,
  parseLineAt,
  parseLpsLineText,
  parseWindow,
} from "./languageService";

class CountingLineReader implements LineReader {
  public readonly readLines: number[] = [];

  constructor(private readonly lines: string[]) {}

  get lineCount(): number {
    return this.lines.length;
  }

  lineAt(lineNumber: number): string {
    this.readLines.push(lineNumber);
    return this.lines[lineNumber] ?? "";
  }
}

describe("LinePutScript lazy language service", () => {
  it("parses a single line with positioned tokens", () => {
    const line = parseLpsLineText("food#meal:|price#6:|desc/n", 3);

    assert.strictEqual(line.lineName, "food");
    assert.deepStrictEqual(line.subNames, ["price"]);
    assert.strictEqual(line.tokens.some((token) => token.kind === "escape" && token.text === "/n"), true);
    assert.strictEqual(line.tokens[0].range.start.line, 3);
  });

  it("reads only the requested line", () => {
    const reader = new CountingLineReader([
      "first:|",
      "second:|sub#info:|",
      "third:|",
    ]);

    const line = parseLineAt(reader, 1);

    assert.strictEqual(line.lineName, "second");
    assert.deepStrictEqual(reader.readLines, [1]);
  });

  it("parses only visible ranges plus buffer", () => {
    const reader = new CountingLineReader([
      "0:|",
      "1:|",
      "2:|",
      "3:|",
      "4:|",
      "5:|",
    ]);

    const lines = parseWindow(reader, [{ startLine: 2, endLine: 3 }], 1);

    assert.deepStrictEqual(lines.map((line) => line.lineNumber), [1, 2, 3, 4]);
    assert.deepStrictEqual(reader.readLines, [1, 2, 3, 4]);
  });

  it("normalizes empty visible ranges to a small initial window", () => {
    const reader = new CountingLineReader(["0:|", "1:|", "2:|", "3:|"]);

    assert.deepStrictEqual(normalizeVisibleRanges(reader, [], 2), [
      { startLine: 0, endLine: 2 },
    ]);
  });

  it("returns diagnostics for parsed visible lines only", () => {
    const reader = new CountingLineReader([
      "ok:|",
      "missingSeparator",
      "| continuation",
    ]);
    const parsedLines = parseWindow(reader, [{ startLine: 1, endLine: 2 }], 0);

    const diagnostics = getDiagnosticsForLines(parsedLines);

    assert.strictEqual(diagnostics.length, 2);
    assert.strictEqual(diagnostics[0].severity, "warning");
  });

  it("hovers by parsing only the current line", () => {
    const reader = new CountingLineReader([
      "food#meal:|price#6:|desc",
      "other:|",
    ]);

    const hover = getHoverForPosition(reader, { line: 0, character: 1 });

    assert.strictEqual(hover?.contents[0], "Line name: `food`");
    assert.deepStrictEqual(reader.readLines, [0]);
  });

  it("returns fixed and local completions without scanning the whole document", () => {
    const reader = new CountingLineReader([
      "first:|name#A:|",
      "second:|price#6:|",
      "third:|",
    ]);

    const completions = getCompletionItems(reader, { line: 1, character: 3 }, ["cached"], 0);
    const labels = completions.map((item) => item.label);

    assert.strictEqual(labels.includes(":|"), true);
    assert.strictEqual(labels.includes("/n"), true);
    assert.strictEqual(labels.includes("cached"), true);
    assert.strictEqual(labels.includes("second"), true);
    assert.strictEqual(labels.includes("price"), true);
    assert.deepStrictEqual(reader.readLines, [1]);
  });

  it("builds symbols from parsed lines for lazy large-file paths", () => {
    const reader = new CountingLineReader([
      "first:|name#A:|",
      "second:|price#6:|",
      "third:|",
    ]);

    const parsedLines = parseWindow(reader, [{ startLine: 1, endLine: 1 }], 0);
    const symbols = getSymbolsForLines(parsedLines, 10);

    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0].name, "second");
    assert.strictEqual(symbols[0].children[0].name, "price");
    assert.deepStrictEqual(reader.readLines, [1]);
  });

  it("limits document symbols when scanning is allowed", () => {
    const reader = new CountingLineReader(["first:|", "second:|", "third:|"]);

    const symbols = getDocumentSymbols(reader, 2);

    assert.deepStrictEqual(symbols.map((symbol) => symbol.name), ["first", "second"]);
  });

  it("formats only the requested line range", () => {
    const reader = new CountingLineReader([
      "first:|",
      "second#info:|price#6:|",
      "third:|",
    ]);

    assert.strictEqual(formatLineRange(reader, 1, 1), "second#info:|price#6:|");
    assert.deepStrictEqual(reader.readLines, [1]);
  });

  it("collects names from already parsed lines", () => {
    const parsed = [
      parseLpsLineText("food:|price#6:|", 0),
      parseLpsLineText("drink:|price#2:|", 1),
    ];

    assert.deepStrictEqual(collectNamesFromLines(parsed).sort(), ["drink", "food", "price"]);
  });
});
