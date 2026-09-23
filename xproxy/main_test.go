package main

import (
	"encoding/json"
	"testing"
)

// Regresión: la app manda `count` como número JSON y el decode fallaba con 400.
func TestFlexibleCountAceptaNumeroYString(t *testing.T) {
	cases := []struct {
		body string
		want int
	}{
		{`{"count":3}`, 3},
		{`{"count":"5"}`, 5},
		{`{"count":null}`, 0},
		{`{}`, 0},
	}
	for _, tc := range cases {
		var payload struct {
			Count flexibleCount `json:"count"`
		}
		if err := json.Unmarshal([]byte(tc.body), &payload); err != nil {
			t.Fatalf("%s: decode inesperado: %v", tc.body, err)
		}
		if int(payload.Count) != tc.want {
			t.Fatalf("%s: got %d, want %d", tc.body, int(payload.Count), tc.want)
		}
	}
}

func TestFlexibleCountRechazaBasura(t *testing.T) {
	var payload struct {
		Count flexibleCount `json:"count"`
	}
	if err := json.Unmarshal([]byte(`{"count":"abc"}`), &payload); err == nil {
		t.Fatal("esperaba error de decode para count no numérico")
	}
}
