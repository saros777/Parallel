package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOldVersionCannotSilentlyReopen(t *testing.T) {
	dir := t.TempDir()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"application": appID, "version": "3.1.0"})
	}))
	defer server.Close()
	session, _ := json.Marshal(Session{URL: server.URL + "/?token=test", Token: "test"})
	os.WriteFile(filepath.Join(dir, "session.json"), session, 0600)
	err := run(dir, 0, true)
	if err == nil || !strings.Contains(err.Error(), "3.1.0") || !strings.Contains(err.Error(), version) {
		t.Fatalf("Expected explicit old-version warning, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "workspace.json")); !os.IsNotExist(err) {
		t.Fatal("Version check must not replace or create a database")
	}
}

const emptyState = `{"classes":[],"teachers":[],"subjects":[],"rooms":[],"lessons":[]}`

func TestSeedAndReopen(t *testing.T) {
	dir := t.TempDir()
	s, err := openStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]json.RawMessage
	json.Unmarshal(s.data.State, &data)
	for key, count := range map[string]int{"classes": 25, "teachers": 42, "lessons": 16421} {
		var rows []any
		json.Unmarshal(data[key], &rows)
		if len(rows) != count {
			t.Fatalf("%s: %d", key, len(rows))
		}
	}
	if err := validateState(s.data.State); err != nil {
		t.Fatal(err)
	}
	reopened, err := openStore(dir)
	var originalCompact, reopenedCompact bytes.Buffer
	json.Compact(&originalCompact, s.data.State)
	if err != nil {
		t.Fatal(err)
	}
	json.Compact(&reopenedCompact, reopened.data.State)
	if !bytes.Equal(reopenedCompact.Bytes(), originalCompact.Bytes()) {
		t.Fatal("Reopen failed", err)
	}
}

func TestAtomicOverwriteAndCorruption(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "workspace.json")
	if err := atomicWrite(path, []byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := atomicWrite(path, []byte("corrupt")); err != nil {
		t.Fatal(err)
	}
	if _, err := openStore(dir); err == nil {
		t.Fatal("Corruption must not reset the database")
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != "corrupt" {
		t.Fatal("Corrupt file changed")
	}
}

func TestAuthenticationSavingAndBackups(t *testing.T) {
	dir := t.TempDir()
	s := &Store{dir: dir, data: Envelope{State: json.RawMessage(emptyState)}}
	a := &App{store: s, token: "test-secret", origin: "http://127.0.0.1:1234"}
	handler := a.routes()
	request := func(method, path, body, token, origin, host string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, a.origin+path, strings.NewReader(body))
		r.Header.Set("X-App-Token", token)
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if host != "" {
			r.Host = host
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if request("GET", "/api/state", "", "", "", "").Code != 401 {
		t.Fatal("Unauthenticated access")
	}
	if request("GET", "/api/state", "", a.token, "https://example.com", "").Code != 403 {
		t.Fatal("Cross-origin access")
	}
	if request("GET", "/api/state", "", a.token, "", "attacker.example").Code != 403 {
		t.Fatal("Invalid host")
	}
	if request("GET", "/", "", "", "", "").Code != 403 {
		t.Fatal("Unauthenticated page")
	}
	page := request("GET", "/?token="+a.token, "", "", "", "")
	if page.Code != 200 || !strings.Contains(page.Body.String(), "window.DESKTOP=") {
		t.Fatal("Page failed")
	}
	if request("GET", "/engine.js", "", "", "", "").Code != 200 {
		t.Fatal("Assets missing")
	}
	for i := 0; i < 23; i++ {
		body, _ := json.Marshal(Envelope{Revision: i, State: json.RawMessage(emptyState)})
		res := request("PUT", "/api/state", string(body), a.token, a.origin, "")
		if res.Code != 200 {
			t.Fatal(res.Code, res.Body.String())
		}
		if request("PUT", "/api/state", string(body), a.token, a.origin, "").Code != 409 {
			t.Fatal("Stale write accepted")
		}
	}
	backups, _ := filepath.Glob(filepath.Join(dir, "backups", "*.json"))
	if len(backups) != 20 {
		t.Fatalf("Backup count: %d", len(backups))
	}
	reopened, err := openStore(dir)
	if err != nil || reopened.data.Revision != 23 {
		t.Fatal("Saved state not persistent", err)
	}
	for _, field := range []string{"students", "documents", "memberships"} {
		bad := strings.TrimSuffix(emptyState, "}") + `,"` + field + `":[]}`
		if validateState(json.RawMessage(bad)) == nil {
			t.Fatal("Student data accepted")
		}
	}
}
