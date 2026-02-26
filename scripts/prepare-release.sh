#!/bin/bash

# Script to prepare a signed release build
# Usage: ./scripts/prepare-release.sh

set -e

echo "ðŸ”‘ Checking for signing keys..."

if [ ! -f ~/.tauri/vibetube.key ]; then
  echo "âŒ Private key not found at ~/.tauri/vibetube.key"
  echo "Run: cd tauri && bun tauri signer generate -w ~/.tauri/vibetube.key"
  exit 1
fi

if [ ! -f ~/.tauri/vibetube.key.pub ]; then
  echo "âŒ Public key not found at ~/.tauri/vibetube.key.pub"
  exit 1
fi

echo "âœ… Signing keys found"
echo ""

# Check if public key is in tauri.conf.json
if grep -q "REPLACE_WITH_YOUR_PUBLIC_KEY" tauri/src-tauri/tauri.conf.json; then
  echo "âš ï¸  Public key not configured in tauri.conf.json"
  echo ""
  echo "Add this to tauri/src-tauri/tauri.conf.json:"
  echo ""
  cat ~/.tauri/vibetube.key.pub
  echo ""
  exit 1
fi

echo "ðŸ”§ Setting up environment..."

export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/vibetube.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

echo "âœ… Environment configured"
echo ""

echo "ðŸ“¦ Building release..."
echo ""

bun run build

echo ""
echo "âœ… Release build complete!"
echo ""
echo "ðŸ“‚ Bundles created in: tauri/src-tauri/target/release/bundle/"
echo ""
echo "Next steps:"
echo "1. Create a GitHub release"
echo "2. Upload all files from the bundle directory"
echo "3. Create latest.json with update metadata"
echo ""

