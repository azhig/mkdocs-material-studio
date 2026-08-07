import * as vscode from "vscode";
import type { Document } from "yaml";

/**
 * Applies the modified yaml Document to the mkdocs.yml file through a
 * WorkspaceEdit (keeping the undo history), then saves the file so that
 * mkdocs serve re-reads the configuration.
 */
export async function applyConfigDoc(configFile: vscode.Uri, doc: Document): Promise<void> {
  const document = await vscode.workspace.openTextDocument(configFile);
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    new vscode.Position(0, 0),
    document.lineAt(document.lineCount - 1).range.end,
  );
  edit.replace(configFile, fullRange, doc.toString());
  await vscode.workspace.applyEdit(edit);
  await document.save();
}
