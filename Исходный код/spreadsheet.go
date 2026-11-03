package main

import (
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/xuri/excelize/v2"
)

type SpreadsheetSheet struct {
	Name string     `json:"name"`
	Rows [][]string `json:"rows"`
}
type SpreadsheetBook struct {
	Sheets []SpreadsheetSheet `json:"sheets"`
}

func readSpreadsheet(raw []byte, name string) (SpreadsheetBook, error) {
	book := SpreadsheetBook{}
	if len(raw) > 32<<20 {
		return book, errors.New("таблица больше 32 МБ")
	}
	if strings.EqualFold(filepath.Ext(name), ".csv") || strings.EqualFold(filepath.Ext(name), ".tsv") {
		text := strings.TrimPrefix(string(raw), "\ufeff")
		best := ','
		columns := 0
		for _, separator := range []rune{';', ',', '\t'} {
			r := csv.NewReader(strings.NewReader(text))
			r.Comma = separator
			header, err := r.Read()
			if err == nil && len(header) > columns {
				columns = len(header)
				best = separator
			}
		}
		r := csv.NewReader(strings.NewReader(text))
		r.Comma = best
		r.FieldsPerRecord = -1
		rows := [][]string{}
		for {
			row, err := r.Read()
			if err == io.EOF {
				break
			}
			if err != nil {
				return book, fmt.Errorf("неверный CSV: %w", err)
			}
			if len(rows) >= 25000 || len(row) > 64 {
				return book, errors.New("CSV превышает предел 25 000 строк или 64 столбцов")
			}
			rows = append(rows, row)
		}
		book.Sheets = []SpreadsheetSheet{{Name: strings.TrimSuffix(filepath.Base(name), filepath.Ext(name)), Rows: rows}}
	} else {
		f, err := excelize.OpenReader(bytes.NewReader(raw), excelize.Options{UnzipSizeLimit: 64 << 20, UnzipXMLSizeLimit: 16 << 20})
		if err != nil {
			return book, fmt.Errorf("не удалось прочитать XLSX: %w", err)
		}
		defer f.Close()
		if len(f.GetSheetList()) > 16 {
			return book, errors.New("в таблице больше 16 листов")
		}
		for _, sheet := range f.GetSheetList() {
			iterator, err := f.Rows(sheet)
			if err != nil {
				return book, err
			}
			rows := [][]string{}
			for iterator.Next() {
				row, err := iterator.Columns()
				if err != nil {
					iterator.Close()
					return book, err
				}
				if len(rows) >= 25000 || len(row) > 64 {
					iterator.Close()
					return book, errors.New("XLSX превышает предел 25 000 строк или 64 столбцов")
				}
				rows = append(rows, row)
			}
			err = iterator.Error()
			iterator.Close()
			if err != nil {
				return book, err
			}
			book.Sheets = append(book.Sheets, SpreadsheetSheet{Name: sheet, Rows: rows})
		}
	}
	if err := validateSpreadsheet(book); err != nil {
		return SpreadsheetBook{}, err
	}
	return book, nil
}
func validateSpreadsheet(book SpreadsheetBook) error {
	if len(book.Sheets) < 1 || len(book.Sheets) > 16 {
		return errors.New("в таблице должно быть от 1 до 16 листов")
	}
	cells := 0
	for _, s := range book.Sheets {
		if len(s.Rows) > 25000 {
			return errors.New("на листе больше 25 000 строк")
		}
		for _, r := range s.Rows {
			if len(r) > 64 {
				return errors.New("на листе больше 64 столбцов")
			}
			cells += len(r)
			for _, c := range r {
				if len(c) > 32767 {
					return errors.New("слишком длинное значение ячейки")
				}
			}
		}
	}
	if cells > 500000 {
		return errors.New("таблица содержит больше 500 000 ячеек")
	}
	return nil
}
func writeSpreadsheet(book SpreadsheetBook, format string) ([]byte, error) {
	if err := validateSpreadsheet(book); err != nil {
		return nil, err
	}
	if format == "csv" {
		if len(book.Sheets) != 1 {
			return nil, errors.New("для CSV выберите один раздел")
		}
		var out bytes.Buffer
		out.WriteString("\ufeff")
		w := csv.NewWriter(&out)
		w.Comma = ';'
		w.UseCRLF = true
		// All values are data. Prefix formula-like text in CSV for safe Excel opening.
		for _, row := range book.Sheets[0].Rows {
			safe := append([]string{}, row...)
			for i, s := range safe {
				if strings.HasPrefix(s, "=") || strings.HasPrefix(s, "+") || strings.HasPrefix(s, "@") || strings.HasPrefix(s, "-") {
					safe[i] = "'" + s
				}
			}
			if err := w.Write(safe); err != nil {
				return nil, err
			}
		}
		w.Flush()
		return out.Bytes(), w.Error()
	}
	if format != "xlsx" {
		return nil, errors.New("выберите XLSX или CSV")
	}
	f := excelize.NewFile()
	defer f.Close()
	style, err := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Color: "FFFFFF"}, Fill: excelize.Fill{Type: "pattern", Color: []string{"245AC2"}, Pattern: 1}})
	if err != nil {
		return nil, err
	}
	for i, s := range book.Sheets {
		name := s.Name
		if name == "" {
			name = fmt.Sprintf("Лист %d", i+1)
		}
		if i == 0 {
			err = f.SetSheetName("Sheet1", name)
		} else {
			_, err = f.NewSheet(name)
		}
		if err != nil {
			return nil, err
		}
		columns := 0
		for row, values := range s.Rows {
			if len(values) > columns {
				columns = len(values)
			}
			for column, value := range values {
				cell, _ := excelize.CoordinatesToCellName(column+1, row+1)
				numeric := false
				if row > 0 && len(s.Rows) > 0 && column < len(s.Rows[0]) {
					switch strings.ToLower(s.Rows[0][column]) {
					case "количество", "вместимость", "занятий в неделю", "длительность", "часов", "часов в неделю", "урок":
						numeric = true
					}
				}
				if number, parseErr := strconv.ParseFloat(strings.ReplaceAll(value, ",", "."), 64); numeric && parseErr == nil {
					err = f.SetCellFloat(name, cell, number, -1, 64)
				} else {
					err = f.SetCellStr(name, cell, value)
				}
				if err != nil {
					return nil, err
				}
			}
		}
		if columns > 0 {
			last, _ := excelize.ColumnNumberToName(columns)
			f.SetColWidth(name, "A", last, 24)
			f.SetCellStyle(name, "A1", last+"1", style)
			f.SetRowHeight(name, 1, 24)
		}
		f.SetPanes(name, &excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"})
	}
	out, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
func (b *DesktopBridge) ReadSpreadsheet() (WireData, error) {
	if b.openFile == nil {
		return WireData{}, errors.New("диалог открытия недоступен")
	}
	path, err := b.openFile("table")
	if err != nil || path == "" {
		return WireData{}, err
	}
	f, err := os.Open(path)
	if err != nil {
		return WireData{}, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, (32<<20)+1))
	if err != nil {
		return WireData{}, err
	}
	book, err := readSpreadsheet(raw, path)
	if err != nil {
		return WireData{}, err
	}
	data, err := json.Marshal(book)
	if err != nil {
		return WireData{}, err
	}
	return packWire(data), nil
}
func (b *DesktopBridge) WriteSpreadsheet(raw, format string) (bool, error) {
	if len(raw) > maxProjectBytes {
		return false, errors.New("слишком большой экспорт")
	}
	var book SpreadsheetBook
	if err := json.Unmarshal([]byte(raw), &book); err != nil {
		return false, err
	}
	data, err := writeSpreadsheet(book, format)
	if err != nil {
		return false, err
	}
	if b.savePath == nil {
		return false, errors.New("диалог сохранения недоступен")
	}
	path, err := b.savePath("Расписание_данные."+format, format)
	if err != nil || path == "" {
		return false, err
	}
	if !strings.EqualFold(filepath.Ext(path), "."+format) {
		path += "." + format
	}
	if err = atomicWrite(path, data); err != nil {
		return false, err
	}
	return true, nil
}
func spreadsheetHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		w.WriteHeader(405)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxProjectBytes)
	var request struct {
		Name, Data, Format string
		Book               SpreadsheetBook
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		writeJSON(w, 400, map[string]string{"error": "Неверная таблица"})
		return
	}
	if strings.HasSuffix(r.URL.Path, "/read") {
		raw, err := base64.StdEncoding.DecodeString(request.Data)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		book, err := readSpreadsheet(raw, request.Name)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, book)
	} else {
		raw, err := writeSpreadsheet(request.Book, request.Format)
		if err != nil {
			writeJSON(w, 400, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]string{"data": base64.StdEncoding.EncodeToString(raw)})
	}
}
