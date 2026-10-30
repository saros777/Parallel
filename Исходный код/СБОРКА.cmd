@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0build\windows\build.ps1"
if errorlevel 1 (
  echo Ошибка сборки. Нужны Go 1.26+ и NSIS 3.x.
  pause
  exit /b 1
)
echo Готово: dist\Parallel.exe и dist\Parallel-5.1-Setup.exe
pause
