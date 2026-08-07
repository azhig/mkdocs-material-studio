import * as vscode from "vscode";
import * as path from "node:path";
import type { ProjectService, MkdocsProject } from "../core/projectService";
import { readMkdocsConfig } from "../core/mkdocsConfig";
import { applyConfigDoc } from "../core/configWriter";
import {
  moveNavItem,
  addNavPage,
  addNavSection,
  renameNavItem,
  removeNavItem,
  type NavPath,
} from "../core/navEditor";
import { MkdocsTreeProvider, type NavNode } from "./treeProvider";
import { t } from "../core/i18n";
import { getLogger } from "../util/logger";

/** Builds the tree, registers the commands and handles drag and drop. */
export class TreeController {
  private readonly provider: MkdocsTreeProvider;
  private readonly view: vscode.TreeView<NavNode>;

  constructor(
    context: vscode.ExtensionContext,
    private readonly projects: ProjectService,
  ) {
    this.provider = new MkdocsTreeProvider(projects);
    this.provider.onMove = (from, toParent, toIndex, project) =>
      this.applyNav(project, (doc) => moveNavItem(doc, from, toParent, toIndex));
    this.provider.onAttachLoose = (rel, toParent, toIndex, project) =>
      this.applyNav(project, (doc) => {
        addNavPage(doc, toParent, titleFromPath(rel), rel, toIndex);
        return true;
      });

    this.view = vscode.window.createTreeView("mkdocsStudio.projectTree", {
      treeDataProvider: this.provider,
      dragAndDropController: this.provider,
      canSelectMany: false,
      showCollapseAll: true,
    });

    context.subscriptions.push(
      this.view,
      vscode.commands.registerCommand("mkdocsStudio.tree.refresh", () => this.provider.refresh()),
      vscode.commands.registerCommand("mkdocsStudio.tree.newPage", (node?: NavNode) =>
        this.newPage(node),
      ),
      vscode.commands.registerCommand("mkdocsStudio.tree.newSection", (node?: NavNode) =>
        this.newSection(node),
      ),
      vscode.commands.registerCommand("mkdocsStudio.tree.rename", (node?: NavNode) =>
        this.rename(node),
      ),
      vscode.commands.registerCommand("mkdocsStudio.tree.delete", (node?: NavNode) =>
        this.delete(node),
      ),
      vscode.commands.registerCommand("mkdocsStudio.tree.openConfig", () => this.openConfig()),
    );

    // Refresh the tree when files or the config change.
    const watcher = vscode.workspace.createFileSystemWatcher("**/{mkdocs.yml,mkdocs.yaml,docs/**}");
    watcher.onDidCreate(() => this.provider.refresh());
    watcher.onDidDelete(() => this.provider.refresh());
    context.subscriptions.push(watcher);
  }

  refresh(): void {
    this.provider.refresh();
  }

  private async applyNav(
    project: MkdocsProject,
    mutate: (doc: import("yaml").Document) => boolean,
  ): Promise<void> {
    try {
      const { doc } = await readMkdocsConfig(project.configFile);
      if (mutate(doc)) {
        await applyConfigDoc(project.configFile, doc);
        this.provider.refresh();
      }
    } catch (err) {
      void vscode.window.showErrorMessage(t("Failed to change nav: {0}", String(err)));
      getLogger().error(String(err));
    }
  }

  private async firstProject(): Promise<MkdocsProject | undefined> {
    return (await this.projects.getProjects())[0];
  }

  private parentPathOf(node: NavNode | undefined): NavPath {
    if (!node || !node.navPath) {
      return [];
    }
    return node.type === "section" ? node.navPath : node.navPath.slice(0, -1);
  }

  private async newPage(node?: NavNode): Promise<void> {
    const project = node?.project ?? (await this.firstProject());
    if (!project) {
      return;
    }
    const title = await vscode.window.showInputBox({ prompt: t("Page title") });
    if (!title) {
      return;
    }
    const suggested = slugify(title) + ".md";
    const rel = await vscode.window.showInputBox({
      prompt: t("File path relative to docs/"),
      value: suggested,
    });
    if (!rel) {
      return;
    }

    const { config } = await readMkdocsConfig(project.configFile);
    const docsRoot = vscode.Uri.joinPath(project.root, config.docsDir);
    const fileUri = vscode.Uri.joinPath(docsRoot, rel);
    try {
      await vscode.workspace.fs.stat(fileUri);
    } catch {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(fileUri, ".."));
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(`# ${title}\n`, "utf8"));
    }

    await this.applyNav(project, (doc) => {
      addNavPage(doc, this.parentPathOf(node), title, rel);
      return true;
    });
    void vscode.window.showTextDocument(fileUri);
  }

  private async newSection(node?: NavNode): Promise<void> {
    const project = node?.project ?? (await this.firstProject());
    if (!project) {
      return;
    }
    const title = await vscode.window.showInputBox({ prompt: t("Section name") });
    if (!title) {
      return;
    }
    await this.applyNav(project, (doc) => {
      addNavSection(doc, this.parentPathOf(node), title);
      return true;
    });
  }

  private async rename(node?: NavNode): Promise<void> {
    if (!node?.navPath) {
      return;
    }
    const next = await vscode.window.showInputBox({ prompt: t("New title"), value: node.title });
    if (!next || next === node.title) {
      return;
    }
    await this.applyNav(node.project, (doc) => renameNavItem(doc, node.navPath!, next));
  }

  private async delete(node?: NavNode): Promise<void> {
    if (!node) {
      return;
    }
    if (node.type === "loose" && node.fileUri) {
      const del = t("Delete");
      const yes = await vscode.window.showWarningMessage(
        t("Delete the file {0}?", node.title),
        { modal: true },
        del,
      );
      if (yes === del) {
        await vscode.workspace.fs.delete(node.fileUri, { useTrash: true });
        this.provider.refresh();
      }
      return;
    }
    if (node.navPath) {
      const remove = t("Remove");
      const yes = await vscode.window.showWarningMessage(
        t("Remove “{0}” from the navigation? The file is not deleted.", node.title),
        { modal: true },
        remove,
      );
      if (yes === remove) {
        await this.applyNav(node.project, (doc) => removeNavItem(doc, node.navPath!));
      }
    }
  }

  private async openConfig(): Promise<void> {
    const project = await this.firstProject();
    if (project) {
      void vscode.window.showTextDocument(project.configFile);
    }
  }
}

function titleFromPath(rel: string): string {
  const base = path.basename(rel).replace(/\.(md|markdown)$/i, "");
  return base.charAt(0).toUpperCase() + base.slice(1).replace(/[-_]/g, " ");
}

function slugify(title: string): string {
  // Letters and digits of any script, not just Latin: a page titled in Chinese,
  // Greek or Cyrillic must not come out as a file named “-.md”.
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
