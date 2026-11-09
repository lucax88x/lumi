package app

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"sort"
	"strings"
	"sync"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
	"lumi/internal/api"
)

const studyInstructions = `STUDIO DI ARGOMENTI: accompagna una bambina di prima–seconda primaria. Italiano semplice, pochi concetti, esempi concreti. Non analizzare le parole della richiesta come una frase scolastica. Non chiedere MAI quale formato vuole: scegli tu mappa mentale, disegno, schema o cartina.
CHIARISCI IL CONTENUTO: per argomenti ampi o classificazioni non specificate usa ask_study_focus con una sola domanda e 2–3 scelte pertinenti. Per «Egiziani» proponi per esempio «Il Nilo», «Le piramidi», «La vita quotidiana». Per «Cretesi» chiedi quale parte vuole scoprire, con esempi concreti. Per «tipi di angoli» chiedi quali sta studiando o un esempio, senza decidere tu una classificazione. Puoi proporre «Ti dico i nomi», «Un esempio del quaderno», «Una prima scoperta». L'app aggiunge «Non lo so» e permette di scrivere o parlare. Le scelte sono suggerimenti, non fatti o preferenze già espressi. Non chiedere foto o dati personali. La domanda è già mostrata e letta: non ripeterla nel testo.
Se il contesto basta, NON chiedere ancora. Se risponde «Il Nilo» alla domanda sugli Egiziani, parla del Nilo: non analizzare la frase e non chiedere di nuovo. Se dice «Non lo so», «Una prima scoperta» o chiede una panoramica, dai una piccola introduzione senza ripetere il chiarimento. Se la risposta è «Ti dico i nomi», aspetta i nomi con una breve domanda. «Spiegami l'angolo retto» è già preciso: mostra direttamente figura, spiegazione ed esempio. Segui una nuova domanda se cambia argomento.
VISUALI: per posizione o distribuzione geografica, «dove si trovano», cartine, planisferi e «una mappa dei continenti» usa show_learning_visual kind=map, NON show_topic_map. Se chiede esplicitamente una mappa mentale o concettuale, usa invece show_topic_map. «Intendevo una cartina» corregge il formato: riprendi l’argomento e i luoghi dalla cronologia e mostra la cartina senza chiederli di nuovo. Usa show_topic_map per organizzare concetti: normalmente 2–4 rami e 1–3 voci per ramo. Usa show_learning_visual per figure geometriche, sequenze, cicli, linee del tempo, paesaggi schematici o vere cartine. Scegli il formato utile automaticamente per una richiesta di studio chiara, anche se non chiede esplicitamente un disegno. Una definizione molto breve può essere solo testo. Una visuale principale per turno; un chiarimento esclude mappe e disegni nello stesso turno. Dopo una visuale basta una breve introduzione. Non scrivere JSON, Markdown o elenchi lunghi nel testo e non promettere visuali se il tool fallisce.
GEOMETRIA: figures contiene da 1 a 3 esempi. Per un angolo specifica degrees fra 0 e 360, senza width o height. App e disegno ricavano la classificazione dalla misura: nullo=0, acuto fra 0 e 90, retto=90, ottuso fra 90 e 180, piatto=180, concavo fra 180 e 360, giro=360. Non chiamare retto un angolo da 60°. Per line, ray, segment, triangle, square, rectangle, circle non usare degrees. width e height sono dimensioni del disegno; non inventare misure fisiche o unità. Il triangolo rappresentato è isoscele, con base width e altezza height; se chiedi equilateralità usa height=width*sqrt(3)/2. Il cerchio usa width come diametro. Le dimensioni non richieste possono essere null. Inserisci un esempio quotidiano nella spiegazione.
SCHEMI: da 2 a 6 nodi con id distinti, etichette brevi, spiegazioni di una o due frasi. sequence per passaggi ordinati; cycle per un ciclo, con un collegamento da ogni nodo al successivo e ritorno al primo; timeline per eventi in ordine cronologico con eventuale timeLabel; scene per parti di un paesaggio. edges collega solo id presenti. I simboli sono predefiniti; non inventare codice SVG, URL o coordinate. Mantieni pochi elementi, aggiungine altri nei turni successivi.
CARTINE REALI: usa prima find_map_features (massimo due ricerche per turno) con il nome del luogo, anche italiano; il catalogo restituisce id e contesto. Usa in show_learning_visual kind=map soltanto gli id realmente trovati, datasetVersion=ne-v2. Le cartine normali usano view=focus (o null). Per i continenti usa view=world: mostra sei continenti (Africa, America unita, Antartide, Asia, Europa, Oceania) con un’unica ricerca «continenti», «mondo» o «planisfero» e includi tutti i sei risultati. Se chiede esplicitamente sette continenti, cerca «sette continenti» e includi tutti i sette risultati con America del Nord e America del Sud separate. Spiega in poche parole dove si trova ogni continente. Questa panoramica è già precisa: non chiedere un chiarimento. Non inventare confini o coordinate. Se ci sono omonimi chiedi quale intende. Se manca un luogo o la cartina fallisce, dichiaralo brevemente e spiega a parole. Non presentare una mappa delle idee o uno schema a rami come una cartina riuscita. Sono cartine didattiche della geografia attuale, non confini di civiltà antiche. Per il Nilo evidenzia il fiume; per Creta evidenzia l'isola, non tutta la Grecia.
PROSEGUIRE: conserva il contenuto mostrato e il punto selezionato. «Più facile» e «Fammi un esempio» si riferiscono a quel punto, senza rigenerare la visuale. «Continua» passa al prossimo concetto: se il contesto indica un punto selezionato, riparti da quello. Ricrea una visuale solo quando serve aggiornarla o per un nuovo argomento. Non chiedere mai di scegliere un formato. Le foto restano solo su richiesta esplicita, separate dai disegni didattici.`

