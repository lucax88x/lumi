package app

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"lumi/internal/api"
	"math"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
)

func (s *Server) Transcribe(w http.ResponseWriter, r *http.Request) {
	subject, ok := requestSubject(w, r)
	if !ok {
		return
	}
	languages := []string{"it"}
	if subject == api.English {
		languages = nil
	}
	if strings.TrimSpace(s.config.OpenAIAPIKey) == "" {
		problem(w, 503, "transcription_not_configured", "Per i vocali serve la chiave OpenAI: chiedi a un genitore di configurarla. Intanto puoi scrivere.")
		return
	}
	select {
	case s.voice <- struct{}{}:
		defer func() { <-s.voice }()
	default:
		problem(w, 429, "voice_busy", "Sto già ascoltando un vocale. Riprova tra un momento.")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		problem(w, 400, "invalid_audio", "Il vocale è troppo grande o non è valido.")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		problem(w, 400, "missing_audio", "Registra prima un vocale.")
		return
	}
	defer file.Close()
	temp, err := os.CreateTemp("", "lumi-voice-*")
	if err != nil {
		internalError(w, err)
		return
	}
	defer os.Remove(temp.Name())
	size, err := io.Copy(temp, io.LimitReader(file, 8<<20))
	temp.Close()
	if err != nil || size == 0 {
		problem(w, 400, "invalid_audio", "Non ho ricevuto il vocale.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	cmd := exec.CommandContext(ctx, "ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", temp.Name(), "-t", "61", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1")
	wav, err := cmd.Output()
	cancel()
	if err != nil {
		problem(w, 400, "invalid_audio", "Non riesco ad ascoltare questo vocale. Prova a registrarlo di nuovo.")
		return
	}
	if len(wav) > 60*32000+1024 {
		problem(w, 400, "audio_too_long", "Il vocale può durare al massimo un minuto.")
		return
	}
	if len(wav) < 3200 {
		problem(w, 400, "audio_empty", "Il vocale è troppo breve. Proviamo ancora?")
		return
	}
	if pcmQuiet(wav) {
		problem(w, 400, "silence", "Non ho sentito parole. Avvicinati al microfono e riprova.")
		return
	}
	ctx, cancel = context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	// A dedicated client keeps paid transcription separate from ChatGPT OAuth.
	client := openai.NewClient(option.WithAPIKey(s.config.OpenAIAPIKey), option.WithBaseURL("https://api.openai.com/v1/"), option.WithMaxRetries(0), option.WithHTTPClient(s.http))
	result, err := client.Audio.Transcriptions.New(ctx, openai.AudioTranscriptionNewParams{
		File:           openai.File(bytes.NewReader(wav), "question.wav", "audio/wav"),
		Model:          openai.AudioModelGPTTranscribe,
		Languages:      languages,
		ResponseFormat: openai.AudioResponseFormatJSON,
	})
	if err != nil {
		var apiErr *openai.Error
		if errors.As(err, &apiErr) {
			switch apiErr.StatusCode {
			case 401, 403:
				problem(w, 503, "transcription_credentials", "Un genitore deve controllare la chiave OpenAI per i vocali. Intanto puoi scrivere.")
				return
			case 429:
				problem(w, 503, "transcription_limit", "L’ascolto ha raggiunto un limite. Un genitore può controllare il credito OpenAI; intanto puoi scrivere.")
				return
			}
		}
		problem(w, 503, "voice_unavailable", "Non riesco ad ascoltarti adesso. Puoi scrivere o riprovare.")
		return
	}
	result.Text = strings.TrimSpace(result.Text)
	if result.Text == "" || strings.HasPrefix(result.Text, "[BLANK_AUDIO]") {
		problem(w, 400, "silence", "Non ho sentito parole. Avvicinati al microfono e riprova.")
		return
	}
	if len([]rune(result.Text)) > 4000 {
		problem(w, 400, "transcription_too_long", "Proviamo con una frase più breve.")
		return
	}
	sendJSON(w, 200, api.Transcription{Text: result.Text})
}

// FFmpeg above always produces mono, 16 kHz signed 16-bit PCM. Reject near-silence
// before uploading, avoiding paid requests for empty recordings.
func pcmQuiet(wav []byte) bool {
	for offset := 12; offset+8 <= len(wav); {
		size := uint64(binary.LittleEndian.Uint32(wav[offset+4 : offset+8]))
		if string(wav[offset:offset+4]) == "data" {
			data := wav[offset+8:]
			if size < uint64(len(data)) {
				data = data[:size]
			}
			if len(data) < 2 {
				return true
			}
			var sum float64
			for i := 0; i+1 < len(data); i += 2 {
				sample := float64(int16(binary.LittleEndian.Uint16(data[i:i+2]))) / 32768
				sum += sample * sample
			}
			return math.Sqrt(sum/float64(len(data)/2)) < 0.001
		}
		next := uint64(offset) + 8 + size + size%2
		if next > uint64(len(wav)) {
			return true
		}
		offset = int(next)
	}
	return true
}
