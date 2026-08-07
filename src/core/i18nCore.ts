// Translation lookup without any dependency on the VS Code API.
//
// Kept separate from i18n.ts on purpose: modules covered by unit tests (the
// mkdocs.yml model, block parsers) also need t(), and importing `vscode` there
// would break vitest — the same split as mkdocsConfig/mkdocsConfigParse.
//
// Keys are the English strings themselves: the source stays readable, and a
// missing translation degrades to English instead of showing a bare key.

/** Languages shipped with the extension. `auto` follows VS Code's UI language. */
export const SUPPORTED_LANGUAGES = ["en", "ru", "de", "es", "fr", "pt-br", "zh-cn", "ja"] as const;

export type LanguageId = (typeof SUPPORTED_LANGUAGES)[number];

let bundle: Record<string, string> = {};
let activeLanguage: LanguageId = "en";

/** Installs the bundle for a language (called by the VS Code-aware loader). */
export function setBundle(language: LanguageId, strings: Record<string, string>): void {
  activeLanguage = language;
  bundle = strings;
}

/** Language actually in use (never `auto`). */
export function currentLanguage(): LanguageId {
  return activeLanguage;
}

/** Strings for the active language — webviews get this as a plain object. */
export function translations(): Record<string, string> {
  return bundle;
}

/**
 * Translates a string. Placeholders are `{0}`, `{1}`, … so that translators
 * can reorder them: `t("Opened {0} of {1}", done, total)`.
 */
export function t(text: string, ...args: (string | number)[]): string {
  const translated = bundle[text] ?? text;
  return args.length === 0 ? translated : format(translated, args);
}

export function format(text: string, args: (string | number)[]): string {
  return text.replace(/\{(\d+)\}/g, (whole, index) => {
    const value = args[Number(index)];
    return value === undefined ? whole : String(value);
  });
}

/**
 * VS Code reports tags like `pt-br`, `zh-cn`, `de-DE`. Match the full tag
 * first, then the primary subtag (`de-DE` → `de`), then fall back to English.
 */
export function normalizeLanguage(tag: string | undefined): LanguageId {
  const lower = (tag ?? "en").toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find((id) => id === lower);
  if (exact) {
    return exact;
  }
  const primary = lower.split("-")[0];
  const partial = SUPPORTED_LANGUAGES.find((id) => id.split("-")[0] === primary);
  return partial ?? "en";
}
