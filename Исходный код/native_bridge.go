package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

// DesktopBridge reuses the validated store handlers via in-process IPC.
// Native mode never listens on a TCP port and never launches a browser.
type DesktopBridge struct {
	ready    atomic.Bool
	handler  http.Handler
	token    string
	origin   string
	dir      string
	quit     func()
	saveFile func(string, []byte) (bool, error)
}
type BridgeResponse struct {
	Status int    `json:"status"`
	Body   string `json:"body"`
}

func newDesktopBridge(dir string) (*DesktopBridge, error) {
	store, err := openStore(dir)
	if err != nil {
		return nil, err
	}
	var random [32]byte
	if _, err = rand.Read(random[:]); err != nil {
		return nil, err
	}
	b := &DesktopBridge{dir: dir, token: hex.EncodeToString(random[:]), origin: "http://parallel.desktop"}
	app := &App{store: store, token: b.token, origin: b.origin}
	b.handler = app.routes()
	return b, nil
}
func (b *DesktopBridge) Ready() { b.ready.Store(true) }
func (b *DesktopBridge) Request(path, method, body string) BridgeResponse {
	allowed := map[string]bool{"/api/ping": true, "/api/state": true, "/api/info": true, "/api/open-folder": true, "/api/shutdown": true}
	if !allowed[path] {
		return BridgeResponse{404, `{"error":"Неизвестная команда"}`}
	}
	if len(body) > 64<<20 {
		return BridgeResponse{413, `{"error":"Слишком большой файл"}`}
	}
	if path == "/api/shutdown" {
		if method != "POST" {
			return BridgeResponse{405, `{}`}
		}
		if b.quit != nil {
			go func() { time.Sleep(100 * time.Millisecond); b.quit() }()
		}
		return BridgeResponse{200, `{"ok":true}`}
	}
	r := httptest.NewRequest(method, b.origin+path, strings.NewReader(body))
	r.Header.Set("X-App-Token", b.token)
	r.Header.Set("Origin", b.origin)
	out := httptest.NewRecorder()
	b.handler.ServeHTTP(out, r)
	return BridgeResponse{out.Code, out.Body.String()}
}
func (b *DesktopBridge) SaveFile(name, data string) (bool, error) {
	if b.saveFile == nil {
		return false, errors.New("диалог сохранения недоступен")
	}
	if len(data) > 128<<20 {
		return false, errors.New("слишком большой файл")
	}
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return false, errors.New("неверный формат файла")
	}
	return b.saveFile(filepath.Base(name), raw)
}

// Index injection selects the native bridge before the application scripts load.
type desktopAssets struct{ fs.FS }

func (a desktopAssets) Open(name string) (fs.File, error) {
	if name != "index.html" {
		return a.FS.Open(name)
	}
	raw, err := fs.ReadFile(a.FS, name)
	if err != nil {
		return nil, err
	}
	raw = bytes.Replace(raw, []byte("</head>"), []byte(`<script>window.DESKTOP={native:true,version:"`+version+`"};</script></head>`), 1)
	return &desktopIndex{Reader: bytes.NewReader(raw), size: int64(len(raw))}, nil
}

type desktopIndex struct {
	*bytes.Reader
	size int64
}

func (f *desktopIndex) Close() error               { return nil }
func (f *desktopIndex) Stat() (fs.FileInfo, error) { return desktopIndexInfo{f.size}, nil }

type desktopIndexInfo struct{ size int64 }

func (i desktopIndexInfo) Name() string       { return "index.html" }
func (i desktopIndexInfo) Size() int64        { return i.size }
func (i desktopIndexInfo) Mode() fs.FileMode  { return 0444 }
func (i desktopIndexInfo) ModTime() time.Time { return time.Time{} }
func (i desktopIndexInfo) IsDir() bool        { return false }
func (i desktopIndexInfo) Sys() any           { return nil }
