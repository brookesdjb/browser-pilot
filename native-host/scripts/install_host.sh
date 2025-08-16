#!/bin/bash

# Browser Pilot Native Messaging Host Installer
# This script installs the native messaging host for the Browser Pilot Chrome extension
# Works on macOS and Linux systems

set -e

# Detect OS
PLATFORM=$(uname -s)

# Set variables
INSTALL_DIR=""
TARGET_DIR=""
MANIFEST_FILE="com.brookesdjb.browser_pilot.json"
EXTENSION_ID="EXTENSION_ID_PLACEHOLDER" # Replace during packaging
HOST_PATH=""
HOST_NAME="browser-pilot-host"

# Determine installation paths based on OS
if [ "$PLATFORM" == "Darwin" ]; then
    # macOS
    echo "Detected macOS platform"
    TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    INSTALL_DIR="$HOME/Library/Application Support/BrowserPilot"
elif [ "$PLATFORM" == "Linux" ]; then
    # Linux
    echo "Detected Linux platform"
    TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    INSTALL_DIR="$HOME/.local/share/browser-pilot"
else
    echo "Unsupported platform: $PLATFORM"
    echo "This installer only works on macOS and Linux."
    exit 1
fi

# Create installation directory if needed
mkdir -p "$INSTALL_DIR"
echo "Created installation directory: $INSTALL_DIR"

# Create target directory for manifest if needed
mkdir -p "$TARGET_DIR"
echo "Created target directory: $TARGET_DIR"

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PARENT_DIR="$( dirname "$SCRIPT_DIR" )"

# Copy host executable (assumed to be in the dist directory)
HOST_BINARY="$PARENT_DIR/dist/index.js"
HOST_PATH="$INSTALL_DIR/$HOST_NAME"

if [ ! -f "$HOST_BINARY" ]; then
    echo "Error: Could not find host binary at $HOST_BINARY"
    exit 1
fi

cp "$HOST_BINARY" "$HOST_PATH"
chmod +x "$HOST_PATH"
echo "Installed host executable to $HOST_PATH"

# Copy and customize manifest
MANIFEST_TEMPLATE="$PARENT_DIR/manifests/$MANIFEST_FILE"
MANIFEST_DEST="$TARGET_DIR/$MANIFEST_FILE"

if [ ! -f "$MANIFEST_TEMPLATE" ]; then
    echo "Error: Could not find manifest template at $MANIFEST_TEMPLATE"
    exit 1
fi

# Replace placeholders in manifest
sed -e "s|HOST_PATH_PLACEHOLDER|$HOST_PATH|g" \
    -e "s|EXTENSION_ID_PLACEHOLDER|$EXTENSION_ID|g" \
    "$MANIFEST_TEMPLATE" > "$MANIFEST_DEST"

echo "Installed manifest to $MANIFEST_DEST"

# Verify installation
if [ -f "$HOST_PATH" ] && [ -f "$MANIFEST_DEST" ]; then
    echo "Installation successful!"
    echo "Native messaging host installed at: $HOST_PATH"
    echo "Manifest installed at: $MANIFEST_DEST"
else
    echo "Installation failed. Please check the logs above."
    exit 1
fi

exit 0