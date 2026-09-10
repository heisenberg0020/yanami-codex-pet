#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="八奈见的小卖部"
BUNDLE_ID="com.heisenberg.yanami-snack-club"
OUTPUT="$REPO_DIR/dist/$APP_NAME.app"
NODE_BIN=""
NODE_LICENSE=""
STAGING_ROOT=""

usage() {
  cat <<'USAGE'
用法：bash macos/build.sh [--output /完整路径/八奈见的小卖部.app] [--node /路径/node] [--node-license /路径/LICENSE]

先在仓库根目录执行 npm run build，生成 companion/dist。
默认把本机 Node 和纯内置模块服务一并打包，不复制 node_modules。
生成当前 Mac 架构的应用，使用本地 ad-hoc 签名；不代表已公证。
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      OUTPUT="$2"
      shift 2
      ;;
    --node)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      NODE_BIN="$2"
      shift 2
      ;;
    --node-license)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      NODE_LICENSE="$2"
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) printf '未知参数：%s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$OUTPUT" == *.app ]] || { printf '输出路径必须以 .app 结尾。\n' >&2; exit 2; }
[[ ! -L "$OUTPUT" ]] || { printf '输出路径不能是符号链接。\n' >&2; exit 2; }
[[ -f "$REPO_DIR/companion/dist/index.html" ]] || {
  printf '缺少 companion/dist/index.html，请先在仓库根目录执行 npm run build。\n' >&2
  exit 1
}
[[ -f "$REPO_DIR/companion/server.mjs" ]] || {
  printf '缺少 companion/server.mjs。\n' >&2
  exit 1
}
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || {
  printf '找不到 Node。请通过 --node 指定可执行文件。\n' >&2
  exit 1
}
NODE_BIN="$(cd "$(dirname "$NODE_BIN")" && pwd)/$(basename "$NODE_BIN")"
if [[ -z "$NODE_LICENSE" ]]; then
  NODE_LICENSE="$(dirname "$NODE_BIN")/../LICENSE"
fi
[[ -f "$NODE_LICENSE" ]] || {
  printf '找不到此 Node 发行版的 LICENSE，请通过 --node-license 指定其许可文件。\n' >&2
  exit 1
}
"$NODE_BIN" --check "$REPO_DIR/companion/server.mjs"
NODE_ARCH="$("$NODE_BIN" -p 'process.arch')"
HOST_ARCH="$(uname -m)"
if [[ "$HOST_ARCH" == "arm64" && "$NODE_ARCH" != "arm64" ]] ||
   [[ "$HOST_ARCH" == "x86_64" && "$NODE_ARCH" != "x64" ]]; then
  printf 'Node 架构与当前 Mac 不一致：Node=%s，Mac=%s。\n' "$NODE_ARCH" "$HOST_ARCH" >&2
  exit 1
fi

NON_SYSTEM_LIBS="$(/usr/bin/otool -L "$NODE_BIN" | awk 'NR > 1 {print $1}' | awk '$0 !~ /^\/System\/Library\// && $0 !~ /^\/usr\/lib\//')"
if [[ -n "$NON_SYSTEM_LIBS" ]]; then
  printf '此 Node 依赖包外动态库，不能只复制一个可执行文件：\n%s\n请改用独立 Node 发行版。\n' "$NON_SYSTEM_LIBS" >&2
  exit 1
fi
NODE_MIN_MACOS="$(/usr/bin/otool -l -arch "$HOST_ARCH" "$NODE_BIN" | awk '
  /cmd LC_BUILD_VERSION/ {block="build"; next}
  /cmd LC_VERSION_MIN_MACOSX/ {block="legacy"; next}
  block == "build" && $1 == "minos" {print $2; exit}
  block == "legacy" && $1 == "version" {print $2; exit}
')"
[[ "$NODE_MIN_MACOS" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || {
  printf '无法确认此 Node 的最低 macOS 版本。\n' >&2
  exit 1
}
MIN_MACOS="$(awk -v node="$NODE_MIN_MACOS" 'BEGIN {split(node,v,"."); print (v[1] >= 12 ? node : "12.0")}')"

OUTPUT_PARENT="$(dirname "$OUTPUT")"
mkdir -p "$OUTPUT_PARENT"
OUTPUT_PARENT="$(cd "$OUTPUT_PARENT" && pwd)"
OUTPUT="$OUTPUT_PARENT/$(basename "$OUTPUT")"

if [[ -e "$OUTPUT" ]]; then
  EXISTING_ID="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$OUTPUT/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$EXISTING_ID" == "$BUNDLE_ID" ]] || {
    printf '输出位置已有其它内容，未覆盖：%s\n' "$OUTPUT" >&2
    exit 1
  }
fi

STAGING_ROOT="$(mktemp -d "$OUTPUT_PARENT/.yanami-build.XXXXXX")"
cleanup() {
  if [[ -n "$STAGING_ROOT" && -d "$STAGING_ROOT" ]]; then
    rm -rf "$STAGING_ROOT"
  fi
}
trap cleanup EXIT

STAGED_APP="$STAGING_ROOT/$APP_NAME.app"
CONTENTS="$STAGED_APP/Contents"
RESOURCES="$CONTENTS/Resources"
mkdir -p "$CONTENTS/MacOS" "$RESOURCES/runtime" "$RESOURCES/companion" "$SCRIPT_DIR/.build/module-cache"

xcrun swiftc -swift-version 5 -O \
  -target "$HOST_ARCH-apple-macosx$MIN_MACOS" \
  -module-cache-path "$SCRIPT_DIR/.build/module-cache" \
  -framework AppKit -framework WebKit \
  "$SCRIPT_DIR/main.swift" \
  -o "$CONTENTS/MacOS/YanamiSnackClub"

cp "$NODE_BIN" "$RESOURCES/runtime/node"
chmod 755 "$RESOURCES/runtime/node"
cp "$NODE_LICENSE" "$RESOURCES/runtime/NODE-LICENSE.txt"
cp "$REPO_DIR"/companion/*.mjs "$RESOURCES/companion/"
cp -R "$REPO_DIR/companion/dist" "$RESOURCES/companion/dist"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>YanamiSnackClub</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.2.1</string>
  <key>CFBundleVersion</key><string>3</string>
  <key>LSMinimumSystemVersion</key><string>$MIN_MACOS</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

/usr/bin/plutil -lint "$CONTENTS/Info.plist"
/usr/bin/codesign --force --sign - --timestamp=none "$RESOURCES/runtime/node"
/usr/bin/codesign --force --sign - --timestamp=none "$STAGED_APP"
/usr/bin/codesign --verify --strict "$STAGED_APP"

if [[ -e "$OUTPUT" ]]; then
  BACKUP="$OUTPUT.backup-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mv "$OUTPUT" "$BACKUP"
  printf '上一版已保留：%s\n' "$BACKUP"
fi
mv "$STAGED_APP" "$OUTPUT"
printf '已构建：%s\n' "$OUTPUT"
printf '架构：%s；最低系统要求：macOS %s。\n' "$HOST_ARCH" "$MIN_MACOS"
printf '运行：open "%s"\n' "$OUTPUT"
printf '此结果只代表构建与签名检查完成，实际窗口操作需另行验收。\n'
