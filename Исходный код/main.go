package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// No runtime libraries, external services, or installed Python are required.
//
//go:embed ui/* ui/fonts/* seed.json
var bundled embed.FS

const version = "4.0.0"
const appID = "parallel-school-desktop"

type Envelope struct {
	Revision int             `json:"revision"`
	State    json.RawMessage `json:"state"`
	Updated  string          `json:"updated"`
}
type Session struct {
	URL   string `json:"url"`
	Token string `json:"token"`
	PID   int    `json:"pid"`
}
type Store struct {
	mu   sync.Mutex
	dir  string
	data Envelope
}
type App struct {
	store  *Store
	token  string
	origin string
	server *http.Server
}

func main() {
	noBrowser := flag.Bool("no-browser", false, "Do not open browser (testing)")
	dir := flag.String("data-dir", "", "Alternative data directory")
	port := flag.Int("port", 0, "Local port, 0 selects a free port")
	flag.Parse()
	if *dir == "" {
		*dir = defaultDataDir()
	}
	if err := run(*dir, *port, *noBrowser); err != nil {
		showError("Параллель", "Не удалось запустить приложение.\n\n"+err.Error()+"\n\nРабочая база: "+*dir)
		os.Exit(1)
	}
}

func defaultDataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base, _ = os.UserConfigDir()
	}
	if base == "" {
		base, _ = os.UserHomeDir()
	}
	return filepath.Join(base, "ParallelSchool")
}

