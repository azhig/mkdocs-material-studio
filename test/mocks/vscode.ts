// The slice of the VS Code API the extension host actually uses.
//
// Aliased in place of the real module by vitest.config.ts. Everything here has
// to behave the way the real thing does where a test leans on it — a
// WorkspaceEdit applies all of its operations against the ORIGINAL document,
// fs.stat throws for a file that is not there, a Disposable can be disposed
// twice — because a mock that is merely convenient proves nothing. What is not
// used is not here; add to it rather than guess.

import * as fs from "node:fs/promises";
import * as path from "node:path";

// ── Values ────────────────────────────────────────────────────────────────────

export class Position {
  constructor(
    readonly line: number,
    readonly character: number,
  ) {}
  isBefore(other: Position): boolean {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(start: Position, end: Position);
  constructor(startLine: number, startCh: number, endLine: number, endCh: number);
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    if (typeof a === "number") {
      this.start = new Position(a, b as number);
      this.end = new Position(c ?? 0, d ?? 0);
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
  get isEmpty(): boolean {
    return this.start.line === this.end.line && this.start.character === this.end.character;
  }
}

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query = "",
    readonly fragment = "",
  ) {}

  static file(fsPath: string): Uri {
    return new Uri("file", "", fsPath.split(path.sep).join("/"));
  }

