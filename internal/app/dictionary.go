package app

import (
	"net/http"
	"time"

	"lumi/internal/api"
)

func (s *Store) Dictionary() ([]api.DictionaryEntry, error) {
	rows, err := s.db.Query(`SELECT id,word,meaning,example,first_asked_at,last_asked_at FROM dictionary_entries ORDER BY last_asked_at DESC,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	entries := []api.DictionaryEntry{}
	for rows.Next() {
		var entry api.DictionaryEntry
		var first, last string
		if err := rows.Scan(&entry.Id, &entry.Word, &entry.Meaning, &entry.Example, &first, &last); err != nil {
			return nil, err
		}
		entry.FirstAskedAt, _ = time.Parse(time.RFC3339Nano, first)
		entry.LastAskedAt, _ = time.Parse(time.RFC3339Nano, last)
		entries = append(entries, entry)
	}
	return entries, rows.Err()
}

func (s *Server) ListDictionaryWords(w http.ResponseWriter, r *http.Request) {
	entries, err := s.store.Dictionary()
	if err != nil {
		internalError(w, err)
		return
	}
	sendJSON(w, 200, entries)
}

func (s *Server) deleteDictionary(w http.ResponseWriter, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.active) > 0 {
		problem(w, 409, "busy", "Aspetta che Lumi finisca prima di eliminare le parole.")
		return
	}
	query, args := `DELETE FROM dictionary_entries`, []any{}
	if id != "" {
		query += ` WHERE id=?`
		args = append(args, id)
	}
	if _, err := s.store.db.Exec(query, args...); err != nil {
		internalError(w, err)
		return
	}
	w.WriteHeader(204)
}

func (p *portalAPI) ListDictionaryWords(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, false, func(s *Server) { s.ListDictionaryWords(w, r) })
}

func (p *portalAPI) DeleteDictionaryWord(w http.ResponseWriter, r *http.Request, familyId, entryId string) {
	p.withFamily(w, r, familyId, true, func(s *Server) { s.deleteDictionary(w, entryId) })
}

func (p *portalAPI) ClearDictionary(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, true, func(s *Server) { s.deleteDictionary(w, "") })
}
