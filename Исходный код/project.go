package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"
	"unicode"
)

const maxProjectBytes = 64 << 20

type projectSession struct {
	Path          string   `json:"path"`
	SavedRevision int      `json:"savedRevision"`
	Recent        []string `json:"recent"`
}
type ProjectInfo struct {
	Revision  int      `json:"revision"`
	Cancelled bool     `json:"cancelled,omitempty"`
	Path      string   `json:"path"`
	Name      string   `json:"name"`
	Modified  bool     `json:"modified"`
	Recent    []string `json:"recent"`
}
type ProjectSelection struct {
	Token   string   `json:"token"`
	Path    string   `json:"path"`
	Content WireData `json:"content"`
}
type pendingProject struct {
	token, path string
	state       json.RawMessage
	revision    int
}

// .parallel is an ordinary ZIP container with a versioned manifest and JSON.
// Original dated lessons, exceptions, directories and history remain lossless.
func encodeProject(state json.RawMessage) ([]byte, error) {
	if err := validateProjectState(state); err != nil {
		return nil, err
	}
	var out bytes.Buffer
	z := zip.NewWriter(&out)
	manifest, err := z.Create("manifest.json")
	if err != nil {
		return nil, err
	}
	if _, err = io.WriteString(manifest, `{"format":"parallel-schedule","version":1}`); err != nil {
		return nil, err
	}
	file, err := z.Create("state.json")
	if err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	if _, err = file.Write(canonical); err != nil {
		return nil, err
	}
	if err = z.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
func decodeProject(raw []byte) (json.RawMessage, error) {
	if len(raw) > maxProjectBytes {
		return nil, errors.New("файл расписания больше 64 МБ")
	}
	state := json.RawMessage(raw)
	if bytes.HasPrefix(raw, []byte("PK")) {
		z, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
		if err != nil {
			return nil, errors.New("повреждён файл расписания")
		}
		if len(z.File) != 2 {
			return nil, errors.New("неверный состав файла расписания")
		}
		files := map[string][]byte{}
		for _, f := range z.File {
			if (f.Name != "manifest.json" && f.Name != "state.json") || f.UncompressedSize64 > maxProjectBytes || (f.Name == "manifest.json" && f.UncompressedSize64 > 4096) || files[f.Name] != nil {
				return nil, errors.New("неверный или слишком большой файл расписания")
			}
			r, err := f.Open()
			if err != nil {
				return nil, err
			}
			data, err := io.ReadAll(io.LimitReader(r, maxProjectBytes+1))
			r.Close()
			if err != nil || len(data) > maxProjectBytes {
				return nil, errors.New("не удалось прочитать расписание")
			}
			files[f.Name] = data
		}
		var manifest struct {
			Format  string `json:"format"`
			Version int    `json:"version"`
		}
		if json.Unmarshal(files["manifest.json"], &manifest) != nil || manifest.Format != "parallel-schedule" || manifest.Version != 1 {
			return nil, errors.New("неподдерживаемая версия файла расписания")
		}
		state = files["state.json"]
	} else {
		// Existing JSON backups/envelopes are supported without losing the original.
		var envelope struct {
			State json.RawMessage `json:"state"`
		}
		if json.Unmarshal(raw, &envelope) == nil && len(envelope.State) > 0 {
			state = envelope.State
		}
	}
	if err := validateProjectState(state); err != nil {
		return nil, err
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, state); err != nil {
		return nil, err
	}
	return json.Marshal(json.RawMessage(compact.Bytes()))
}
func validateProjectState(raw json.RawMessage) error { return validateState(raw) }
func readProjectPath(path string) (json.RawMessage, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, maxProjectBytes+1))
	if err != nil {
		return nil, err
	}
	return decodeProject(raw)
}
func projectHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxProjectBytes)
	var request struct {
		Data  string          `json:"data"`
		State json.RawMessage `json:"state"`
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		writeJSON(w, 400, map[string]string{"error": "Неверный файл расписания"})
		return
	}
	if strings.HasSuffix(r.URL.Path, "/read") {
		raw, err := base64.StdEncoding.DecodeString(request.Data)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		state, err := decodeProject(raw)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]json.RawMessage{"state": state})
	} else {
		raw, err := encodeProject(request.State)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]string{"data": base64.StdEncoding.EncodeToString(raw)})
	}
}

