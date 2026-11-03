package app

import (
	"encoding/json"
	"io"
	"strings"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
	"lumi/internal/api"
)

const wordClarificationInstructions = `CONTESTO DELLA PAROLA: prima di spiegare o tradurre una parola, considera il contesto già fornito nella conversazione. Solo se restano più significati plausibili, usa lumi.ask_word_context invece di indovinare il senso o mostrare una scheda definitiva. Chiedi una sola cosa in italiano semplice, per esempio «Mi scrivi o mi dici la frase in cui hai trovato “formato”?». word è la parola o espressione ORIGINALE chiesta dall'utente, language la sua lingua (it o en), examples inizialmente è vuoto. La domanda viene mostrata e letta dall'app: non ripeterla nel testo normale; dopo il successo del tool puoi terminare senza altro testo.
L'app offre «Non ho una frase». Se l'utente lo sceglie o dice di non avere contesto, usa ask_word_context con due o tre esempi quotidiani che distinguono sensi diversi della stessa parola; sentence è nella lingua della parola, meaning spiega quel senso in italiano semplice. Chiedi quale esempio si avvicina al senso cercato. Gli esempi sono ipotesi, non frasi dell'utente. Si può scegliere con un tocco, scrivere o parlare liberamente. Se nessun esempio aiuta e manca ancora il contesto, spiega brevemente le alternative senza insistere, senza scegliere un significato e senza creare una scheda definitiva.
Quando arriva una frase in risposta al chiarimento, oppure la scelta di un esempio, spiega LA PAROLA ORIGINALE in quel contesto usando show_word_explanation: la frase serve a disambiguare e non è una richiesta di mappa o analisi dell'intera frase. Non spiegare un'altra parola presente nell'esempio. Nell'inglese mantieni sourceWord e sourceLanguage originali, traducendo quel senso. Se il contesto è ancora insufficiente puoi chiedere un ulteriore piccolo chiarimento, senza ripetere meccanicamente la stessa domanda. Se arriva una nuova domanda distinta, seguila senza restare bloccato sul chiarimento precedente. Non chiedere una frase per ogni parola: se il senso richiesto è già chiaro rispondi direttamente. Il chiarimento e la spiegazione definitiva o una mappa sono alternative nello stesso turno.`

func wordClarificationTool() responses.NamespaceToolToolUnionParam {
	text := func(max int) map[string]any {
		return map[string]any{"type": "string", "minLength": 1, "maxLength": max}
	}
	return responses.NamespaceToolToolUnionParam{OfFunction: &responses.NamespaceToolToolFunctionParam{
		Name: "ask_word_context", Strict: openai.Bool(true),
		Description: openai.String("Chiede una frase per capire una parola ambigua prima di spiegarla. Se manca una frase, propone due o tre esempi con significati diversi tra cui scegliere."),
		Parameters: map[string]any{
			"type": "object", "additionalProperties": false,
			"required": []string{"word", "question", "language", "examples"},
			"properties": map[string]any{
				"word": text(80), "question": text(240),
				"language": map[string]any{"type": "string", "enum": []string{"it", "en"}},
				"examples": map[string]any{"type": "array", "maxItems": 3, "items": map[string]any{
					"type": "object", "additionalProperties": false, "required": []string{"sentence", "meaning"},
					"properties": map[string]any{"sentence": text(240), "meaning": text(240)},
				}},
			},
		},
	}}
}

func executeWordClarificationTool(arguments string, history []api.Message) (*api.WordClarification, string) {
	const invalid = "Il chiarimento non è valido. Chiedi una frase in italiano semplice senza scegliere un significato."
	var result api.WordClarification
	decoder := json.NewDecoder(strings.NewReader(arguments))
	decoder.DisallowUnknownFields()
	if len(arguments) > 8192 || decoder.Decode(&result) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, invalid
	}
	result.Word = strings.TrimSpace(result.Word)
	result.Question = strings.TrimSpace(result.Question)
	if !shortText(result.Word, 80) || !shortText(result.Question, 240) ||
		(result.Language != "it" && result.Language != "en") || result.Examples == nil || len(result.Examples) == 1 || len(result.Examples) > 3 {
		return nil, invalid
	}
	seen := map[string]bool{}
	for i := range result.Examples {
		example := &result.Examples[i]
		example.Sentence = strings.TrimSpace(example.Sentence)
		example.Meaning = strings.TrimSpace(example.Meaning)
		key := wordKey(example.Sentence)
		if !shortText(example.Sentence, 240) || !shortText(example.Meaning, 240) ||
			!requestedExpression(result.Word, example.Sentence) || seen[key] {
			return nil, invalid
		}
		seen[key] = true
	}
	for _, m := range history {
		if m.Role == "user" && requestedExpression(result.Word, m.Text) {
			return &result, ""
		}
	}
	return nil, "Chiedi contesto solo per una parola o espressione richiesta dall'utente."
}
