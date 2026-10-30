//go:build windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWebViewBootstrapRejectsChangedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "MicrosoftEdgeWebview2Setup.exe")
	if err := os.WriteFile(path, []byte("not the pinned Microsoft installer"), 0600); err != nil {
		t.Fatal(err)
	}
	if file, err := openVerifiedWebViewBootstrap(path); err == nil {
		file.Close()
		t.Fatal("Changed bootstrapper was accepted")
	}
	// Rejection must release the lock.
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
}

func TestWebViewBootstrapTrustAndLock(t *testing.T) {
	path, err := filepath.Abs(filepath.Join("vendor", "github.com", "wailsapp", "wails", "v2", "internal", "webview2runtime", "MicrosoftEdgeWebview2Setup.exe"))
	if err != nil {
		t.Fatal(err)
	}
	file, err := openVerifiedWebViewBootstrap(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	write, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err == nil {
		write.Close()
		t.Fatal("Verified bootstrapper can be modified while it is scheduled for execution")
	}
}
