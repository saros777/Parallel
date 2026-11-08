package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type stateRecord struct {
	Name        *string  `json:"name"`
	WeeklyHours *float64 `json:"weeklyHours"`
	WeeklyCount *float64 `json:"weeklyCount"`
	Length      *int     `json:"length"`
	ID          string   `json:"id"`
	ClassID     string   `json:"classId"`
	SubjectID   string   `json:"subjectId"`
	TeacherID   string   `json:"teacherId"`
	RoomID      string   `json:"roomId"`
	GroupID     string   `json:"groupId"`
	CourseID    string   `json:"courseId"`
	Date        string   `json:"date"`
	Slot        int      `json:"slot"`
	Cancelled   bool     `json:"cancelled"`
}

func validDate(s string) bool { _, err := time.Parse("2006-01-02", s); return err == nil }

// One validator serves recovery writes, native IPC, project files and imports.
// Bell labels and simultaneous lessons are intentionally not validity errors.
func validateState(raw json.RawMessage) error {
	if len(raw) > maxProjectBytes {
		return errors.New("расписание больше 64 МБ")
	}
	if err := validateStateShape(raw); err != nil {
		return err
	}
	var doc struct {
		Meta struct {
			Schema string `json:"schemaVersion"`
		} `json:"meta"`
		Classes, Teachers, Subjects, Rooms, Groups, Courses []stateRecord
		Lessons, ExtraLessons                               []json.RawMessage
		BaseSchedule                                        *struct {
			Week    string
			Lessons []json.RawMessage
		}
		Overrides map[string]json.RawMessage
		Absences  []struct {
			ID, TeacherID, Start, End, StartDate, EndDate, Date string
			StartSlot, EndSlot                                  *int
		}
	}
	if json.Unmarshal(raw, &doc) != nil {
		return errors.New("неверные типы данных расписания")
	}
	if doc.Meta.Schema != "1.0" {
		return errors.New("неподдерживаемая схема расписания")
	}
	names := map[string]string{"classes": "класс", "teachers": "учитель", "subjects": "предмет", "rooms": "кабинет", "groups": "подгруппа", "courses": "запись нагрузки"}
	sets := map[string]map[string]bool{}
	for kind, rows := range map[string][]stateRecord{"classes": doc.Classes, "teachers": doc.Teachers, "subjects": doc.Subjects, "rooms": doc.Rooms, "groups": doc.Groups, "courses": doc.Courses} {
		ids := map[string]bool{}
		for _, r := range rows {
			if strings.TrimSpace(r.ID) == "" || ids[r.ID] {
				return fmt.Errorf("Справочник: %s — пустой или повторяющийся идентификатор", names[kind])
			}
			ids[r.ID] = true
		}
		sets[kind] = ids
	}
	ref := func(kind, id string, required bool) error {
		if id == "" && !required {
			return nil
		}
		if !sets[kind][id] {
			return fmt.Errorf("не найден %s с идентификатором %q", names[kind], id)
		}
		return nil
	}
	for _, g := range doc.Groups {
		if err := ref("classes", g.ClassID, true); err != nil {
			return err
		}
		if err := ref("subjects", g.SubjectID, false); err != nil {
			return err
		}
	}
	for _, c := range doc.Courses {
		if c.WeeklyHours != nil && *c.WeeklyHours < 0 || c.WeeklyCount != nil && *c.WeeklyCount <= 0 || c.Length != nil && (*c.Length < 1 || *c.Length > 20) {
			return fmt.Errorf("нагрузка %s: неверное количество или длительность", c.ID)
		}
		for kind, id := range map[string]string{"classes": c.ClassID, "subjects": c.SubjectID, "teachers": c.TeacherID, "rooms": c.RoomID, "groups": c.GroupID} {
			if err := ref(kind, id, kind == "classes" || kind == "subjects"); err != nil {
				return fmt.Errorf("нагрузка %s: %w", c.ID, err)
			}
		}
	}
	originals := map[string]json.RawMessage{}
	base := map[string]json.RawMessage{}
	checkRows := func(rows []json.RawMessage, index map[string]json.RawMessage) error {
		for _, raw := range rows {
			var l stateRecord
			if json.Unmarshal(raw, &l) != nil || l.ID == "" || index[l.ID] != nil {
				return errors.New("пустой или повторяющийся ID урока")
			}
			index[l.ID] = raw
		}
		return nil
	}
	if err := checkRows(append(append([]json.RawMessage{}, doc.Lessons...), doc.ExtraLessons...), originals); err != nil {
		return err
	}
	if doc.BaseSchedule != nil {
		if !validDate(doc.BaseSchedule.Week) {
			return errors.New("неверная дата основной недели")
		}
		if err := checkRows(doc.BaseSchedule.Lessons, base); err != nil {
			return err
		}
	}
	check := func(raw json.RawMessage) error {
		var l stateRecord
		if err := json.Unmarshal(raw, &l); err != nil {
			return err
		}
		if l.ID == "" || !validDate(l.Date) || l.Slot < 1 || l.Slot > 20 {
			return fmt.Errorf("урок %s: неверная дата или номер", l.ID)
		}
		for kind, id := range map[string]string{"classes": l.ClassID, "subjects": l.SubjectID, "teachers": l.TeacherID, "rooms": l.RoomID, "groups": l.GroupID, "courses": l.CourseID} {
			if l.Cancelled && (kind == "courses" || kind == "groups") {
				continue
			}
			if err := ref(kind, id, kind == "classes" || kind == "subjects"); err != nil {
				return fmt.Errorf("урок %s: %w", l.ID, err)
			}
		}
		return nil
	}
	merge := func(row, patch json.RawMessage) (json.RawMessage, error) {
		var fields, changes map[string]json.RawMessage
		if json.Unmarshal(row, &fields) != nil || json.Unmarshal(patch, &changes) != nil || changes == nil {
			return nil, errors.New("неверные изменения урока")
		}
		for k, v := range changes {
			fields[k] = v
		}
		return json.Marshal(fields)
	}
	for id, row := range originals {
		if p := doc.Overrides[id]; p != nil {
			var err error
			row, err = merge(row, p)
			if err != nil {
				return err
			}
		}
		if err := check(row); err != nil {
			return err
		}
	}
	for _, row := range base {
		if err := check(row); err != nil {
			return err
		}
	}
	for id, patch := range doc.Overrides {
		if originals[id] != nil {
			continue
		}
		row := base[id]
		if row == nil {
			if i := strings.LastIndex(id, "@"); i > 0 && validDate(id[i+1:]) {
				row = base[id[:i]]
			}
		}
		if row == nil {
			return fmt.Errorf("изменение неизвестного урока %s", id)
		}
		merged, err := merge(row, patch)
		if err != nil {
			return err
		}
		if err = check(merged); err != nil {
			return err
		}
	}
	absenceIDs := map[string]bool{}
	for _, a := range doc.Absences {
		if a.ID == "" || absenceIDs[a.ID] {
			return errors.New("пустой или повторяющийся ID отсутствия")
		}
		absenceIDs[a.ID] = true
		start, end := a.StartDate, a.EndDate
		if start == "" {
			start = a.Date
		}
		if end == "" {
			end = start
		}
		from, to := 1, 20
		if a.StartSlot != nil {
			from = *a.StartSlot
		}
		if a.EndSlot != nil {
			to = *a.EndSlot
		}
		if !validDate(start) || !validDate(end) || end < start || from < 1 || to > 20 || from > to {
			return errors.New("неверные даты или номера уроков отсутствия")
		}
		if err := ref("teachers", a.TeacherID, true); err != nil {
			return err
		}
	}
	return nil
}
