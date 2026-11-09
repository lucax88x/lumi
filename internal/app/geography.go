package app

import (
	"embed"
	"encoding/json"
	"io"
	"sort"
	"strings"
	"sync"
	"unicode"

	"github.com/openai/openai-go/v3/responses"
	"golang.org/x/text/unicode/norm"
)

// This generated index corresponds to the versioned assets shipped in web/public.
//
//go:embed geographydata/catalog.json
var geographyData embed.FS

type mapSearchResult struct {
	Id      string   `json:"id"`
	Label   string   `json:"label"`
	Kind    string   `json:"kind"`
	Context string   `json:"context"`
	Aliases []string `json:"-"`
}

func (f *mapSearchResult) UnmarshalJSON(data []byte) error {
	type alias mapSearchResult
	var raw struct {
		*alias
		Aliases []string `json:"aliases"`
	}
	raw.alias = (*alias)(f)
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	f.Aliases = raw.Aliases
	return nil
}

var geographyCatalog = sync.OnceValue(func() []mapSearchResult {
	data, err := geographyData.ReadFile("geographydata/catalog.json")
	if err != nil {
		panic(err)
	}
	var features []mapSearchResult
	if err = json.Unmarshal(data, &features); err != nil {
		panic(err)
	}
	return features
})

func mapFeatureExists(id string) bool {
	for _, feature := range geographyCatalog() {
		if feature.Id == id {
			return true
		}
	}
	return false
}
func mapSearchTool() responses.NamespaceToolToolUnionParam {
	return studyTool("find_map_features", "Cerca luoghi reali nel catalogo: restituisce id, nome e contesto. Usa il nome del luogo, per esempio Nilo, Creta, Italia o Toscana. Con continenti, mondo o planisfero restituisce tutti i sei continenti in una chiamata; con sette continenti restituisce i sette. Sono cercabili anche America del Nord e America del Sud. Non inventare id.", map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"query"}, "properties": map[string]any{"query": map[string]any{"type": "string", "minLength": 1, "maxLength": 100}},
	})
}
func geographicKey(value string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(value)) {
		if unicode.IsMark(r) {
			continue
		}
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}
func findMapFeatures(arguments string) ([]mapSearchResult, string) {
	var input struct {
		Query string `json:"query"`
	}
	decoder := json.NewDecoder(strings.NewReader(arguments))
	decoder.DisallowUnknownFields()
	if len(arguments) > 2048 || decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF || !shortText(input.Query, 100) {
		return nil, "Scrivi il nome del luogo da cercare."
	}
	query := geographicKey(input.Query)
	for _, prefix := range []string{"il fiume ", "fiume ", "il lago ", "lago ", "l isola di ", "isola di ", "il ", "la ", "lo ", "l "} {
		query = strings.TrimPrefix(query, prefix)
	}
	if query == "" {
		return nil, "Scrivi il nome del luogo da cercare."
	}
	// A world overview must fit in one lookup (only two are allowed per turn).
	world := query == "continenti" || query == "mondo" || query == "planisfero" || query == "sei continenti" || query == "6 continenti"
	seven := query == "sette continenti" || query == "7 continenti"
	if world || seven {
		results := []mapSearchResult{}
		for _, f := range geographyCatalog() {
			if f.Kind != "continents" || (seven && f.Id == "continents-america") || (!seven && (f.Id == "continents-north-america" || f.Id == "continents-south-america")) {
				continue
			}
			results = append(results, f)
		}
		return results, ""
	}
	type match struct {
		feature mapSearchResult
		rank    int
	}
	matches := []match{}
	for _, f := range geographyCatalog() {
		rank := 3
		for _, alias := range f.Aliases {
			key := geographicKey(alias)
			if key == query {
				rank = 0
				break
			}
			if len([]rune(query)) >= 3 && strings.HasPrefix(key, query) && rank > 1 {
				rank = 1
			}
			if len([]rune(query)) >= 3 && strings.Contains(key, query) && rank > 2 {
				rank = 2
			}
		}
		if rank < 3 {
			matches = append(matches, match{f, rank})
		}
	}
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].rank != matches[j].rank {
			return matches[i].rank < matches[j].rank
		}
		return matches[i].feature.Id < matches[j].feature.Id
	})
	results := []mapSearchResult{}
	for _, m := range matches {
		if len(results) == 6 {
			break
		}
		results = append(results, m.feature)
	}
	return results, ""
}
