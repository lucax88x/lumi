package main

import (
	"context"
	"errors"
	"log/slog"
	"lumi/internal/app"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
func main() {
	server, err := app.NewPortal(context.Background(), app.Config{DataDir: env("DATA_DIR", "data"), Origin: env("PUBLIC_ORIGIN", "http://127.0.0.1:5173"), WebDir: env("WEB_DIR", "web/dist"), OpenAIAPIKey: os.Getenv("OPENAI_API_KEY"), OIDCIssuer: os.Getenv("OIDC_ISSUER_URL"), OIDCInternalURL: os.Getenv("OIDC_INTERNAL_URL"), OIDCClientID: os.Getenv("OIDC_CLIENT_ID"), OIDCClientSecret: os.Getenv("OIDC_CLIENT_SECRET")})
	if err != nil {
		slog.Error("startup failed", "error", err)
		os.Exit(1)
	}
	defer server.Close()
	httpServer := &http.Server{Addr: env("LISTEN_ADDR", ":8080"), Handler: server.Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 90 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 32 << 10}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdown)
	}()
	slog.Info("Lumi ready", "address", httpServer.Addr)
	if err = httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