func run(dir string, port int, noBrowser bool) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	logFile, err := os.OpenFile(filepath.Join(dir, "application.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer logFile.Close()
	log.SetOutput(logFile)
	sessionPath := filepath.Join(dir, "session.json")
	if raw, err := os.ReadFile(sessionPath); err == nil {
		var old Session
		if json.Unmarshal(raw, &old) == nil && strings.HasPrefix(old.URL, "http://127.0.0.1:") {
			req, _ := http.NewRequest("GET", strings.Split(old.URL, "/?")[0]+"/api/ping", nil)
			req.Header.Set("X-App-Token", old.Token)
			client := &http.Client{Timeout: 1500 * time.Millisecond}
			if res, err := client.Do(req); err == nil {
				var ping map[string]any
				json.NewDecoder(res.Body).Decode(&ping)
				res.Body.Close()
				if res.StatusCode == 200 && ping["application"] == appID {
					if ping["version"] != version {
						return fmt.Errorf("Сейчас уже работает Параллель %v, а вы запускаете %s.\n\nНовая версия НЕ открыта, чтобы не показывать старый интерфейс под видом обновления.\nВ старой программе нажмите «Сохранить и выйти» и подтвердите закрытие. Затем снова запустите этот новый EXE.\n\nЗакрыть только вкладку браузера недостаточно. Ваше расписание останется сохраненным.", ping["version"], version)
					}
					if !noBrowser {
						return openBrowser(old.URL)
					}
					return errors.New("приложение уже запущено")
				}
			}
		}
	}
	// Prevent two simultaneous starts from taking ownership of one database.
	lockPath := filepath.Join(dir, "starting.lock")
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		if st, e := os.Stat(lockPath); e == nil && time.Since(st.ModTime()) > time.Minute {
			os.Remove(lockPath)
			return run(dir, port, noBrowser)
		}
		return errors.New("приложение запускается. Подождите несколько секунд и запустите снова")
	}
	f.Close()
	defer os.Remove(lockPath)
	store, err := openStore(dir)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return err
	}
	defer listener.Close()
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return err
	}
	a := &App{store: store, token: hex.EncodeToString(tokenBytes), origin: "http://" + listener.Addr().String()}
	a.server = &http.Server{Handler: a.routes(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 60 * time.Second, WriteTimeout: 60 * time.Second}
	url := a.origin + "/?token=" + a.token
	raw, _ := json.Marshal(Session{URL: url, Token: a.token, PID: os.Getpid()})
	if err := os.WriteFile(sessionPath, raw, 0600); err != nil {
		return err
	}
	defer os.Remove(sessionPath)
	os.Remove(lockPath)
	log.Printf("Started %s, port %s", version, listener.Addr())
	if !noBrowser {
		go func() {
			time.Sleep(350 * time.Millisecond)
			if err := openBrowser(url); err != nil {
				showError("Параллель", "Не удалось открыть браузер автоматически.\nПриложение запущено. Его локальный адрес:\n"+url)
			}
		}()
	}
	err = a.server.Serve(listener)
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func openStore(dir string) (*Store, error) {
	s := &Store{dir: dir}
	path := filepath.Join(dir, "workspace.json")
	raw, err := os.ReadFile(path)
	if err == nil {
		if json.Unmarshal(raw, &s.data) != nil || validateState(s.data.State) != nil {
			return nil, errors.New("рабочая база повреждена и НЕ была заменена. Сохраните workspace.json и восстановите файл из папки backups")
		}
		return s, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	seed, err := bundled.ReadFile("seed.json")
	if err != nil {
		return nil, err
	}
	s.data = Envelope{Revision: 0, State: seed, Updated: time.Now().UTC().Format(time.RFC3339)}
	raw, _ = json.Marshal(s.data)
	if err := atomicWrite(path, raw); err != nil {
		return nil, err
	}
	return s, nil
}

func atomicWrite(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".parallel-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func validateState(raw json.RawMessage) error {
	var data map[string]json.RawMessage
	if json.Unmarshal(raw, &data) != nil {
		return errors.New("неверный JSON")
	}
	for _, k := range []string{"classes", "teachers", "subjects", "rooms", "lessons"} {
		v, ok := data[k]
		if !ok || len(bytes.TrimSpace(v)) == 0 || bytes.TrimSpace(v)[0] != '[' {
			return fmt.Errorf("отсутствует список %s", k)
		}
	}
	for _, k := range []string{"students", "documents", "memberships"} {
		if _, ok := data[k]; ok {
			return errors.New("персональные данные учеников нельзя сохранять в диспетчере")
		}
	}
	return nil
}

func (a *App) authorized(r *http.Request) bool {
	got := r.Header.Get("X-App-Token")
	return len(got) == len(a.token) && subtle.ConstantTimeCompare([]byte(got), []byte(a.token)) == 1
}
func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
func (a *App) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"application": appID, "version": version})
	})
	mux.HandleFunc("/api/state", a.state)
	mux.HandleFunc("/api/info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"version": version, "dataDir": a.store.dir})
	})
	mux.HandleFunc("/api/open-folder", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		if err := openFolder(a.store.dir); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("/api/shutdown", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(405)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
		go func() {
			time.Sleep(300 * time.Millisecond)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			a.server.Shutdown(ctx)
		}()
	})
	sub, _ := fs.Sub(bundled, "ui")
	assets := http.FileServer(http.FS(sub))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			if subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("token")), []byte(a.token)) != 1 {
				http.Error(w, "Запустите Параллель.exe двойным щелчком.", 403)
				return
			}
			page, _ := bundled.ReadFile("ui/index.html")
			config := fmt.Sprintf("<script>window.DESKTOP={apiBase:'',token:%q,version:%q};</script>", a.token, version)
			page = bytes.Replace(page, []byte("</head>"), []byte(config+"</head>"), 1)
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(page)
			return
		}
		assets.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'")
		if r.Host != strings.TrimPrefix(a.origin, "http://") {
			http.Error(w, "Host rejected", 403)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if origin := r.Header.Get("Origin"); origin != "" && origin != a.origin {
				http.Error(w, "Origin rejected", 403)
				return
			}
			if !a.authorized(r) {
				http.Error(w, "Unauthorized", 401)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
func (a *App) state(w http.ResponseWriter, r *http.Request) {
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	if r.Method == "GET" {
		writeJSON(w, 200, a.store.data)
		return
	}
	if r.Method != "PUT" {
		w.WriteHeader(405)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<20)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, 413, map[string]string{"error": "Слишком большой файл"})
		return
	}
	var next Envelope
	if json.Unmarshal(raw, &next) != nil || validateState(next.State) != nil {
		writeJSON(w, 400, map[string]string{"error": "Неверная структура расписания"})
		return
	}
	if next.Revision != a.store.data.Revision {
		writeJSON(w, 409, map[string]string{"error": "База изменена в другой вкладке. Сохраните резервную копию и перезагрузите окно."})
		return
	}
	backupDir := filepath.Join(a.store.dir, "backups")
	if err := os.MkdirAll(backupDir, 0700); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	previous, _ := json.Marshal(a.store.data)
	backupPath := filepath.Join(backupDir, fmt.Sprintf("revision-%09d.json", a.store.data.Revision))
	if err := atomicWrite(backupPath, previous); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Не удалось создать резервную копию: " + err.Error()})
		return
	}
	next.Revision++
	next.Updated = time.Now().UTC().Format(time.RFC3339)
	out, _ := json.Marshal(next)
	if err := atomicWrite(filepath.Join(a.store.dir, "workspace.json"), out); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Не удалось сохранить на диск: " + err.Error()})
		return
	}
	a.store.data = next
	entries, _ := filepath.Glob(filepath.Join(backupDir, "revision-*.json"))
	sort.Strings(entries)
	for len(entries) > 20 {
		os.Remove(entries[0])
		entries = entries[1:]
	}
	writeJSON(w, 200, map[string]any{"revision": next.Revision, "updated": next.Updated})
}
