import * as vscode from "vscode";

/** The extension's single logging channel. */
let channel: vscode.LogOutputChannel | undefined;

export function initLogger(): vscode.LogOutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel("MkDocs Material Studio", { log: true });
  }
  return channel;
}

export function getLogger(): vscode.LogOutputChannel {
  if (!channel) {
    return initLogger();
  }
  return channel;
}
