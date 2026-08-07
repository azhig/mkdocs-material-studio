// The extension host as a test sees it: a webview panel that records what was
// posted to it and lets a test post back, and the dependencies a provider is
// constructed with.
//
// The panel is deliberately faithful about one thing — messages go out through
// postMessage and come in through the handler registered with
// onDidReceiveMessage, asynchronously — because that is the whole protocol.

import * as vscode from "vscode";
import type { ProjectService } from "../../src/core/projectService";
import type { FallbackRenderFn } from "../../src/preview/fallbackRenderer";
import type { InsertPanel } from "../../src/wizards/insertPanel";

/** Anything the webview was told. */
export type PostedMessage = { type: string } & Record<string, unknown>;

export class FakeWebviewPanel {
  readonly posted: PostedMessage[] = [];
  visible = true;
  private messageHandlers: ((msg: unknown) => void)[] = [];
  private disposeHandlers: (() => void)[] = [];

  readonly webview = {
    html: "",
    options: {} as Record<string, unknown>,
    cspSource: "vscode-webview://test",
    asWebviewUri: (uri: vscode.Uri): vscode.Uri =>
      vscode.Uri.parse(`https://file+.vscode-resource/${uri.path.replace(/^\//, "")}`),
    postMessage: (msg: PostedMessage): Promise<boolean> => {
      this.posted.push(msg);
      return Promise.resolve(true);
    },
    onDidReceiveMessage: (handler: (msg: unknown) => void): vscode.Disposable => {
      this.messageHandlers.push(handler);
      return new vscode.Disposable(() => {
        this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
      });
    },
  };

  onDidDispose(handler: () => void): vscode.Disposable {
    this.disposeHandlers.push(handler);
    return new vscode.Disposable(() => {});
  }

  onDidChangeViewState(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  reveal(): void {}

  dispose(): void {
    this.disposeHandlers.forEach((h) => h());
  }

  /** Sends a message from the webview and lets the handler's promises settle. */
  async send(msg: Record<string, unknown>): Promise<void> {
    for (const handler of [...this.messageHandlers]) {
      handler(msg);
    }
    await settle();
  }

  /** Every message of this type, oldest first. */
  ofType(type: string): PostedMessage[] {
    return this.posted.filter((m) => m.type === type);
  }

  /** The most recent message of this type. */
  last(type: string): PostedMessage | undefined {
    return this.ofType(type).at(-1);
  }

  clear(): void {
    this.posted.length = 0;
  }
}

/** Lets every pending microtask and timer-free promise chain finish. */
export async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

/** An extension context with only the fields the host actually reads. */
export function fakeContext(extensionPath = "/ext"): {
  extensionUri: vscode.Uri;
  subscriptions: { dispose(): void }[];
} {
  return { extensionUri: vscode.Uri.file(extensionPath), subscriptions: [] };
}

/** A project service that reports no MkDocs project — the plain-Markdown case. */
export function noProjects(): ProjectService {
  return {
    getProjects: () => Promise.resolve([]),
    findProjectFor: () => Promise.resolve(undefined),
    invalidate: () => {},
  } as unknown as ProjectService;
}

/** A project service with one MkDocs project rooted at the given path. */
export function projectAt(root: string): ProjectService {
  const rootUri = vscode.Uri.file(root);
  const project = {
    root: rootUri,
    configFile: vscode.Uri.joinPath(rootUri, "mkdocs.yml"),
    docsDir: vscode.Uri.joinPath(rootUri, "docs"),
  };
  return {
    getProjects: () => Promise.resolve([project]),
    findProjectFor: () => Promise.resolve(project),
    invalidate: () => {},
  } as unknown as ProjectService;
}

/** A renderer that reports what it was asked to render instead of rendering it. */
export function echoRenderer(): FallbackRenderFn {
  return (doc, _project, textOverride) =>
    Promise.resolve({
      html: `<p data-src-line="0">${textOverride ?? doc.getText()}</p>`,
      palette: undefined,
    } as Awaited<ReturnType<FallbackRenderFn>>);
}

/** An insert panel that records the calls instead of opening anything. */
export function recordingInsertPanel(): InsertPanel & {
  insertCalls: unknown[];
  editCalls: unknown[];
} {
  const insertCalls: unknown[] = [];
  const editCalls: unknown[] = [];
  return {
    insertCalls,
    editCalls,
    openInsertAt: (target: unknown) => insertCalls.push(target),
    openForEdit: (id: unknown, values: unknown, target: unknown) =>
      editCalls.push({ id, values, target }),
  } as unknown as InsertPanel & { insertCalls: unknown[]; editCalls: unknown[] };
}
