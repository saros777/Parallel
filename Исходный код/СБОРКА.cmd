@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0build\windows\build.ps1"
if errorlevel 1 (
  echo Ошибка сборки. Нужны Go 1.26.10 и .NET SDK 8 для закреплённого WiX 5.0.2.
  pause
  exit /b 1
)
echo Готово: dist\Parallel.exe и dist\Parallel-5.2-x64.msi
pause
