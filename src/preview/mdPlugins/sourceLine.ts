import type MarkdownIt from "markdown-it";

/**
 * Sets data-src-line/data-src-end on block tokens — the basis for scroll sync
 * and click-to-edit (M6). The block type (blockType) is carried over from meta
 * into data-block-type so the webview knows which form to open.
 */
export function sourceLinePlugin(md: MarkdownIt): void {
  md.core.ruler.push("source_line", (state) => {
    const srcLines = state.src.split("\n");
    for (const token of state.tokens) {
      if (!token.map) {
        continue;
      }
      const isOpen = token.nesting === 1;
      const isSelfBlock = token.nesting === 0 && token.block;
      if (!isOpen && !isSelfBlock) {
        continue;
      }
      // For lists and definition lists markdown-it includes the trailing blank
      // separator line in the map. Leaving it inside the block's range means that
      // editing such a block wipes out the separator and glues the block to the
      // next one — so we trim it (for paragraphs and headings the map carries no
      // blank lines anyway).
      const start = token.map[0];
      let end = token.map[1];
      while (end > start + 1 && (srcLines[end - 1] ?? "").trim() === "") {
        end--;
      }
      token.attrSet("data-src-line", String(start));
      token.attrSet("data-src-end", String(end));
      const blockType = token.meta?.blockType;
      if (typeof blockType === "string") {
        token.attrSet("data-block-type", blockType);
      }
    }
    markAuthorStyle(state.tokens, srcLines);
  });
}

/**
 * Preserves the author's styling of a block: the list marker (`*`, `+`, `1)`),
 * the code fence character (`~~~`), the table alignment row, a setext heading.
 * Rendering does not depend on this, but without the hint the serializer would
 * rewrite the block into its own canonical form — and editing one paragraph
 * would change someone else's formatting in hand-written documents.
 */
function markAuthorStyle(tokens: ReturnType<typeof Object.values>, srcLines: string[]): void {
  const list = tokens as Array<{
    type: string;
    markup: string;
    map: [number, number] | null;
    attrSet: (name: string, value: string) => void;
  }>;
  let openList: (typeof list)[number] | null = null;
  for (const token of list) {
    switch (token.type) {
      case "bullet_list_open":
      case "ordered_list_open":
        openList = token;
        break;
      case "list_item_open":
        // An item's markup is “-”, “*”, “+”, or “.”, “)” for an ordered list.
        if (openList && token.markup) {
          openList.attrSet("data-marker", token.markup);
          openList = null;
        }
        break;
      case "fence":
        if (token.markup && token.markup[0] !== "`") {
          token.attrSet("data-fence", token.markup);
        }
        break;
      case "heading_open": {
        // A setext heading (underlined with “===” or “---”) instead of hashes.
        if (token.markup === "=" || token.markup === "-") {
          const under = token.map ? srcLines[token.map[1] - 1] : undefined;
          token.attrSet("data-setext", (under ?? token.markup).trim());
        }
        break;
      }
      case "table_open": {
        // The alignment row is written in different ways: “|:--|--:|”, “| --- | --- |”.
        const delim = token.map ? srcLines[token.map[0] + 1] : undefined;
        if (delim !== undefined) {
          token.attrSet("data-delim-row", delim.trim());
        }
        break;
      }
      default:
        break;
    }
  }
}
