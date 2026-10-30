param([switch]$ExecutableOnly)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $root
try {
    New-Item -ItemType Directory -Force 'dist' | Out-Null
    $env:CGO_ENABLED = '0'
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    # Record provenance separately so checkout paths/state cannot change EXE bytes.
    go build -mod=vendor -buildvcs=false -trimpath -tags 'desktop,production,wv2runtime.error' -ldflags '-s -w -H=windowsgui' -o dist/Parallel.exe .
    if ($LASTEXITCODE -ne 0) { throw 'Go build failed' }
    $bootstrap = Join-Path $root 'vendor\github.com\wailsapp\wails\v2\internal\webview2runtime\MicrosoftEdgeWebview2Setup.exe'
    $signature = Get-AuthenticodeSignature -LiteralPath $bootstrap
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
        throw "Microsoft bootstrapper signature is not valid: $($signature.Status)"
    }
    Copy-Item -LiteralPath $bootstrap -Destination 'dist\MicrosoftEdgeWebview2Setup.exe'
    if ($ExecutableOnly) { return }
    # WiX is developer-only. The installed application needs no .NET or WiX.
    dotnet tool restore
    if ($LASTEXITCODE -ne 0) { throw 'WiX tool restore failed' }
    dotnet tool run wix extension add WixToolset.UI.wixext/5.0.2
    if ($LASTEXITCODE -ne 0) { throw 'WiX UI extension restore failed' }
    dotnet tool run wix build -arch x64 -culture ru-ru -ext WixToolset.UI.wixext -d "SourceDir=$root" -d "DistDir=$root\dist" -o dist/Parallel-5.2-x64.msi build/windows/installer.wxs
    if ($LASTEXITCODE -ne 0) { throw 'MSI build failed' }
    Write-Host 'MSI: dist/Parallel-5.2-x64.msi'
} finally { Pop-Location }
