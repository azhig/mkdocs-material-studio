import { type FieldValues } from "./components";

/**
 * Reverse parsing of a preview block into the form model (for click-to-edit, M6).
 *
 * Only those blocks are supported whose form fully describes the content while
 * the generator restores the original text without loss: admonition and code
 * block. For the other types undefined is returned — the calling code then just
 * jumps to the source line instead of substituting the block.
 *
 * Replacement safety: parsing is allowed only with a zero base indent (the
 * generators lay the block out from column 0) and a canonical fence/marker form.
 * Any doubt → undefined, so as not to corrupt the file.
 */
export interface ParsedBlock {
  id: string;
  values: FieldValues;
}

export function parseBlock(text: string, blockType: string | undefined): ParsedBlock | undefined {
  switch (blockType) {
    case "admonition":
      return parseAdmonition(text);
    case "code":
      return parseCode(text);
    default:
      return undefined;
  }
}

const ADMONITION_HEAD_RE = /^(\s*)(!{3}|\?{3}\+?)\s+(.*)$/;

function parseAdmonition(raw: string): ParsedBlock | undefined {
  const lines = raw.replace(/\n$/, "").split("\n");
  if (lines.length === 0) {
    return undefined;
  }
  const head = ADMONITION_HEAD_RE.exec(lines[0]);
  if (!head) {
    return undefined;
  }
  // The generator always writes the block from column 0; nested (indented) ones are left alone.
  if (head[1].length !== 0) {
    return undefined;
  }

  const marker = head[2];
  const collapsible = marker === "???" ? "collapsed" : marker === "???+" ? "expanded" : "no";

  const rest = head[3].trim();
  const titleMatch = /"([^"]*)"\s*$/.exec(rest);
  let title = "";
  let typesPart = rest;
  if (titleMatch) {
    title = titleMatch[1];
    typesPart = rest.slice(0, titleMatch.index).trim();
  }
  const classes = typesPart ? typesPart.split(/\s+/) : [];
  // The form holds exactly one type; blocks with extra classes (e.g. `note inline`)
  // are not edited, so the classes are not lost on regeneration.
  if (classes.length !== 1) {
    return undefined;
  }

  const contentIndent = 4;
  const body = lines.slice(1);
  const content: string[] = [];
  for (const line of body) {
    if (line.trim() === "") {
      content.push("");
      continue;
    }
    if (leadingSpaces(line) < contentIndent) {
      return undefined; // unexpected indent — safer not to edit
    }
    content.push(line.slice(contentIndent));
  }

  return {
    id: "admonition",
    values: { type: classes[0], title, collapsible, content: content.join("\n") },
  };
}

function parseCode(raw: string): ParsedBlock | undefined {
  const lines = raw.replace(/\n$/, "").split("\n");
  if (lines.length < 2) {
    return undefined;
  }
  const open = /^(`{3,}|~{3,})(.*)$/.exec(lines[0]);
  if (!open) {
    return undefined;
  }
  // The generator uses exactly three backticks; other fences (~~~, ````) and the
  // braced info-string form are not converted, so the syntax is not changed.
  if (open[1] !== "```") {
    return undefined;
  }
  const info = open[2].trim();
  if (/^\{.*\}$/.test(info)) {
    return undefined;
  }
  const close = lines[lines.length - 1];
  if (!/^`{3,}\s*$/.test(close)) {
    return undefined;
  }

  const firstToken = info.split(/\s+/)[0] ?? "";
  const language = firstToken && !firstToken.includes("=") ? firstToken : "";
  const titleMatch = /title="([^"]*)"/.exec(info);
  const hlMatch = /hl_lines="([^"]*)"/.exec(info);
  const linenums = /(?:^|\s)linenums="?\d/.test(info);
  const content = lines.slice(1, -1).join("\n");

  return {
    id: "code",
    values: {
      language,
      title: titleMatch ? titleMatch[1] : "",
      linenums,
      hl_lines: hlMatch ? hlMatch[1] : "",
      content,
    },
  };
}

function leadingSpaces(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === " ") {
    i++;
  }
  return i;
}
