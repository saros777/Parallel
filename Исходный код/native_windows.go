//go:build windows

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func desktopSupported() bool { return true }
func runDesktop(dir string) error {
	if err := ensureWebView2(); err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	// An older HTTP build must release the shared database before native mode starts.
	if raw, err := os.ReadFile(filepath.Join(dir, "session.json")); err == nil {
		var old Session
		if json.Unmarshal(raw, &old) == nil && strings.HasPrefix(old.URL, "http://127.0.0.1:") {
			req, _ := http.NewRequest("GET", strings.Split(old.URL, "/?")[0]+"/api/ping", nil)
			req.Header.Set("X-App-Token", old.Token)
			client := &http.Client{Timeout: time.Second}
			if res, err := client.Do(req); err == nil {
				res.Body.Close()
				if res.StatusCode == 200 {
					return fmt.Errorf("закройте предыдущую программу через «Сохранить и выйти», затем снова запустите Параллель")
				}
			}
		}
	}
	bridge, err := newDesktopBridge(dir)
	if err != nil {
		return err
	}
	assets, err := fs.Sub(bundled, "ui")
	if err != nil {
		return err
	}
	logfile, err := os.OpenFile(filepath.Join(dir, "application.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer logfile.Close()
	log.SetOutput(logfile)
	var ctx context.Context
	var closing atomic.Bool
	bridge.quit = func() { closing.Store(true); wruntime.Quit(ctx) }
	bridge.saveFile = func(name string, raw []byte) (bool, error) {
		ext := strings.ToLower(filepath.Ext(name))
		pattern := "*" + ext
		dest, err := wruntime.SaveFileDialog(ctx, wruntime.SaveDialogOptions{Title: "Сохранить файл", DefaultFilename: name, Filters: []wruntime.FileFilter{{DisplayName: strings.ToUpper(strings.TrimPrefix(ext, ".")) + " файл", Pattern: pattern}}})
		if err != nil || dest == "" {
			return false, err
		}
		if err := atomicWrite(dest, raw); err != nil {
			return false, err
		}
		return true, nil
	}
	messages := windows.DefaultMessages()
	messages.MissingRequirements = "Параллель: системный компонент"
	messages.InstallationRequired = "Для окна приложения нужен Microsoft Edge WebView2 Runtime. Установщик Microsoft загрузит его из интернета."
	messages.PressOKToInstall = " Нажмите OK для установки. Ваш браузер не запускается."
	messages.ContactAdmin = "Установите Microsoft Edge WebView2 Runtime через установщик Параллель и повторите запуск."
	messages.Webview2NotInstalled = "WebView2 не установлен. Установите Microsoft Edge WebView2 Runtime и повторите запуск."
	log.Printf("Starting native desktop %s", version)
	return wails.Run(&options.App{
		Title: "Параллель · Расписание школы", Width: 1440, Height: 900, MinWidth: 1024, MinHeight: 640,
		WindowStartState: options.Maximised, BackgroundColour: options.NewRGB(244, 246, 249),
		AssetServer: &assetserver.Options{Assets: desktopAssets{assets}}, Bind: []interface{}{bridge},
		OnStartup: func(c context.Context) { ctx = c },
		OnBeforeClose: func(c context.Context) bool {
			if closing.Load() || !bridge.ready.Load() {
				return false
			}
			wruntime.EventsEmit(c, "parallel:close-request")
			return true
		},
		SingleInstanceLock: &options.SingleInstanceLock{UniqueId: appID, OnSecondInstanceLaunch: func(_ options.SecondInstanceData) {
			if ctx != nil {
				wruntime.WindowUnminimise(ctx)
				wruntime.WindowShow(ctx)
			}
		}},
		Windows: &windows.Options{WebviewUserDataPath: filepath.Join(dir, "WebView2"), Messages: messages, Theme: windows.Light, WindowClassName: "ParallelSchoolDesktop", ResizeDebounceMS: 16},
	})
}
