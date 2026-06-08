import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseDocument } from "./formatter";
import {
  collectNamesFromLines,
  getCompletionItems,
  getDiagnosticsForLines,
  getDocumentSymbols,
  LineReader,
  parseLineAt,
  parseLpsLineText,
  parseWindow,
} from "./languageService";

class FixtureLineReader implements LineReader {
  private readonly lines: string[];

  constructor(text: string) {
    this.lines = text.replace(/\r/g, "").split("\n");
  }

  get lineCount(): number {
    return this.lines.length;
  }

  lineAt(lineNumber: number): string {
    return this.lines[lineNumber] ?? "";
  }
}

const coverageFixture = fs.readFileSync(
  path.join(__dirname, "..", "test", "coverage.lps"),
  "utf8"
);
const foodFixture = fs.readFileSync(path.join(__dirname, "..", "test", "food.lps"), "utf8");
const vupFixture = fs.readFileSync(path.join(__dirname, "..", "test", "vup.lps"), "utf8");
const baseFixture = fs.readFileSync(path.join(__dirname, "..", "test", "Base2306.lps"), "utf8");

describe("LinePutScript fixture coverage", () => {
  it("covers document-level LinePutScript load rules", () => {
    const lines = parseDocument(coverageFixture);
    const names = lines.map((line) => line.name);
    const hashInfo = lines.find((line) => line.name === "hashInfo");

    assert.strictEqual(names.includes("multiText"), true);
    assert.strictEqual(names.includes("multiJoin"), true);
    assert.strictEqual(lines.find((line) => line.name === "multiText")?.text, "第一行/n第二行");
    assert.strictEqual(lines.find((line) => line.name === "multiJoin")?.text, "第一段第二段");
    assert.strictEqual(hashInfo?.info, "line#a#b");
    assert.strictEqual(hashInfo?.subs[0].info, "c#d");
    assert.strictEqual(hashInfo?.text, "text#kept");
  });

  it("covers values, line/sub/comment/null and empty-info cases", () => {
    const lines = parseDocument(coverageFixture);
    const typedValues = lines.find((line) => line.name === "typedValues");
    const betterBuy = lines.find((line) => line.name === "BetterBuyData");
    const item = lines.find((line) => line.name === "item5");
    const literalNull = lines.find((line) => line.name === "literalNull");
    const comment = lines.find((line) => line.name === "commented");
    const commentOnly = lines.find((line) => line.name === "");

    assert.deepStrictEqual(
      typedValues?.subs.map((sub) => `${sub.name}=${sub.info}`),
      [
        "int=10",
        "int64=693937152000000000",
        "double=3.1415926",
        "storedFloat=3141592600",
        "boolTrue=True",
        "boolFalse=False",
        "negative=-0.5",
      ]
    );
    assert.deepStrictEqual(
      betterBuy?.subs.map((sub) => `${sub.name}=${sub.info}`),
      ["LastDiscont=0", "Discont=", "ScheduleBuyItems=", "BuyHistory=/null"]
    );
    assert.deepStrictEqual(
      item?.subs.map((sub) => sub.name),
      ["Image", "name", "itemtype", "Price", "Desc", "Count", "Data", "CanUse", "Star", "IsSingle", "Visibility"]
    );
    assert.deepStrictEqual(
      literalNull?.subs.map((sub) => `${sub.name}=${sub.info}`),
      ["none=/null", "note=annulling /null values"]
    );
    assert.strictEqual(comment?.comments, "注释内容///尾部保留");
    assert.strictEqual(commentOnly?.comments, "commentOnly#notARealLine:|");
  });

  it("covers converter-style list, dictionary and serialized line values", () => {
    const lines = parseDocument(coverageFixture);
    const converted = lines.find((line) => line.name === "convertedObject");
    const dictionary = lines.find((line) => line.name === "dictionaryLine");
    const serialized = lines.find((line) => line.name === "serializedLine");

    assert.strictEqual(converted?.subs.find((sub) => sub.name === "intlist")?.info, "10,20,30,40,50");
    assert.strictEqual(
      converted?.subs.find((sub) => sub.name === "stringlistgetset")?.info,
      "a:/!!/!|a,b/!idb,c/!!/!|/!!/!|c"
    );
    assert.strictEqual(converted?.subs.find((sub) => sub.name === "intdict")?.info, "1=2/n3=4/n5=6");
    assert.deepStrictEqual(
      dictionary?.subs.map((sub) => `${sub.name}=${sub.info}`),
      ["1=2", "3=4", "5=6"]
    );
    assert.strictEqual(serialized?.info.includes("/!|Name/idworkone"), true);
    assert.strictEqual(serialized?.text, "");
  });

  it("covers lazy language service names and symbols", () => {
    const reader = new FixtureLineReader(coverageFixture);
    const parsedLines = parseWindow(reader, [{ startLine: 0, endLine: reader.lineCount - 1 }], 0);
    const names = collectNamesFromLines(parsedLines);
    const symbols = getDocumentSymbols(reader, 100);

    assert.strictEqual(names.includes("Image"), true);
    assert.strictEqual(names.includes("Data"), true);
    assert.strictEqual(names.includes("CanUse"), true);
    assert.strictEqual(names.includes("StrengthDrink"), true);
    assert.strictEqual(names.includes("ButtonForeground"), true);
    assert.strictEqual(symbols.some((symbol) => symbol.name === "item5"), true);
  });

  it("covers completion candidates from the coverage fixture", () => {
    const reader = new FixtureLineReader(coverageFixture);
    const itemLine = coverageFixture.split(/\r?\n/).findIndex((line) => line.startsWith("item5:|"));
    const completions = getCompletionItems(reader, { line: itemLine, character: 3 }, [], 0);
    const labels = completions.map((completion) => completion.label);

    assert.strictEqual(labels.includes("item5"), true);
    assert.strictEqual(labels.includes("Image"), true);
    assert.strictEqual(labels.includes("Data"), true);
    assert.strictEqual(labels.includes("/n"), true);
  });

  it("does not create escape tokens inside /null values", () => {
    const parsed = parseLpsLineText("literalNull#value/null:|none#/null:|", 0);
    const escapes = parsed.tokens.filter((token) => token.kind === "escape").map((token) => token.text);

    assert.deepStrictEqual(escapes, []);
  });

  it("covers diagnostics on intentional edge cases only", () => {
    const reader = new FixtureLineReader(coverageFixture);
    const parsedLines = parseWindow(reader, [{ startLine: 0, endLine: reader.lineCount - 1 }], 0);
    const diagnostics = getDiagnosticsForLines(parsedLines);

    assert.strictEqual(diagnostics.some((diagnostic) => diagnostic.message.includes("continuation marker")), true);
  });

  it("covers real fixture patterns from food, vup and base files", () => {
    const foodReader = new FixtureLineReader(foodFixture);
    const foodLine = parseLineAt(foodReader, 0);
    const vupReader = new FixtureLineReader(vupFixture);
    const workLineNumber = vupFixture.split(/\r?\n/).findIndex((line) => line.startsWith("work:|"));
    const workLine = parseLineAt(vupReader, workLineNumber);
    const baseLine = parseDocument(baseFixture)[0];

    assert.strictEqual(foodLine.lineName, "food");
    assert.strictEqual(foodLine.subNames.includes("StrengthDrink"), true);
    assert.strictEqual(foodLine.subNames.includes("desc"), true);
    assert.strictEqual(workLine.lineName, "work");
    assert.strictEqual(workLine.subNames.includes("ButtonForeground"), true);
    assert.strictEqual(baseLine.name.includes("尝试加载游戏MOD"), true);
    assert.strictEqual(baseLine.info.includes("Try loading game MOD"), true);
  });
});
