package app

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestWordImages(t *testing.T) {
	s := testServer(t)
	calls := 0
	s.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		q := r.URL.Query()
		if r.URL.Host != "it.wikipedia.org" || q.Get("gsrsearch") != "arcobaleno" || q.Get("pilicense") != "free" || q.Get("gsrlimit") != "3" {
			t.Error("wrong image search")
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("sent credentials to Wikipedia")
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"query":{"pages":[
			{"title":"Wrong host","index":1,"pageimage":"x.jpg","thumbnail":{"source":"https://upload.wikimedia.org.evil.test/x.jpg"}},
			{"title":"Missing image","index":2},
			{"title":"Arcobaleno","index":3,"pageimage":"Rainbow.jpg","thumbnail":{"source":"https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a1/Rainbow.jpg"}}
		]}}`))}, nil
	})
	w := call(s, "GET", "/api/v1/word-images?word=arcobaleno", "", "", nil, "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "Wrong host") || !strings.Contains(w.Body.String(), "File:Rainbow.jpg") {
		t.Fatalf("bad images %d %s", w.Code, w.Body)
	}
	for _, query := range []string{"", "http%3A%2F%2F127.0.0.1", strings.Repeat("a", 81)} {
		w = call(s, "GET", "/api/v1/word-images?word="+query, "", "", nil, "")
		if w.Code != 400 {
			t.Fatalf("invalid word accepted: %s", query)
		}
	}
	if calls != 1 {
		t.Fatal("invalid input fetched")
	}
}

func TestWordImageFailures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   int
	}{
		{"no images", 200, `{}`, 200},
		{"bad JSON", 200, `invalid`, 502},
		{"API error", 200, `{"error":{"info":"private error"}}`, 502},
		{"unavailable", 429, `private error`, 503},
		{"timeout", 0, "", 503},
		{"redirect", 302, "", 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := testServer(t)
			calls := 0
			s.http.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
				calls++
				if tc.status == 0 {
					return nil, context.DeadlineExceeded
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Location": {"http://127.0.0.1/"}}, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			w := call(s, "GET", "/api/v1/word-images?word=arcobaleno", "", "", nil, "")
			if w.Code != tc.want || strings.Contains(w.Body.String(), "private error") {
				t.Fatalf("bad response: %d %s", w.Code, w.Body)
			}
			if calls != 1 {
				t.Fatal("unexpected redirect or retry")
			}
		})
	}
}
