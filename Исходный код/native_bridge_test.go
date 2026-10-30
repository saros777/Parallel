package main

import (
	"encoding/base64"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDesktopBridgePreservesBaseAndExceptions(t *testing.T) {
	dir := t.TempDir()
	bridge, err := newDesktopBridge(dir)
	if err != nil {
		t.Fatal(err)
	}
	got := bridge.Request("/api/state", "GET", "")
	if got.Status != 200 {
		t.Fatal(got)
	}
	var data Envelope
	if err = json.Unmarshal([]byte(got.Body), &data); err != nil {
		t.Fatal(err)
	}
	var state map[string]any
	json.Unmarshal(data.State, &state)
	state["baseSchedule"] = map[string]any{"week": "2026-09-07", "lessons": []any{map[string]any{"id": "custom-template", "slot": 6}}}
	state["overrides"] = map[string]any{"weekly-exception": map[string]any{"slot": 3}}
	data.State, _ = json.Marshal(state)
	payload, _ := json.Marshal(data)
	saved := bridge.Request("/api/state", "PUT", string(payload))
	if saved.Status != 200 {
		t.Fatal(saved)
	}
	if bridge.Request("/api/state", "PUT", string(payload)).Status != 409 {
		t.Fatal("Stale write accepted")
	}
	reopened, err := newDesktopBridge(dir)
	if err != nil {
		t.Fatal(err)
	}
	actual := reopened.Request("/api/state", "GET", "")
	if !strings.Contains(actual.Body, "custom-template") || !strings.Contains(actual.Body, "weekly-exception") {
		t.Fatal("Native mode lost base or weekly exception")
	}
	if _, err := os.Stat(filepath.Join(dir, "session.json")); !os.IsNotExist(err) {
		t.Fatal("Native bridge must not create an HTTP server session")
	}
	if reopened.Request("/api/unknown", "GET", "").Status != 404 {
		t.Fatal("Unknown IPC path accepted")
	}
}
func TestDesktopAssetsSelectNativeBeforeBoot(t *testing.T) {
	sub, _ := fs.Sub(bundled, "ui")
	assets := desktopAssets{sub}
	raw, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	config := strings.Index(text, "window.DESKTOP={native:true")
	if config < 0 || config > strings.Index(text, "desktop-bridge.js") {
		t.Fatal("Native transport not selected before frontend boot")
	}
	if _, err = fs.ReadFile(assets, "studio.js"); err != nil {
		t.Fatal(err)
	}
}
func TestDesktopSaveDialogAndShutdown(t *testing.T) {
	b, _ := newDesktopBridge(t.TempDir())
	called := false
	b.saveFile = func(name string, data []byte) (bool, error) {
		called = true
		if name != "backup.json" || string(data) != "test" {
			t.Fatal(name, string(data))
		}
		return true, nil
	}
	ok, err := b.SaveFile("../backup.json", base64.StdEncoding.EncodeToString([]byte("test")))
	if err != nil || !ok || !called {
		t.Fatal(ok, err)
	}
	if _, err = b.SaveFile("bad.json", "not base64!"); err == nil {
		t.Fatal("Invalid file accepted")
	}
	quit := make(chan struct{}, 1)
	b.quit = func() { quit <- struct{}{} }
	if b.Request("/api/shutdown", "GET", "").Status != 405 {
		t.Fatal("GET shutdown accepted")
	}
	if b.Request("/api/shutdown", "POST", "").Status != 200 {
		t.Fatal("Shutdown failed")
	}
	select {
	case <-quit:
	case <-time.After(time.Second):
		t.Fatal("Native shutdown was not invoked")
	}
}
