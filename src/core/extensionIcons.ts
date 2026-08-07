// The installed extension's icon pack, opened once.
//
// Three places want icons — the renderer, the site header's logo and the
// picker's batches — and each would otherwise hold its own descriptor and its
// own copy of the 0.4 MB index.

import * as vscode from "vscode";
import { openIconPack, type IconPack } from "./iconPack";

let shared: IconPack | undefined;
let registered = false;

/** The pack, opened on first use. */
export function iconPackFor(extensionUri: vscode.Uri): IconPack {
  shared ??= openIconPack(vscode.Uri.joinPath(extensionUri, "assets", "icons").fsPath);
  return shared;
}

/** The same pack, with its descriptor released when the extension shuts down. */
export function extensionIconPack(context: vscode.ExtensionContext): IconPack {
  const pack = iconPackFor(context.extensionUri);
  if (!registered) {
    registered = true;
    context.subscriptions.push({
      dispose: () => {
        pack.dispose();
        shared = undefined;
        registered = false;
      },
    });
  }
  return pack;
}
