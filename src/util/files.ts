import * as vscode from "vscode";

/**
 * Is there a file at this path? We ask VS Code rather than node:fs — a workspace
 * may live on a remote or in a virtual file system, and there `fs.existsSync`
 * would answer for the wrong machine.
 */
export async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(file));
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}
