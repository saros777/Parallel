package main

import (
	"bytes"
	"reflect"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestSpreadsheetXLSXAndCSVRoundTrip(t *testing.T) {
	book := SpreadsheetBook{Sheets: []SpreadsheetSheet{{Name: "Учителя", Rows: [][]string{{"ID", "ФИО", "Часов"}, {"t1", "Иванова Анна Ивановна", "2.5"}, {"t2", "Петров; Пётр Петрович", "3"}}}}}
	for _, format := range []string{"xlsx", "csv"} {
		raw, err := writeSpreadsheet(book, format)
		if err != nil {
			t.Fatal(err)
		}
		got, err := readSpreadsheet(raw, "Учителя."+format)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got.Sheets[0].Rows, book.Sheets[0].Rows) {
			t.Fatal(format, got.Sheets[0].Rows)
		}
		if format == "xlsx" && !bytes.HasPrefix(raw, []byte("PK")) {
			t.Fatal("XLSX is not a real OOXML workbook")
		}
	}
}
func TestSpreadsheetValuesAreNotExecutableFormulas(t *testing.T) {
	book := SpreadsheetBook{Sheets: []SpreadsheetSheet{{Name: "Данные", Rows: [][]string{{"Название"}, {"=HYPERLINK(\"https://example.invalid\")"}}}}}
	raw, err := writeSpreadsheet(book, "xlsx")
	if err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	formula, _ := f.GetCellFormula("Данные", "A2")
	value, _ := f.GetCellValue("Данные", "A2")
	if formula != "" || value != book.Sheets[0].Rows[1][0] {
		t.Fatal("Input was interpreted as a formula")
	}
	csv, err := writeSpreadsheet(book, "csv")
	if err != nil || !bytes.Contains(csv, []byte("'=HYPERLINK")) {
		t.Fatal("CSV formula text not escaped", err)
	}
}
func TestSpreadsheetBadInputAndLimits(t *testing.T) {
	if _, err := readSpreadsheet([]byte("not XLSX"), "bad.xlsx"); err == nil {
		t.Fatal("Broken workbook accepted")
	}
	if _, err := readSpreadsheet([]byte("ФИО;Класс\n\"broken"), "bad.csv"); err == nil {
		t.Fatal("Broken CSV accepted")
	}
	if _, err := readSpreadsheet([]byte(strings.Repeat("a\n", 25001)), "large.csv"); err == nil {
		t.Fatal("CSV row limit not enforced")
	}
	book := SpreadsheetBook{Sheets: []SpreadsheetSheet{{Name: "A", Rows: [][]string{{"A"}}}, {Name: "B", Rows: [][]string{{"B"}}}}}
	if _, err := writeSpreadsheet(book, "csv"); err == nil {
		t.Fatal("Multi-sheet CSV accepted")
	}
	b := projectBridge(t)
	b.savePath = func(string, string) (string, error) { return "", nil }
	if saved, err := b.WriteSpreadsheet(`{"sheets":[{"name":"Учителя","rows":[["ФИО"]]}]}`, "xlsx"); saved || err != nil {
		t.Fatal("Cancelled export not respected", saved, err)
	}
}
