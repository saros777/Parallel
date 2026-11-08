package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

var errStaleProject = errors.New("расписание изменилось во время операции; повторите команду")

// Caller holds store.mu. State and document ownership have ONE commit point.
func (s *Store) writeLocked(next Envelope) error {
	backupDir := filepath.Join(s.dir, "backups")
	if err := os.MkdirAll(backupDir, 0700); err != nil {
		return err
	}
	previous, err := json.Marshal(s.data)
	if err != nil {
		return err
	}
	if err = atomicWrite(filepath.Join(backupDir, fmt.Sprintf("revision-%09d.json", s.data.Revision)), previous); err != nil {
		return err
	}
	raw, err := json.Marshal(next)
	if err != nil {
		return err
	}
	if err = atomicWrite(filepath.Join(s.dir, "workspace.json"), raw); err != nil {
		return err
	}
	s.data = next
	entries, _ := filepath.Glob(filepath.Join(backupDir, "revision-*.json"))
	sort.Strings(entries)
	for len(entries) > 20 {
		_ = os.Remove(entries[0])
		entries = entries[1:]
	}
	return nil
}
