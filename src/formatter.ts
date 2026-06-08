export interface LpsSub {
  name: string;
  info: string;
}

export interface LpsLine extends LpsSub {
  comments: string;
  subs: LpsSub[];
  text: string;
}

function splitFirst(value: string, separator: string): [string, string?] {
  const index = value.indexOf(separator);
  if (index === -1) {
    return [value];
  }

  return [
    value.substring(0, index),
    value.substring(index + separator.length),
  ];
}

function trimNewLines(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && value.charCodeAt(start) === 10) {
    start++;
  }

  while (end > start && value.charCodeAt(end - 1) === 10) {
    end--;
  }

  return value.substring(start, end);
}

function parseSub(value: string): LpsSub {
  const [name, info] = splitFirst(value, "#");
  return {
    name,
    info: info ?? "",
  };
}

export function parseLine(value: string): LpsLine {
  const [body, comments] = splitFirst(value, "///");
  const parts = body.split(":|");
  const head = parseSub(parts[0] ?? "");
  const subs: LpsSub[] = [];

  for (let index = 1; index < parts.length - 1; index++) {
    subs.push(parseSub(parts[index]));
  }

  return {
    ...head,
    comments: comments ?? "",
    subs,
    text: parts[parts.length - 1] ?? "",
  };
}

function serializeSub(sub: LpsSub): string {
  const body = sub.info === "" ? sub.name : `${sub.name}#${sub.info}`;
  return `${body}:|`;
}

export function serializeLine(line: LpsLine): string {
  let result = line.info === "" ? line.name : `${line.name}#${line.info}`;

  if (result.length !== 0) {
    result += ":|";
  }

  for (const sub of line.subs) {
    result += serializeSub(sub);
  }

  result += line.text;

  if (line.comments !== "") {
    result += `///${line.comments}`;
  }

  return result;
}

export function parseDocument(value: string): LpsLine[] {
  const normalized = trimNewLines(
    value
      .replace(/\r/g, "")
      .split(":\n|")
      .join("/n")
      .split(":\n:")
      .join("")
  );

  if (normalized === "") {
    return [];
  }

  return normalized
    .split("\n")
    .filter((line) => line.length !== 0)
    .map(parseLine);
}

export function formatLpsDocument(value: string): string {
  return parseDocument(value).map(serializeLine).join("\n");
}
