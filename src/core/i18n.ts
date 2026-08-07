// Localization for the extension host: loading bundles and following the
// `mkdocsStudio.language` setting.
//
// The lookup itself lives in the pure i18nCore.ts — modules covered by unit
// tests import t() from there, because importing `vscode` would break vitest.
//
// The display language follows our own setting rather than VS Code's UI
// language: the user asked to switch it per extension.

import * as vscode from "vscode";
import * as fs from "node:fs";
import { normalizeLanguage, setBundle, type LanguageId } from "./i18nCore";

export { currentLanguage, t, translations, SUPPORTED_LANGUAGES } from "./i18nCore";
export type { LanguageId } from "./i18nCore";

let extensionUri: vscode.Uri | undefined;

/**
 * Loads the bundle for the configured language. Safe to call repeatedly —
 * that is what happens when the setting changes.
 */
export function loadTranslations(context?: vscode.ExtensionContext): LanguageId {
  if (context) {
    extensionUri = context.extensionUri;
  }
  const language = resolveLanguage();
  setBundle(language, language === "en" ? {} : readBundle(language));
  return language;
}

/** Did a configuration change affect the display language? */
export function affectsLanguage(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration("mkdocsStudio.language");
}

function resolveLanguage(): LanguageId {
  const setting = vscode.workspace.getConfiguration("mkdocsStudio").get<string>("language", "auto");
  const wanted = setting === "auto" ? vscode.env.language : setting;
  return normalizeLanguage(wanted);
}

function readBundle(language: LanguageId): Record<string, string> {
  if (!extensionUri) {
    return {};
  }
  const file = vscode.Uri.joinPath(extensionUri, "assets", "i18n", `${language}.json`).fsPath;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    // A missing or broken bundle is not fatal: English is always available.
    return {};
  }
}
