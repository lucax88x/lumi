package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"lumi/internal/api"
)

var rockImages = []api.WordImage{{Title: "Roccia", ImageUrl: "https://upload.wikimedia.org/rock.jpg", SourceUrl: "https://it.wikipedia.org/wiki/Roccia", CreditUrl: "https://it.wikipedia.org/wiki/File:Rock.jpg"}}

func toolCall(id, arguments string) map[string]any {
	return map[string]any{"type": "function_call", "id": "fc_" + id, "call_id": id, "namespace": "lumi", "name": "show_images", "arguments": arguments, "status": "completed"}
}
func completedStream(text string, output []any) *http.Response {
	var body strings.Builder
	if text != "" {
		b, _ := json.Marshal(map[string]any{"type": "response.output_text.delta", "delta": text})
		fmt.Fprintf(&body, "data: %s\n\n", b)
	}
	b, _ := json.Marshal(map[string]any{"type": "response.completed", "response": map[string]any{"status": "completed", "output": output}})
	fmt.Fprintf(&body, "data: %s\n\n", b)
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body.String()))}
}

// The subscription route emits completed items but an empty final output array.
func streamedItems(output []any) *http.Response {
	var body strings.Builder
	for index, item := range output {
		b, _ := json.Marshal(map[string]any{"type": "response.output_item.done", "output_index": index, "item": item})
		fmt.Fprintf(&body, "data: %s\n\n", b)
	}
	terminal := completedStream("", []any{})
	rest, _ := io.ReadAll(terminal.Body)
	terminal.Body.Close()
	body.Write(rest)
	terminal.Body = io.NopCloser(strings.NewReader(body.String()))
	return terminal
}

func toolGenerator(t *testing.T, transport func(*http.Request) (*http.Response, error)) *OpenAIGenerator {
	t.Helper()
	auth, err := NewOAuth(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	auth.creds = credentials{AccessToken: "test-access", RefreshToken: "refresh", Scopes: permission, ExpiresAt: time.Now().Add(time.Hour)}
	auth.http.Transport = roundTripFunc(transport)
	return &OpenAIGenerator{auth: auth}
}
func requestBody(t *testing.T, r *http.Request) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Error(err)
	}
	return body
}

func TestImageToolConversation(t *testing.T) {
	calls, searches := 0, 0
	var events []GenerationEvent
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		calls++
		body := requestBody(t, r)
		if r.Header.Get("Authorization") != "Bearer test-access" || body["store"] != false || body["stream"] != true || body["parallel_tool_calls"] != false {
			t.Errorf("bad request contract: %v", body)
		}
		tools := body["tools"].([]any)
		ns := tools[0].(map[string]any)
		fn := ns["tools"].([]any)[0].(map[string]any)
		wantTool := "show_images"
		if calls > 1 {
			wantTool = "show_sentence_map"
		}
		if ns["type"] != "namespace" || ns["name"] != "lumi" || fn["name"] != wantTool || fn["strict"] != true {
			t.Errorf("wrong tool: %v", tools)
		}
		if !strings.Contains(body["instructions"].(string), "solo quando") {
			t.Error("missing application instructions")
		}
		input := body["input"].([]any)
		if calls == 1 {
			if len(input) != 3 || input[2].(map[string]any)["content"] != "Me ne mostri una?" {
				t.Errorf("missing follow-up context: %v", input)
			}
			call := toolCall("one", `{"word":"roccia"}`)
			return streamedItems([]any{map[string]any{"type": "reasoning", "id": "rs_1", "summary": []any{}, "encrypted_content": "opaque-reasoning"}, call, call}), nil
		}
		if calls != 2 || searches != 1 || len(events) != 1 || len(events[0].Images) != 1 {
			t.Error("images should be emitted once before continuation")
		}
		if body["tool_choice"] == "none" || len(input) != 6 {
			t.Errorf("bad continuation: %v", body)
		}
		if input[3].(map[string]any)["encrypted_content"] != "opaque-reasoning" {
			t.Error("lost reasoning")
		}
		result := input[5].(map[string]any)
		if result["type"] != "function_call_output" || result["call_id"] != "one" || !strings.Contains(result["output"].(string), "Roccia") {
			t.Errorf("wrong tool output: %v", result)
		}
		return completedStream("Ecco una roccia!", []any{}), nil
	})
	g.searchImages = func(ctx context.Context, word string) ([]api.WordImage, error) {
		searches++
		if word != "roccia" {
			t.Errorf("wrong search: %s", word)
		}
		return rockImages, nil
	}
	history := []api.Message{{Role: "user", Text: "Cos'è una roccia?", Status: "completed"}, {Role: "assistant", Text: "Una roccia è un materiale naturale.", Status: "completed"}, {Role: "user", Text: "Me ne mostri una?", Status: "completed"}}
	err := g.Stream(context.Background(), api.Settings{Model: "test", Prompt: "Prompt personalizzato"}, history, func(e GenerationEvent) error { events = append(events, e); return nil })
	if err != nil || calls != 2 || searches != 1 || len(events) != 2 || events[1].Text != "Ecco una roccia!" {
		t.Fatalf("bad flow: %v, %d, %d, %+v", err, calls, searches, events)
	}
}

