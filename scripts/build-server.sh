#!/bin/bash
# Build Python server binary for all platforms

set -e

# Determine platform
PLATFORM=$(rustc --print host-tuple 2>/dev/null || echo "unknown")

echo "Building vibetube-server for platform: $PLATFORM"

# Build Python binary
cd backend

# Check if PyInstaller is installed
if ! python -c "import PyInstaller" 2>/dev/null; then
    echo "Installing PyInstaller..."
    pip install pyinstaller
fi

# Build binary
python build_binary.py

# Create binaries directory if it doesn't exist
mkdir -p ../tauri/src-tauri/binaries

# Copy binary with platform suffix
if [ -f dist/vibetube-server ]; then
    cp dist/vibetube-server ../tauri/src-tauri/binaries/vibetube-server-${PLATFORM}
    chmod +x ../tauri/src-tauri/binaries/vibetube-server-${PLATFORM}
    echo "Built vibetube-server-${PLATFORM}"
elif [ -f dist/vibetube-server.exe ]; then
    cp dist/vibetube-server.exe ../tauri/src-tauri/binaries/vibetube-server-${PLATFORM}.exe
    echo "Built vibetube-server-${PLATFORM}.exe"
else
    echo "Error: Binary not found in dist/"
    exit 1
fi

echo "Build complete!"

