// Proxy X (Twitter) para OpenHer Chat.
//
// Puente HTTP sobre `twitter-cli` (sesión propia del dueño, guardada en el
// servidor). Solo expone lecturas y un POST de búsqueda limitada; nunca
// credenciales. El binario no guarda cookies: twitter-cli lee su config local.
//
// Endpoints:
//
//	GET  /healthz
//	GET  /x/user-posts?user=<screenName>&count=<1..20>
//	GET  /x/user?user=<screenName>
//	GET  /x/feed?count=<1..20>
//	POST /x/search  {query, count, from?, since?, until?, lang?}  (best-effort)
//
// Uso: openher-x-proxy -addr 127.0.0.1:8081 -twitter-binary twitter
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const (
	execTimeout = 45 * time.Second
	maxCount    = 20
)

type server struct {
	binary string
}

func (s *server) cors(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
}

func (s *server) fail(w http.ResponseWriter, status int, message string) {
	log.Printf("error %d: %s", status, message)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": message})
}

// runTwitter ejecuta twitter-cli y devuelve el JSON crudo de stdout, validado.
func (s *server) runTwitter(args ...string) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), execTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.binary, args...)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		return nil, errors.New("twitter-cli timeout")
	}
	raw := strings.TrimSpace(stdout.String())
	// La advertencia de ClientTransaction va a stderr; igual la reportamos si no hay JSON.
	if raw == "" {
		return nil, fmt.Errorf("twitter-cli sin salida: %s", strings.TrimSpace(stderr.String()))
	}
	if !json.Valid([]byte(raw)) {
		return nil, errors.New("twitter-cli devolvió salida no-JSON")
	}
	if err != nil {
		// El CLI usa exit != 0 para resultados "ok: false"; el JSON manda.
		return json.RawMessage(raw), nil
	}
	return json.RawMessage(raw), nil
}

func clampCount(raw string) string {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value < 1 {
		return "10"
	}
	if value > maxCount {
		value = maxCount
	}
	return strconv.Itoa(value)
}

// flexibleCount acepta `count` como número JSON (lo que manda la app) o como
// string (clientes manuales). Sin esto, `{"count":3}` falla el decode con 400.
type flexibleCount int

func (c *flexibleCount) UnmarshalJSON(data []byte) error {
	raw := strings.Trim(strings.TrimSpace(string(data)), `"`)
	if raw == "" || raw == "null" {
		return nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fmt.Errorf("count inválido: %w", err)
	}
	*c = flexibleCount(value)
	return nil
}

func cleanUser(raw string) (string, bool) {
	user := strings.TrimPrefix(strings.TrimSpace(raw), "@")
	if user == "" || strings.ContainsAny(user, " \t/\\&?") {
		return "", false
	}
	return user, true
}

func (s *server) handleUserPosts(w http.ResponseWriter, r *http.Request) {
	user, ok := cleanUser(r.URL.Query().Get("user"))
	if !ok {
		s.fail(w, http.StatusBadRequest, "user inválido")
		return
	}
	raw, err := s.runTwitter("user-posts", user, "-n", clampCount(r.URL.Query().Get("count")), "--json")
	if err != nil {
		s.fail(w, http.StatusBadGateway, err.Error())
		return
	}
	s.cors(w)
	_, _ = w.Write(raw)
}

func (s *server) handleUser(w http.ResponseWriter, r *http.Request) {
	user, ok := cleanUser(r.URL.Query().Get("user"))
	if !ok {
		s.fail(w, http.StatusBadRequest, "user inválido")
		return
	}
	raw, err := s.runTwitter("user", user, "--json")
	if err != nil {
		s.fail(w, http.StatusBadGateway, err.Error())
		return
	}
	s.cors(w)
	_, _ = w.Write(raw)
}

func (s *server) handleFeed(w http.ResponseWriter, r *http.Request) {
	raw, err := s.runTwitter("feed", "-n", clampCount(r.URL.Query().Get("count")), "--json")
	if err != nil {
		s.fail(w, http.StatusBadGateway, err.Error())
		return
	}
	s.cors(w)
	_, _ = w.Write(raw)
}

func (s *server) handleSearch(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Query string        `json:"query"`
		Count flexibleCount `json:"count"`
		From  string        `json:"from"`
		Since string        `json:"since"`
		Until string        `json:"until"`
		Lang  string        `json:"lang"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8*1024)).Decode(&body); err != nil {
		s.fail(w, http.StatusBadRequest, "JSON inválido")
		return
	}
	query := strings.TrimSpace(body.Query)
	if query == "" && strings.TrimSpace(body.From) == "" {
		s.fail(w, http.StatusBadRequest, "query o from requerido")
		return
	}
	args := []string{"search"}
	if query != "" {
		args = append(args, query)
	}
	args = append(args, "-n", clampCount(strconv.Itoa(int(body.Count))), "--json")
	if from, ok := cleanUser(body.From); ok {
		args = append(args, "--from", from)
	}
	for flag, value := range map[string]string{"--since": body.Since, "--until": body.Until, "--lang": body.Lang} {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			args = append(args, flag, trimmed)
		}
	}
	raw, err := s.runTwitter(args...)
	if err != nil {
		s.fail(w, http.StatusBadGateway, err.Error())
		return
	}
	s.cors(w)
	_, _ = w.Write(raw)
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8081", "dirección de escucha")
	binary := flag.String("twitter-binary", "twitter", "ruta o nombre de twitter-cli")
	allowSearch := flag.Bool("allow-search", true, "habilitar POST /x/search (el endpoint de búsqueda de X puede fallar según su API)")
	flag.Parse()

	s := &server{binary: *binary}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		s.cors(w)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/x/user-posts", s.handleUserPosts)
	mux.HandleFunc("/x/user", s.handleUser)
	mux.HandleFunc("/x/feed", s.handleFeed)
	if *allowSearch {
		mux.HandleFunc("/x/search", s.handleSearch)
	}
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			s.cors(w)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		s.fail(w, http.StatusNotFound, "ruta desconocida")
	})

	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	log.Printf("x-proxy %s -> %s", *addr, *binary)
	log.Fatal(httpServer.ListenAndServe())
}
