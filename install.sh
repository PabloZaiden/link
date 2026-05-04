#!/bin/sh
set -e

# Link installer script
# Usage: curl -fsSL https://raw.githubusercontent.com/pablozaiden/link/main/install.sh | sh

REPO="pablozaiden/link"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
BINARY_NAME="link-cli"

make_temp_file() {
  case "$OS" in
    darwin) mktemp -t link-cli.XXXXXX ;;
    *) mktemp "${TMPDIR:-/tmp}/link-cli.XXXXXX" ;;
  esac
}

verify_checksum() {
  checksum_file=$1
  binary_file=$2

  if command -v sha256sum >/dev/null 2>&1; then
    (cd "$(dirname "$binary_file")" && sha256sum -c "$checksum_file")
  elif command -v shasum >/dev/null 2>&1; then
    (cd "$(dirname "$binary_file")" && shasum -a 256 -c "$checksum_file")
  else
    echo "Error: sha256sum or shasum is required to verify the downloaded binary."
    exit 1
  fi
}

detect_os() {
  case "$(uname -s)" in
    Linux*) echo "linux" ;;
    Darwin*) echo "darwin" ;;
    *) echo "unsupported" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64) echo "x64" ;;
    amd64) echo "x64" ;;
    aarch64) echo "arm64" ;;
    arm64) echo "arm64" ;;
    *) echo "unsupported" ;;
  esac
}

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required to install Link."
  exit 1
fi

OS=$(detect_os)
ARCH=$(detect_arch)

if [ "$OS" = "unsupported" ]; then
  echo "Error: Unsupported operating system: $(uname -s)"
  echo "Link supports Linux and macOS only."
  exit 1
fi

if [ "$ARCH" = "unsupported" ]; then
  echo "Error: Unsupported architecture: $(uname -m)"
  echo "Link supports x64 and arm64 architectures only."
  exit 1
fi

echo "Detected platform: $OS-$ARCH"

echo "Fetching latest release..."
LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
  echo "Error: Could not determine latest release version."
  exit 1
fi

echo "Latest version: $LATEST_TAG"

mkdir -p "$INSTALL_DIR"

ASSET_NAME="$BINARY_NAME-$LATEST_TAG-$OS-$ARCH"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/$LATEST_TAG/$ASSET_NAME"
CHECKSUM_NAME="$ASSET_NAME.sha256"
CHECKSUM_URL="$DOWNLOAD_URL.sha256"
TEMP_FILE=$(make_temp_file)
CHECKSUM_FILE=$(make_temp_file)

cleanup() {
  rm -f "$TEMP_FILE" "$CHECKSUM_FILE"
}

trap cleanup EXIT

echo "Downloading $ASSET_NAME..."
if ! curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_FILE"; then
  echo "Error: Failed to download from $DOWNLOAD_URL"
  exit 1
fi

echo "Downloading $CHECKSUM_NAME..."
if ! curl -fsSL "$CHECKSUM_URL" -o "$CHECKSUM_FILE"; then
  echo "Error: Failed to download checksum from $CHECKSUM_URL"
  exit 1
fi

echo "Verifying checksum..."
VERIFY_DIR=$(dirname "$TEMP_FILE")
VERIFY_FILE="$VERIFY_DIR/$ASSET_NAME"
mv "$TEMP_FILE" "$VERIFY_FILE"
verify_checksum "$CHECKSUM_FILE" "$VERIFY_FILE"
TEMP_FILE="$VERIFY_FILE"

mv "$TEMP_FILE" "$INSTALL_DIR/$BINARY_NAME"
TEMP_FILE=""
chmod +x "$INSTALL_DIR/$BINARY_NAME"
echo "Installed $BINARY_NAME to $INSTALL_DIR/$BINARY_NAME"

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    echo ""
    echo "Installation complete!"
    echo "Run '$BINARY_NAME web' to start Link."
    ;;
  *)
    echo ""
    echo "Warning: $INSTALL_DIR is not in your PATH."
    echo ""
    echo "Add it to your shell profile:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    echo ""
    echo "Or run directly with:"
    echo "  $INSTALL_DIR/$BINARY_NAME"
    ;;
esac
