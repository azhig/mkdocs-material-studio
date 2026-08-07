// The UI of the visual mkdocs.yml editor: tabs, fields, palette swatches, toggles.

import { t } from "../shared/i18n";

interface ToggleItem {
  id: string;
  label: string;
  enabled: boolean;
}
interface ConfigModel {
  general: Record<string, string>;
  theme: {
    name: string;
    language: string;
    paletteMode: "none" | "single" | "list";
    primary: string;
    accent: string;
    scheme: string;
  };
  features: ToggleItem[];
  plugins: ToggleItem[];
  extensions: ToggleItem[];
  catalogs: {
    primary: string[];
    accent: string[];
    schemes: { value: string; label: string }[];
    languages: { value: string; label: string }[];
  };
}
interface GeneralField {
  key: string;
  label: string;
  placeholder?: string;
}

type ConfigChange =
  | { kind: "scalar"; path: string[]; value: string }
  | { kind: "palette"; field: "primary" | "accent" | "scheme"; value: string }
  | { kind: "toggle"; group: "features" | "plugins" | "extensions"; id: string; on: boolean };

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

const tabsEl = document.getElementById("tabs") as HTMLElement;
const mainEl = document.getElementById("main") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;

document
  .getElementById("openRaw")
  ?.addEventListener("click", () => api.postMessage({ type: "openFile" }));

// The actual Material colors (for the swatches). The exact values are not
// critical — this is a visual hint; the names match theme.palette.primary/accent.
const PRIMARY_HEX: Record<string, string> = {
  red: "#ef5350",
  pink: "#e91e63",
  purple: "#ab47bc",
  "deep purple": "#7e57c2",
  indigo: "#3f51b5",
  blue: "#2196f3",
  "light blue": "#03a9f4",
  cyan: "#00bcd4",
  teal: "#009688",
  green: "#4caf50",
  "light green": "#7cb342",
  lime: "#c0ca33",
  yellow: "#f9a825",
  amber: "#ffa000",
  orange: "#fb8c00",
  "deep orange": "#ff7043",
  brown: "#795548",
  grey: "#757575",
  "blue grey": "#546e7a",
  black: "#000000",
  white: "#ffffff",
};
const ACCENT_HEX: Record<string, string> = {
  red: "#ff1744",
  pink: "#f50057",
  purple: "#e040fb",
  "deep purple": "#7c4dff",
  indigo: "#536dfe",
  blue: "#448aff",
  "light blue": "#0091ea",
  cyan: "#00b8d4",
  teal: "#00bfa5",
  green: "#00c853",
  "light green": "#64dd17",
  lime: "#aeea00",
  yellow: "#ffd600",
  amber: "#ffab00",
  orange: "#ff9100",
  "deep orange": "#ff3d00",
};

const TABS = [
  { id: "general", label: t("General") },
  { id: "theme", label: t("Theme") },
  { id: "features", label: t("Features") },
  { id: "plugins", label: t("Plugins") },
  { id: "extensions", label: t("Extensions") },
];

let model: ConfigModel | undefined;
let fields: GeneralField[] = [];
let activeTab = "general";

window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as { type: string; [k: string]: unknown };
  switch (msg.type) {
    case "model":
      model = msg.model as ConfigModel;
      fields = msg.fields as GeneralField[];
      render();
      break;
    case "error":
      showToast(String(msg.text));
      break;
  }
});

function render(): void {
  renderTabs();
  renderPage();
}

function renderTabs(): void {
  tabsEl.innerHTML = "";
  // The loop variable is named `tab`, not `t`: `t` is the translation function,
  // and shadowing it here would turn any future t("…") in this scope into a
  // runtime “t is not a function”.
  for (const tab of TABS) {
    const el = document.createElement("div");
    el.className = "tab" + (tab.id === activeTab ? " active" : "");
    el.textContent = tab.label;
    el.addEventListener("click", () => {
      activeTab = tab.id;
      render();
    });
    tabsEl.appendChild(el);
  }
}

function renderPage(): void {
  mainEl.innerHTML = "";
  if (!model) {
    mainEl.appendChild(text("p", t("Loading…")));
    return;
  }
  switch (activeTab) {
    case "general":
      renderGeneral();
      break;
    case "theme":
      renderTheme();
      break;
    case "features":
      renderToggles("features", t("Theme features"), model.features);
      break;
    case "plugins":
      renderToggles(
        "plugins",
        t("Plugins"),
        model.plugins,
        t("Disabling every plugin will remove the built-in search."),
      );
      break;
    case "extensions":
      renderToggles("extensions", t("Markdown extensions"), model.extensions);
      break;
  }
}

