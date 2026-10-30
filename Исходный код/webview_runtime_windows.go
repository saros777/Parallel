//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"unsafe"

	"github.com/wailsapp/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
)

// This exact Microsoft bootstrapper is included in the pinned Wails dependency.
// Both its hash and its Windows Authenticode trust must pass before execution.
const webViewBootstrapSHA256 = "7ebc4ce80143ef89cea86a61ea151502868db6caaa678b8b43660a66ace11c3a"

func openVerifiedWebViewBootstrap(path string) (*os.File, error) {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	// Keep the file locked against replacement or modification until setup exits.
	handle, err := windows.CreateFile(ptr, windows.GENERIC_READ, windows.FILE_SHARE_READ, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, fmt.Errorf("не найден установщик Microsoft WebView2: %w", err)
	}
	file := os.NewFile(uintptr(handle), path)
	ok := false
	defer func() {
		if !ok {
			file.Close()
		}
	}()
	digest := sha256.New()
	if _, err = io.Copy(digest, file); err != nil {
		return nil, err
	}
	if hex.EncodeToString(digest.Sum(nil)) != webViewBootstrapSHA256 {
		return nil, fmt.Errorf("установщик Microsoft WebView2 изменён; запуск остановлен")
	}
	info := windows.WinTrustFileInfo{FilePath: ptr, File: handle}
	info.Size = uint32(unsafe.Sizeof(info))
	trust := windows.WinTrustData{
		UIChoice: windows.WTD_UI_NONE, RevocationChecks: windows.WTD_REVOKE_WHOLECHAIN,
		UnionChoice: windows.WTD_CHOICE_FILE, FileOrCatalogOrBlobOrSgnrOrCert: unsafe.Pointer(&info),
		StateAction: windows.WTD_STATEACTION_VERIFY,
		ProvFlags:   windows.WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT | windows.WTD_DISABLE_MD2_MD4,
	}
	trust.Size = uint32(unsafe.Sizeof(trust))
	err = windows.WinVerifyTrustEx(0, &windows.WINTRUST_ACTION_GENERIC_VERIFY_V2, &trust)
	trust.StateAction = windows.WTD_STATEACTION_CLOSE
	windows.WinVerifyTrustEx(0, &windows.WINTRUST_ACTION_GENERIC_VERIFY_V2, &trust)
	runtime.KeepAlive(info)
	runtime.KeepAlive(ptr)
	if err != nil {
		return nil, fmt.Errorf("Windows не подтвердила цифровую подпись Microsoft WebView2: %w", err)
	}
	ok = true
	return file, nil
}

func ensureWebView2() error {
	installed, err := webviewloader.GetAvailableCoreWebView2BrowserVersionString("")
	if err != nil {
		return fmt.Errorf("не удалось проверить Microsoft WebView2: %w", err)
	}
	if installed != "" {
		return nil
	}
	title, _ := windows.UTF16PtrFromString("Параллель — компонент окна")
	text, _ := windows.UTF16PtrFromString("Для окна приложения нужен Microsoft Edge WebView2 Runtime.\n\nУстановить официальный компонент Microsoft? Потребуется интернет.\n\nРасписание и рабочая база не изменятся.")
	answer, _, _ := windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x24)
	if answer != 6 { // IDYES; a refusal never starts the dependency installer.
		return fmt.Errorf("установка WebView2 отменена; для запуска нужен Microsoft Edge WebView2 Runtime")
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	setup := filepath.Join(filepath.Dir(exe), "MicrosoftEdgeWebview2Setup.exe")
	file, err := openVerifiedWebViewBootstrap(setup)
	if err != nil {
		return err
	}
	defer file.Close()
	cmd := exec.Command(setup, "/silent", "/install")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	installErr := cmd.Run()
	installed, err = webviewloader.GetAvailableCoreWebView2BrowserVersionString("")
	if err != nil || installed == "" {
		return fmt.Errorf("Microsoft WebView2 не установлен. Проверьте подключение к интернету и повторите запуск. Результат установки: %v", installErr)
	}
	return nil
}
