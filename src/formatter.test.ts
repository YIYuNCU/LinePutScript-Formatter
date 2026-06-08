import * as assert from "assert";
import { formatLpsDocument, parseLine, serializeLine } from "./formatter";

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
});