  static parse(value: string): Uri {
    // The authority matters: dropping it turns https://example.com/docs into
    // https:///example.com/docs, and an address the extension opens for the
    // author would go somewhere else entirely.
    const m = /^([a-z][a-z0-9+.-]*):(\/\/([^/?#]*))?([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(value);
    if (!m) {
      return Uri.file(value);
    }
    return new Uri(
      m[1].toLowerCase(),
      m[3] ?? "",
      m[4] ?? "",
      (m[5] ?? "").replace(/^\?/, ""),
      (m[6] ?? "").replace(/^#/, ""),
    );
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, base.authority, path.posix.join(base.path, ...segments));
  }

  get fsPath(): string {
    return this.path.split("/").join(path.sep);
  }

  with(change: { path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      this.scheme,
      this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  toString(): string {
    const query = this.query ? `?${this.query}` : "";
    const fragment = this.fragment ? `#${this.fragment}` : "";
    const head =
      this.authority !== "" || this.scheme === "file"
        ? `${this.scheme}://${this.authority}`
        : `${this.scheme}:`;
    return `${head}${this.path}${query}${fragment}`;
  }
}

export class Disposable {
  private done = false;
  constructor(private readonly fn: () => void) {}
  dispose(): void {
    if (!this.done) {
      this.done = true;
      this.fn();
    }
  }
  static from(...items: { dispose(): void }[]): Disposable {
    return new Disposable(() => items.forEach((i) => i.dispose()));
  }
}

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  readonly event = (listener: (e: T) => void): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  };
  fire(e: T): void {
    for (const listener of [...this.listeners]) {
      listener(e);
    }
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class RelativePattern {
  constructor(
    readonly base: Uri,
    readonly pattern: string,
  ) {}
}

export class ThemeIcon {
  constructor(readonly id: string) {}
}

export class TreeItem {
  label?: string;
  description?: string;
  contextValue?: string;
  iconPath?: unknown;
  command?: unknown;
  resourceUri?: Uri;
  constructor(
    label: string,
    readonly collapsibleState?: number,
  ) {
    this.label = label;
  }
}

export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;

/** The values VS Code uses in workspace.fs.readDirectory. */
export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const;
export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2 } as const;
export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3,
} as const;

// ── Documents ────────────────────────────────────────────────────────────────

/** A text document that really holds text, so an edit can be checked against it. */
export class FakeTextDocument {
  version = 1;
  private text: string;

  constructor(
    readonly uri: Uri,
    text: string,
  ) {
    this.text = text;
    documents.set(uri.toString(), this);
  }

  get lineCount(): number {
    return this.text.split("\n").length;
  }

  get isDirty(): boolean {
    return false;
  }

  lineAt(line: number): { text: string; lineNumber: number; range: Range } {
    const text = this.text.split("\n")[line] ?? "";
    return { text, lineNumber: line, range: new Range(line, 0, line, text.length) };
  }

  /** Writes the text out, so a test can check the file rather than the buffer. */
  async save(): Promise<boolean> {
    await fs.writeFile(this.uri.fsPath, this.text, "utf8");
    return true;
  }

  getText(range?: Range): string {
    if (!range) {
      return this.text;
    }
    return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  offsetAt(position: Position): number {
    const starts = lineStarts(this.text);
    return Math.min(
      (starts[position.line] ?? this.text.length) + position.character,
      this.text.length,
    );
  }

  /** Replaces the whole text as an outside edit would (a save from elsewhere). */
  setText(text: string): void {
    this.text = text;
    this.version += 1;
  }

  /** Applies a batch the way VS Code does: every offset taken in the text as it is now. */
  applyOperations(ops: { range: Range; text: string }[]): void {
    const spans = ops
      .map((op) => ({
        start: this.offsetAt(op.range.start),
        end: this.offsetAt(op.range.end),
        text: op.text,
      }))
      .sort((a, b) => b.start - a.start || b.end - a.end);
    for (const span of spans) {
      this.text = this.text.slice(0, span.start) + span.text + this.text.slice(span.end);
    }
    this.version += 1;
  }
}

const documents = new Map<string, FakeTextDocument>();

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

export class WorkspaceEdit {
  readonly operations: { uri: Uri; range: Range; text: string }[] = [];

  insert(uri: Uri, position: Position, text: string): void {
    this.operations.push({ uri, range: new Range(position, position), text });
  }
  delete(uri: Uri, range: Range): void {
    this.operations.push({ uri, range, text: "" });
  }
  replace(uri: Uri, range: Range, text: string): void {
    this.operations.push({ uri, range, text });
  }
  get size(): number {
    return this.operations.length;
  }
}

// ── Test controls ────────────────────────────────────────────────────────────

interface Recorded {
  executedCommands: { command: string; args: unknown[] }[];
  openedExternal: string[];
  warnings: string[];
  errors: string[];
  /** Set to make workspace.applyEdit refuse, the way a read-only file does. */
  refuseEdits: boolean;
  /**
   * When onDidChangeTextDocument arrives relative to applyEdit resolving. VS
   * Code promises neither order, so the host has to work under both — "before"
   * is the adversarial one and the default.
   */
  changeEvent: "before" | "after";
  /** Answer for the next window.showOpenDialog. */
  openDialogResult: Uri[] | undefined;
  /** Answers for window.showInputBox, taken in order. */
  inputBoxAnswers: (string | undefined)[];
  /** Answer for window.showWarningMessage. */
  warningAnswer: string | undefined;
  /** Messages passed to window.showInformationMessage. */
  infos: string[];
  /** Panels handed out by window.createWebviewPanel, oldest first. */
  createdPanels: unknown[];
}

let panelFactory: (() => unknown) | undefined;

/** What window.createWebviewPanel should hand out. */
export function __setPanelFactory(fn: (() => unknown) | undefined): void {
  panelFactory = fn;
}

export const __recorded: Recorded = {
  executedCommands: [],
  openedExternal: [],
  warnings: [],
  infos: [],
  errors: [],
  refuseEdits: false,
  changeEvent: "before",
  openDialogResult: undefined,
  inputBoxAnswers: [],
  warningAnswer: undefined,
  createdPanels: [],
};

const settings = new Map<string, unknown>();
let folders: { uri: Uri; name: string; index: number }[] = [];
let foundFiles: Uri[] = [];

export const __onDidChangeTextDocument = new EventEmitter<{
  document: FakeTextDocument;
  contentChanges: unknown[];
}>();
export const __onDidChangeConfiguration = new EventEmitter<{
  affectsConfiguration(section: string): boolean;
}>();

/** Wipes every bit of state between tests. */
export function __reset(): void {
  documents.clear();
  settings.clear();
  folders = [];
  __recorded.executedCommands = [];
  __recorded.openedExternal = [];
  __recorded.warnings = [];
  __recorded.infos = [];
  __recorded.errors = [];
  __recorded.refuseEdits = false;
  __recorded.changeEvent = "before";
  __recorded.openDialogResult = undefined;
  __recorded.inputBoxAnswers = [];
  __recorded.warningAnswer = undefined;
  __recorded.createdPanels = [];
  panelFactory = undefined;
  foundFiles = [];
}

export function __setSetting(key: string, value: unknown): void {
  settings.set(key, value);
}

export function __setWorkspaceFolders(uris: Uri[]): void {
  folders = uris.map((uri, index) => ({ uri, name: path.basename(uri.fsPath), index }));
}

/** What workspace.findFiles answers — the configs a test wants discovered. */
export function __setFoundFiles(uris: Uri[]): void {
  foundFiles = uris;
}

/** Fires onDidChangeConfiguration for the given sections. */
export function __fireConfigChange(...sections: string[]): void {
  __onDidChangeConfiguration.fire({
    affectsConfiguration: (section: string) => sections.some((s) => s.startsWith(section)),
  });
}

// ── Namespaces ───────────────────────────────────────────────────────────────

export const workspace = {
  get workspaceFolders(): { uri: Uri; name: string; index: number }[] | undefined {
    return folders.length > 0 ? folders : undefined;
  },

  getWorkspaceFolder(uri: Uri): { uri: Uri; name: string; index: number } | undefined {
    return folders.find((f) => uri.fsPath.startsWith(f.uri.fsPath));
  },

  getConfiguration(section: string) {
    return {
      get<T>(key: string, fallback?: T): T | undefined {
        const value = settings.get(`${section}.${key}`);
        return (value as T) ?? fallback;
      },
      update(key: string, value: unknown): Promise<void> {
        settings.set(`${section}.${key}`, value);
        return Promise.resolve();
      },
    };
  },

  onDidChangeTextDocument: __onDidChangeTextDocument.event,
  onDidChangeConfiguration: __onDidChangeConfiguration.event,
  onDidChangeWorkspaceFolders: new EventEmitter<unknown>().event,

  createFileSystemWatcher(): {
    onDidCreate(): Disposable;
    onDidChange(): Disposable;
    onDidDelete(): Disposable;
    dispose(): void;
  } {
    const noop = (): Disposable => new Disposable(() => {});
    return { onDidCreate: noop, onDidChange: noop, onDidDelete: noop, dispose: () => {} };
  },

  findFiles(): Promise<Uri[]> {
    return Promise.resolve(foundFiles);
  },

  openTextDocument(uri: Uri): Promise<FakeTextDocument> {
    const doc = documents.get(uri.toString());
    return doc
      ? Promise.resolve(doc)
      : fs.readFile(uri.fsPath, "utf8").then((text) => new FakeTextDocument(uri, text));
  },

  async applyEdit(edit: WorkspaceEdit): Promise<boolean> {
    if (__recorded.refuseEdits) {
      return false;
    }
    const byDoc = new Map<FakeTextDocument, { range: Range; text: string }[]>();
    for (const op of edit.operations) {
      const doc = documents.get(op.uri.toString());
      if (!doc) {
        return false;
      }
      const list = byDoc.get(doc) ?? [];
      list.push({ range: op.range, text: op.text });
      byDoc.set(doc, list);
    }
    for (const [doc, ops] of byDoc) {
      doc.applyOperations(ops);
      const notify = (): void =>
        __onDidChangeTextDocument.fire({ document: doc, contentChanges: ops });
      if (__recorded.changeEvent === "after") {
        setTimeout(notify, 0);
      } else {
        notify();
      }
    }
    return true;
  },

  fs: {
    async createDirectory(uri: Uri): Promise<void> {
      await fs.mkdir(uri.fsPath, { recursive: true });
    },
    async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
      await fs.writeFile(uri.fsPath, content);
    },
    async readFile(uri: Uri): Promise<Uint8Array> {
      return new Uint8Array(await fs.readFile(uri.fsPath));
    },
    /** Entries as VS Code reports them: [name, FileType]. Throws for a missing directory. */
    async readDirectory(uri: Uri): Promise<[string, number][]> {
      const entries = await fs.readdir(uri.fsPath, { withFileTypes: true });
      return entries.map((e) => [e.name, e.isDirectory() ? FileType.Directory : FileType.File]);
    },
    /** Throws for something that is not there — the provider relies on that. */
    async stat(uri: Uri): Promise<{ type: number; size: number }> {
      const s = await fs.stat(uri.fsPath);
      return { type: s.isDirectory() ? 2 : 1, size: s.size };
    },
    async delete(uri: Uri, options?: { recursive?: boolean }): Promise<void> {
      await fs.rm(uri.fsPath, { recursive: options?.recursive ?? false, force: true });
    },
  },
};

export const window = {
  activeTextEditor: undefined as { document: FakeTextDocument } | undefined,
  visibleTextEditors: [] as { document: FakeTextDocument }[],

  createOutputChannel(): {
    info(m: string): void;
    warn(m: string): void;
    error(m: string): void;
    debug(m: string): void;
    trace(m: string): void;
    appendLine(m: string): void;
    show(): void;
    dispose(): void;
  } {
    return {
      info: () => {},
      warn: (m: string) => __recorded.warnings.push(m),
      error: (m: string) => __recorded.errors.push(m),
      debug: () => {},
      trace: () => {},
      appendLine: () => {},
      show: () => {},
      dispose: () => {},
    };
  },

  showInformationMessage(message: string): Promise<undefined> {
    __recorded.infos.push(message);
    return Promise.resolve(undefined);
  },
  showWarningMessage(message: string): Promise<string | undefined> {
    __recorded.warnings.push(message);
    return Promise.resolve(__recorded.warningAnswer);
  },
  showErrorMessage(message: string): Promise<undefined> {
    __recorded.errors.push(message);
    return Promise.resolve(undefined);
  },
  showInputBox(): Promise<string | undefined> {
    return Promise.resolve(__recorded.inputBoxAnswers.shift());
  },
  showOpenDialog(): Promise<Uri[] | undefined> {
    return Promise.resolve(__recorded.openDialogResult);
  },
  showTextDocument(): Promise<undefined> {
    return Promise.resolve(undefined);
  },
  onDidChangeActiveTextEditor: new EventEmitter<unknown>().event,
  onDidChangeTextEditorVisibleRanges: new EventEmitter<unknown>().event,

  createTreeView(): { dispose(): void; reveal(): Promise<void> } {
    return { dispose: () => {}, reveal: () => Promise.resolve() };
  },
  /**
   * Hands out whatever __setPanelFactory was given. The panel itself lives in
   * the test helpers, which import this module — hence the factory rather than
   * an import back the other way.
   */
  createWebviewPanel(): unknown {
    const panel = panelFactory?.();
    if (panel) {
      __recorded.createdPanels.push(panel);
    }
    return panel;
  },
  registerWebviewPanelSerializer(): Disposable {
    return new Disposable(() => {});
  },
  registerCustomEditorProvider(): Disposable {
    return new Disposable(() => {});
  },
};

export const commands = {
  registerCommand(command: string, handler: (...args: unknown[]) => unknown): Disposable {
    registeredCommands.set(command, handler);
    return new Disposable(() => registeredCommands.delete(command));
  },
  executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    __recorded.executedCommands.push({ command, args });
    const handler = registeredCommands.get(command);
    return Promise.resolve(handler ? handler(...args) : undefined);
  },
};

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

export const env = {
  language: "en",
  openExternal(uri: Uri): Promise<boolean> {
    __recorded.openedExternal.push(uri.toString());
    return Promise.resolve(true);
  },
};
