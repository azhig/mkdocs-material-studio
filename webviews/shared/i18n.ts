// Localization inside webviews.
//
// The extension host embeds the active bundle into the page shell as
// `window.__i18n`, so the very first paint is already translated — no flash of
// English text while a message round-trip happens. Keys are English strings,
// a missing translation falls back to the key itself.

interface I18nData {
  lang: string;
  strings: Record<string, string>;
}

declare const window: Window & { __i18n?: I18nData };

const data: I18nData = window.__i18n ?? { lang: "en", strings: {} };

/** Active language tag (`en`, `ru`, `pt-br`, …). */
export function language(): string {
  return data.lang;
}

/** Translates a string; `{0}`, `{1}`, … are replaced by the arguments. */
export function t(text: string, ...args: (string | number)[]): string {
  const translated = data.strings[text] ?? text;
  if (args.length === 0) {
    return translated;
  }
  return translated.replace(/\{(\d+)\}/g, (whole, index) => {
    const value = args[Number(index)];
    return value === undefined ? whole : String(value);
  });
}
