// The UI of the component insertion panel: the palette, the forms, the icon picker.

import { t } from "../shared/i18n";

interface FieldOption {
  value: string;
  label: string;
}
interface FieldDef {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox" | "number" | "icon";
  options?: FieldOption[];
  default?: string | number | boolean;
  placeholder?: string;
  help?: string;
  /** The field that picks this one's options, and the options per its value. */
  dependsOn?: string;
  optionsBy?: Record<string, FieldOption[]>;
}
interface ComponentMeta {
  id: string;
  label: string;
  category: string;
  icon: string;
  description?: string;
  fields: FieldDef[];
}

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
declare const window: Window & {
  __wizard?: { iconBase: string; nonce: string };
};

const api = acquireVsCodeApi();
const cfg = window.__wizard ?? { iconBase: "", nonce: "" };

const app = document.getElementById("app") as HTMLElement;
const toast = document.getElementById("toast") as HTMLElement;
const picker = document.getElementById("picker") as HTMLElement;
const pickerSearch = document.getElementById("pickerSearch") as HTMLInputElement;
const pickerGrid = document.getElementById("pickerGrid") as HTMLElement;

let components: ComponentMeta[] = [];
let iconNames: string[] = [];
let iconsRequested = false;
let currentIconField: { field: string; setValue: (v: string) => void } | undefined;

window.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as { type: string; [k: string]: unknown };
  switch (msg.type) {
    case "init":
      components = msg.components as ComponentMeta[];
      renderPalette();
      break;
    case "icons":
      iconNames = msg.names as string[];
      renderIconGrid("");
      break;
    case "edit": {
      const comp = components.find((c) => c.id === msg.id);
      if (comp) {
        renderForm(comp, msg.values as Record<string, unknown>, true);
      }
      break;
    }
    case "reset":
      renderPalette();
      break;
    case "inserted":
      showToast(t("Inserted ✓"));
      renderPalette();
      break;
    case "saved":
      showToast(t("Saved ✓"));
      break;
  }
});

function renderPalette(): void {
  const byCat = new Map<string, ComponentMeta[]>();
  for (const c of components) {
    const list = byCat.get(c.category) ?? [];
    list.push(c);
    byCat.set(c.category, list);
  }
  app.innerHTML = `<h2>${escapeHtml(t("Insert a component"))}</h2>`;
  for (const [cat, list] of byCat) {
    const catEl = el("div", "cat", cat);
    app.appendChild(catEl);
    const grid = el("div", "palette");
    for (const c of list) {
      const card = el("div", "card");
      card.innerHTML = `<span class="codicon codicon-${c.icon}"></span><span>${escapeHtml(c.label)}</span>`;
      card.title = c.description ?? c.label;
      card.addEventListener("click", () => renderForm(c));
      grid.appendChild(card);
    }
    app.appendChild(grid);
  }
}

function renderForm(
  component: ComponentMeta,
  prefill?: Record<string, unknown>,
  isEdit = false,
): void {
  const heading = isEdit ? t("Editing: {0}", component.label) : component.label;
  app.innerHTML = `<h2>${escapeHtml(heading)}</h2>`;
  const form = document.createElement("form");

  for (const field of component.fields) {
    form.appendChild(renderField(field));
  }

  const actions = el("div", "actions");
  const insertBtn = el("button", "", isEdit ? t("Save") : t("Insert")) as HTMLButtonElement;
  insertBtn.type = "submit";
  const backBtn = el("button", "secondary", t("← Back")) as HTMLButtonElement;
  backBtn.type = "button";
  backBtn.addEventListener("click", renderPalette);
  actions.append(insertBtn, backBtn);
  form.appendChild(actions);

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    api.postMessage({
      type: "insert",
      id: component.id,
      values: collectValues(form, component),
      edit: isEdit,
    });
  });

  app.appendChild(form);
  const refreshDependent = wireDependentFields(form, component);
  if (prefill) {
    applyValues(form, component, prefill);
    refreshDependent(); // the prefilled language decides which types are offered
  }
}

/**
 * Keeps a select whose choices belong to another field in step with it — the
 * diagram type follows the diagram language. Returns a function that re-applies
 * the dependency after the form has been filled programmatically (no `change`
 * event is fired then).
 */
function wireDependentFields(form: HTMLFormElement, component: ComponentMeta): () => void {
  const refreshers: Array<() => void> = [];
  for (const field of component.fields) {
    if (!field.dependsOn || !field.optionsBy) {
      continue;
    }
    const master = form.elements.namedItem(field.dependsOn);
    const slave = form.elements.namedItem(field.name);
    if (!(master instanceof HTMLSelectElement) || !(slave instanceof HTMLSelectElement)) {
      continue;
    }
    const fill = (): void => {
      const options = field.optionsBy?.[master.value] ?? field.options ?? [];
      const chosen = slave.value;
      slave.replaceChildren();
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.value;
        o.textContent = opt.label;
        slave.appendChild(o);
      }
      // A type both renderers know (a sequence diagram) survives the switch.
      slave.value = options.some((o) => o.value === chosen) ? chosen : (options[0]?.value ?? "");
    };
    master.addEventListener("change", fill);
    fill();
    refreshers.push(fill);
  }
  return () => refreshers.forEach((refresh) => refresh());
}

