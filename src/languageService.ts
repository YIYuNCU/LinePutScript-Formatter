import { formatLpsDocument, parseLine, serializeLine } from "./formatter";

export interface TextPosition {
  line: number;
  character: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

export interface LineReader {
  readonly lineCount: number;
  lineAt(lineNumber: number): string;
}

export interface ParsedToken {
  kind:
  | "lineName"
  | "subName"
  | "info"
  | "text"
  | "comment"
  | "subSeparator"
  | "infoSeparator"
  | "escape";
  text: string;
  range: TextRange;
  infoOwner?: "line" | "sub";
}

export interface ParsedLine {
  lineNumber: number;
  rawText: string;
  lineName: string;
  lineInfo: string;
  text: string;
  comment: string;
  tokens: ParsedToken[];
  subNames: string[];
}

export interface LpsDiagnostic {
  message: string;
  range: TextRange;
  severity: "warning" | "error";
}

export interface LpsCompletionItem {
  label: string;
  detail: string;
  insertText: string;
  kind:
  | "field"
  | "property"
  | "operator"
  | "snippet"
  | "constant";
}

export interface LpsHover {
  contents: string[];
  range: TextRange;
}

export interface LpsSymbol {
  name: string;
  detail: string;
  range: TextRange;
  children: LpsSymbol[];
}

export interface VisibleRange {
  startLine: number;
  endLine: number;
}

const escapeDescriptions = new Map<string, string>([
  ["/stop", "Escaped sub separator `:|`."],
  ["/equ", "Escaped equals sign `=`."],
  ["/tab", "Escaped tab character."],
  ["/n", "Escaped newline character."],
  ["/r", "Escaped carriage return."],
  ["/id", "Escaped info separator `#`."],
  ["/com", "Escaped comma `,`."],
  ["/!", "Escaped slash `/`."],
  ["/|", "Escaped pipe `|`."],
]);

const fixedCompletions: LpsCompletionItem[] = [
  {
    label: ":|",
    detail: "Sub separator",
    insertText: ":|",
    kind: "operator",
  },
  {
    label: "#",
    detail: "Name/info separator",
    insertText: "#",
    kind: "operator",
  },
  {
    label: "///",
    detail: "Line comment marker",
    insertText: "///",
    kind: "snippet",
  },
  ...Array.from(escapeDescriptions.keys()).map((escape): LpsCompletionItem => ({
    label: escape,
    detail: "LPS escape sequence",
    insertText: escape,
    kind: "constant",
  })),
];

function position(line: number, character: number): TextPosition {
  return { line, character };
}

function range(
  line: number,
  startCharacter: number,
  endCharacter: number
): TextRange {
  return {
    start: position(line, startCharacter),
    end: position(line, endCharacter),
  };
}

function contains(rangeValue: TextRange, target: TextPosition): boolean {
  if (target.line !== rangeValue.start.line || target.line !== rangeValue.end.line) {
    return false;
  }

  return target.character >= rangeValue.start.character &&
    target.character <= rangeValue.end.character;
}

function addToken(
  tokens: ParsedToken[],
  lineNumber: number,
  kind: ParsedToken["kind"],
  text: string,
  startCharacter: number,
  infoOwner?: ParsedToken["infoOwner"]
) {
  tokens.push({
    kind,
    text,
    range: range(lineNumber, startCharacter, startCharacter + text.length),
    infoOwner,
  });
}

function addEscapes(
  tokens: ParsedToken[],
  lineNumber: number,
  value: string,
  offset: number
) {
  const escapePattern = /\/(?:stop|equ|tab|n|r|id|com|!|\|)/g;
  let match: RegExpExecArray | null;

  while ((match = escapePattern.exec(value)) !== null) {
    addToken(tokens, lineNumber, "escape", match[0], offset + match.index);
  }
}

function parseSegment(
  tokens: ParsedToken[],
  lineNumber: number,
  segment: string,
  segmentStart: number,
  nameKind: "lineName" | "subName",
  infoOwner: ParsedToken["infoOwner"]
): { name: string; info: string } {
  const hashIndex = segment.indexOf("#");

  if (hashIndex === -1) {
    if (segment.length > 0) {
      addToken(tokens, lineNumber, nameKind, segment, segmentStart);
    }

    return {
      name: segment,
      info: "",
    };
  }

  const name = segment.substring(0, hashIndex);
  const info = segment.substring(hashIndex + 1);
  if (name.length > 0) {
    addToken(tokens, lineNumber, nameKind, name, segmentStart);
  }

  addToken(tokens, lineNumber, "infoSeparator", "#", segmentStart + hashIndex);
  if (info.length > 0) {
    addToken(tokens, lineNumber, "info", info, segmentStart + hashIndex + 1, infoOwner);
    addEscapes(tokens, lineNumber, info, segmentStart + hashIndex + 1);
  }

  return { name, info };
}

export function parseLpsLineText(rawText: string, lineNumber: number): ParsedLine {
  const tokens: ParsedToken[] = [];
  const commentIndex = rawText.indexOf("///");
  const body = commentIndex === -1 ? rawText : rawText.substring(0, commentIndex);
  const comment = commentIndex === -1 ? "" : rawText.substring(commentIndex + 3);

  if (commentIndex !== -1) {
    addToken(tokens, lineNumber, "comment", rawText.substring(commentIndex), commentIndex);
  }

  const parsed = parseLine(rawText);
  const parts = body.split(":|");
  const head = parseSegment(tokens, lineNumber, parts[0] ?? "", 0, "lineName", "line");
  let cursor = parts[0]?.length ?? 0;
  const subNames: string[] = [];

  for (let index = 1; index < parts.length; index++) {
    addToken(tokens, lineNumber, "subSeparator", ":|", cursor);
    cursor += 2;

    const segment = parts[index] ?? "";
    if (index < parts.length - 1) {
      const sub = parseSegment(tokens, lineNumber, segment, cursor, "subName", "sub");
      subNames.push(sub.name);
    } else if (segment.length > 0) {
      addToken(tokens, lineNumber, "text", segment, cursor);
      addEscapes(tokens, lineNumber, segment, cursor);
    }

    cursor += segment.length;
  }

  return {
    lineNumber,
    rawText,
    lineName: head.name,
    lineInfo: head.info,
    text: parsed.text,
    comment,
    tokens,
    subNames,
  };
}

export function parseLineAt(reader: LineReader, lineNumber: number): ParsedLine {
  return parseLpsLineText(reader.lineAt(lineNumber), lineNumber);
}

export function normalizeVisibleRanges(
  reader: LineReader,
  visibleRanges: VisibleRange[],
  bufferLines: number
): VisibleRange[] {
  if (reader.lineCount === 0) {
    return [];
  }

  const safeBufferLines = Math.max(0, bufferLines);
  if (visibleRanges.length === 0) {
    return [{
      startLine: 0,
      endLine: Math.min(reader.lineCount - 1, safeBufferLines),
    }];
  }

  return visibleRanges.map((visibleRange) => ({
    startLine: Math.max(0, visibleRange.startLine - safeBufferLines),
    endLine: Math.min(reader.lineCount - 1, visibleRange.endLine + safeBufferLines),
  }));
}

export function parseWindow(
  reader: LineReader,
  visibleRanges: VisibleRange[],
  bufferLines: number
): ParsedLine[] {
  const parsedLines: ParsedLine[] = [];
  const seen = new Set<number>();

  for (const visibleRange of normalizeVisibleRanges(reader, visibleRanges, bufferLines)) {
    for (let lineNumber = visibleRange.startLine; lineNumber <= visibleRange.endLine; lineNumber++) {
      if (!seen.has(lineNumber)) {
        seen.add(lineNumber);
        parsedLines.push(parseLineAt(reader, lineNumber));
      }
    }
  }

  return parsedLines;
}

export function getTokenAt(line: ParsedLine, target: TextPosition): ParsedToken | undefined {
  return line.tokens.find((token) => contains(token.range, target));
}

export function getDiagnosticsForLines(lines: ParsedLine[]): LpsDiagnostic[] {
  const diagnostics: LpsDiagnostic[] = [];

  for (const line of lines) {
    const trimmed = line.rawText.trim();
    if (trimmed.length === 0) {
      continue;
    }

    if (line.rawText.startsWith("|") || line.rawText.startsWith(":")) {
      diagnostics.push({
        message: "This continuation marker is parsed with the previous logical LPS line.",
        range: range(line.lineNumber, 0, 1),
        severity: "warning",
      });
      continue;
    }

    if (line.lineName.length === 0 && line.comment.length === 0) {
      diagnostics.push({
        message: "LPS line name is empty.",
        range: range(line.lineNumber, 0, Math.max(1, line.rawText.length)),
        severity: "error",
      });
    }

    if (!line.rawText.includes(":|") && line.comment.length === 0) {
      diagnostics.push({
        message: "LPS line has no `:|` separator; it will be parsed as name-only text.",
        range: range(line.lineNumber, 0, line.rawText.length),
        severity: "warning",
      });
    }
  }

  return diagnostics;
}

export function getHoverForPosition(
  reader: LineReader,
  target: TextPosition
): LpsHover | undefined {
  const line = parseLineAt(reader, target.line);
  const token = getTokenAt(line, target);
  if (!token) {
    return undefined;
  }

  switch (token.kind) {
    case "lineName":
      return {
        range: token.range,
        contents: [`Line name: \`${token.text}\``, `Info: \`${line.lineInfo}\``],
      };
    case "subName":
      return {
        range: token.range,
        contents: [`Sub name: \`${token.text}\``],
      };
    case "info":
      return {
        range: token.range,
        contents: [`${token.infoOwner === "line" ? "Line" : "Sub"} info: \`${token.text}\``],
      };
    case "text":
      return {
        range: token.range,
        contents: [`Line text: \`${token.text}\``],
      };
    case "comment":
      return {
        range: token.range,
        contents: ["LPS comment. The first `///` splits comments from data."],
      };
    case "subSeparator":
      return {
        range: token.range,
        contents: ["Sub separator `:|`."],
      };
    case "infoSeparator":
      return {
        range: token.range,
        contents: ["Info separator `#`."],
      };
    case "escape":
      return {
        range: token.range,
        contents: [escapeDescriptions.get(token.text) ?? "LPS escape sequence."],
      };
  }
}

export function getCompletionItems(
  reader: LineReader,
  target: TextPosition,
  cachedNames: Iterable<string>,
  localRadius: number
): LpsCompletionItem[] {
  const items = new Map<string, LpsCompletionItem>();
  const addItem = (item: LpsCompletionItem) => items.set(`${item.kind}:${item.label}`, item);

  for (const completion of fixedCompletions) {
    addItem(completion);
  }

  for (const name of cachedNames) {
    if (name !== "") {
      addItem({
        label: name,
        detail: "Known LPS name",
        insertText: name,
        kind: "field",
      });
    }
  }

  const startLine = Math.max(0, target.line - localRadius);
  const endLine = Math.min(reader.lineCount - 1, target.line + localRadius);
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
    const line = parseLineAt(reader, lineNumber);
    if (line.lineName !== "") {
      addItem({
        label: line.lineName,
        detail: "Line name in nearby LPS text",
        insertText: line.lineName,
        kind: "field",
      });
    }

    for (const subName of line.subNames) {
      if (subName !== "") {
        addItem({
          label: subName,
          detail: "Sub name in nearby LPS text",
          insertText: subName,
          kind: "property",
        });
      }
    }
  }