var studySpec = sync.OnceValues(api.GetSwagger)

// Build strict function schemas from the API source of truth, expanding references.
// Optional API properties become required nullable properties for model tools.
func studySchema(name string) map[string]any {
	spec, err := studySpec()
	if err != nil {
		panic(err)
	}
	var expand func(any) any
	expand = func(value any) any {
		m, ok := value.(map[string]any)
		if !ok {
			return value
		}
		if ref, ok := m["$ref"].(string); ok {
			schema := spec.Components.Schemas[strings.TrimPrefix(ref, "#/components/schemas/")].Value
			data, _ := json.Marshal(schema)
			var raw any
			_ = json.Unmarshal(data, &raw)
			return expand(raw)
		}
		delete(m, "discriminator")
		// OpenAPI 3.0 uses a boolean; function tools use JSON Schema's numeric form.
		if exclusive, ok := m["exclusiveMinimum"].(bool); ok {
			if exclusive {
				m["exclusiveMinimum"] = m["minimum"]
				delete(m, "minimum")
			} else {
				delete(m, "exclusiveMinimum")
			}
		}
		if one, ok := m["oneOf"]; ok {
			m["anyOf"] = one
			delete(m, "oneOf")
		}
		if props, ok := m["properties"].(map[string]any); ok {
			// Saved messages accept older versions; tools only create the current atlas.
			if version, ok := props["datasetVersion"].(map[string]any); ok {
				version["enum"] = []string{"ne-v2"}
			}
			required := map[string]bool{}
			for _, key := range m["required"].([]any) {
				required[key.(string)] = true
			}
			keys := []string{}
			for key, prop := range props {
				prop = expand(prop)
				if !required[key] {
					prop = map[string]any{"anyOf": []any{prop, map[string]any{"type": "null"}}}
				}
				props[key] = prop
				keys = append(keys, key)
			}
			// Stable ordering keeps tool schemas reproducible and cacheable.
			sort.Strings(keys)
			m["required"] = keys
		}
		if items, ok := m["items"]; ok {
			m["items"] = expand(items)
		}
		if variants, ok := m["anyOf"].([]any); ok {
			for i, variant := range variants {
				variants[i] = expand(variant)
			}
		}
		return m
	}
	data, _ := json.Marshal(spec.Components.Schemas[name].Value)
	var raw any
	_ = json.Unmarshal(data, &raw)
	return expand(raw).(map[string]any)
}

func studyTool(name, description string, schema map[string]any) responses.NamespaceToolToolUnionParam {
	return responses.NamespaceToolToolUnionParam{OfFunction: &responses.NamespaceToolToolFunctionParam{
		Name: name, Description: openai.String(description), Strict: openai.Bool(true), Parameters: schema,
	}}
}

