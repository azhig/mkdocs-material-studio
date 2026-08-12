import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildMarkdownEngine } from "./markdownEngine";
import { readMkdocsConfig, type PaletteConfig } from "../core/mkdocsConfig";
import { resolvePalette, type PaletteInfo } from "../core/paletteResolve";
import { rewriteHtmlAssetUrls } from "../core/assetUrls";
import { extensionIconPack } from "../core/extensionIcons";
import type { MkdocsProject } from "../core/projectService";
import { getLogger } from "../util/logger";
import { readSnippetFrom } from "./snippetSource";

export type { PaletteInfo, SchemeColors } from "../core/paletteResolve";

export interface FallbackResult {
  html: string;
  palette?: PaletteInfo;
}

export type FallbackRenderFn = (
  doc: vscode.TextDocument,
  project: MkdocsProject | undefined,
  // Render this text instead of the document's own — used for fragments (the
  // annotation editor). The document still provides the snippet/palette context.
  textOverride?: string,
  // The panel's own address translator (webview.asWebviewUri). Without it the
  // links of images and video are left as the author wrote them.
  toWebviewUri?: (uri: vscode.Uri) => string,
) => Promise<FallbackResult>;

/**
 * Creates the lightweight render function. markdown-it is built once; every
 * call only changes the base directories (for snippets) and the palette.
 */
export function createFallbackRenderer(context: vscode.ExtensionContext): FallbackRenderFn {
  const icons = extensionIconPack(context);
  const resolveIcon = (shortcode: string): string | undefined => icons.get(shortcode);

  // The base directories for snippets are set before every render.
  let snippetBases: string[] = [];
  const readSnippet = (rel: string): string | undefined =>
    readSnippetFrom(snippetBases, rel, (file) => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return undefined; // not here — try the next base directory
      }
    });

  const md = buildMarkdownEngine({ resolveIcon, readSnippet });

  return async (doc, project, textOverride, toWebviewUri) => {
    // Snippets resolve the way pymdownx does by default: against the folder of
    // mkdocs.yml (`base_path: ["."]`), NOT against the page. A page-relative
    // path used to render here while breaking on the built site — matching the
    // site is what the preview is for. A lone file has no project, so its own
    // folder stands in for the root.
    const docDir = path.dirname(doc.uri.fsPath);
    snippetBases = [docDir];
    // Even without a project the settings still have a say: the colors are also
    // applied to a lone Markdown file outside of MkDocs.
    let yamlPalette: PaletteConfig | PaletteConfig[] | undefined;
    // An absolute link (`/assets/logo.png`) is resolved by MkDocs against the site
    // root, which is docs_dir; without a project the document's own folder is all
    // there is.
    let siteRoot = docDir;
    if (project) {
      snippetBases = [project.root.fsPath];
      try {
        const { config } = await readMkdocsConfig(project.configFile);
        const docsRoot = vscode.Uri.joinPath(project.root, config.docsDir).fsPath;
        siteRoot = docsRoot;
        yamlPalette = config.theme.palette;
      } catch (err) {
        getLogger().warn(`fallback: failed to read the config: ${String(err)}`);
      }
    }
    const palette = resolvePalette(yamlPalette, paletteFromSettings(doc.uri));

    const env: Record<string, unknown> = {};
    let html = md.render(textOverride ?? doc.getText(), env);
    if (toWebviewUri) {
      html = rewriteHtmlAssetUrls(html, (target) =>
        resolveAsset(target, docDir, siteRoot, toWebviewUri),
      );
    }
    return { html, palette };
  };
}

/**
 * A link from the document to an address the webview may load. The query and the
 * anchor of the link are dropped: they mean nothing for a file on disk, and
 * `asWebviewUri` would carry them into the path.
 */
function resolveAsset(
  target: string,
  docDir: string,
  siteRoot: string,
  toWebviewUri: (uri: vscode.Uri) => string,
): string | undefined {
  const clean = target.replace(/[?#].*$/, "");
  if (clean === "") {
    return undefined;
  }
  // A path written by hand may be percent-encoded (`my%20image.png`); on disk the
  // file is called by its real name.
  let rel = clean;
  try {
    rel = decodeURIComponent(clean);
  } catch {
    // A stray “%” — take the link as it is.
  }
  const base = rel.startsWith("/") ? siteRoot : docDir;
  const abs = path.resolve(base, rel.replace(/^\/+/, ""));
  if (!fs.existsSync(abs)) {
    // Nothing to point at — a broken link stays visible as the author wrote it
    // instead of turning into an unreadable webview address.
    return undefined;
  }
  return toWebviewUri(vscode.Uri.file(abs));
}

/**
 * The colors of the extension settings — the fallback for what mkdocs.yml leaves
 * out. Read per document: a workspace folder may override them for itself.
 */
function paletteFromSettings(scope?: vscode.Uri): PaletteInfo {
  const cfg = vscode.workspace.getConfiguration("mkdocsStudio", scope);
  const read = (key: string): string | undefined => cfg.get<string>(key, "cyan") || undefined;
  return {
    light: { primary: read("palette.light.primary"), accent: read("palette.light.accent") },
    dark: { primary: read("palette.dark.primary"), accent: read("palette.dark.accent") },
  };
}

/**
 * Where the page background comes from: the Material scheme (as on the published
 * site) or the VS Code theme. Only the colors of the webview change — the render
 * itself does not depend on it.
 */
export function pageBackground(scope?: vscode.Uri): "material" | "editor" {
  const value = vscode.workspace
    .getConfiguration("mkdocsStudio", scope)
    .get<string>("pageBackground");
  return value === "editor" ? "editor" : "material";
}

/** An appearance settings edit is applied on the fly, without reopening the panel. */
export function affectsPalette(e: vscode.ConfigurationChangeEvent): boolean {
  return (
    e.affectsConfiguration("mkdocsStudio.palette") ||
    e.affectsConfiguration("mkdocsStudio.pageBackground")
  );
}