func TestImageToolFailuresAndLimits(t *testing.T) {
	for _, tc := range []struct {
		name, arguments string
		searchErr       error
		extraCall       bool
		wantSearch      int
		wantError       bool
	}{
		{name: "empty results", arguments: `{"word":"roccia"}`, wantSearch: 1},
		{name: "timeout", arguments: `{"word":"roccia"}`, searchErr: context.DeadlineExceeded, wantSearch: 1, wantError: true},
		{name: "invalid JSON", arguments: `{`, wantError: true},
		{name: "unknown parameter", arguments: `{"word":"roccia","url":"https://example.com"}`, wantError: true},
		{name: "trailing JSON", arguments: `{"word":"roccia"} {}`, wantError: true},
		{name: "missing word", arguments: `{}`, wantError: true},
		{name: "extra call", arguments: `{"word":"roccia"}`, extraCall: true, wantSearch: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls, searches, attachments := 0, 0, 0
			g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
				calls++
				body := requestBody(t, r)
				if calls == 1 {
					output := []any{toolCall("one", tc.arguments)}
					if tc.extraCall {
						output = append(output, toolCall("two", tc.arguments))
					}
					return completedStream("", output), nil
				}
				input := body["input"].([]any)
				outputs := 0
				for _, raw := range input {
					item := raw.(map[string]any)
					if item["type"] != "function_call_output" {
						continue
					}
					outputs++
					var result imageToolResult
					if err := json.Unmarshal([]byte(item["output"].(string)), &result); err != nil {
						t.Error(err)
					}
					wantError := tc.wantError || item["call_id"] == "two"
					if (result.Error != "") != wantError || result.Images == nil {
						t.Errorf("bad tool failure: %+v", result)
					}
				}
				expected := 1
				if tc.extraCall {
					expected++
				}
				if outputs != expected {
					t.Error("missing call outputs")
				}
				return completedStream("Non ho trovato immagini.", []any{}), nil
			})
			g.searchImages = func(context.Context, string) ([]api.WordImage, error) {
				searches++
				return []api.WordImage{}, tc.searchErr
			}
			err := g.Stream(context.Background(), api.Settings{Model: "test"}, nil, func(e GenerationEvent) error { attachments += len(e.Images); return nil })
			if err != nil || calls != 2 || searches != tc.wantSearch || attachments != 0 {
				t.Fatalf("bad failure handling: %v searches=%d", err, searches)
			}
		})
	}
}

func TestImageToolInterruptedStreamDoesNotSearch(t *testing.T) {
	g := toolGenerator(t, func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: io.NopCloser(strings.NewReader("data: {\"type\":\"response.function_call_arguments.done\",\"arguments\":\"{\\\"word\\\":\\\"roccia\\\"}\"}\n\n"))}, nil
	})
	g.searchImages = func(context.Context, string) ([]api.WordImage, error) {
		t.Error("searched before completed response")
		return rockImages, nil
	}
	if err := g.Stream(context.Background(), api.Settings{Model: "test"}, nil, func(GenerationEvent) error { return nil }); err == nil {
		t.Fatal("accepted interrupted stream")
	}
}

func TestImageToolCallbackCancellation(t *testing.T) {
	calls := 0
	g := toolGenerator(t, func(*http.Request) (*http.Response, error) {
		calls++
		return completedStream("", []any{toolCall("one", `{"word":"roccia"}`)}), nil
	})
	g.searchImages = func(context.Context, string) ([]api.WordImage, error) { return rockImages, nil }
	err := g.Stream(context.Background(), api.Settings{Model: "test"}, nil, func(GenerationEvent) error { return context.Canceled })
	if !errors.Is(err, context.Canceled) || calls != 1 {
		t.Fatalf("continued after cancelled callback: %v", err)
	}
}

func TestImageToolRefreshDuringContinuationDoesNotRepeatSearch(t *testing.T) {
	responses, searches, refreshes := 0, 0, 0
	g := toolGenerator(t, func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "/oauth/token") {
			refreshes++
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"access_token":"renewed","refresh_token":"rotated","expires_in":3600}`))}, nil
		}
		responses++
		if responses == 1 {
			return completedStream("", []any{toolCall("one", `{"word":"roccia"}`)}), nil
		}
		if responses == 2 {
			return &http.Response{StatusCode: 401, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"error":{"message":"Expired","type":"invalid_request_error"}}`))}, nil
		}
		if r.Header.Get("Authorization") != "Bearer renewed" {
			t.Error("continued with old token")
		}
		input := requestBody(t, r)["input"].([]any)
		if input[len(input)-1].(map[string]any)["call_id"] != "one" {
			t.Error("lost tool output on refresh")
		}
		return completedStream("Ecco una roccia!", []any{}), nil
	})
	g.searchImages = func(context.Context, string) ([]api.WordImage, error) { searches++; return rockImages, nil }
	err := g.Stream(context.Background(), api.Settings{Model: "test"}, nil, func(GenerationEvent) error { return nil })
	if err != nil || responses != 3 || searches != 1 || refreshes != 1 {
		t.Fatalf("bad refresh: %v responses=%d searches=%d refreshes=%d", err, responses, searches, refreshes)
	}
}
