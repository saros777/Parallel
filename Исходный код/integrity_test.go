package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func putReview(b *DesktopBridge, state json.RawMessage) BridgeResponse {
	b.store.mu.Lock()
	rev := b.store.data.Revision
	b.store.mu.Unlock()
	raw, _ := json.Marshal(Envelope{Revision: rev, State: state})
	return b.Request("/api/state", "PUT", string(raw))
}
func TestStrictStateWrites(t *testing.T) {
	b := projectBridge(t)
	before := append([]byte{}, b.store.data.State...)
	for _, bad := range [][]byte{
		bytes.Replace(before, []byte(`"classId":"c"`), []byte(`"classId":"unknown"`), 1),
		bytes.Replace(before, []byte(`"teacherId":"t"`), []byte(`"teacherId":"unknown"`), 1),
		bytes.Replace(before, []byte(`"roomId":"r"`), []byte(`"roomId":"unknown"`), 1),
		bytes.Replace(before, []byte(`"slot":1`), []byte(`"slot":0`), 1),
		bytes.Replace(before, []byte(`2026-09-07`), []byte(`2026-02-30`), 1),
	} {
		if r := putReview(b, bad); r.Status != 400 {
			t.Fatalf("accepted invalid state: %d %s", r.Status, r.Body)
		}
		if !bytes.Equal(before, b.store.data.State) {
			t.Fatal("invalid write changed recovery")
		}
	}
	var doc map[string]any
	json.Unmarshal(before, &doc)
	doc["baseSchedule"] = map[string]any{"week": "2026-09-07", "lessons": []any{map[string]any{"id": "x", "classId": "unknown", "subjectId": "s", "date": "2026-09-07", "slot": 1}}}
	raw, _ := json.Marshal(doc)
	if r := putReview(b, raw); r.Status != 400 {
		t.Fatal("bad base accepted")
	}
	delete(doc, "baseSchedule")
	doc["overrides"] = map[string]any{"l": map[string]any{"teacherId": "unknown"}}
	raw, _ = json.Marshal(doc)
	if r := putReview(b, raw); r.Status != 400 {
		t.Fatal("bad patch accepted")
	}
	doc["overrides"] = map[string]any{}
	lesson := doc["lessons"].([]any)[0].(map[string]any)
	lesson["time"] = "Неизвестно"
	copy := map[string]any{}
	for k, v := range lesson {
		copy[k] = v
	}
	copy["id"] = "simultaneous"
	doc["lessons"] = []any{lesson, copy}
	raw, _ = json.Marshal(doc)
	if r := putReview(b, raw); r.Status != 200 {
		t.Fatalf("structural validation must permit conflicts and unknown bells: %s", r.Body)
	}
}
func TestDocumentCommitFailurePreservesOwnership(t *testing.T) {
	b := projectBridge(t)
	original := append([]byte{}, b.store.data.State...)
	originalSession := b.projectSession
	next := bytes.Replace(projectFixture(), []byte("Математика"), []byte("Алгебра"), 1)
	path := filepath.Join(t.TempDir(), "Next.parallel")
	raw, _ := encodeProject(next)
	os.WriteFile(path, raw, 0600)
	selected, err := b.stageProject(path)
	if err != nil {
		t.Fatal(err)
	}
	blocked := filepath.Join(t.TempDir(), "not-a-folder")
	os.WriteFile(blocked, []byte("blocked"), 0600)
	goodDir := b.store.dir
	b.store.dir = blocked
	if _, err = b.ActivateProject(selected.Token); err == nil {
		t.Fatal("failed activation reported success")
	}
	if !bytes.Equal(original, b.store.data.State) || b.projectSession.Path != originalSession.Path {
		t.Fatal("failed activation changed current document")
	}
	if _, err = b.NewProject(string(next)); err == nil {
		t.Fatal("failed new project accepted")
	}
	if !bytes.Equal(original, b.store.data.State) {
		t.Fatal("failed new project changed recovery")
	}
	b.store.dir = goodDir
	if _, err = b.ActivateProject(selected.Token); err != nil {
		t.Fatal("retry failed", err)
	}
	reopened, err := newDesktopBridge(b.dir)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.ProjectInfo().Path != path || reopened.ProjectInfo().Modified || !bytes.Contains(reopened.store.data.State, []byte("Алгебра")) {
		t.Fatal("state and ownership did not reopen together")
	}
	if reopened.store.data.Project == nil {
		t.Fatal("document metadata missing from atomic envelope")
	}
}
func TestSavedDocumentMetadataSurvivesAutosave(t *testing.T) {
	b := projectBridge(t)
	path := filepath.Join(t.TempDir(), "Saved.parallel")
	b.savePath = func(string, string) (string, error) { return path, nil }
	if _, err := b.SaveProject(false); err != nil {
		t.Fatal(err)
	}
	next := bytes.Replace(projectFixture(), []byte("Математика"), []byte("Алгебра"), 1)
	if r := putReview(b, next); r.Status != 200 {
		t.Fatal(r)
	}
	again, err := newDesktopBridge(b.dir)
	if err != nil {
		t.Fatal(err)
	}
	if again.ProjectInfo().Path != path || !again.ProjectInfo().Modified || !bytes.Contains(again.store.data.State, []byte("Алгебра")) {
		t.Fatal("newer unsaved recovery lost")
	}
	// Client-supplied envelope metadata cannot redirect native Save.
	payload, _ := json.Marshal(Envelope{Revision: again.store.data.Revision, State: again.store.data.State, Project: &projectSession{Path: "attacker.parallel"}})
	if r := again.Request("/api/state", "PUT", string(payload)); r.Status != 200 {
		t.Fatal(r)
	}
	reopened, err := newDesktopBridge(b.dir)
	if err != nil || reopened.ProjectInfo().Path != path {
		t.Fatal("client changed document ownership", err)
	}
}
func TestStaleFileSelectionCannotOverwriteEdits(t *testing.T) {
	b := projectBridge(t)
	path := filepath.Join(t.TempDir(), "Next.parallel")
	raw, _ := encodeProject(projectFixture())
	os.WriteFile(path, raw, 0600)
	selected, _ := b.stageProject(path)
	next := bytes.Replace(projectFixture(), []byte("Математика"), []byte("Алгебра"), 1)
	if r := putReview(b, next); r.Status != 200 {
		t.Fatal(r)
	}
	if _, err := b.ActivateProject(selected.Token); !errors.Is(err, errStaleProject) {
		t.Fatal("stale selection overwrote newer work", err)
	}
	if !bytes.Contains(b.store.data.State, []byte("Алгебра")) {
		t.Fatal("edits lost")
	}
}
func TestPendingRequestsSurviveStartupAndRemainFIFO(t *testing.T) {
	b := projectBridge(t)
	paths := []string{}
	for _, name := range []string{"First", "Second"} {
		p := filepath.Join(t.TempDir(), name+".parallel")
		state := bytes.Replace(projectFixture(), []byte("Математика"), []byte(name), 1)
		raw, _ := encodeProject(state)
		os.WriteFile(p, raw, 0600)
		paths = append(paths, p)
		b.queueProject(p)
	}
	for _, path := range paths {
		s, err := b.PendingProject()
		if err != nil || s.Path != path {
			t.Fatal("FIFO order lost", s.Path, err)
		}
		if _, err = b.ActivateProject(s.Token); err != nil {
			t.Fatal(err)
		}
	}
	if s, err := b.PendingProject(); err != nil || s.Token != "" {
		t.Fatal("queue not empty")
	}
}
func TestAllDialogMethodsAwaitStartup(t *testing.T) {
	b, err := newDesktopBridge(t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	called := make(chan struct{}, 1)
	b.openFile = func(string) (string, error) { called <- struct{}{}; return "", nil }
	done := make(chan error, 1)
	go func() { _, err := b.ReadProject(); done <- err }()
	select {
	case <-called:
		t.Fatal("dialog used context before startup")
	case <-time.After(25 * time.Millisecond):
	}
	b.initialiseErr = errors.New("startup failure")
	close(b.initialised)
	if err := <-done; err == nil {
		t.Fatal("startup failure ignored")
	}
	select {
	case <-called:
		t.Fatal("dialog invoked after failed startup")
	default:
	}
}
func TestConcurrentPendingQueue(t *testing.T) {
	b := projectBridge(t)
	path := filepath.Join(t.TempDir(), "Queue.parallel")
	raw, _ := encodeProject(projectFixture())
	os.WriteFile(path, raw, 0600)
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); b.queueProject(path); _ = b.ProjectInfo() }()
	}
	wg.Wait()
	for i := 0; i < 20; i++ {
		s, err := b.PendingProject()
		if err != nil || s.Token == "" {
			t.Fatal("request lost", err)
		}
	}
}
func TestStaleLockRemovalFailureIsBounded(t *testing.T) {
	dir := t.TempDir()
	lock := filepath.Join(dir, "starting.lock")
	os.Mkdir(lock, 0700)
	os.WriteFile(filepath.Join(lock, "keep"), []byte("x"), 0600)
	old := time.Now().Add(-2 * time.Minute)
	os.Chtimes(lock, old, old)
	if err := run(dir, 0, true); err == nil {
		t.Fatal("failed lock removal was ignored")
	}
}
