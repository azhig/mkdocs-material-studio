# Shortcuts for everyday work. Every target maps to an npm script, so the same
# commands work in CI without make being installed — and so that this file has
# nothing of its own to fall out of date. `test/unit/makefile.test.ts` checks
# that no npm script is missing a target here.

.DEFAULT_GOAL := help
.PHONY: help install build watch package compile lint lint-fix format format-check \
        test test-coverage test-integration check harness demo shots icon vsix assets clean

help: ## Show this help
	@grep -E '^[a-z-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm install

build: ## Build the extension and the webview bundles into dist/
	npm run build

watch: ## Rebuild on every change
	npm run watch

package: ## Production build of the bundles (minified, no sourcemaps)
	npm run package

compile: ## Type check all four tsconfig projects (tsc --noEmit)
	npm run compile

lint: ## Run ESLint
	npm run lint

lint-fix: ## Run ESLint and fix what can be fixed
	npm run lint:fix

format: ## Format the sources with Prettier
	npm run format

format-check: ## Verify formatting without changing files
	npm run format:check

test: ## Run the unit tests
	npm run test:unit

test-coverage: ## Run the unit tests with a coverage report in coverage/
	npm run test:coverage

test-integration: ## Smoke tests inside a real VS Code (downloads one on first run)
	npm run test:integration

check: ## Everything CI checks: types, lint, formatting, tests
	npm run check

harness: ## Start the dev harnesses at http://localhost:8931
	npm run harness

demo: ## Record assets/demo.gif from the harness (macOS, needs Chrome)
	npm run demo

shots: ## Take the Marketplace screenshots into docs/images/ (macOS, needs Chrome)
	npm run shots

icon: ## Rebuild assets/icon.png from assets/icon.svg (macOS)
	npm run icon

assets: ## Re-download the Material CSS and icons from the mkdocs-material wheel
	node scripts/fetch-material-assets.mjs

vsix: ## Build the installable .vsix package
	npm run vsix

clean: ## Remove build output, packages and coverage reports
	rm -rf dist coverage *.vsix
