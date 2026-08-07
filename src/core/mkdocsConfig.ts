import * as vscode from "vscode";
import { parseMkdocsConfig, type MkdocsConfig } from "./mkdocsConfigParse";
import type { Document } from "yaml";

// Re-export of the pure model, so the rest of the code imports from a single place.
export * from "./mkdocsConfigParse";

/** Reads and parses mkdocs.yml from the file system. */
export async function readMkdocsConfig(
  configFile: vscode.Uri,
): Promise<{ config: MkdocsConfig; doc: Document }> {
  const bytes = await vscode.workspace.fs.readFile(configFile);
  const text = Buffer.from(bytes).toString("utf8");
  return parseMkdocsConfig(text);
}
