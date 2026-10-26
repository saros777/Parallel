@echo off
chcp 65001 >nul
cd /d "%~dp0"
where go >nul 2>nul
if errorlevel 1 (
  echo Для сборки исходного кода требуется Go 1.26 или новее.
  echo Для запуска готового приложения Go НЕ нужен.
  pause
  exit /b 1
)
set GOOS=windows
set GOARCH=amd64
set CGO_ENABLED=0
go test ./...
if errorlevel 1 (
  pause
  exit /b 1
)
go build -trimpath -ldflags="-s -w -H=windowsgui" -o "..\Параллель.exe" .
if errorlevel 1 (
  pause
  exit /b 1
)
echo Готово: Параллель.exe в родительской папке.
pause
