// Proxy same-origin mínimo para el gateway de OpenCode (https://opencode.ai).
//
// Solo stdlib, sin dependencias: reenvía método, query, headers y cuerpo al
// upstream y devuelve la respuesta tal cual (streaming SSE incluido) agregando
// cabeceras CORS. La API key del usuario viaja en su propio header
// `Authorization` y solo se reenvía al upstream, nunca se guarda.
//
// Uso:
//
//	go build -o openher-zen-proxy .
//	./openher-zen-proxy -addr 127.0.0.1:8080 -upstream https://opencode.ai
package main

import (
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

// Cabeceras de salto que nunca se reenvían al upstream.
var hopHeaders = map[string]struct{}{
	"Host":              {},
	"Connection":        {},
	"Content-Length":    {},
	"Transfer-Encoding": {},
	"Keep-Alive":        {},
	"Upgrade":           {},
	"Expect":            {},
}

func corsHeaders(h http.Header) {
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	h.Set("Access-Control-Max-Age", "3600")
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "dirección de escucha")
	upstream := flag.String("upstream", "https://opencode.ai", "origen a proxear")
	flag.Parse()

	target, err := url.Parse(strings.TrimRight(*upstream, "/"))
	if err != nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" {
		log.Fatalf("upstream inválido: %q", *upstream)
	}

	proxy := &httputil.ReverseProxy{
		Director: func(r *http.Request) {
			r.URL.Scheme = target.Scheme
			r.URL.Host = target.Host
			r.Host = target.Host
			for name := range r.Header {
				if _, hop := hopHeaders[http.CanonicalHeaderKey(name)]; hop {
					r.Header.Del(name)
				}
			}
			// Path y query se conservan tal cual (/zen/go/v1/...).
		},
		ModifyResponse: func(resp *http.Response) error {
			corsHeaders(resp.Header)
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			log.Printf("upstream: %v", err)
			corsHeaders(w.Header())
			http.Error(w, "upstream unreachable", http.StatusBadGateway)
		},
		// Sin buffer intermedio: el stream (SSE) llega al cliente al instante.
		FlushInterval: -1,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		corsHeaders(w.Header())
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			corsHeaders(w.Header())
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			corsHeaders(w.Header())
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		proxy.ServeHTTP(w, r)
	})

	server := &http.Server{
		Addr:              *addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		// Sin WriteTimeout: los streams largos (SSE) no se cortan.
	}
	log.Printf("proxy %s -> %s", *addr, target.String())
	log.Fatal(server.ListenAndServe())
}
