$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$msi = Join-Path $root 'dist\Parallel-5.2-x64.msi'
$install = Join-Path $env:LOCALAPPDATA 'Programs\ParallelDesktop'
$data = Join-Path $env:LOCALAPPDATA 'ParallelSchool'
$scanner = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
$report = [ordered]@{
    version = '5.2.0'; sourceCommit = (git -C $root rev-parse HEAD)
    os = [Environment]::OSVersion.VersionString
    installerFormat = 'Windows Installer MSI'; installerScripts = 'none'
    applicationSignature = 'NotSigned: no publisher code-signing certificate provided'
    sampleSubmission = 'disabled; antivirus remains active'
    originalDetection = '5.1: Trojan:Win32/Wacatac.B!ml; cause unconfirmed; installer withdrawn'
    checks = [ordered]@{}
}
function Scan-Path([string]$Path) {
    & $scanner -Scan -ScanType 3 -File $Path
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Path)) { throw "Defender rejected $Path (exit $LASTEXITCODE)" }
}
function Invoke-Msi([string]$Operation, [string]$LogName) {
    $log = Join-Path $env:RUNNER_TEMP $LogName
    $p = Start-Process msiexec.exe -ArgumentList @($Operation, "`"$msi`"", '/qn', '/norestart', '/l*v', "`"$log`"") -Wait -PassThru
    if ($p.ExitCode -notin @(0,3010)) {
        if (Test-Path $log) { Select-String -Path $log -Pattern 'Error [0-9]+|Return value 3' | ForEach-Object { Write-Output $_.Line } }
        throw "MSI $Operation failed with exit $($p.ExitCode)"
    }
}
function Run-NativeWindow {
    $app = Start-Process (Join-Path $install 'Parallel.exe') -PassThru
    try {
        $ready = $false
        $statePath = Join-Path $data 'workspace.json'
        for ($i = 0; $i -lt 160; $i++) {
            Start-Sleep -Milliseconds 250
            $app.Refresh()
            if ($app.HasExited) { throw 'Installed native application exited during startup' }
            if ($app.MainWindowHandle -ne 0 -and (Test-Path $statePath)) {
                try {
                    $state = Get-Content -Raw $statePath | ConvertFrom-Json
                    if ($state.revision -ge 1 -and $state.state.preferences.studioSuspensions) { $ready = $true; break }
                } catch { }
            }
        }
        if (-not $ready) { throw 'Installed application did not complete frontend IPC/autosave' }
        if (Test-Path (Join-Path $data 'session.json')) { throw 'Native application started an HTTP session' }
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $app.Id)
        if ($listeners.Count) { throw 'Native application unexpectedly listens on TCP' }
        if (-not $app.CloseMainWindow() -or -not $app.WaitForExit(15000)) { throw 'Installed application did not save and close' }
        if ($app.ExitCode -ne 0) { throw "Native application failed at close: $($app.ExitCode)" }
    } finally { if (-not $app.HasExited) { $app.Kill() } }
}
try {
    $status = Get-MpComputerStatus
    if (-not $status.AMServiceEnabled -or -not $status.AntivirusEnabled) { throw 'Defender must be active' }
    $report.defender = [ordered]@{
        engine = $status.AMEngineVersion; platform = $status.AMProductVersion
        realTimeProtectionEnabled = $status.RealTimeProtectionEnabled
        signatures = $status.AntivirusSignatureVersion; signaturesUpdated = $status.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o')
    }
    if (Test-Path $data) { throw 'Dedicated clean Windows test machine required: default data folder already exists' }
    # Preserve the downloaded-file mark while scanning. Never unblock the file.
    foreach ($markedFile in @($msi, (Join-Path $root 'dist\Parallel.exe'), (Join-Path $root 'dist\MicrosoftEdgeWebview2Setup.exe'))) {
        Set-Content -LiteralPath $markedFile -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3`r`n"
    }
    Scan-Path $msi
    Scan-Path (Join-Path $root 'dist\Parallel.exe')
    Scan-Path (Join-Path $root 'dist\MicrosoftEdgeWebview2Setup.exe')
    $report.checks.defenderInstallerAndExecutables = 'passed; files retain Internet zone mark'
    Invoke-Msi '/i' 'parallel-install.log'
    foreach ($name in @('Parallel.exe','MicrosoftEdgeWebview2Setup.exe')) {
        $installed = Join-Path $install $name
        if ((Get-FileHash -LiteralPath $installed).Hash -ne (Get-FileHash -LiteralPath (Join-Path $root "dist\$name")).Hash) { throw "Installed file hash mismatch: $name" }
    }
    Scan-Path $install
    $report.checks.msiInstallAndInstalledPayloadScan = 'passed'
    Run-NativeWindow
    $report.checks.installedNativeWindowIpcAutosaveClose = 'passed; default data folder; no HTTP listener'
    $statePath = Join-Path $data 'workspace.json'
    $state = Get-Content -Raw $statePath | ConvertFrom-Json -AsHashtable
    $state.state.meta['installerVerificationMarker'] = 'preserve-existing-workspace'
    $state | ConvertTo-Json -Depth 100 -Compress | Set-Content -LiteralPath $statePath -Encoding utf8NoBOM
    Invoke-Msi '/fa' 'parallel-repair.log'
    Run-NativeWindow
    $state = Get-Content -Raw $statePath | ConvertFrom-Json
    if ($state.state.meta.installerVerificationMarker -ne 'preserve-existing-workspace') { throw 'Repair/restart replaced the existing workspace' }
    $report.checks.msiRepairAndExistingWorkspace = 'passed'
    $savedHash = (Get-FileHash -LiteralPath $statePath).Hash
    Invoke-Msi '/x' 'parallel-uninstall.log'
    if (Test-Path (Join-Path $install 'Parallel.exe')) { throw 'Uninstall did not remove the application' }
    if ((Get-FileHash -LiteralPath $statePath).Hash -ne $savedHash) { throw 'Uninstall removed or changed the saved workspace' }
    $report.checks.msiUninstallPreservesWorkspace = 'passed'
    $threats = @(Get-MpThreat -ErrorAction Stop)
    if ($threats.Count) { throw "Defender recorded detections: $(($threats | ForEach-Object ThreatName) -join ', ')" }
    $report.verdict = 'All specified checks passed in this environment. This does not clear the reported 5.1 detection or guarantee identical results on another device.'
    $report.completedUtc = [DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $root 'dist\Parallel-5.2-Verification.json') -Encoding utf8NoBOM
} catch {
    $message = $_.Exception.Message -replace '[\r\n]+',' '
    Write-Output "::error title=Windows installer validation failed::$message"
    throw
}
