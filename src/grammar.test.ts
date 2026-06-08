import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

type Pattern = {
  match?: string;
  name?: string;
};

type GrammarRepository = {
  [key: string]: Pattern | { patterns: Pattern[] };
};

const grammar = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "syntaxes", "lps.tmLanguage.json"), "utf8")
) as { repository: GrammarRepository };
const coverageFixture = fs.readFileSync(
  path.join(__dirname, "..", "test", "coverage.lps"),
  "utf8"
);

function getPattern(name: string): RegExp {
  const entry = grammar.repository[name] as Pattern;
  assert.strictEqual(typeof entry.match, "string");
  return new RegExp(entry.match as string, "g");
}

function matches(pattern: RegExp, value: string): string[] {
  return Array.from(value.matchAll(pattern), (match) => match[0]);
}

describe("LinePutScript grammar", () => {
  it("highlights only keyed subs as sub names", () => {
    const subNamePattern = getPattern("subName");

    assert.deepStrictEqual(
      matches(subNamePattern, "line:|sub#value:|text"),
      ["sub"]
    );
  });

  it("highlights empty-info subs from the coverage fixture", () => {
    const subNamePattern = getPattern("subName");
    const itemLine = coverageFixture
      .split(/\r?\n/)
      .find((line) => line.startsWith("item5:|"));

    assert.ok(itemLine);
    assert.deepStrictEqual(
      matches(subNamePattern, itemLine as string),
      [
        "Image",
        "name",
        "itemtype",
        "Price",
        "Desc",
        "Count",
        "Data",
        "CanUse",
        "Star",
        "IsSingle",
        "Visibility",
      ]
    );
  });

  it("highlights all item subs from the coverage fixture", () => {
    const subNamePattern = getPattern("subName");
    const itemLine = coverageFixture
      .split(/\r?\n/)
      .find((line) => line.startsWith("item5:|"));

    assert.ok(itemLine);
    assert.deepStrictEqual(
      matches(subNamePattern, itemLine as string),
      [
        "Image",
        "name",
        "itemtype",
        "Price",
        "Desc",
        "Count",
        "Data",
        "CanUse",
        "Star",
        "IsSingle",
        "Visibility",
      ]
    );
  });

  it("does not highlight trailing text as a sub name", () => {
    const subNamePattern = getPattern("subName");

    assert.deepStrictEqual(
      matches(subNamePattern, "line:|sub#value:|plain text"),
      ["sub"]
    );
  });

  it("does not split /null into a /n escape", () => {
    const escapePattern = getPattern("escape");

    assert.deepStrictEqual(matches(escapePattern, "BuyHistory#/null:|"), []);
  });

  it("recognizes all supported escapes from the coverage fixture", () => {
    const escapePattern = getPattern("escape");
    const escapeLine = coverageFixture
      .split(/\r?\n/)
      .find((line) => line.startsWith("stringEscapes#"));

    assert.ok(escapeLine);
    assert.deepStrictEqual(
      matches(escapePattern, escapeLine as string),
      ["/|", "/!", "/id", "/com", "/tab", "/n", "/r", "/stop", "/equ"]
    );
  });

  it("does not mark /null values in the coverage fixture as escapes", () => {
    const escapePattern = getPattern("escape");
    const nullLines = coverageFixture
      .split(/\r?\n/)
      .filter((line) => line.includes("/null"));

    assert.ok(nullLines.length > 0);
    for (const line of nullLines) {
      const matchesInLine = Array.from(line.matchAll(escapePattern));
      for (const nullMatch of line.matchAll(/\/null/g)) {
        const nullStart = nullMatch.index ?? -1;
        const nullEnd = nullStart + "/null".length;
        const nullMatches = matchesInLine
          .filter((match) => (match.index ?? -1) >= nullStart && (match.index ?? -1) < nullEnd)
          .map((match) => match[0]);

        assert.deepStrictEqual(nullMatches, []);
      }
    }
  });

  it("still highlights standalone LPS escapes", () => {
    const escapePattern = getPattern("escape");

    assert.deepStrictEqual(
      matches(escapePattern, "desc#/n,/id,/stop,/|:|"),
      ["/n", "/id", "/stop", "/|"]
    );
  });
});
