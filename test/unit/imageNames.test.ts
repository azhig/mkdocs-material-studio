// Naming a pasted or dropped image. Whatever comes off the clipboard becomes a
// file in the author's project, so the odd cases are the point: no name at all,
// a name that is only punctuation, an extension that is really a query string.

import { describe, expect, it } from "vitest";
import { imageBaseName, imageCandidate, imageExt } from "../../src/wysiwyg/imageNames";

describe("imageExt", () => {
  it("prefers the MIME type", () => {
    expect(imageExt("image/png", "shot.jpg")).toBe("png");
    expect(imageExt("image/jpeg", "")).toBe("jpg");
    expect(imageExt("image/svg+xml", "")).toBe("svg");
    expect(imageExt("image/avif", "")).toBe("avif");
  });

  it("falls back to the name, lower-cased", () => {
    expect(imageExt("", "Screenshot.PNG")).toBe("png");
    expect(imageExt("application/octet-stream", "photo.JPEG")).toBe("jpeg");
  });

  it("falls back to png when neither says anything", () => {
    // A screenshot pasted from the clipboard arrives with no name at all.
    expect(imageExt("", "")).toBe("png");
    expect(imageExt("", "no-extension")).toBe("png");
    expect(imageExt("text/plain", "trailing.")).toBe("png");
  });
});

describe("imageBaseName", () => {
  it("keeps a plain name", () => {
    expect(imageBaseName("diagram.png")).toBe("diagram");
    expect(imageBaseName("v1.2-final.png")).toBe("v1.2-final");
  });

  it("takes the name out of a path", () => {
    expect(imageBaseName("/Users/me/Pictures/shot.png")).toBe("shot");
  });

  it("replaces what a file system will not take", () => {
    expect(imageBaseName("my photo (1).png")).toBe("my-photo-1");
    expect(imageBaseName("  spaced  .png")).toBe("spaced");
    expect(imageBaseName("a/b?c=d.png")).toBe("b-c-d");
  });

  it("never returns an empty name", () => {
    // An empty base would make the file `.png`: hidden on Unix, nameless in the
    // markdown, and the next paste would collide with it.
    expect(imageBaseName("")).toBe("image");
    expect(imageBaseName("???.png")).toBe("image");
    expect(imageBaseName("---.png")).toBe("image");
    expect(imageBaseName("...")).toBe("image");
  });

  it("does not leave a name starting or ending with a dot", () => {
    // Hidden on Unix, invalid on Windows. `.png` has no extension by node's
    // rules, so the whole thing is the base name.
    expect(imageBaseName(".png")).toBe("png");
    expect(imageBaseName("report..png")).toBe("report");
  });

  it("keeps a name written in any script", () => {
    // `\w` is ASCII: this used to reduce every one of these to “image”, in an
    // extension that ships in Russian, Chinese and Japanese.
    expect(imageBaseName("διάγραμμα.png")).toBe("διάγραμμα");
    expect(imageBaseName("设计图.png")).toBe("设计图");
    expect(imageBaseName("スクリーンショット.png")).toBe("スクリーンショット");
    expect(imageBaseName("café.jpg")).toBe("café");
    expect(imageBaseName("Größe 2.png")).toBe("Größe-2");
  });
});

describe("imageCandidate", () => {
  it("numbers everything but the first", () => {
    expect(imageCandidate("shot", "png", 0)).toBe("shot.png");
    expect(imageCandidate("shot", "png", 1)).toBe("shot-1.png");
    expect(imageCandidate("shot", "png", 42)).toBe("shot-42.png");
  });
});
