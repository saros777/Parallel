//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
)

func openBrowser(url string) error { return exec.Command("xdg-open", url).Start() }
func openFolder(path string) error { return exec.Command("xdg-open", path).Start() }
func showError(title, text string) { fmt.Fprintln(os.Stderr, title+": "+text) }

func desktopSupported() bool      { return false }
func runDesktop(dir string) error { return run(dir, 0, false) }
