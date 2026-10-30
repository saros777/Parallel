#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p dist
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -mod=vendor -trimpath -tags 'desktop,production,wv2runtime.error' -ldflags='-s -w -H=windowsgui' -o dist/Parallel.exe .
makensis -DAPP_EXE="$PWD/dist/Parallel.exe" -DWV2_SETUP="$PWD/vendor/github.com/wailsapp/wails/v2/internal/webview2runtime/MicrosoftEdgeWebview2Setup.exe" -DOUTPUT="$PWD/dist/Parallel-5.1-Setup.exe" build/windows/installer.nsi
