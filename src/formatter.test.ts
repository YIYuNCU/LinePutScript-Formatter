import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { formatLpsDocument, parseLine, serializeLine } from "./formatter";

const coverageFixture = fs.readFileSync(
  path.join(__dirname, "..", "test", "coverage.lps"),
  "utf8"
);

describe("LinePutScript formatter", () => {
  it("keeps compact output unchanged", () => {
    const input = "line#info:|sub#value:|text";

    assert.strictEqual(formatLpsDocument(input), input);
  });

  it("normalizes CRLF, empty lines, and multiple logical lines", () => {
    assert.strictEqual(
      formatLpsDocument("\r\nmoney#10500:|\r\n\r\ncomputer:|name#pc:|\r\n"),
      "money#10500:|\ncomputer:|name#pc:|"
    );
  });

  it("splits name and info on the first hash only", () => {
    assert.strictEqual(
      formatLpsDocument("line#a#b:|sub#c#d:|text"),
      "line#a#b:|sub#c#d:|text"
    );
  });

  it("preserves comments after the first triple slash", () => {
    const line = parseLine("test#info:|value///comment///tail");

    assert.strictEqual(line.comments, "comment///tail");
    assert.strictEqual(serializeLine(line), "test#info:|value///comment///tail");
  });

  it("matches C# handling of a full comment-looking line", () => {
    assert.strictEqual(formatLpsDocument("///comment"), "///comment");
  });

  it("converts text newline continuation to slash-n", () => {
    assert.strictEqual(
      formatLpsDocument("detail:| first:\n| second"),
      "detail:| first/n second"
    );
  });

  it("removes direct continuation newline", () => {
    assert.strictEqual(
      formatLpsDocument("detail:| first:\n: second"),
      "detail:| first second"
    );
  });

  it("preserves empty info and empty text", () => {
    assert.strictEqual(
      formatLpsDocument("line:|sub:|"),
      "line:|sub:|"
    );
  });

  it("formats the coverage fixture using C# compact document rules", () => {
    const formatted = formatLpsDocument(coverageFixture);

    assert.strictEqual(formatted.includes("multiText:|第一行/n第二行"), true);
    assert.strictEqual(formatted.includes("multiJoin:|第一段第二段"), true);
    assert.strictEqual(formatted.includes("Image#/null:|"), true);
    assert.strictEqual(formatted.includes("Data:|CanUse#False:|"), true);
    assert.strictEqual(formatted.includes("stringEscapes#pipe/|,slash/!,hash/id,comma/com,tab/tab,newline/n,carriage/r,stop/stop,equal/equ:|"), true);
    assert.strictEqual(formatted.includes("convertedObject:|tc#/null:|intlist#10,20,30,40,50:|"), true);
    assert.strictEqual(formatted.includes("dictionaryLine:|1#2:|3#4:|5#6:|"), true);
    assert.strictEqual(formatted.includes("food:|name#ab钙奶:|type#Drink:|"), true);
    assert.strictEqual(formatted.includes("serializedLine#deflinename:/!|Name/idworkone:/!|"), true);
    assert.strictEqual(formatted.includes("commented#info:|sub#value:|text///注释内容///尾部保留"), true);
  });
});
