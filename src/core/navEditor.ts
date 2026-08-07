import { isMap, isScalar, isSeq, YAMLMap, YAMLSeq, type Document } from "yaml";

/**
 * Edits to the `nav` section of mkdocs.yml at the yaml AST level — preserving
 * comments and formatting. Nodes are moved by splicing the items array, which
 * carries the comments attached to a node along with it.
 *
 * NavPath is the path of indices from the nav root (e.g. [1, 0] — the first
 * child of the second top-level item).
 */
export type NavPath = number[];

/** Returns the root nav YAMLSeq, creating it if there is none. */
function ensureNavSeq(doc: Document): YAMLSeq {
  let nav = doc.get("nav");
  if (!isSeq(nav)) {
    nav = new YAMLSeq();
    doc.set("nav", nav);
  }
  return nav as YAMLSeq;
}

/** The container (YAMLSeq) holding the children at parentPath. */
function containerAt(doc: Document, parentPath: NavPath): YAMLSeq | undefined {
  let seq = doc.get("nav");
  if (!isSeq(seq)) {
    return undefined;
  }
  for (const index of parentPath) {
    const item = (seq as YAMLSeq).items[index];
    const childSeq = sectionSeq(item);
    if (!childSeq) {
      return undefined;
    }
    seq = childSeq;
  }
  return seq as YAMLSeq;
}

/** If the node is a section (map: title → seq), returns the nested seq. */
function sectionSeq(node: unknown): YAMLSeq | undefined {
  if (isMap(node) && node.items.length === 1) {
    const value = node.items[0].value;
    if (isSeq(value)) {
      return value;
    }
  }
  return undefined;
}

/** Moves the node at fromPath into the toParentPath container at position toIndex. */
export function moveNavItem(
  doc: Document,
  from: NavPath,
  toParent: NavPath,
  toIndex: number,
): boolean {
  const fromParent = containerAt(doc, from.slice(0, -1));
  const fromIndex = from[from.length - 1];
  if (!fromParent || fromIndex === undefined) {
    return false;
  }
  const node = fromParent.items[fromIndex];
  if (node === undefined) {
    return false;
  }

  const toContainer = containerAt(doc, toParent);
  if (!toContainer) {
    return false;
  }

  fromParent.items.splice(fromIndex, 1);
  // Correct the position if the removal happened in the same container to the left of the insertion.
  let target = toIndex;
  if (fromParent === toContainer && fromIndex < toIndex) {
    target -= 1;
  }
  target = Math.max(0, Math.min(target, toContainer.items.length));
  toContainer.items.splice(target, 0, node);
  return true;
}

/** Adds a page (title: path) to the parentPath container. */
export function addNavPage(
  doc: Document,
  parentPath: NavPath,
  title: string,
  filePath: string,
  index?: number,
): void {
  const container = parentPath.length === 0 ? ensureNavSeq(doc) : containerAt(doc, parentPath);
  if (!container) {
    return;
  }
  const node = doc.createNode({ [title]: filePath }) as unknown as YAMLMap;
  insertAt(container, node, index);
}

/** Adds a section (title: []) to the parentPath container. */
export function addNavSection(
  doc: Document,
  parentPath: NavPath,
  title: string,
  index?: number,
): void {
  const container = parentPath.length === 0 ? ensureNavSeq(doc) : containerAt(doc, parentPath);
  if (!container) {
    return;
  }
  const node = doc.createNode({ [title]: [] }) as unknown as YAMLMap;
  insertAt(container, node, index);
}

/** Renames a node (changes the title). Turns a bare path string into a map. */
export function renameNavItem(doc: Document, path: NavPath, newTitle: string): boolean {
  const parent = containerAt(doc, path.slice(0, -1));
  const index = path[path.length - 1];
  if (!parent || index === undefined) {
    return false;
  }
  const node = parent.items[index];
  if (isMap(node) && node.items.length === 1) {
    node.items[0].key = doc.createNode(newTitle);
    return true;
  }
  if (isScalar(node)) {
    parent.items[index] = doc.createNode({ [newTitle]: node.value }) as unknown as YAMLMap;
    return true;
  }
  return false;
}

/** Removes a node from nav. */
export function removeNavItem(doc: Document, path: NavPath): boolean {
  const parent = containerAt(doc, path.slice(0, -1));
  const index = path[path.length - 1];
  if (!parent || index === undefined || parent.items[index] === undefined) {
    return false;
  }
  parent.items.splice(index, 1);
  return true;
}

function insertAt(container: YAMLSeq, node: unknown, index?: number): void {
  if (index === undefined || index >= container.items.length) {
    container.items.push(node);
  } else {
    container.items.splice(Math.max(0, index), 0, node);
  }
}
