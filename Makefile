# Blip — Build, Sign, Notarize, Install
# Usage:
#   make          — full release: build → post-build → notarize → install
#   make build    — tauri release build + NE compile
#   make sign     — post-build signing only (no rebuild)
#   make notarize — notarize + staple the DMG
#   make install  — install notarized app to /Applications
#   make dev      — run in dev mode (no notarization needed)
#   make clean    — remove build artifacts

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

.PHONY: all build sign notarize staple install dev clean help

## Default: full pipeline
all: build sign notarize install
	@echo ""
	@echo "✓ Done — Blip.app installed and notarized"

## Build NE + Tauri release
build:
	@echo "=== Building NE ==="
	cd $(TAURI) && bash scripts/build-ne.sh
	@echo "=== Building Tauri release ==="
	cd $(ROOT) && npm run tauri build

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

## Tag a release and push to GitHub (triggers CI workflow)
## Usage: make release
release:
	@echo "=== Releasing v$(VERSION) ==="
	git tag -a "v$(VERSION)" -m "Blip v$(VERSION)"
	git push origin "v$(VERSION)"
	@echo "✓ Tag v$(VERSION) pushed — GitHub Actions will build the release"

## Local release: build + sign + notarize + create GitHub release manually
## Usage: make local-release
local-release: all
	@echo "=== Creating GitHub release ==="
	gh release create "v$(VERSION)" \
		"$(DMG)" \
		--title "Blip v$(VERSION)" \
		--notes "See the assets to download and install this version." \
		--latest

## Remove build artifacts
clean:
	rm -rf $(TAURI)/target/release/bundle
	rm -rf $(TAURI)/target/ne-build
	@echo "Cleaned"

help:
	@echo "Targets: all build sign notarize staple install dev clean"
