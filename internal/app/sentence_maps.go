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

const sentenceMapInstructions = `MAPPA DELLA FRASE: quando aiuti a capire o scomporre una frase fornita dall'utente, usa lumi.show_sentence_map per mostrarne una mappa visiva. Fallo anche su richiesta di una mappa della frase già presente nella conversazione. Non usarlo per una singola parola, un saluto, una semplice domanda o un esempio inventato da te. Se non è chiaro quale frase analizzare, chiedila. Copia la frase esattamente, senza aggiungere punteggiatura. Dividila in 2–6 gruppi brevi di parole, contigui e nell'ordine originale: unendo i pezzi con uno spazio si deve ricostruire la frase intera. Mantieni articoli e preposizioni con le parole a cui appartengono, e i modi di dire insieme. Non inventare soggetti sottintesi e non forzare etichette grammaticali. Per ogni pezzo scegli una domanda semplice adatta al significato, per esempio «Chi?», «Che cosa fa?», «Dove?», «Quando?» o «Che cosa succede?», e una spiegazione molto breve in italiano facile. La UI mostra tutti i pezzi ma apre una sola spiegazione alla volta. Nel testo parlato dai solo il senso generale e accompagna il primo pezzo: non ripetere tutte le spiegazioni della mappa e non scrivere JSON, diagrammi o Markdown. Nei turni successivi usa la mappa già presente nella cronologia: non ricrearla per «Più facile», «Fammi un esempio», «Continua» o una richiesta di immagini. Una nuova frase o una richiesta esplicita di cambiare la mappa può avere una nuova mappa. Se la frase supera 600 caratteri o non sta in 6 pezzi comprensibili, chiedi di lavorare su una frase più breve senza tagliarla di nascosto. Conferma la mappa soltanto dopo che lo strumento ha avuto successo; in caso di errore continua ad aiutare con il testo. La mappa è indipendente dalle immagini: usa show_images soltanto se richiesto. Ogni strumento è disponibile una volta per turno.`

func sentenceMapTool() responses.NamespaceToolToolUnionParam {
	text := func(max int) map[string]any {
		return map[string]any{"type": "string", "minLength": 1, "maxLength": max}
	}
	return responses.NamespaceToolToolUnionParam{OfFunction: &responses.NamespaceToolToolFunctionParam{
		Name: "show_sentence_map", Strict: openai.Bool(true),
		Description: openai.String("Mostra una mappa interattiva della frase dell'utente, divisa in piccoli gruppi di parole nell'ordine originale. Ogni pezzo ha una domanda guida e una spiegazione breve."),
		Parameters: map[string]any{
			"type": "object", "additionalProperties": false, "required": []string{"sentence", "parts"},
			"properties": map[string]any{
				"sentence": text(600),
				"parts": map[string]any{"type": "array", "minItems": 2, "maxItems": 6, "items": map[string]any{
					"type": "object", "additionalProperties": false, "required": []string{"text", "question", "explanation"},
					"properties": map[string]any{"text": text(200), "question": text(60), "explanation": text(240)},
				}},
			},
		},
	}}
}

func executeSentenceMapTool(arguments string, history []api.Message) (*api.SentenceMap, string) {
	var result api.SentenceMap
	decoder := json.NewDecoder(strings.NewReader(arguments))
	decoder.DisallowUnknownFields()
	if len(arguments) > 16384 || decoder.Decode(&result) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, "La mappa non è valida. Continua con una spiegazione a parole."
	}
	validText := func(text string, max int) bool {
		return strings.TrimSpace(text) != "" && utf8.RuneCountInString(text) <= max
	}
	if !validText(result.Sentence, 600) || len(result.Parts) < 2 || len(result.Parts) > 6 {
		return nil, "Usa una frase breve e da 2 a 6 pezzi."
	}
	normalize := func(text string) string { return strings.Join(strings.Fields(text), " ") }
	parts := make([]string, 0, len(result.Parts))
	for _, part := range result.Parts {
		if !validText(part.Text, 200) || !validText(part.Question, 60) || !validText(part.Explanation, 240) {
			return nil, "Ogni pezzo deve avere parole, una domanda e una breve spiegazione."
		}
		parts = append(parts, part.Text)
	}
	if normalize(strings.Join(parts, " ")) != normalize(result.Sentence) {
		return nil, "I pezzi devono ricostruire tutta la frase originale, senza cambiare o saltare parole."
	}
	for _, message := range history {
		if message.Role == "user" && strings.Contains(normalize(message.Text), normalize(result.Sentence)) {
			return &result, ""
		}
	}
	return nil, "La frase deve essere copiata da un messaggio dell'utente."
}
