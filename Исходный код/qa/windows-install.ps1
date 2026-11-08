$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$msi = Join-Path $root 'dist\Parallel-5.4-x64.msi'
$install = Join-Path $env:LOCALAPPDATA 'Programs\ParallelDesktop'
$data = Join-Path $env:LOCALAPPDATA 'ParallelSchool'
$scanner = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
$report = [ordered]@{
    version = '5.4.0'; sourceCommit = (git -C $root rev-parse HEAD)
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
$project = Join-Path $env:RUNNER_TEMP 'Parallel-5.4-School.parallel'
function Write-Fixture([string]$Marker = '') {
    $rawPath = Join-Path $env:RUNNER_TEMP 'parallel-fixture-state.json'
    node (Join-Path $PSScriptRoot 'project-fixture.cjs') $rawPath
    if ($LASTEXITCODE -ne 0) { throw 'Document fixture creation failed' }
    $raw = Get-Content -Raw -LiteralPath $rawPath
    if ($Marker) {
        $fixture = $raw | ConvertFrom-Json -AsHashtable
        $fixture.meta['installerVerificationMarker'] = $Marker
        $raw = $fixture | ConvertTo-Json -Depth 100 -Compress
    }
    $zip = [IO.Compression.ZipArchive]::new([IO.File]::Create($project), [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($entry in @(@('manifest.json','{"format":"parallel-schedule","version":1}'),@('state.json',$raw))) {
            $writer = [IO.StreamWriter]::new($zip.CreateEntry($entry[0]).Open(),[Text.UTF8Encoding]::new($false))
            try { $writer.Write($entry[1]) } finally { $writer.Dispose() }
        }
    } finally { $zip.Dispose() }
    New-Item -ItemType Directory -Force $data | Out-Null
    ('{"revision":0,"updated":"2026-11-03T00:00:00Z","state":'+$raw+'}') | Set-Content -LiteralPath (Join-Path $data 'workspace.json') -Encoding utf8NoBOM
    @{path=$project;savedRevision=0;recent=@($project)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $data 'project-session.json') -Encoding utf8NoBOM
}
function Run-NativeWindow([switch]$Association, [switch]$Warm, [string]$Executable = '', [string]$RunLabel = '') {
    if (-not $Executable) { $Executable = Join-Path $install 'Parallel.exe' }
    Write-Output "::notice title=Native startup test::Association=$Association"
    $timingPath = Join-Path $data 'startup-timing.json'
    Remove-Item -LiteralPath $timingPath -ErrorAction SilentlyContinue
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $app = if ($Association) { Start-Process $project -PassThru } else { Start-Process $Executable -PassThru }
    try {
        $ready = $false
        $forwarded = $false
        $secondary = $null
        $statePath = Join-Path $data 'workspace.json'
        for ($i = 0; $i -lt 160; $i++) {
            Start-Sleep -Milliseconds 250
            $app.Refresh()
            if ($app.HasExited) { throw 'Installed native application exited during startup' }
            if (-not $Warm -and -not $Association -and -not $forwarded -and $app.MainWindowHandle -ne 0) {
                $secondary = Start-Process (Join-Path $install 'Parallel.exe') -ArgumentList @("`"$project`"") -PassThru
                $forwarded = $true
            }
            if ($app.MainWindowHandle -ne 0 -and (Test-Path $timingPath)) {
                try {
                    $timing = Get-Content -Raw $timingPath | ConvertFrom-Json
                    if ($timing.stateJSONBytes -gt 0 -and $timing.stateIPCBytes -gt 0) {
                        if ($forwarded) {
                            $recovery = Get-Content -Raw $statePath | ConvertFrom-Json
                            if ($recovery.revision -lt 1 -or -not $recovery.project -or $recovery.project.path -ne $project) { continue }
                            if (-not $secondary.WaitForExit(1000) -or $secondary.ExitCode -ne 0) { throw 'Second instance did not forward the document request' }
                            $report.checks.secondInstanceDocumentRequest = 'passed; second process exited, first window activated the queued document'
                        }
                        $ready = $true; break
                    }
                } catch { }
            }
        }
        if (-not $ready) { throw 'Installed application did not complete frontend IPC/rendering' }
        $watch.Stop()
        Write-Output "::notice title=Native ready::$($timing | ConvertTo-Json -Compress)"
        if ($timing.stateIPCBytes -gt $timing.stateJSONBytes / 3) { throw 'Native IPC did not compress the full database' }
        $runName = if ($RunLabel) { $RunLabel } elseif ($Association) { 'afterRepairViaFileAssociation' } elseif ($Warm) { 'regularLaunch' } else { 'firstInstalledLaunch' }
        $report.checks[$runName] = @{elapsedMs=$timing.elapsedMs;observedReadyMs=$watch.ElapsedMilliseconds;stateJSONBytes=$timing.stateJSONBytes;stateIPCBytes=$timing.stateIPCBytes;stateReadMs=$timing.stateReadMs;statePackMs=$timing.statePackMs;frontend=$timing.frontend}
        if (Test-Path (Join-Path $data 'session.json')) { throw 'Native application started an HTTP session' }
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $app.Id)
        if ($listeners.Count) { throw 'Native application unexpectedly listens on TCP' }
        Start-Sleep -Milliseconds 250 # Allow the committed IPC reply to finish updating the document view.
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
    Write-Output '::notice title=Defender scans::MSI and executables passed'
    Invoke-Msi '/i' 'parallel-install.log'
    Write-Output '::notice title=MSI installed::Installation completed'
    foreach ($name in @('Parallel.exe','MicrosoftEdgeWebview2Setup.exe')) {
        $installed = Join-Path $install $name
        if ((Get-FileHash -LiteralPath $installed).Hash -ne (Get-FileHash -LiteralPath (Join-Path $root "dist\$name")).Hash) { throw "Installed file hash mismatch: $name" }
    }
    Scan-Path $install
    $report.checks.msiInstallAndInstalledPayloadScan = 'passed'
    $appZip = Join-Path $root 'dist\Parallel-5.4-App.zip'
    Compress-Archive -LiteralPath @((Join-Path $root 'dist\Parallel.exe'),(Join-Path $root 'dist\MicrosoftEdgeWebview2Setup.exe'),(Join-Path $root 'build\windows\README-app.txt')) -DestinationPath $appZip
    Scan-Path $appZip
    $unpacked = Join-Path $env:RUNNER_TEMP 'parallel-without-install'
    Expand-Archive -LiteralPath $appZip -DestinationPath $unpacked
    foreach ($name in @('Parallel.exe','MicrosoftEdgeWebview2Setup.exe')) {
        if ((Get-FileHash (Join-Path $unpacked $name)).Hash -ne (Get-FileHash (Join-Path $root "dist\$name")).Hash) { throw "Application ZIP mismatch: $name" }
    }
    $report.checks.applicationZipDefenderScan = 'passed'

    Write-Fixture
    Write-Output '::notice title=Schedule fixture::Full original database prepared'
    Copy-Item -LiteralPath $project -Destination (Join-Path $root 'dist\Parallel-5.4-School.parallel')
    Scan-Path (Join-Path $root 'dist\Parallel-5.4-School.parallel')
    Run-NativeWindow
    Run-NativeWindow -Warm
    Run-NativeWindow -Warm -Executable (Join-Path $unpacked 'Parallel.exe') -RunLabel 'withoutInstallationLaunch'
    $report.checks.installedNativeWindowIpcClose = 'passed; full 16421-lesson document; no HTTP listener'
    $statePath = Join-Path $data 'workspace.json'
    Write-Fixture 'preserve-existing-workspace'
    Invoke-Msi '/fa' 'parallel-repair.log'
    Run-NativeWindow -Association
    $state = Get-Content -Raw $statePath | ConvertFrom-Json
    if ($state.state.meta.installerVerificationMarker -ne 'preserve-existing-workspace') { throw 'Repair/restart replaced the existing workspace' }
    $report.checks.msiRepairAndExistingWorkspace = 'passed'
    $savedHash = (Get-FileHash -LiteralPath $statePath).Hash
    $projectHash = (Get-FileHash -LiteralPath $project).Hash
    Invoke-Msi '/x' 'parallel-uninstall.log'
    if (Test-Path (Join-Path $install 'Parallel.exe')) { throw 'Uninstall did not remove the application' }
    if ((Get-FileHash -LiteralPath $statePath).Hash -ne $savedHash) { throw 'Uninstall removed or changed the saved workspace' }
    if ((Get-FileHash -LiteralPath $project).Hash -ne $projectHash) { throw 'Uninstall removed or changed the schedule document' }
    $report.checks.msiUninstallPreservesWorkspace = 'passed'
    if ($report.checks.withoutInstallationLaunch.elapsedMs -gt 8000) { throw 'Extracted EXE startup exceeded 8 seconds' }
    $report.startupBudgetsMs = @{firstWebViewProfile=20000;regularLaunch=5000;fileAssociation=8000}
    if ($report.checks.regularLaunch.elapsedMs -gt 5000) { throw "Regular startup exceeded 5 seconds: $($report.checks.regularLaunch.elapsedMs) ms" }
    if ($report.checks.afterRepairViaFileAssociation.elapsedMs -gt 8000) { throw 'File association startup exceeded 8 seconds' }
    if ($report.checks.firstInstalledLaunch.elapsedMs -gt 20000) { throw 'First WebView2 profile initialization exceeded 20 seconds' }
    $threats = @(Get-MpThreat -ErrorAction Stop)
    if ($threats.Count) { throw "Defender recorded detections: $(($threats | ForEach-Object ThreatName) -join ', ')" }
    $report.verdict = 'All specified checks passed in this environment. This does not clear the reported 5.1 detection or guarantee identical results on another device.'
    $report.completedUtc = [DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $root 'dist\Parallel-5.4-Verification.json') -Encoding utf8NoBOM
} catch {
    $message = $_.Exception.Message -replace '[\r\n]+',' '
    Write-Output "::error title=Windows installer validation failed::$message"
    throw
}
