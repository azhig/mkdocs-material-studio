import * as vscode from "vscode";
import * as path from "node:path";
import type { ProjectService, MkdocsProject } from "../core/projectService";
import { readMkdocsConfig } from "../core/mkdocsConfig";
import type { NavItem } from "../core/mkdocsConfigParse";
import {
  collectSections,
  includeTargetOf,
  resolveSectionPath,
  type MonorepoSection,
} from "../core/monorepo";
import type { NavPath } from "../core/navEditor";
import { t } from "../core/i18n";
import { getLogger } from "../util/logger";

export type NavNodeType = "page" | "section" | "loose" | "looseGroup";

export interface NavNode {
  type: NavNodeType;
  title: string;
  navPath?: NavPath;
  fileUri?: vscode.Uri;
  children?: NavNode[];
  project: MkdocsProject;
  /**
   * The included config this entry is written in (`lib/mkdocs.yml`), for the
   * contents of an `!include` section. Such an entry has no navPath — editing it
   * from here would write to the wrong file — and this is what lets the commands
   * say so instead of doing nothing.
   */
  includedFrom?: string;
}

const NAV_MIME = "application/vnd.code.tree.mkdocsview.nav";

/**
 * The documentation structure tree: the navigation from mkdocs.yml plus a
 * “Not in navigation” section with the docs/ files missing from nav. Supports
 * drag and drop.
 */
