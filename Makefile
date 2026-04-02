# Blip — Build, Sign, Notarize, Install
# Usage:
#   make              — full pipeline: build → sign → notarize → install
#   make release      — bump patch, commit, tag, push (CI builds it)
#   make release BUMP=minor  — bump minor version
#   make release BUMP=major  — bump major version
#   make local-release       — bump + build + sign + notarize + upload DMG
#   make build        — tauri release build + NE compile
#   make sign         — post-build signing only (no rebuild)
#   make notarize     — notarize + staple the DMG
#   make install      — install notarized app to /Applications
#   make dev          — run in dev mode (no notarization needed)
#   make clean        — remove build artifacts

SHELL := /bin/bash
ROOT  := $(shell pwd)
TAURI := $(ROOT)/src-tauri

# Load credentials from .env.apple (non-secret identifiers)
-include $(ROOT)/.env.apple

# Load secrets from emit's .env.github-secrets (APPLE_PASSWORD etc.)
# Falls back gracefully if file not found
SECRETS_FILE := $(HOME)/Development/Apps/emit/.env.github-secrets
-include $(SECRETS_FILE)

IDENTITY      := $(APPLE_SIGNING_IDENTITY)
APPLE_ID      ?= InfamousVagueRat@gmail.com
TEAM_ID       := F6ZAL7ANAD
VERSION       := $(shell node -e "console.log(require('./src-tauri/tauri.conf.json').version)")
APP_BUNDLE    := $(TAURI)/target/release/bundle/macos/Blip.app
DMG           := $(TAURI)/target/release/bundle/dmg/Blip_$(VERSION)_aarch64.dmg
INSTALL_PATH  := /Applications/Blip.app

.PHONY: all build sign notarize staple install dev release local-release clean help

## Default: full pipeline
all: build sign notarize install
	@echo ""
	@echo "✓ Done — Blip.app installed and notarized"

## Build NE + Tauri release
build:
	@echo "=== Building NE ==="
	cd $(TAURI) && bash scripts/build-ne.sh
	@echo "=== Building Tauri release ==="
	cd $(ROOT) && npm run tauri build -- --bundles app,dmg

## Post-build: place NE in bundle, embed profiles, sign everything
sign:
	@echo "=== Signing ==="
	cd $(TAURI) && bash scripts/post-build.sh

## Notarize the DMG with Apple
notarize:
	@echo "=== Notarizing ==="
	@if [ -z "$(APPLE_PASSWORD)" ]; then \
		echo "ERROR: APPLE_PASSWORD not set. Check $(SECRETS_FILE)"; exit 1; \
	fi
	xcrun notarytool submit "$(DMG)" \
		--apple-id "$(APPLE_ID)" \
		--team-id "$(TEAM_ID)" \
		--password "$(APPLE_PASSWORD)" \
		--wait

## Staple notarization ticket to DMG
staple:
	@echo "=== Stapling ==="
	xcrun stapler staple "$(DMG)"

## Install notarized app from DMG to /Applications
install: staple
	@echo "=== Installing ==="
	hdiutil attach "$(DMG)" -quiet -nobrowse -mountpoint /tmp/blip-dmg
	rm -rf "$(INSTALL_PATH)"
	ditto /tmp/blip-dmg/Blip.app "$(INSTALL_PATH)"
	hdiutil detach /tmp/blip-dmg -quiet
	@echo "Installed: $(INSTALL_PATH)"
	@spctl --assess --type execute --verbose "$(INSTALL_PATH)" 2>&1

## Dev mode — compile NE + run tauri dev (no notarization)
dev:
	@echo "=== Dev mode ==="
	cd $(TAURI) && bash scripts/build-ne.sh
	cd $(ROOT) && npm run tauri dev

## Bump version (patch), commit, tag, push — triggers CI release
## Usage: make release            (bumps patch: 0.3.0 → 0.3.1)
##        make release BUMP=minor (bumps minor: 0.3.0 → 0.4.0)
##        make release BUMP=major (bumps major: 0.3.0 → 1.0.0)
BUMP ?= patch