/** Pre-fills the form fields with values (for the editing mode). */
function applyValues(
  form: HTMLFormElement,
  component: ComponentMeta,
  values: Record<string, unknown>,
): void {
  for (const field of component.fields) {
    const node = form.elements.namedItem(field.name) as HTMLInputElement | HTMLSelectElement | null;
    if (!node || !(field.name in values)) {
      continue;
    }
    const value = values[field.name];
    if (field.type === "checkbox") {
      (node as HTMLInputElement).checked = Boolean(value);
    } else {
      node.value = String(value ?? "");
    }
  }
}

function renderField(field: FieldDef): HTMLElement {
  const wrap = document.createElement("label");
  wrap.appendChild(document.createTextNode(field.label));

  if (field.type === "select") {
    const select = document.createElement("select");
    select.name = field.name;
    for (const opt of field.options ?? []) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === field.default) {
        o.selected = true;
      }
      select.appendChild(o);
    }
    wrap.appendChild(select);
  } else if (field.type === "textarea") {
    const ta = document.createElement("textarea");
    ta.name = field.name;
    if (field.placeholder) {
      ta.placeholder = field.placeholder;
    }
    wrap.appendChild(ta);
  } else if (field.type === "checkbox") {
    const row = el("div", "row");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.name = field.name;
    cb.checked = field.default === true;
    row.appendChild(cb);
    wrap.appendChild(row);
  } else if (field.type === "icon") {
    wrap.appendChild(renderIconField(field));
  } else {
    const input = document.createElement("input");
    input.type = field.type === "number" ? "number" : "text";
    input.name = field.name;
    if (field.default !== undefined) {
      input.value = String(field.default);
    }
    if (field.placeholder) {
      input.placeholder = field.placeholder;
    }
    wrap.appendChild(input);
  }

  if (field.help) {
    wrap.appendChild(el("span", "help", field.help));
  }
  return wrap;
}

function renderIconField(field: FieldDef): HTMLElement {
  const box = el("div", "iconField");
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = field.name;
  hidden.value = String(field.default ?? "material-star");

  const preview = document.createElement("img");
  const setValue = (code: string) => {
    hidden.value = code;
    preview.src = iconSrc(code);
    label.textContent = code;
  };
  const btn = el("button", "secondary", t("Choose an icon")) as HTMLButtonElement;
  btn.type = "button";
  const label = el("span", "help", hidden.value);
  btn.addEventListener("click", () => openPicker(field.name, setValue));

  preview.src = iconSrc(hidden.value);
  box.append(hidden, preview, btn, label);
  return box;
}

function collectValues(form: HTMLFormElement, component: ComponentMeta): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of component.fields) {
    const el = form.elements.namedItem(field.name) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) {
      continue;
    }
    if (field.type === "checkbox") {
      values[field.name] = (el as HTMLInputElement).checked;
    } else if (field.type === "number") {
      values[field.name] = Number((el as HTMLInputElement).value);
    } else {
      values[field.name] = (el as HTMLInputElement).value;
    }
  }
  return values;
}

// --- Icon picker ---
function openPicker(field: string, setValue: (v: string) => void): void {
  currentIconField = { field, setValue };
  picker.classList.add("show");
  pickerSearch.value = "";
  pickerSearch.focus();
  if (!iconsRequested) {
    iconsRequested = true;
    api.postMessage({ type: "loadIcons" });
  } else {
    renderIconGrid("");
  }
}

pickerSearch.addEventListener("input", () =>
  renderIconGrid(pickerSearch.value.trim().toLowerCase()),
);

function renderIconGrid(query: string): void {
  const matches = (query ? iconNames.filter((n) => n.includes(query)) : iconNames).slice(0, 500);
  pickerGrid.innerHTML = "";
  for (const name of matches) {
    const cell = el("div", "ic");
    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = iconSrc(name);
    img.alt = name;
    cell.title = name;
    cell.appendChild(img);
    cell.addEventListener("click", () => {
      currentIconField?.setValue(name);
      picker.classList.remove("show");
    });
    pickerGrid.appendChild(cell);
  }
  if (matches.length === 0) {
    pickerGrid.appendChild(
      el("div", "help", iconNames.length ? t("Nothing found") : t("Loading…")),
    );
  }
}

function iconSrc(shortcode: string): string {
  const dash = shortcode.indexOf("-");
  if (dash < 0) {
    return "";
  }
  const set = shortcode.slice(0, dash);
  const rest = shortcode.slice(dash + 1);
  return `${cfg.iconBase}/${set}/${rest}.svg`;
}

// --- Utilities ---
function el(tag: string, className = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) {
    e.className = className;
  }
  if (text !== undefined) {
    e.textContent = text;
  }
  return e;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string): void {
  toast.textContent = text;
  toast.classList.add("show");
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
}

api.postMessage({ type: "ready" });