function renderGeneral(): void {
  mainEl.appendChild(text("h2", t("General settings")));
  for (const f of fields) {
    const value = model!.general[f.key] ?? "";
    mainEl.appendChild(
      scalarField(f.label, value, f.placeholder, (v) =>
        change({ kind: "scalar", path: [f.key], value: v }),
      ),
    );
  }
}

function renderTheme(): void {
  const theme = model!.theme;
  mainEl.appendChild(text("h2", t("Theme")));

  const row = div("row");
  row.appendChild(
    scalarField(t("Theme"), theme.name, "material", (v) =>
      change({ kind: "scalar", path: ["theme", "name"], value: v }),
    ),
  );
  row.appendChild(
    selectField(
      t("Language"),
      theme.language,
      [{ value: "", label: t("— default —") }, ...model!.catalogs.languages],
      (v) => change({ kind: "scalar", path: ["theme", "language"], value: v }),
    ),
  );
  mainEl.appendChild(row);

  if (theme.paletteMode === "list") {
    mainEl.appendChild(
      banner(
        t(
          "The palette is given as a list (a light/dark theme toggle). Changes are applied to the first scheme.",
        ),
      ),
    );
  }

  mainEl.appendChild(
    selectField(
      t("Color scheme"),
      theme.scheme,
      [{ value: "", label: t("— not set —") }, ...model!.catalogs.schemes],
      (v) => change({ kind: "palette", field: "scheme", value: v }),
    ),
  );

  mainEl.appendChild(text("div", t("Primary color"), "hint"));
  mainEl.appendChild(
    swatches(model!.catalogs.primary, PRIMARY_HEX, theme.primary, (v) =>
      change({ kind: "palette", field: "primary", value: v }),
    ),
  );

  mainEl.appendChild(text("div", t("Accent color"), "hint"));
  mainEl.appendChild(
    swatches(model!.catalogs.accent, ACCENT_HEX, theme.accent, (v) =>
      change({ kind: "palette", field: "accent", value: v }),
    ),
  );
}

function renderToggles(
  group: "features" | "plugins" | "extensions",
  title: string,
  items: ToggleItem[],
  note?: string,
): void {
  mainEl.appendChild(text("h2", title));
  if (note) {
    mainEl.appendChild(banner(note));
  }
  const grid = div("toggles");
  for (const item of items) {
    const label = document.createElement("label");
    label.className = "toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = item.enabled;
    cb.addEventListener("change", () =>
      change({ kind: "toggle", group, id: item.id, on: cb.checked }),
    );
    const span = document.createElement("span");
    span.textContent = item.label;
    span.title = item.id;
    label.append(cb, span);
    grid.appendChild(label);
  }
  mainEl.appendChild(grid);
}

// --- Widgets ---

function scalarField(
  label: string,
  value: string,
  placeholder: string | undefined,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.appendChild(document.createTextNode(label));
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  if (placeholder) {
    input.placeholder = placeholder;
  }
  input.addEventListener("change", () => onChange(input.value.trim()));
  wrap.appendChild(input);
  return wrap;
}

function selectField(
  label: string,
  value: string,
  options: { value: string; label: string }[],
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = document.createElement("label");
  wrap.className = "field";
  wrap.appendChild(document.createTextNode(label));
  const select = document.createElement("select");
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) {
      o.selected = true;
    }
    select.appendChild(o);
  }
  select.addEventListener("change", () => onChange(select.value));
  wrap.appendChild(select);
  return wrap;
}

function swatches(
  names: string[],
  hex: Record<string, string>,
  current: string,
  onPick: (v: string) => void,
): HTMLElement {
  const box = div("swatches");
  // “None” — resets the color.
  const none = document.createElement("div");
  none.className = "swatch" + (current === "" ? " active" : "");
  none.style.background =
    "linear-gradient(135deg, transparent 45%, var(--vscode-errorForeground) 45%, var(--vscode-errorForeground) 55%, transparent 55%)";
  none.style.border = "1px solid var(--vscode-widget-border, #8886)";
  none.title = t("Not set");
  none.addEventListener("click", () => onPick(""));
  box.appendChild(none);

  for (const name of names) {
    const sw = document.createElement("div");
    sw.className = "swatch" + (name === current ? " active" : "");
    sw.style.background = hex[name] ?? "#888";
    if (name === "white") {
      sw.style.border = "1px solid var(--vscode-widget-border, #8886)";
    }
    sw.title = name;
    sw.addEventListener("click", () => onPick(name));
    box.appendChild(sw);
  }
  return box;
}

function change(payload: ConfigChange): void {
  api.postMessage({ type: "change", change: payload });
}

// --- Utilities ---

function div(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function text(tag: string, content: string, className = ""): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = content;
  if (className) {
    el.className = className;
  }
  return el;
}

function banner(message: string): HTMLElement {
  return text("div", message, "banner");
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2000);
}

api.postMessage({ type: "ready" });
