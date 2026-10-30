$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $root
try {
    New-Item -ItemType Directory -Force 'dist' | Out-Null
    $env:CGO_ENABLED = '0'
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    go build -mod=vendor -trimpath -tags 'desktop,production,wv2runtime.error' -ldflags '-s -w -H=windowsgui' -o dist/Parallel.exe .
    if ($LASTEXITCODE -ne 0) { throw 'Go build failed' }
    $makensis = Get-Command makensis.exe -ErrorAction SilentlyContinue
    $makensisPath = if ($makensis) { $makensis.Source } else { $null }
    if (-not $makensis) {
        $candidate = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'
        if (Test-Path $candidate) { $makensisPath = $candidate }
    }
    if (-not $makensisPath) { throw 'Install NSIS 3.x to build the installer. dist/Parallel.exe is already built.' }
    $exe = Join-Path $root 'dist\Parallel.exe'
    $setup = Join-Path $root 'vendor\github.com\wailsapp\wails\v2\internal\webview2runtime\MicrosoftEdgeWebview2Setup.exe'
    $output = Join-Path $root 'dist\Parallel-5.1-Setup.exe'
    & $makensisPath "/DAPP_EXE=$exe" "/DWV2_SETUP=$setup" "/DOUTPUT=$output" 'build\windows\installer.nsi'
    if ($LASTEXITCODE -ne 0) { throw 'NSIS build failed' }
    Write-Host "Installer: $output"
} finally { Pop-Location }
