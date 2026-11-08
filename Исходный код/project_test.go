package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func projectFixture() json.RawMessage {
	return json.RawMessage(`{"meta":{"schemaVersion":"1.0","school":"Тест <&>","academicYear":"2026-2027"},"classes":[{"id":"c","name":"5а"}],"teachers":[{"id":"t","name":"Иванова Анна Ивановна"}],"subjects":[{"id":"s","name":"Математика"}],"rooms":[{"id":"r","name":"12"}],"lessons":[{"id":"l","classId":"c","subjectId":"s","teacherId":"t","roomId":"r","date":"2026-09-07","slot":1}],"overrides":{},"extraLessons":[],"absences":[],"history":[],"preferences":{}}`)
}
func projectBridge(t *testing.T) *DesktopBridge {
	t.Helper()
	dir := t.TempDir()
	data, _ := json.Marshal(Envelope{Revision: 0, State: projectFixture()})
	if err := os.WriteFile(filepath.Join(dir, "workspace.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	b, err := newDesktopBridge(dir)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
func canonicalProject(t *testing.T, raw []byte) []byte {
	t.Helper()
	data, err := decodeProject(raw)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
func TestProjectSaveRecoveryAndExplicitSave(t *testing.T) {
	b := projectBridge(t)
	path := filepath.Join(t.TempDir(), "Вариант.parallel")
	b.savePath = func(string, string) (string, error) { return path, nil }
	info, err := b.SaveProject(false)
	if err != nil || info.Modified || info.Path != path {
		t.Fatal(info, err)
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(canonicalProject(t, original), canonicalProject(t, projectFixture())) {
		t.Fatal("Project changed data")
	}
	var state map[string]any
	json.Unmarshal(projectFixture(), &state)
	state["meta"].(map[string]any)["projectName"] = "Несохранённые правки"
	changed, _ := json.Marshal(state)
	if err = b.replaceProjectState(changed); err != nil {
		t.Fatal(err)
	}
	disk, _ := os.ReadFile(path)
	if !bytes.Equal(disk, original) {
		t.Fatal("Recovery silently overwrote the named document")
	}
	reopened, err := newDesktopBridge(b.dir)
	if err != nil {
		t.Fatal(err)
	}
	if !reopened.ProjectInfo().Modified || !bytes.Contains(reopened.store.data.State, []byte("Несохранённые")) {
		t.Fatal("Unsaved recovery was discarded")
	}
	if _, err = reopened.SaveProject(false); err != nil {
		t.Fatal(err)
	}
	again, err := newDesktopBridge(b.dir)
	if err != nil || again.ProjectInfo().Modified {
		t.Fatal("Saved project reopens dirty", err)
	}
	if !bytes.Contains(again.store.data.State, []byte("Несохранённые")) {
		t.Fatal("Saved change missing")
	}
}
func TestProjectForwardedLaunchDefersRestoration(t *testing.T) {
	b := projectBridge(t)
	path := filepath.Join(t.TempDir(), "Открытый.parallel")
	b.savePath = func(string, string) (string, error) { return path, nil }
	if _, err := b.SaveProject(false); err != nil {
		t.Fatal(err)
	}
	changed := bytes.Replace(projectFixture(), []byte("Математика"), []byte("Алгебра"), 1)
	raw, err := encodeProject(changed)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(b.dir, "workspace.json"))
	deferred, err := newDesktopBridge(b.dir, true)
	if err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(filepath.Join(b.dir, "workspace.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("Second launch restored over active recovery before obtaining the single-instance lock")
	}
	deferred.initialiseErr = deferred.initialiseStore()
	close(deferred.initialised)
	if deferred.initialiseErr != nil {
		t.Fatal(deferred.initialiseErr)
	}
	if response := deferred.Request("/api/state", "GET", ""); response.Status != 200 || !bytes.Contains([]byte(response.Body), []byte("Алгебра")) {
		t.Fatal("Primary instance did not finish restoration", response.Status)
	}
}
func TestProjectCancelledAndFailedSaveKeepDirty(t *testing.T) {
	b := projectBridge(t)
	b.savePath = func(string, string) (string, error) { return "", nil }
	info, err := b.SaveProject(true)
	if err != nil || !info.Cancelled || !info.Modified || info.Path != "" {
		t.Fatal(info, err)
	}
	b.savePath = func(string, string) (string, error) {
		return filepath.Join(t.TempDir(), "missing", "cannot.parallel"), nil
	}
	if _, err = b.SaveProject(true); err == nil {
		t.Fatal("Write failure accepted")
	}
	if !b.ProjectInfo().Modified || b.ProjectInfo().Path != "" {
		t.Fatal("Failed save changed document ownership")
	}
}
func TestProjectStageValidateAndSwitch(t *testing.T) {
	b := projectBridge(t)
	path := filepath.Join(t.TempDir(), "Другой.parallel")
	raw, err := encodeProject(projectFixture())
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(path, raw, 0600)
	b.openFile = func(string) (string, error) { return path, nil }
	selected, err := b.ReadProject()
	if err != nil {
		t.Fatal(err)
	}
	if b.ProjectInfo().Path != "" {
		t.Fatal("Merely selecting a file changed the active project")
	}
	if _, err = b.ActivateProject("wrong-token"); err == nil {
		t.Fatal("Invalid selection token accepted")
	}
	info, err := b.ActivateProject(selected.Token)
	if err != nil || info.Modified || info.Path != path {
		t.Fatal(info, err)
	}
	if _, err = b.ActivateProject(selected.Token); err == nil {
		t.Fatal("Selection token reused")
	}
	oldState := append([]byte{}, b.store.data.State...)
	os.WriteFile(path, []byte("not a project"), 0600)
	if _, err = b.ReadProject(); err == nil {
		t.Fatal("Corrupt project accepted")
	}
	if !bytes.Equal(oldState, b.store.data.State) {
		t.Fatal("Bad input overwrote current work")
	}
}
func TestProjectJSONCompatibilityAndSafeContainer(t *testing.T) {
	raw := projectFixture()
	envelope, _ := json.Marshal(Envelope{Revision: 3, State: raw})
	a, err := decodeProject(envelope)
	if err != nil || !bytes.Equal(a, canonicalProject(t, raw)) {
		t.Fatal("Old backup not supported", err)
	}
	var data bytes.Buffer
	z := zip.NewWriter(&data)
	f, _ := z.Create("../state.json")
	f.Write(raw)
	z.Close()
	if _, err = decodeProject(data.Bytes()); err == nil {
		t.Fatal("Unexpected archive members accepted")
	}
	wrong := bytes.Replace(raw, []byte(`"schemaVersion":"1.0"`), []byte(`"schemaVersion":"99"`), 1)
	if _, err = encodeProject(wrong); err == nil {
		t.Fatal("Unknown project version accepted")
	}
}
func TestWireCompressionAndLimits(t *testing.T) {
	raw := bytes.Repeat([]byte("Расписание школы 1234\n"), 10000)
	packed := packWire(raw)
	if packed.Encoding != "gzip/base64" || len(packed.Data) > len(raw)/5 {
		t.Fatal("Large IPC payload not compressed")
	}
	decoded, err := unpackWire(packed.Data, packed.Encoding)
	if err != nil || !bytes.Equal(decoded, raw) {
		t.Fatal("IPC changed bytes", err)
	}
	for _, pair := range [][2]string{{"x", "unknown"}, {"not base64", "gzip/base64"}, {"eA==", "gzip/base64"}} {
		if _, err = unpackWire(pair[0], pair[1]); err == nil {
			t.Fatal("Malformed encoded request accepted")
		}
	}
}