// Recovery state and its ownership are persisted in the same atomic envelope.
func (b *DesktopBridge) commitDocument(state json.RawMessage, session projectSession, expected int, replace, clean bool) error {
	b.store.mu.Lock()
	defer b.store.mu.Unlock()
	if b.store.data.Revision != expected {
		return errStaleProject
	}
	next := b.store.data
	if replace {
		if err := validateState(state); err != nil {
			return err
		}
		next.State = state
		next.Revision++
		next.Updated = time.Now().UTC().Format(time.RFC3339)
	}
	if clean {
		session.SavedRevision = next.Revision
	}
	session.Recent = append([]string{}, session.Recent...)
	next.Project = &session
	if err := b.store.writeLocked(next); err != nil {
		return err
	}
	b.projectSession = session
	return nil
}
func semanticStateEqual(a, b json.RawMessage) bool {
	decode := func(raw json.RawMessage) any {
		d := json.NewDecoder(bytes.NewReader(raw))
		d.UseNumber()
		var value any
		_ = d.Decode(&value)
		return value
	}
	return reflect.DeepEqual(decode(a), decode(b))
}
func (b *DesktopBridge) restoreProject() error {
	snapshot := b.store.data
	session := projectSession{SavedRevision: -1}
	migrated := snapshot.Project == nil
	if snapshot.Project != nil {
		session = *snapshot.Project
	} else {
		raw, err := os.ReadFile(filepath.Join(b.dir, "project-session.json"))
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if len(raw) > 0 && json.Unmarshal(raw, &session) != nil {
			session = projectSession{SavedRevision: -1}
		}
	}
	if session.Path != "" {
		session.Path = cleanProjectPath(session.Path)
	}
	b.projectSession = session
	if session.Path != "" && session.SavedRevision == snapshot.Revision {
		state, err := readProjectPath(session.Path)
		if err != nil {
			session.SavedRevision = -1
			migrated = true
		} else if !semanticStateEqual(state, snapshot.State) {
			return b.commitDocument(state, session, snapshot.Revision, true, true)
		}
	}
	if migrated {
		return b.commitDocument(nil, session, snapshot.Revision, false, false)
	}
	return nil
}
func cleanProjectPath(path string) string {
	if absolute, err := filepath.Abs(path); err == nil {
		return filepath.Clean(absolute)
	}
	return filepath.Clean(path)
}
func rememberProject(session *projectSession, path string) {
	path = cleanProjectPath(path)
	recent := []string{path}
	for _, p := range session.Recent {
		p = cleanProjectPath(p)
		if !strings.EqualFold(p, path) && len(recent) < 8 {
			recent = append(recent, p)
		}
	}
	session.Recent = recent
}
func (b *DesktopBridge) projectInfoLocked() ProjectInfo {
	b.store.mu.Lock()
	defer b.store.mu.Unlock()
	name := "Без названия.parallel"
	if b.projectSession.Path != "" {
		name = filepath.Base(b.projectSession.Path)
	}
	return ProjectInfo{Revision: b.store.data.Revision, Path: b.projectSession.Path, Name: name, Modified: b.projectSession.SavedRevision != b.store.data.Revision, Recent: append([]string{}, b.projectSession.Recent...)}
}
func (b *DesktopBridge) ProjectInfo() ProjectInfo {
	<-b.initialised
	b.projectMu.Lock()
	defer b.projectMu.Unlock()
	return b.projectInfoLocked()
}
func (b *DesktopBridge) queueProject(path string) {
	b.projectMu.Lock()
	defer b.projectMu.Unlock()
	b.pendingRequests = append(b.pendingRequests, cleanProjectPath(path))
}
func (b *DesktopBridge) PendingProject() (ProjectSelection, error) {
	if err := b.awaitInitialised(); err != nil {
		return ProjectSelection{}, err
	}
	b.projectMu.Lock()
	defer b.projectMu.Unlock()
	if len(b.pendingRequests) == 0 {
		return ProjectSelection{}, nil
	}
	path := b.pendingRequests[0]
	b.pendingRequests = b.pendingRequests[1:]
	return b.stageProject(path)
}
func (b *DesktopBridge) stageProject(path string) (ProjectSelection, error) {
	path = cleanProjectPath(path)
	state, err := readProjectPath(path)
	if err != nil {
		return ProjectSelection{}, err
	}
	var token [24]byte
	if _, err = rand.Read(token[:]); err != nil {
		return ProjectSelection{}, err
	}
	id := hex.EncodeToString(token[:])
	b.store.mu.Lock()
	revision := b.store.data.Revision
	b.store.mu.Unlock()
	b.pendingProject = &pendingProject{token: id, path: path, state: state, revision: revision}
	return ProjectSelection{Token: id, Path: path, Content: packWire(state)}, nil
}
func (b *DesktopBridge) ReadProject() (ProjectSelection, error) {
	if err := b.awaitInitialised(); err != nil {
		return ProjectSelection{}, err
	}
	b.projectMu.Lock()
	defer b.projectMu.Unlock()
	if b.openFile == nil {
		return ProjectSelection{}, errors.New("диалог открытия недоступен")
	}
	path, err := b.openFile("project")
	if err != nil || path == "" {
		return ProjectSelection{}, err
	}
	return b.stageProject(path)
}
func (b *DesktopBridge) ReadRecentProject(index int) (ProjectSelection, error) {
	if err := b.awaitInitialised(); err != nil {
		return ProjectSelection{}, err
	}
	b.projectMu.Lock()
	defer b.projectMu.Unlock()
	if index < 0 || index >= len(b.projectSession.Recent) {
		return ProjectSelection{}, errors.New("файл не найден в последних проектах")
	}
	return b.stageProject(b.projectSession.Recent[index])
}
func (b *DesktopBridge) replaceProjectState(state json.RawMessage) error {
	b.store.mu.Lock()
	revision := b.store.data.Revision
	b.store.mu.Unlock()
	raw, err := json.Marshal(Envelope{Revision: revision, State: state})
	if err != nil {
		return err
	}
	response := b.requestInternal("/api/state", "PUT", string(raw))
	if response.Status != 200 {
		return fmt.Errorf("не удалось сохранить рабочую копию: %s", response.Body)
	}
	return nil
}
func (b *DesktopBridge) ActivateProject(token string) (ProjectInfo, error) {
	if err := b.awaitInitialised(); err != nil {
		return ProjectInfo{}, err
	}
	b.projectMu.Lock()
	defer b.projectMu.Unlock()
	p := b.pendingProject
	if p == nil || p.token != token {
		return ProjectInfo{}, errors.New("выбор файла устарел")
	}
	session := b.projectSession
	session.Path = p.path
	rememberProject(&session, p.path)
	if err := b.commitDocument(p.state, session, p.revision, true, true); err != nil {
		return ProjectInfo{}, err
	}
	b.pendingProject = nil

	return b.projectInfoLocked(), nil
}
func (b *DesktopBridge) NewProject(raw string) (ProjectInfo, error) {
	if err := b.awaitInitialised(); err != nil {
		return ProjectInfo{}, err
	}
	state := json.RawMessage(raw)
	if err := validateProjectState(state); err != nil {
		return ProjectInfo{}, err
	}
	b.projectMu.Lock()
	defer b.projectMu.Unlock()
	session := b.projectSession
	session.Path = ""
	session.SavedRevision = -1
	b.store.mu.Lock()
	revision := b.store.data.Revision
	b.store.mu.Unlock()
	if err := b.commitDocument(state, session, revision, true, false); err != nil {
		return ProjectInfo{}, err
	}
	b.pendingProject = nil

	return b.projectInfoLocked(), nil
}
func (b *DesktopBridge) SaveProject(saveAs bool) (ProjectInfo, error) {
	if err := b.awaitInitialised(); err != nil {
		return ProjectInfo{}, err
	}
	b.projectMu.Lock()
	defer b.projectMu.Unlock()
	path := b.projectSession.Path
	if path == "" || saveAs || !strings.EqualFold(filepath.Ext(path), ".parallel") {
		if b.savePath == nil {
			return ProjectInfo{}, errors.New("диалог сохранения недоступен")
		}
		name := filepath.Base(path)
		if name == "." || name == "" {
			name = "Расписание.parallel"
			var doc struct {
				Meta struct {
					ProjectName string `json:"projectName"`
				} `json:"meta"`
			}
			b.store.mu.Lock()
			_ = json.Unmarshal(b.store.data.State, &doc)
			b.store.mu.Unlock()
			if doc.Meta.ProjectName != "" {
				title := strings.Map(func(r rune) rune {
					if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
						return '-'
					}
					return r
				}, doc.Meta.ProjectName)
				runes := []rune(strings.Trim(title, ". "))
				if len(runes) > 80 {
					runes = runes[:80]
				}
				if len(runes) > 0 {
					name = "Расписание_" + string(runes) + ".parallel"
				}
			}
		}
		if !strings.EqualFold(filepath.Ext(name), ".parallel") {
			name = strings.TrimSuffix(name, filepath.Ext(name)) + ".parallel"
		}
		var err error
		path, err = b.savePath(name, "project")
		if err != nil {
			return ProjectInfo{}, err
		}
		if path == "" {
			info := b.projectInfoLocked()
			info.Cancelled = true
			return info, nil
		}
		if !strings.EqualFold(filepath.Ext(path), ".parallel") {
			path += ".parallel"
		}
	}
	b.store.mu.Lock()
	snapshot := b.store.data
	b.store.mu.Unlock()
	raw, err := encodeProject(snapshot.State)
	if err != nil {
		return ProjectInfo{}, err
	}
	if err = atomicWrite(path, raw); err != nil {
		return ProjectInfo{}, err
	}
	session := b.projectSession
	session.Path = cleanProjectPath(path)
	session.SavedRevision = snapshot.Revision
	rememberProject(&session, path)
	// A simultaneous autosave remains dirty; it is never marked as saved by an older snapshot.
	b.store.mu.Lock()
	current := b.store.data.Revision
	b.store.mu.Unlock()
	if err := b.commitDocument(nil, session, current, false, false); err != nil {
		return ProjectInfo{}, fmt.Errorf("файл записан, но не удалось записать состояние восстановления: %w", err)
	}

	return b.projectInfoLocked(), nil
}