// New tools expose cartography only in Geography and History after planning.
func studyTools(allowMaps bool) []responses.NamespaceToolToolUnionParam {
	visual := studySchema("LearningVisual")
	description := "Mostra un disegno geometrico preciso o uno schema semplice."
	if allowMaps {
		description += " Per posizione, continenti, cartine e planisferi usa kind=map; per i continenti usa view=world e tutti i sei (o sette se richiesti) luoghi trovati."
	} else {
		kept := []any{}
		for _, variant := range visual["anyOf"].([]any) {
			kind := variant.(map[string]any)["properties"].(map[string]any)["kind"].(map[string]any)["enum"].([]any)[0]
			if kind != "map" {
				kept = append(kept, variant)
			}
		}
		visual["anyOf"] = kept
	}
	return []responses.NamespaceToolToolUnionParam{
		studyTool("ask_study_focus", "Chiede quale parte dell'argomento vuole capire, con poche scelte pertinenti. Mai chiedere il formato della spiegazione.", studySchema("StudyClarification")),
		studyTool("show_learning_visual", description, map[string]any{"type": "object", "additionalProperties": false, "required": []string{"visual"}, "properties": map[string]any{"visual": visual}}),
	}
}

// Remove nullable optional tool fields before checking the API schema.
func cleanStudyNulls(value any, schema *openapi3.Schema) {
	if schema == nil {
		return
	}
	switch v := value.(type) {
	case map[string]any:
		if len(schema.OneOf) > 0 {
			for _, variant := range schema.OneOf {
				kind := variant.Value.Properties["kind"]
				if kind != nil && len(kind.Value.Enum) == 1 && kind.Value.Enum[0] == v["kind"] {
					cleanStudyNulls(v, variant.Value)
					return
				}
			}
		}
		required := map[string]bool{}
		for _, key := range schema.Required {
			required[key] = true
		}
		for key, prop := range schema.Properties {
			child, exists := v[key]
			if !exists {
				continue
			}
			if child == nil && !required[key] {
				delete(v, key)
			} else {
				cleanStudyNulls(child, prop.Value)
			}
		}
	case []any:
		if schema.Items != nil {
			for _, child := range v {
				cleanStudyNulls(child, schema.Items.Value)
			}
		}
	}
}
func decodeStudy(arguments, schemaName string, target any) error {
	if len(arguments) > 32768 {
		return errors.New("payload too large")
	}
	decoder := json.NewDecoder(strings.NewReader(arguments))
	var raw any
	if decoder.Decode(&raw) != nil || decoder.Decode(new(any)) != io.EOF {
		return errors.New("invalid JSON")
	}
	spec, err := studySpec()
	if err != nil {
		return err
	}
	cleanStudyNulls(raw, spec.Components.Schemas[schemaName].Value)
	if err = spec.Components.Schemas[schemaName].Value.VisitJSON(raw); err != nil {
		return err
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	decoder = json.NewDecoder(strings.NewReader(string(encoded)))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}
func executeStudyFocus(arguments string) (*api.StudyClarification, string) {
	var result api.StudyClarification
	if decodeStudy(arguments, "StudyClarification", &result) != nil || !shortText(result.Topic, 100) || !shortText(result.Question, 200) {
		return nil, "Il chiarimento non è valido. Chiedi quale argomento vuole capire con una sola domanda semplice."
	}
	seen := map[string]bool{}
	for _, choice := range result.Choices {
		key := wordKey(strings.TrimSpace(choice.Label))
		if !shortText(choice.Label, 60) || !shortText(choice.Reply, 180) || seen[key] || key == "non lo so" {
			return nil, "Usa due o tre scelte brevi e distinte. L'app aggiunge già Non lo so."
		}
		seen[key] = true
	}
	return &result, ""
}
func executeLearningVisual(arguments string, found map[string]bool) (*api.LearningVisual, string) {
	const invalid = "Il disegno non è valido e non è stato mostrato. Correggi i dati oppure spiega il concetto in parole semplici."
	var wrapper struct {
		Visual json.RawMessage `json:"visual"`
	}
	decoder := json.NewDecoder(strings.NewReader(arguments))
	decoder.DisallowUnknownFields()
	if len(arguments) > 32768 || decoder.Decode(&wrapper) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, invalid
	}
	var result api.LearningVisual
	if decodeStudy(string(wrapper.Visual), "LearningVisual", &result) != nil {
		return nil, invalid
	}
	var header struct {
		Kind    string `json:"kind"`
		Title   string `json:"title"`
		Summary string `json:"summary"`
	}
	_ = json.Unmarshal(wrapper.Visual, &header)
	if !shortText(header.Title, 100) || !shortText(header.Summary, 240) {
		return nil, invalid
	}
	switch header.Kind {
	case "geometry":
		v, err := result.AsGeometryVisual()
		if err != nil {
			return nil, invalid
		}
		for _, f := range v.Figures {
			if !shortText(f.Label, 60) || !shortText(f.Explanation, 240) {
				return nil, invalid
			}
			if f.Shape == api.Angle {
				if f.Degrees == nil || f.Width != nil || f.Height != nil {
					return nil, invalid
				}
				class := angleClass(float64(*f.Degrees))
				for _, name := range []string{"nullo", "acuto", "retto", "ottuso", "piatto", "concavo", "giro"} {
					if requestedExpression(name, f.Label) && name != class {
						return nil, "Il nome dell'angolo non corrisponde alla sua apertura. Correggi la misura o il nome."
					}
				}
			} else {
				if f.Degrees != nil {
					return nil, invalid
				}
				if (f.Shape == api.Square || f.Shape == api.Circle) && f.Width != nil && f.Height != nil && *f.Width != *f.Height {
					return nil, "Un quadrato o un cerchio non può avere larghezza e altezza diverse."
				}
				if f.Shape == api.Triangle && requestedExpression("equilatero", f.Label) {
					w, h := float64(110), math.Sqrt(3)*55
					if f.Width != nil {
						w = float64(*f.Width)
						h = w * math.Sqrt(3) / 2
					}
					if f.Height != nil {
						h = float64(*f.Height)
					}
					if math.Abs(h-w*math.Sqrt(3)/2) > 0.01 {
						return nil, "Le dimensioni non formano un triangolo equilatero."
					}
				}
			}
		}
	case "diagram":
		v, err := result.AsDiagramVisual()
		if err != nil {
			return nil, invalid
		}
		nodes := map[string]bool{}
		for _, node := range v.Nodes {
			if !shortText(node.Id, 30) || nodes[node.Id] || !shortText(node.Label, 60) || !shortText(node.Explanation, 240) {
				return nil, invalid
			}
			if node.TimeLabel != nil && !shortText(*node.TimeLabel, 40) {
				return nil, invalid
			}
			nodes[node.Id] = true
		}
		edges := map[string]bool{}
		for _, edge := range v.Edges {
			key := edge.From + "\x00" + edge.To
			if !nodes[edge.From] || !nodes[edge.To] || edge.From == edge.To || edges[key] {
				return nil, invalid
			}
			edges[key] = true
		}
		if v.Layout == api.Cycle {
			if len(v.Edges) != len(v.Nodes) {
				return nil, "Il ciclo deve collegare ogni fase alla successiva e tornare alla prima."
			}
			for i, node := range v.Nodes {
				if !edges[node.Id+"\x00"+v.Nodes[(i+1)%len(v.Nodes)].Id] {
					return nil, invalid
				}
			}
		}
	case "map":
		v, err := result.AsGeographyVisual()
		if err != nil {
			return nil, invalid
		}
		seen := map[string]bool{}
		for _, feature := range v.Features {
			if !found[feature.Id] || !mapFeatureExists(feature.Id) || seen[feature.Id] || !shortText(feature.Label, 60) || !shortText(feature.Explanation, 240) {
				return nil, "Scegli solo luoghi distinti trovati con find_map_features. Non inventare coordinate o confini."
			}
			seen[feature.Id] = true
		}
		// Upgrade legacy tool arguments too, without rewriting saved messages.
		v.DatasetVersion = api.NeV2
		if err := result.FromGeographyVisual(v); err != nil {
			return nil, invalid
		}
	default:
		return nil, invalid
	}
	return &result, ""
}
func angleClass(degrees float64) string {
	switch {
	case degrees == 0:
		return "nullo"
	case degrees < 90:
		return "acuto"
	case degrees == 90:
		return "retto"
	case degrees < 180:
		return "ottuso"
	case degrees == 180:
		return "piatto"
	case degrees < 360:
		return "concavo"
	default:
		return "giro"
	}
}
