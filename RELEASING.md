# Releasing

## Before the first publication

The extension is published as `azhig.mkdocs-material-studio` — the publisher ID
in `package.json` plus the package name. That identifier is permanent: it is
what an installed copy is keyed by, so renaming the publisher later means a new
extension rather than an update of this one.

A publisher ID is created once at <https://marketplace.visualstudio.com/manage>
(a Microsoft account plus an Azure DevOps organization). Until it exists, `vsce
package` still works — only `vsce publish` needs it.

The README's version badge reads the Marketplace, so until the first
publication it renders as “not found”. That resolves itself with the first
`vsce publish`; nothing needs editing.

## A release, step by step

1. Make sure the working tree is clean and everything passes:

   ```bash
   npm run check     # types, lint, formatting, tests
   npm run vsix      # the package builds
   ```

2. Update `CHANGELOG.md`: a new section at the top with the version and the
   changes. Write for the reader of the Marketplace page — what changed and why
   it matters, not which files were touched.

3. Bump the version. Semantic versioning: a breaking change to settings or to
   file behaviour is a major bump, a new feature is a minor one, a fix is a patch.

   ```bash
   npm version minor --no-git-tag-version   # 0.1.0 → 0.2.0
   ```

4. Commit and push the tag — the rest is done by `.github/workflows/release.yml`:

   ```bash
   git commit -am "Release 0.2.0"
   git tag v0.2.0
   git push && git push --tags
   ```

   The workflow verifies that the tag matches the version in `package.json`,
   runs the checks, builds the `.vsix`, creates a GitHub release with it, and —
   if the `VSCE_PAT` secret exists — publishes to the Marketplace.

## Publishing by hand

Useful for the very first release, when you want to see the result before
automating it:

```bash
npm run vsix                                  # mkdocs-material-studio-0.1.0.vsix
code --install-extension mkdocs-material-studio-0.1.0.vsix   # try it locally
npx vsce login <publisher>                    # asks for the token once
npx vsce publish --packagePath mkdocs-material-studio-0.1.0.vsix
```

The token (Personal Access Token) is issued in Azure DevOps with the
**Marketplace → Manage** scope. In CI it lives in the `VSCE_PAT` repository
secret.

## Screenshots for the Marketplace page

The page is judged by its pictures. Three live in `docs/images/` and are taken
by a script, so they can be redone whenever the interface moves:

```bash
npm run shots                     # all three
npm run shots -- --scene dark     # one of them
```

It drives the harness through a headless Chrome, which means the pictures show
the very bundle that ships in the VSIX rather than a mock-up. The scenes and the
document they use are at the top of `scripts/shoot-screenshots.mjs`.

Still missing is the visual `mkdocs.yml` editor: it has no harness page, so
that one has to be taken by hand from the Extension Development Host (`F5`).

**Where the pictures come from once the package is built.** `vsce` rewrites the
README's relative links into absolute ones under `raw.githubusercontent.com`,
built from `repository.url`. The rewritten README is what both the Marketplace
page and the extension page inside VS Code display, so **the image files in the
package are never read** — which is why `assets/demo.gif` and `docs/images/` are
excluded by `.vscodeignore`. Shipping them would be dead weight, not a fallback.

The rewrite points at the default branch, so a picture appears on the page only
after it is pushed. A new screenshot in a release commit is visible once that
commit is on `main` — which the release workflow guarantees, since it is
triggered by a tag on it.

## What to check before publishing

- **`npm run vsix` and install the package locally.** The Extension Development
  Host does not catch everything: a missing file in the VSIX (`.vscodeignore`
  went too far) shows up only in a real installation.
- **The icon and the description.** They are what the Marketplace page is judged
  by; `assets/icon.png` is generated from the SVG by `npm run icon`.
- **The size of the package.** About 10 MB of it is the Material icon set — that
  is deliberate (the icon picker searches 14,000+ glyphs), but a sudden jump
  means something extra slipped past `.vscodeignore`. To see the contents:

  ```bash
  npx vsce ls --tree
  ```

- **The language.** `mkdocsStudio.language` switches the interface; the bundles
  live in `assets/i18n/`. Keys missing from a bundle fall back to English, so a
  new user-visible string means updating `assets/i18n/*.json` too.
