#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="${PROJECT_ROOT}/flatpak-build"

echo "[clauded-build] Starting Flatpak build process..."
echo "[clauded-build] Project root: $PROJECT_ROOT"
echo "[clauded-build] Build directory: $BUILD_DIR"

# Step 1: Vendor crates if not already vendored
if [ ! -d "$PROJECT_ROOT/vendor" ]; then
    echo "[clauded-build] Vendoring crates..."
    cd "$PROJECT_ROOT"
    cargo vendor vendor/
    echo "[clauded-build] Crates vendored successfully"
else
    echo "[clauded-build] Vendor directory already exists, skipping vendor step"
fi

# Step 2: Create .cargo/config.toml for offline builds
echo "[clauded-build] Creating .cargo/config.toml for offline builds..."
mkdir -p "$PROJECT_ROOT/.cargo-home"
cat > "$PROJECT_ROOT/.cargo-home/config.toml" << 'EOF'
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "vendor"
EOF

# Step 3: Build with offline mode
echo "[clauded-build] Building with cargo (offline mode)..."
cd "$PROJECT_ROOT"
CARGO_HOME="$(pwd)/.cargo-home" cargo build --release --offline

# Step 4: Create build output directory
mkdir -p "$BUILD_DIR"

# Step 5: Copy binaries
echo "[clauded-build] Copying binaries to $BUILD_DIR..."
install -Dm755 target/release/clauded "$BUILD_DIR/clauded"
install -Dm755 target/release/clauded-hook "$BUILD_DIR/clauded-hook"

echo "[clauded-build] Build complete!"
echo "[clauded-build] Binaries available at:"
echo "[clauded-build]   - $BUILD_DIR/clauded"
echo "[clauded-build]   - $BUILD_DIR/clauded-hook"
