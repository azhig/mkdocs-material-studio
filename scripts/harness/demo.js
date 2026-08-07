// A scripted walk-through of the visual editor, used to record the README demo.
//
// Runs only when the page is opened with ?frame=N: the scenario is a flat list of
// steps, and the page replays steps 0…N with no delays and then stops. That way a
// frame is a pure function of its number — the recorder (scripts/record-demo.mjs)
// takes one screenshot per number and never has to race an animation.
//
// The harness debug panel is hidden here, and a mouse pointer and a caret are
// drawn on top: without them the clicks are invisible on the recording.

(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has("frame")) {
    return;
  }
  const target = Number(params.get("frame"));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const doc = () => document.getElementById("doc");
  const $ = (sel) => document.querySelector(sel);
  const byMenuName = (name) =>
    Array.from(document.querySelectorAll(".vmenu button")).find(
      (b) => b.querySelector(".vmenu-name")?.textContent.trim() === name,
    );
  /** A tab of the site header, by its label. */
  const tab = (name) =>
    Array.from(document.querySelectorAll("#vhead .mvh-tab")).find(
      (b) => b.textContent.trim() === name,
    );
  const byTitle = (root, title) =>
    Array.from(root.querySelectorAll("button")).find(
      (b) => (b.title || "").trim() === title || b.textContent.trim() === title,
    );

  // --- The pointer and the caret: drawn, not real ---

  let pointer;
  let caret;

  function chrome() {
    document.getElementById("hpanel")?.style.setProperty("display", "none");
    document.body.classList.add("demo-mode");

    const style = document.createElement("style");
    style.textContent = `
      .demo-mode { overflow: hidden; }
      #demoPointer {
        position: fixed; z-index: 99999; pointer-events: none;
        width: 22px; height: 22px; margin: -2px 0 0 -2px;
        transition: none;
      }
      #demoCaret {
        position: fixed; z-index: 99998; pointer-events: none;
        width: 2px; background: #1f6feb; border-radius: 1px;
      }
    `;
    document.head.appendChild(style);

    pointer = document.createElement("div");
    pointer.id = "demoPointer";
    pointer.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22">' +
      '<path d="M5 2l14 9-6 1.2 3.2 6.6-2.8 1.3-3.2-6.6L5 18z" fill="#fff" stroke="#222" stroke-width="1.4" stroke-linejoin="round"/>' +
      "</svg>";
    pointer.style.left = "-60px";
    pointer.style.top = "-60px";
    document.body.appendChild(pointer);

    caret = document.createElement("div");
    caret.id = "demoCaret";
    caret.style.display = "none";
    document.body.appendChild(caret);
  }

  /**
   * The recording opens on the sample site as a reader would see it: the header
   * with its tabs and the navigation panel. “On this page” is left out — three
   * columns on a 1180px frame leave the text too narrow to read.
   */
  function siteChrome() {
    const shown = (sel) => {
      const el = document.querySelector(sel);
      return el && getComputedStyle(el).display !== "none" && el.offsetHeight > 0;
    };
    if (!shown("#vhead")) {
      document.getElementById("tbSiteHead")?.click();
    }
    if (!shown("#vnav")) {
      document.getElementById("tbSiteNav")?.click();
    }
    if (shown("#vtoc")) {
      document.getElementById("tbToc")?.click();
    }
  }

  /** Puts the pointer over an element (or over a point of it). */
  function point(el, fx = 0.5, fy = 0.5) {
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    pointer.style.left = `${r.left + r.width * fx}px`;
    pointer.style.top = `${r.top + r.height * fy}px`;
  }

  /** Draws the caret at the current selection. */
  function showCaret() {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) {
      caret.style.display = "none";
      return;
    }
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      caret.style.display = "none";
      return;
    }
    caret.style.display = "block";
    caret.style.left = `${rect.right}px`;
    caret.style.top = `${rect.top}px`;
    caret.style.height = `${rect.height || 18}px`;
  }

  function hideCaret() {
    caret.style.display = "none";
  }

  /**
   * Clicks a point of an element the way a person would: the caret is placed
   * from the coordinates and the events carry them. Setting a Range by hand is
   * not enough — the editor decides which block is active from the caret, and a
   * synthetic click with no coordinates leaves it looking at the wrong one.
   */
  function clickAt(el, fx = 0.5, fy = 0.5) {
    if (!el) {
      return null;
    }
    const r = el.getBoundingClientRect();
    const x = r.left + r.width * fx;
    const y = r.top + r.height * fy;
    const hit = document.elementFromPoint(x, y) ?? el;
    const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
    if (range) {
      const sel = document.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    for (const type of ["mousedown", "mouseup", "click"]) {
      hit.dispatchEvent(
        new MouseEvent(type, { bubbles: true, view: window, clientX: x, clientY: y }),
      );
    }
    pointer.style.left = `${x}px`;
    pointer.style.top = `${y}px`;
    return { x, y };
  }

  /** Places the caret at the very end of an element (used before typing). */
  function caretAtEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    doc().focus();
    document.dispatchEvent(new Event("selectionchange"));
  }

  /** Selects `count` characters of an element starting at `from`. */
  function selectText(el, from, count) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    let seen = 0;
    let start = null;
    let end = null;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (start === null && seen + len >= from) {
        start = [node, from - seen];
      }
      if (start !== null && seen + len >= from + count) {
        end = [node, from + count - seen];
        break;
      }
      seen += len;
    }
    if (!start || !end) {
      return;
    }
    const range = document.createRange();
    range.setStart(start[0], start[1]);
    range.setEnd(end[0], end[1]);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }

  function type(text) {
    doc().focus();
    document.execCommand("insertText", false, text);
    showCaret();
  }

  // --- The scenario ---

  const PHRASE = " Type straight into the rendered page.";
  const CHUNK = 6;

  /** The paragraph the typing happens in — looked up afresh: every edit
      re-renders #doc, and a reference captured earlier points at a detached node. */
  const intro = () => Array.from(doc().children).find((el) => el.tagName === "P");
  /** The admonition inserted along the way. */
  let inserted;

  const steps = [];
  const step = (fn) => steps.push(fn);
  const hold = (n = 1) => {
    for (let i = 0; i < n; i++) {
      steps.push(async () => {});
    }
  };

  // 1. Typing and formatting
  step(async () => {
    point(intro(), 0.62, 0.5);
  });
  step(async () => {
    clickAt(intro(), 0.62, 0.5);
    await sleep(60);
    caretAtEnd(intro());
    showCaret();
  });
  for (let i = 0; i < Math.ceil(PHRASE.length / CHUNK); i++) {
    step(async () => {
      type(PHRASE.slice(i * CHUNK, (i + 1) * CHUNK));
    });
  }
  hold(2);
  step(async () => {
    const text = intro().textContent;
    const at = text.indexOf("rendered page");
    hideCaret();
    selectText(intro(), at, "rendered page".length);
    await sleep(60);
  });
  hold(1);
  step(async () => {
    const bubble = $(".vbubble");
    point(bubble ? bubble.querySelector("button") : $("#tbBold"), 0.5, 0.5);
  });
  step(async () => {
    const bubble = $(".vbubble");
    (bubble ? bubble.querySelector("button") : $("#tbBold")).click();
    await sleep(80);
  });
  hold(2);
  step(async () => {
    // Collapsing the selection dismisses the bubble menu — otherwise it hangs
    // over the insert menu of the next scene.
    caretAtEnd(intro());
    hideCaret();
    await sleep(80);
  });

  // 2. Inserting a component
  step(async () => {
    point($("#tbComponent"));
  });
  step(async () => {
    $("#tbComponent").click();
    await sleep(120);
  });
  step(async () => {
    point(byMenuName("Admonitions"), 0.3, 0.5);
  });
  hold(1);
  step(async () => {
    byMenuName("Admonitions").click();
    await sleep(150);
  });
  step(async () => {
    point(byTitle($(".vpop"), "Tip"));
  });
  step(async () => {
    byTitle($(".vpop"), "Tip").click();
    await sleep(60);
  });
  step(async () => {
    point(byTitle($(".vpop"), "Insert"));
  });
  step(async () => {
    // Remember what was there: the document already has admonitions of its own,
    // and the new block has to be told from them by identity, not by position.
    const before = new Set(doc().querySelectorAll(".admonition"));
    byTitle($(".vpop"), "Insert").click();
    await sleep(300);
    inserted = Array.from(doc().querySelectorAll(".admonition")).find((el) => !before.has(el));
  });
  hold(2);

  // 3. The block menu
  step(async () => {
    const body = inserted?.querySelector("p:last-child") ?? inserted;
    clickAt(body, 0.25, 0.5);
    await sleep(200);
    hideCaret();
  });
  step(async () => {
    point($("#vhandle"));
  });
  step(async () => {
    $("#vhandle").click();
    await sleep(200);
  });
  hold(2);
  // Collapsing rather than changing the type: the block carries the title of the
  // type it was inserted with, and a “Tip” under a warning icon reads as a bug.
  step(async () => {
    const menu = $(".vpop");
    point(menu ? (byTitle(menu, "Collapsed ▸") ?? menu.querySelector("button")) : null);
  });
  step(async () => {
    const menu = $(".vpop");
    (byTitle(menu, "Collapsed ▸") ?? menu.querySelector("button")).click();
    await sleep(300);
  });
  hold(3);

  // 4. An annotation: inserted at the caret, then opened by its marker
  step(async () => {
    // 0.6 of the width, not 0.9: the paragraph box is wider than its text, and a
    // click past the last word leaves the editor without a caret — “Place the
    // cursor in the text to annotate”.
    clickAt(intro(), 0.6, 0.5);
    await sleep(150);
    hideCaret();
    point($("#tbComponent"));
  });
  step(async () => {
    $("#tbComponent").click();
    await sleep(200);
  });
  step(async () => {
    point(byMenuName("Annotations"), 0.3, 0.5);
  });
  step(async () => {
    // An annotation is placed at the caret, and clicking the toolbar took the
    // caret away — put it back into the paragraph before choosing the item.
    caretAtEnd(intro());
    await sleep(60);
    byMenuName("Annotations").click();
    await sleep(600);
  });
  step(async () => {
    // Inserting opens the note in an editor of its own straight away.
    if ($(".vsub-box")) {
      doc().focus();
      document.execCommand("insertText", false, "Hover the plus to read this.");
      showCaret();
    }
    await sleep(150);
  });
  hold(1);
  step(async () => {
    hideCaret();
    point($(".vsub-done"));
  });
  step(async () => {
    $(".vsub-done")?.click();
    await sleep(500);
  });
  hold(1);
  step(async () => {
    point($("#doc .md-annotation"));
  });
  step(async () => {
    $("#doc .md-annotation")?.click();
    await sleep(400);
  });
  hold(3);
  step(async () => {
    // Dismiss the tip before moving on.
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, view: window }));
    await sleep(200);
  });

  // 5. A diagram: the dialog with the code and a live preview
  step(async () => {
    clickAt(intro(), 0.5, 0.5);
    await sleep(120);
    hideCaret();
    point($("#tbComponent"));
  });
  step(async () => {
    $("#tbComponent").click();
    await sleep(200);
  });
  step(async () => {
    point(byMenuName("Diagrams"), 0.3, 0.5);
  });
  step(async () => {
    byMenuName("Diagrams").click();
    // mermaid is loaded on demand — the first render of the preview takes a beat.
    await sleep(1200);
  });
  hold(4);
  step(async () => {
    const foot = $(".vmodal-foot");
    point(foot ? (byTitle(foot, "Insert") ?? foot.querySelector("button:last-child")) : null);
  });
  step(async () => {
    const foot = $(".vmodal-foot");
    (byTitle(foot, "Insert") ?? foot?.querySelector("button:last-child"))?.click();
    await sleep(1200);
  });
  hold(4);

  // 6. Another tab of the site: the page changes, and so does the panel under it
  step(async () => {
    document.body.click();
    point(tab("Reference"));
  });
  hold(1);
  step(async () => {
    tab("Reference")?.click();
    // The page is fetched and re-rendered; the diagrams of the new one warm up.
    await sleep(900);
  });
  hold(3);
  step(async () => {
    const item = Array.from(document.querySelectorAll("#vnav .mvn-page")).find((b) =>
      b.textContent.trim().startsWith("Questions"),
    );
    point(item);
  });
  step(async () => {
    const item = Array.from(document.querySelectorAll("#vnav .mvn-page")).find((b) =>
      b.textContent.trim().startsWith("Questions"),
    );
    item?.click();
    await sleep(900);
  });
  hold(3);

  // 7. The dark theme — the page, the header and the panels follow it
  step(async () => {
    point($("#tbTheme"));
  });
  step(async () => {
    $("#tbTheme").click();
    await sleep(200);
  });
  hold(4);

  // The recorder reads the step count off the DOM (--dump-dom) to know how many
  // screenshots to take.
  window.__demoFrames = steps.length;
  document.body.setAttribute("data-demo-frames", String(steps.length));

  /**
   * Waits for the page of the sample project. The harness fetches it over HTTP,
   * so an early frame would otherwise catch the placeholder document.
   */
  async function ready() {
    for (let i = 0; i < 400; i++) {
      const h1 = doc()?.querySelector("h1");
      if (h1 && h1.textContent.trim().startsWith("Writing")) {
        return;
      }
      await sleep(25);
    }
  }

  (async () => {
    await ready();
    chrome();
    siteChrome();
    await sleep(60);
    for (let i = 0; i <= target && i < steps.length; i++) {
      try {
        await steps[i]();
      } catch (err) {
        // A step that fails must not swallow the whole recording: the frame is
        // still taken, and the recorder prints what went wrong.
        const message = `step ${i}: ${err && err.message ? err.message : String(err)}`;
        document.body.setAttribute("data-demo-error", message);
        console.error("demo:", message);
      }
    }
    // The recorder waits for this attribute: everything is drawn, take the shot.
    document.body.setAttribute("data-demo-ready", String(target));
  })();
})();
