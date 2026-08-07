// @vitest-environment happy-dom
//
// Switching content tabs, and where the caret is left afterwards.
//
// A tab set is a row of labels tied to hidden radio buttons, so clicking a label
// changes what CSS shows and nothing else. The caret stays in the tab you came
// from — and the next insert lands there, in a tab that is no longer on screen.
// That is what a user hit: “I was trying to put a button on tab 2” and it went
// to tab 1, with nothing visible to explain it.

import { beforeEach, describe, expect, it } from "vitest";
import {
  initTabsGrids,
  openTabs,
  restoreOpenTabs,
  wireTabControls,
} from "../../webviews/visual/tabsGrids";

/**
 * The DOM the renderer produces for `=== "Tab 1"` / `=== "Tab 2"`. Each set gets
 * a radio group of its own — with a shared name the browser would treat two
 * sets as one group, and opening a tab in one would close the other.
 */
let setSeq = 0;
function tabSet(): HTMLElement {
  const id = ++setSeq;
  const host = document.createElement("div");
  host.innerHTML = [
    `<div class="tabbed-set" data-src-line="0" data-src-end="6">`,
    `<input checked id="__tabbed_${id}_1" name="__tabbed_${id}" type="radio">`,
    `<input id="__tabbed_${id}_2" name="__tabbed_${id}" type="radio">`,
    '<div class="tabbed-labels">',
    `<label for="__tabbed_${id}_1">Tab 1</label>`,
    `<label for="__tabbed_${id}_2">Tab 2</label>`,
    "</div>",
    '<div class="tabbed-content">',
    '<div class="tabbed-block"><p>first</p></div>',
    '<div class="tabbed-block"><p>second</p></div>',
    "</div>",
    "</div>",
  ].join("");
  document.body.appendChild(host);
  return host.firstElementChild as HTMLElement;
}

let caretWentTo: HTMLElement | null;

beforeEach(() => {
  document.body.textContent = "";
  caretWentTo = null;
  initTabsGrids({
    docEl: document.body,
    indentOfLine: () => "",
    rangedAncestor: (el) => el as HTMLElement | null,
    replaceLines: () => {},
    caretIntoBlock: (block) => {
      caretWentTo = block;
    },
  });
});

describe("clicking a tab takes the caret with it", () => {
  it("puts the caret in the tab that was opened", () => {
    const set = tabSet();
    wireTabControls(set);
    const labels = Array.from(set.querySelectorAll("label"));
    labels[1].click();
    expect(caretWentTo?.textContent).toBe("second");
  });

  it("puts it back when the first tab is opened again", () => {
    const set = tabSet();
    wireTabControls(set);
    const labels = Array.from(set.querySelectorAll("label"));
    labels[1].click();
    labels[0].click();
    expect(caretWentTo?.textContent).toBe("first");
  });

  it("leaves the caret alone while a label is being renamed", () => {
    // Renaming edits the label itself; moving the caret into the body would
    // take the focus away from what the user is typing.
    const set = tabSet();
    wireTabControls(set);
    const label = set.querySelectorAll("label")[1];
    label.setAttribute("contenteditable", "true");
    label.click();
    expect(caretWentTo).toBeNull();
  });
});

// Markdown has no way to say which tab is open, so every render shows the first
// one. A structural edit anywhere on the page — inserting a component, moving a
// block — rebuilds the DOM, and without carrying the choice across it threw the
// reader back to tab 1 of every set on the page, mid-sentence.
describe("the open tab survives a redraw", () => {
  it("reads which tab is open in each set", () => {
    const first = tabSet();
    const second = tabSet();
    expect(openTabs(document.body)).toEqual([0, 0]);
    second.querySelectorAll("input")[1].checked = true;
    expect(openTabs(document.body)).toEqual([0, 1]);
    first.querySelectorAll("input")[1].checked = true;
    expect(openTabs(document.body)).toEqual([1, 1]);
  });

  it("puts them back on the sets that came out of the render", () => {
    tabSet();
    tabSet();
    // What a fresh render looks like: the first tab of every set is checked.
    expect(openTabs(document.body)).toEqual([0, 0]);
    restoreOpenTabs(document.body, [1, 0]);
    expect(openTabs(document.body)).toEqual([1, 0]);
  });

  it("leaves a set alone when the remembered tab is gone", () => {
    // The set may have lost a tab in the same edit; a missing index must not
    // uncheck everything and leave the reader looking at an empty set.
    tabSet();
    restoreOpenTabs(document.body, [5]);
    expect(openTabs(document.body)).toEqual([0]);
  });
});
