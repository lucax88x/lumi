package app

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"lumi/internal/api"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
)

func sampleWAV(silent bool) []byte {
	return sampleWAVSeconds(silent, 1)
}
func sampleWAVSeconds(silent bool, seconds int) []byte {
	samples := 16000 * seconds
	var out bytes.Buffer
	out.WriteString("RIFF")
	_ = binary.Write(&out, binary.LittleEndian, uint32(36+samples*2))
	out.WriteString("WAVEfmt ")
	for _, v := range []any{uint32(16), uint16(1), uint16(1), uint32(16000), uint32(32000), uint16(2), uint16(16)} {
		_ = binary.Write(&out, binary.LittleEndian, v)
	}
	out.WriteString("data")
	_ = binary.Write(&out, binary.LittleEndian, uint32(samples*2))
	for i := range samples {
		var value int16
		if !silent {
			value = int16(math.Sin(float64(i)*2*math.Pi*440/16000) * 8000)
		}
		_ = binary.Write(&out, binary.LittleEndian, value)
	}
	return out.Bytes()
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func transcribeAudio(s *Server, audio []byte) *httptest.ResponseRecorder {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "voice.wav")
	_, _ = part.Write(audio)
	writer.Close()
	r := httptest.NewRequest("POST", "/api/v1/transcriptions", &body)
	r.Header.Set("Origin", s.config.Origin)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	familyTestHandler(s).ServeHTTP(w, r)
	return w
}

func TestOpenAITranscriptionAndValidation(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Fatal("ffmpeg required for audio integration test")
	}
	t.Setenv("OPENAI_API_KEY", "wrong-env-key")
	t.Setenv("OPENAI_BASE_URL", "https://wrong.example/v1/")
	s := testServer(t)
	s.config.OpenAIAPIKey = "audio-test-key"
	var calls atomic.Int32
	s.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		if r.URL.String() != "https://api.openai.com/v1/audio/transcriptions" {
			t.Errorf("wrong endpoint %s", r.URL)
		}
		if r.Header.Get("Authorization") != "Bearer audio-test-key" {
			t.Error("wrong key")
		}
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			t.Fatal(err)
		}
		defer r.MultipartForm.RemoveAll()
		if r.FormValue("languages[]") != "it" || r.FormValue("language") != "" || r.FormValue("model") != "gpt-transcribe" {
			t.Errorf("wrong transcription params %v", r.MultipartForm.Value)
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		wav, _ := io.ReadAll(file)
		if header.Filename != "question.wav" || header.Header.Get("Content-Type") != "audio/wav" || pcmQuiet(wav) {
			t.Error("wrong audio upload")
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"text":" Che cosa significa meraviglia? "}`))}, nil
	})
	for _, tc := range []struct {
		name  string
		audio []byte
		code  int
	}{
		{"speech", sampleWAV(false), 200}, {"silence", sampleWAV(true), 400}, {"invalid", []byte("not audio"), 400},
		{"too long", sampleWAVSeconds(false, 62), 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := transcribeAudio(s, tc.audio)
			if w.Code != tc.code {
				t.Fatalf("status %d: %s", w.Code, w.Body)
			}
			if tc.code == 200 {
				var v api.Transcription
				_ = json.Unmarshal(w.Body.Bytes(), &v)
				if v.Text != "Che cosa significa meraviglia?" {
					t.Fatal("wrong text")
				}
			}
		})
	}
	if calls.Load() != 1 {
		t.Fatal("sent invalid audio to OpenAI")
	}
	var count int
	_ = s.store.db.QueryRow(`SELECT count(*) FROM messages`).Scan(&count)
	if count != 0 {
		t.Fatal("transcription stored without confirmation")
	}
}

func TestTranscriptionErrorsAndNoRetry(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Fatal("ffmpeg required")
	}
	for _, tc := range []struct {
		name           string
		status         int
		response, code string
	}{
		{"key", 401, `{"error":{"message":"secret detail","type":"invalid_request_error"}}`, "transcription_credentials"},
		{"quota", 429, `{"error":{"message":"secret detail","type":"insufficient_quota"}}`, "transcription_limit"},
		{"server", 500, `{"error":{"message":"secret detail"}}`, "voice_unavailable"},
		{"invalid response", 200, "invalid json", "voice_unavailable"},
		{"empty text", 200, `{"text":" "}`, "silence"},
		{"timeout", 0, "", "voice_unavailable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := testServer(t)
			s.config.OpenAIAPIKey = "secret-key"
			calls := 0
			s.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if tc.status == 0 {
					return nil, context.DeadlineExceeded
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(tc.response))}, nil
			})
			w := transcribeAudio(s, sampleWAV(false))
			var result api.Error
			_ = json.Unmarshal(w.Body.Bytes(), &result)
			if w.Code < 400 || result.Code != tc.code || strings.Contains(w.Body.String(), "secret") {
				t.Fatalf("bad error %d %s", w.Code, w.Body)
			}
			if calls != 1 {
				t.Fatalf("retried paid request: %d", calls)
			}
		})
	}
}

func TestMissingTranscriptionKey(t *testing.T) {
	s := testServer(t)
	s.http.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) { t.Fatal("called upstream without key"); return nil, nil })
	w := transcribeAudio(s, sampleWAV(false))
	if w.Code != 503 || !strings.Contains(w.Body.String(), "transcription_not_configured") {
		t.Fatalf("unexpected %s", w.Body)
	}
	for _, key := range []string{"", "configured-key"} {
		s.config.OpenAIAPIKey = key
		w = httptest.NewRecorder()
		s.GetConnection(w, httptest.NewRequest("GET", "/", nil))
		var status api.ConnectionStatus
		_ = json.Unmarshal(w.Body.Bytes(), &status)
		if status.TranscriptionConfigured != (key != "") || strings.Contains(w.Body.String(), "configured-key") {
			t.Fatal("invalid key status")
		}
	}
}
func TestPCMQuietHandlesMalformedInput(t *testing.T) {
	if !pcmQuiet([]byte("invalid")) || !pcmQuiet(sampleWAV(true)) || pcmQuiet(sampleWAV(false)) {
		t.Fatal("invalid silence detection")
	}
}