export class MkdocsTreeProvider
  implements vscode.TreeDataProvider<NavNode>, vscode.TreeDragAndDropController<NavNode>
{
  readonly dropMimeTypes = [NAV_MIME];
  readonly dragMimeTypes = [NAV_MIME];

  private readonly emitter = new vscode.EventEmitter<NavNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  /** Called by the DnD controller to apply a move. */
  onMove?: (
    from: NavPath,
    toParent: NavPath,
    toIndex: number,
    project: MkdocsProject,
  ) => Promise<void>;
  /** Called to add a “loose” file to nav. */
  onAttachLoose?: (
    fileRel: string,
    toParent: NavPath,
    toIndex: number,
    project: MkdocsProject,
  ) => Promise<void>;

  constructor(private readonly projects: ProjectService) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(node: NavNode): vscode.TreeItem {
    const collapsible =
      node.type === "section" || node.type === "looseGroup"
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(node.title, collapsible);
    item.contextValue = node.type;

    if (node.type === "section") {
      item.iconPath = new vscode.ThemeIcon("folder");
    } else if (node.type === "looseGroup") {
      item.iconPath = new vscode.ThemeIcon("question");
      item.tooltip = t("Files in docs/ that are not included in nav");
    } else if (node.fileUri) {
      item.iconPath = new vscode.ThemeIcon("markdown");
      item.resourceUri = node.fileUri;
      item.command = { command: "vscode.open", title: t("Open"), arguments: [node.fileUri] };
    }
    return item;
  }

  async getChildren(element?: NavNode): Promise<NavNode[]> {
    if (element) {
      return element.children ?? [];
    }
    const projects = await this.projects.getProjects();
    if (projects.length === 0) {
      return [];
    }
    // For simplicity we show the first project (the typical case is one site).
    return this.buildRoot(projects[0]);
  }

  private async buildRoot(project: MkdocsProject): Promise<NavNode[]> {
    let navItems: NavItem[] | undefined;
    let docsDir = "docs";
    let sections = new Map<string, MonorepoSection>();
    try {
      const { config } = await readMkdocsConfig(project.configFile);
      navItems = config.nav;
      docsDir = config.docsDir;
      sections = await collectSections(project, config);
    } catch (err) {
      getLogger().warn(`tree: failed to read the config: ${String(err)}`);
    }

    const docsRoot = vscode.Uri.joinPath(project.root, docsDir);
    const fileOf = (rel: string): vscode.Uri =>
      vscode.Uri.joinPath(project.root, resolveSectionPath(rel, docsDir, [...sections.values()]));
    const referenced = new Set<string>();
    const nodes = navItems
      ? navItems.map((item, i) => this.toNode(item, [i], fileOf, project, sections, referenced))
      : [];

    // Files that did not make it into nav — the root docs_dir and, in a monorepo,
    // each section's own, named the way the nav names them.
    const allMd = await this.listMarkdown(docsRoot);
    for (const section of sections.values()) {
      const own = await this.listMarkdown(vscode.Uri.joinPath(project.root, section.docsDir));
      allMd.push(...own.map((rel) => `${section.prefix}/${rel}`));
    }
    const loose = allMd.filter((rel) => !referenced.has(rel));
    if (loose.length > 0) {
      nodes.push({
        type: "looseGroup",
        title: t("Not in navigation"),
        project,
        children: loose.map((rel) => ({
          type: "loose" as const,
          title: rel,
          fileUri: fileOf(rel),
          project,
        })),
      });
    }
    return nodes;
  }

  private toNode(
    item: NavItem,
    navPath: NavPath,
    fileOf: (rel: string) => vscode.Uri,
    project: MkdocsProject,
    sections: Map<string, MonorepoSection>,
    referenced: Set<string>,
  ): NavNode {
    const included = includeTargetOf(item);
    if (included !== undefined) {
      const section = sections.get(included);
      for (const rel of pagePaths(section?.nav ?? [])) {
        referenced.add(rel);
      }
      return {
        type: "section",
        title: item.title ?? section?.prefix ?? included,
        // The entry itself lives in this nav and may be moved; what is inside it
        // does not — those lines belong to the included config, and writing them
        // back here would edit the wrong file.
        navPath,
        project,
        children: (section?.nav ?? []).map((child) =>
          this.sectionNode(child, fileOf, project, included),
        ),
      };
    }
    if (item.kind === "page") {
      referenced.add(item.path.replace(/\\/g, "/"));
      return {
        type: "page",
        title: item.title ?? item.path,
        navPath,
        fileUri: fileOf(item.path),
        project,
      };
    }
    return {
      type: "section",
      title: item.title,
      navPath,
      project,
      children: item.children.map((child, i) =>
        this.toNode(child, [...navPath, i], fileOf, project, sections, referenced),
      ),
    };
  }

  /** A node of an included config: shown and opened, but not moved from here. */
  private sectionNode(
    item: NavItem,
    fileOf: (rel: string) => vscode.Uri,
    project: MkdocsProject,
    includedFrom: string,
  ): NavNode {
    if (item.kind === "page") {
      return {
        type: "page",
        title: item.title ?? item.path,
        fileUri: fileOf(item.path),
        project,
        includedFrom,
      };
    }
    return {
      type: "section",
      title: item.title,
      project,
      includedFrom,
      children: item.children.map((child) =>
        this.sectionNode(child, fileOf, project, includedFrom),
      ),
    };
  }

  private async listMarkdown(dir: vscode.Uri, prefix = ""): Promise<string[]> {
    const result: string[] = [];
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dir);
    } catch {
      return result;
    }
    for (const [name, type] of entries) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (type === vscode.FileType.Directory) {
        result.push(...(await this.listMarkdown(vscode.Uri.joinPath(dir, name), rel)));
      } else if (/\.(md|markdown)$/i.test(name)) {
        result.push(rel);
      }
    }
    return result;
  }

  // --- Drag & Drop ---

  handleDrag(source: readonly NavNode[], data: vscode.DataTransfer): void {
    const node = source[0];
    if (node && (node.type === "page" || node.type === "section" || node.type === "loose")) {
      data.set(NAV_MIME, new vscode.DataTransferItem(node));
    }
  }

  async handleDrop(target: NavNode | undefined, data: vscode.DataTransfer): Promise<void> {
    const item = data.get(NAV_MIME);
    const dragged = item?.value as NavNode | undefined;
    if (!dragged) {
      return;
    }
    const project = dragged.project;
    const { toParent, toIndex } = this.resolveDropTarget(target);

    if (dragged.type === "loose" && dragged.fileUri) {
      const rel = this.relFromUri(project, dragged.fileUri);
      if (rel && this.onAttachLoose) {
        await this.onAttachLoose(rel, toParent, toIndex, project);
      }
      return;
    }
    if (dragged.navPath && this.onMove) {
      await this.onMove(dragged.navPath, toParent, toIndex, project);
    }
  }

  private resolveDropTarget(target: NavNode | undefined): { toParent: NavPath; toIndex: number } {
    if (!target || target.type === "looseGroup") {
      return { toParent: [], toIndex: Number.MAX_SAFE_INTEGER };
    }
    if (target.type === "section" && target.navPath) {
      return { toParent: target.navPath, toIndex: Number.MAX_SAFE_INTEGER };
    }
    if (target.navPath && target.navPath.length > 0) {
      const parent = target.navPath.slice(0, -1);
      const index = target.navPath[target.navPath.length - 1] + 1;
      return { toParent: parent, toIndex: index };
    }
    return { toParent: [], toIndex: Number.MAX_SAFE_INTEGER };
  }

  private relFromUri(project: MkdocsProject, uri: vscode.Uri): string | undefined {
    const rel = path.relative(project.docsDir.fsPath, uri.fsPath).replace(/\\/g, "/");
    return rel.startsWith("..") ? undefined : rel;
  }
}

/** Page paths of a nav, sections included — what counts as “already in nav”. */
function pagePaths(items: NavItem[]): string[] {
  return items.flatMap((item) =>
    item.kind === "section" ? pagePaths(item.children) : [item.path.replace(/\\/g, "/")],
  );
}
