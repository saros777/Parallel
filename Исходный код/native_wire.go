package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"errors"
	"io"
)

type WireData struct {
	Data     string `json:"data"`
	Encoding string `json:"encoding"`
}
type WireResponse struct {
	Status  int      `json:"status"`
	Content WireData `json:"content"`
}

func packWire(raw []byte) WireData {
	if len(raw) < 32768 {
		return WireData{Data: string(raw), Encoding: "utf8"}
	}
	var out bytes.Buffer
	z, _ := gzip.NewWriterLevel(&out, gzip.BestSpeed)
	z.Write(raw)
	z.Close()
	return WireData{Data: base64.StdEncoding.EncodeToString(out.Bytes()), Encoding: "gzip/base64"}
}
func unpackWire(data, encoding string) ([]byte, error) {
	if encoding == "utf8" || encoding == "" {
		if len(data) > maxProjectBytes {
			return nil, errors.New("слишком большой запрос")
		}
		return []byte(data), nil
	}
	if encoding != "gzip/base64" || len(data) > maxProjectBytes {
		return nil, errors.New("неподдерживаемое кодирование запроса")
	}
	raw, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return nil, err
	}
	z, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	defer z.Close()
	out, err := io.ReadAll(io.LimitReader(z, maxProjectBytes+1))
	if len(out) > maxProjectBytes {
		return nil, errors.New("слишком большой распакованный запрос")
	}
	return out, err
}
func (b *DesktopBridge) RequestEncoded(path, method, data, encoding string) WireResponse {
	raw, err := unpackWire(data, encoding)
	if err != nil {
		return WireResponse{Status: 400, Content: WireData{Data: `{"error":"Неверный или слишком большой запрос"}`, Encoding: "utf8"}}
	}
	r := b.Request(path, method, string(raw))
	content := packWire([]byte(r.Body))
	if path == "/api/state" && method == "GET" && r.Status == 200 {
		b.stateJSONBytes.CompareAndSwap(0, int64(len(r.Body)))
		b.stateWireBytes.CompareAndSwap(0, int64(len(content.Data)))
	}
	return WireResponse{Status: r.Status, Content: content}
}
