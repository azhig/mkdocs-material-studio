# Releasing

## Before the first publication

The extension is published as `azhig.mkdocs-material-studio` — the publisher ID
in `package.json` plus the package name. That identifier is permanent: it is
what an installed copy is keyed by, so renaming the publisher later means a new
extension rather than an update of this one.

A publisher ID is created once at <https://marketplace.visualstudio.com/manage>
with a Microsoft account. That page alone is enough to publish — see “Publishing
by hand” below. Until the publisher exists, `vsce package` still works; only
`vsce publish` needs it.

**An Azure DevOps organization is not needed to publish, and is no longer free
to create.** A new organization must be linked to an active Azure subscription
(pay-as-you-go and the like — an Azure free trial is refused), so the “Continue”
button on the organization form stays dead until a subscription exists. The
organization matters only for issuing a Personal Access Token, and that route is
being retired anyway: global PATs in Azure DevOps stop working on **1 December
2026**, with Microsoft Entra ID (workload identity federation, managed
identities) as the replacement for automated publishing.

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

4. Get the new version onto `main` — through a pull request, or straight from
   here if you work on `main`:

   ```bash
   git commit -am "Release 0.2.0"
   git push
   ```

   The rest is `.github/workflows/release.yml`. A push to `main` whose
   `package.json` carries a version that has no tag yet **is** the release: the
   workflow runs the checks, builds the `.vsix`, tags the commit `v0.2.0`,
   creates a GitHub release with the package attached, and — if the `VSCE_PAT`
   secret exists — publishes to the Marketplace. A push that does not change the
   version stops at the first step, since the tag is already there.

   A tag pushed by hand (`git tag v0.2.0 && git push --tags`) still releases,
   for a version cut from somewhere other than `main`; the workflow refuses a
   tag that disagrees with `package.json`.

## Publishing by hand

The way that needs no token at all, and the one to use for the first release:

```bash
npm run vsix                                                 # mkdocs-material-studio-0.1.0.vsix
code --install-extension mkdocs-material-studio-0.1.0.vsix --force   # try it locally first
```

Then at <https://marketplace.visualstudio.com/manage/publishers/azhig>: **New
extension → Visual Studio Code**, and drop the `.vsix` on the form. A later
version goes to the same page as **Update**. The upload is validated
automatically; the status shows on that page.

An installed extension keeps the bundle it was installed with, so after
reinstalling a `.vsix` the VS Code window has to be reloaded (**Developer:
Reload Window**) and the visual editor tab reopened — an open webview does not
re-read `dist/`.

### With a token, while tokens still exist

```bash
npx vsce login azhig                          # asks for the token once
npx vsce publish --packagePath mkdocs-material-studio-0.1.0.vsix
```

The Personal Access Token is issued inside an Azure DevOps organization (**User
settings → Personal access tokens**, scope **Marketplace → Manage**, organization
**All accessible organizations**). Creating that organization now costs an Azure
subscription, and global PATs are retired on 1 December 2026 — so this is the
legacy path, kept here only because `.github/workflows/release.yml` still reads
the `VSCE_PAT` secret. Moving the workflow to Entra ID federation is the
replacement; an Entra app registration itself needs no subscription.

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
commit is on `main` — which the release workflow guarantees, since that is what
triggers it.

## What to check before publishing

- **`npm run vsix` and install the package locally.** The Extension Development
  Host does not catch everything: a missing file in the VSIX (`.vscodeignore`
  went too far) shows up only in a real installation.
- **The icon and the description.** They are what the Marketplace page is judged
  by; `assets/icon.png` is generated from the SVG by `npm run icon`.
- **The size of the package.** Around 5.8 MB in about a hundred files, most of
  it the icon pack — 14,342 glyphs in one `icons.pack` plus its index, which is
  deliberate (the picker reaches every one of them). A jump in either number
  means something slipped past `.vscodeignore`; thousands of files mean the pack
  was not built. To see the contents:

  ```bash
  npx vsce ls --tree
  ```

- **The VS Code version the package claims.** `engines.vscode` is `^1.90.0`, and
  `@types/vscode` is pinned to exactly `1.90.0` — no caret — so the compiler
  refuses an API that version does not have. A caret there would let npm install
  newer types, and a call added under them would only fail on a user's older VS
  Code. Reaching for a newer API means raising both together.
- **The language.** `mkdocsStudio.language` switches the interface; the bundles
  live in `assets/i18n/`. Keys missing from a bundle fall back to English, so a
  new user-visible string means updating `assets/i18n/*.json` too.
