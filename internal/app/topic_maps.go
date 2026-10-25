package app

import (
	"encoding/json"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
	"lumi/internal/api"
)

const topicMapInstructions = `MAPPE DI ARGOMENTI: le richieste esplicite di mappe mentali, mappe concettuali o schemi visivi su un argomento scolastico si realizzano con lumi.show_topic_map. Devi chiamare questo strumento, non limitarti a promettere una mappa o a descriverla in un paragrafo. Sono supportati anche argomenti articolati, per esempio lo spazio, gli animali, il ciclo dell'acqua o un periodo storico. Queste richieste rientrano nell'aiuto alla comprensione scolastica, anche se non riguardano una singola parola o frase. Non scomporre le parole della richiesta: usa show_sentence_map soltanto per analizzare una frase, e show_topic_map per organizzare concetti. Se l'argomento è già chiaro dal contesto, crea la mappa senza chiedere di nuovo; altrimenti chiedi un solo chiarimento. Non creare mappe di argomenti spontaneamente per una definizione o un saluto.
La mappa ha un titolo centrale, da 2 a 6 rami e da 1 a 8 voci per ramo. Organizza i concetti per categorie coerenti, con etichette brevi e spiegazioni facili di una o due frasi. Se vengono richiesti tutti gli elementi di un insieme piccolo e definito, includili tutti: per esempio gli otto pianeti del Sistema solare. Puoi dividerli in gruppi se necessario. Non promettere di elencare tutti gli elementi di un argomento illimitato; crea una panoramica dei principali e chiariscine l'ambito nel titolo. Non omettere senza motivo gli esempi nominati dall'utente. Per «tutti i pianeti e i nomi stellari, tipo meteorite, asteroide» usa un titolo come «Il Sistema solare e i corpi celesti», con rami per i pianeti, le stelle e i piccoli corpi e fenomeni. Distingui stelle e pianeti; il Sole è una stella. Distingui meteoroide (piccolo corpo nello spazio), meteora (fenomeno luminoso nell'atmosfera) e meteorite (frammento arrivato al suolo). Evita categorie fuorvianti: un meteorite non è una stella e una meteora è un fenomeno luminoso, non un corpo celeste. Se raggruppi meteora e meteorite insieme ad asteroidi e comete, chiama il ramo «Piccoli corpi e fenomeni» e non descrivere tutte le voci come corpi che si muovono nello spazio. Non inventare fatti se non li conosci.
La UI apre un ramo e una spiegazione alla volta. Il limite di brevità della risposta parlata non impone di togliere voci dalla mappa: mantieni brevi le singole spiegazioni. Non scrivere JSON, elenchi lunghi, diagrammi o Markdown nel testo. Dopo il successo dello strumento, basta una breve introduzione e un invito a toccare un ramo. Non affermare che la mappa è visibile se il tool fallisce: spiega il problema in modo semplice. Nei turni successivi usa la mappa in cronologia e il punto selezionato per rispondere a «Più facile» e agli esempi senza ricrearla. Ricrea la mappa solo per una nuova richiesta esplicita o per aggiornarla. Puoi usare una sola mappa per turno; immagini soltanto su richiesta esplicita.`

func topicMapTool() responses.NamespaceToolToolUnionParam {
	text := func(max int) map[string]any {
		return map[string]any{"type": "string", "minLength": 1, "maxLength": max}
	}
	item := map[string]any{"type": "object", "additionalProperties": false, "required": []string{"label", "explanation"},
		"properties": map[string]any{"label": text(80), "explanation": text(240)}}
	branch := map[string]any{"type": "object", "additionalProperties": false, "required": []string{"label", "explanation", "items"},
		"properties": map[string]any{"label": text(80), "explanation": text(240), "items": map[string]any{"type": "array", "minItems": 1, "maxItems": 8, "items": item}}}
	return responses.NamespaceToolToolUnionParam{OfFunction: &responses.NamespaceToolToolFunctionParam{
		Name: "show_topic_map", Strict: openai.Bool(true),
		Description: openai.String("Crea e mostra una vera mappa mentale interattiva su un argomento richiesto: titolo centrale, categorie e concetti con spiegazioni. Usalo per richieste come una mappa dei pianeti e dei corpi celesti, degli animali o del ciclo dell'acqua."),
		Parameters: map[string]any{"type": "object", "additionalProperties": false, "required": []string{"title", "branches"},
			"properties": map[string]any{"title": text(100), "branches": map[string]any{"type": "array", "minItems": 2, "maxItems": 6, "items": branch}}},
	}}
}

func executeTopicMapTool(arguments string) (*api.TopicMap, string) {
	var result api.TopicMap
	decoder := json.NewDecoder(strings.NewReader(arguments))
	decoder.DisallowUnknownFields()
	if len(arguments) > 65536 || decoder.Decode(&result) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, "La mappa non è valida. Non è stata mostrata."
	}
	validText := func(text string, max int) bool {
		return strings.TrimSpace(text) != "" && utf8.RuneCountInString(text) <= max
	}
	if !validText(result.Title, 100) || len(result.Branches) < 2 || len(result.Branches) > 6 {
		return nil, "La mappa deve avere un titolo breve e da 2 a 6 rami."
	}
	seenBranches := map[string]bool{}
	for _, branch := range result.Branches {
		key := strings.ToLower(strings.Join(strings.Fields(branch.Label), " "))
		if !validText(branch.Label, 80) || !validText(branch.Explanation, 240) || len(branch.Items) < 1 || len(branch.Items) > 8 || seenBranches[key] {
			return nil, "Ogni ramo deve avere un nome distinto, una spiegazione breve e da 1 a 8 voci."
		}
		seenBranches[key] = true
		seenItems := map[string]bool{}
		for _, item := range branch.Items {
			key := strings.ToLower(strings.Join(strings.Fields(item.Label), " "))
			if !validText(item.Label, 80) || !validText(item.Explanation, 240) || seenItems[key] {
				return nil, "Ogni voce deve avere un nome distinto nel ramo e una spiegazione breve."
			}
			seenItems[key] = true
		}
	}
	return &result, ""
}
