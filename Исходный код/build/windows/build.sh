#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p dist
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -mod=vendor -buildvcs=false -trimpath -tags 'desktop,production,wv2runtime.error' -ldflags='-s -w -H=windowsgui' -o dist/Parallel.exe .
cp vendor/github.com/wailsapp/wails/v2/internal/webview2runtime/MicrosoftEdgeWebview2Setup.exe dist/
echo 'Native executable built. Build the MSI on Windows with build/windows/build.ps1 (Go + .NET SDK 8 + pinned WiX tool).'