release:
	@CURRENT=$(VERSION); \
	IFS='.' read -r MAJOR MINOR PATCH <<< "$$CURRENT"; \
	if [ "$(BUMP)" = "major" ]; then \
		MAJOR=$$((MAJOR + 1)); MINOR=0; PATCH=0; \
	elif [ "$(BUMP)" = "minor" ]; then \
		MINOR=$$((MINOR + 1)); PATCH=0; \
	else \
		PATCH=$$((PATCH + 1)); \
	fi; \
	NEW="$$MAJOR.$$MINOR.$$PATCH"; \
	echo "=== Bumping $$CURRENT → $$NEW ==="; \
	node -e " \
		const fs = require('fs'); \
		const f = 'src-tauri/tauri.conf.json'; \
		const c = JSON.parse(fs.readFileSync(f, 'utf8')); \
		c.version = '$$NEW'; \
		fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n'); \
	"; \
	sed -i '' "s/^version = \"$$CURRENT\"/version = \"$$NEW\"/" src-tauri/Cargo.toml; \
	git add src-tauri/tauri.conf.json src-tauri/Cargo.toml; \
	git commit -m "Blip v$$NEW"; \
	git tag -a "v$$NEW" -m "Blip v$$NEW"; \
	git push origin main; \
	git push origin "v$$NEW"; \
	echo ""; \
	echo "✓ v$$NEW tagged and pushed — GitHub Actions will build the release"

## Local release: bump version, build + sign + notarize + upload to GitHub
## Usage: make local-release            (bumps patch)
##        make local-release BUMP=minor
local-release:
	@CURRENT=$(VERSION); \
	IFS='.' read -r MAJOR MINOR PATCH <<< "$$CURRENT"; \
	if [ "$(BUMP)" = "major" ]; then \
		MAJOR=$$((MAJOR + 1)); MINOR=0; PATCH=0; \
	elif [ "$(BUMP)" = "minor" ]; then \
		MINOR=$$((MINOR + 1)); PATCH=0; \
	else \
		PATCH=$$((PATCH + 1)); \
	fi; \
	NEW="$$MAJOR.$$MINOR.$$PATCH"; \
	echo "=== Bumping $$CURRENT → $$NEW ==="; \
	node -e " \
		const fs = require('fs'); \
		const f = 'src-tauri/tauri.conf.json'; \
		const c = JSON.parse(fs.readFileSync(f, 'utf8')); \
		c.version = '$$NEW'; \
		fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n'); \
	"; \
	sed -i '' "s/^version = \"$$CURRENT\"/version = \"$$NEW\"/" src-tauri/Cargo.toml; \
	git add src-tauri/tauri.conf.json src-tauri/Cargo.toml; \
	git commit -m "Blip v$$NEW"
	$(MAKE) all
	@NEW=$$(node -e "console.log(require('./src-tauri/tauri.conf.json').version)"); \
	DMG="$(TAURI)/target/release/bundle/dmg/Blip_$${NEW}_aarch64.dmg"; \
	git tag -a "v$$NEW" -m "Blip v$$NEW"; \
	git push origin main; \
	git push origin "v$$NEW"; \
	gh release create "v$$NEW" \
		"$$DMG" \
		--title "Blip v$$NEW" \
		--notes "See the assets to download and install this version." \
		--latest; \
	echo ""; \
	echo "✓ v$$NEW released and uploaded"

## Remove build artifacts
clean:
	rm -rf $(TAURI)/target/release/bundle
	rm -rf $(TAURI)/target/ne-build
	@echo "Cleaned"

help:
	@echo "Targets: all build sign notarize staple install dev release local-release clean"
	@echo ""
	@echo "  make release            — bump patch ($(VERSION) → next), tag, push to CI"
	@echo "  make release BUMP=minor — bump minor version"
	@echo "  make release BUMP=major — bump major version"
	@echo "  make local-release      — bump + full local build + upload to GitHub"