  return Array.from(items.values());
}

export function getDocumentSymbols(
  reader: LineReader,
  maxSymbols: number
): LpsSymbol[] {
  const parsedLines: ParsedLine[] = [];

  for (
    let lineNumber = 0;
    lineNumber < reader.lineCount && parsedLines.length < maxSymbols;
    lineNumber++
  ) {
    parsedLines.push(parseLineAt(reader, lineNumber));
  }

  return getSymbolsForLines(parsedLines, maxSymbols);
}

export function getSymbolsForLines(
  lines: ParsedLine[],
  maxSymbols: number
): LpsSymbol[] {
  const symbols: LpsSymbol[] = [];

  for (const line of lines) {
    if (symbols.length >= maxSymbols || line.lineName === "") {
      continue;
    }

    const lineNameToken = line.tokens.find((token) => token.kind === "lineName");
    const children: LpsSymbol[] = [];
    for (const token of line.tokens) {
      if (token.kind === "subName") {
        children.push({
          name: token.text,
          detail: "LPS sub",
          range: token.range,
          children: [],
        });
      }
    }

    symbols.push({
      name: line.lineName,
      detail: "LPS line",
      range: lineNameToken?.range ?? range(line.lineNumber, 0, line.rawText.length),
      children,
    });
  }

  return symbols;
}

export function formatLineRange(reader: LineReader, startLine: number, endLine: number): string {
  const lines: string[] = [];
  const safeStart = Math.max(0, startLine);
  const safeEnd = Math.min(reader.lineCount - 1, endLine);

  for (let lineNumber = safeStart; lineNumber <= safeEnd; lineNumber++) {
    lines.push(reader.lineAt(lineNumber));
  }

  return formatLpsDocument(lines.join("\n"));
}

export function collectNamesFromLines(lines: ParsedLine[]): string[] {
  const names = new Set<string>();
  for (const line of lines) {
    if (line.lineName !== "") {
      names.add(line.lineName);
    }

    for (const subName of line.subNames) {
      if (subName !== "") {
        names.add(subName);
      }
    }
  }

  return Array.from(names);
}

export function serializeParsedLine(line: ParsedLine): string {
  return serializeLine({
    name: line.lineName,
    info: line.lineInfo,
    comments: line.comment,
    subs: line.subNames.map((name) => ({ name, info: "" })),
    text: line.text,
  });
}
