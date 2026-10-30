Unicode True
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!ifndef APP_EXE
 !define APP_EXE "..\..\dist\Parallel.exe"
!endif
!ifndef WV2_SETUP
 !define WV2_SETUP "MicrosoftEdgeWebview2Setup.exe"
!endif
!ifndef OUTPUT
 !define OUTPUT "..\..\dist\Parallel-5.1-Setup.exe"
!endif
Name "Параллель 5.1"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\Parallel"
InstallDirRegKey HKCU "Software\ParallelSchool" "InstallDir"
RequestExecutionLevel user
ManifestDPIAware true
ManifestSupportedOS all
SetCompressor /SOLID lzma
Icon "app.ico"
UninstallIcon "app.ico"
VIProductVersion "5.1.0.0"
VIAddVersionKey /LANG=1049 "ProductName" "Параллель"
VIAddVersionKey /LANG=1049 "FileDescription" "Установка Параллель 5.1 для Windows 10 и выше"
VIAddVersionKey /LANG=1049 "FileVersion" "5.1.0"
VIAddVersionKey /LANG=1049 "ProductVersion" "5.1.0"
VIAddVersionKey /LANG=1049 "LegalCopyright" "Параллель"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Parallel.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить Параллель"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Russian"
Function .onInit
 ${IfNot} ${AtLeastWin10}
  MessageBox MB_ICONSTOP "Для приложения нужна Windows 10 или выше."
  Abort
 ${EndIf}
 ${IfNot} ${RunningX64}
  MessageBox MB_ICONSTOP "Для этой сборки нужна 64-разрядная Windows."
  Abort
 ${EndIf}
 SetShellVarContext current
 System::Call 'user32::FindWindowW(w "ParallelSchoolDesktop", p 0) p.r0'
 ${If} $0 != 0
  MessageBox MB_ICONSTOP "Закройте Параллель перед обновлением. Рабочая база будет сохранена."
  Abort
 ${EndIf}
FunctionEnd
Function CheckWebView2
 StrCpy $1 ""
 SetRegView 32
 ReadRegStr $1 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
 ${If} $1 == ""
  ReadRegStr $1 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
 ${EndIf}
 SetRegView 64
FunctionEnd
Section "Приложение"
 SetRegView 64
 Call CheckWebView2
 ${If} $1 == ""
 ${OrIf} $1 == "0.0.0.0"
  ; /SKIPWEBVIEW2 is for isolated installer QA, never the normal installation path.
  ${GetParameters} $R0
  ${GetOptions} $R0 "/SKIPWEBVIEW2" $R1
  ${If} ${Errors}
   InitPluginsDir
   File /oname=$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe "${WV2_SETUP}"
   DetailPrint "Проверяю подпись Microsoft WebView2…"
   ; Fail closed: do not execute the dependency if Windows cannot validate its signature.
   System::Call 'kernel32::SetEnvironmentVariableW(w "PARALLEL_WEBVIEW2_INSTALLER", w "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe")'
   nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "$$s=Get-AuthenticodeSignature -LiteralPath $$env:PARALLEL_WEBVIEW2_INSTALLER;if($$s.Status -eq $\'Valid$\' -and $$s.SignerCertificate.Subject -match $\'O=Microsoft Corporation$\'){exit 0};exit 1"'
   Pop $0
   Pop $2
   ${If} $0 != 0
    MessageBox MB_ICONSTOP "Не удалось проверить подпись Microsoft. Установка остановлена. Установите официальный Microsoft Edge WebView2 Runtime и повторите установку."
    Abort
   ${EndIf}
   DetailPrint "Устанавливаю системный WebView2. При отсутствии компонента требуется интернет…"
   ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe" /silent /install' $0
   Call CheckWebView2
   ${If} $1 == ""
   ${OrIf} $1 == "0.0.0.0"
    MessageBox MB_ICONSTOP "WebView2 не установлен. Установите Microsoft Edge WebView2 Runtime и повторите установку. База расписания не изменена."
    Abort
   ${EndIf}
  ${EndIf}
 ${EndIf}
 SetOutPath "$INSTDIR"
 File /oname=Parallel.exe "${APP_EXE}"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\Параллель"
 CreateShortcut "$SMPROGRAMS\Параллель\Параллель.lnk" "$INSTDIR\Parallel.exe"
 CreateShortcut "$DESKTOP\Параллель.lnk" "$INSTDIR\Parallel.exe"
 WriteRegStr HKCU "Software\ParallelSchool" "InstallDir" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ParallelSchool" "DisplayName" "Параллель 5.1"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ParallelSchool" "DisplayVersion" "5.1.0"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ParallelSchool" "DisplayIcon" "$INSTDIR\Parallel.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ParallelSchool" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ParallelSchool" "NoModify" 1
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ParallelSchool" "NoRepair" 1
SectionEnd
Section "Uninstall"
 SetRegView 64
 Delete "$INSTDIR\Parallel.exe"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 Delete "$DESKTOP\Параллель.lnk"
 Delete "$SMPROGRAMS\Параллель\Параллель.lnk"
 RMDir "$SMPROGRAMS\Параллель"
 DeleteRegKey HKCU "Software\ParallelSchool"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ParallelSchool"
 ; Never remove %LOCALAPPDATA%\ParallelSchool or its backups.
SectionEnd
