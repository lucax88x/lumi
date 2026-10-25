// Disposable HTTP upstream for testing production proxy headers and streaming.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"
)

func main() {
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	http.HandleFunc("/headers", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"host": r.Host, "forwardedHost": r.Header.Get("X-Forwarded-Host"),
			"proto": r.Header.Get("X-Forwarded-Proto"),
		})
	})
	http.HandleFunc("/stream", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		time.Sleep(2 * time.Second)
		_, _ = fmt.Fprint(w, "data: second\n\n")
	})
	log.Fatal(http.ListenAndServe(":8080", nil))
}
