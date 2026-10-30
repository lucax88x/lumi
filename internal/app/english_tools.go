package app

import (
	"encoding/json"
	"io"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/openai/openai-go/v3/responses"
	"lumi/internal/api"
)

// Each call constructs a fresh schema. Italian retains its original tool contract.
func profileTool(tool responses.NamespaceToolToolUnionParam, subject api.Subject) responses.NamespaceToolToolUnionParam {
	if subject != api.English {
		return tool
	}
	fn := tool.OfFunction
	schema := fn.Parameters.(map[string]any)
	properties := schema["properties"].(map[string]any)
	add := func(schema map[string]any, name string, value any) {
		schema["properties"].(map[string]any)[name] = value
		schema["required"] = append(schema["required"].([]string), name)
	}
	text := func(max int) any { return map[string]any{"type": "string", "minLength": 1, "maxLength": max} }
	language := map[string]any{"type": "string", "enum": []string{"it", "en"}}
	switch fn.Name {
	case "show_word_explanation":
		fn.Description.Value = "Mostra una parola o breve espressione inglese, significato italiano, esempio inglese e traduzione italiana. sourceWord è il testo esatto richiesto dall'utente, anche italiano."
		add(schema, "sourceWord", text(80))
		add(schema, "sourceLanguage", language)
		add(schema, "exampleTranslation", text(240))
	case "show_sentence_map":
		add(schema, "language", language)
		add(schema, "translation", text(600))
		part := properties["parts"].(map[string]any)["items"].(map[string]any)
		add(part, "translation", text(240))
	case "show_topic_map":
		add(schema, "labelLanguage", map[string]any{"type": "string", "enum": []string{"en"}})
	}
	return tool
}

func shortText(text string, max int) bool {
	return strings.TrimSpace(text) != "" && utf8.RuneCountInString(text) <= max
}
func requestedExpression(expression, text string) bool {
	expression = wordKey(strings.Join(strings.Fields(expression), " "))
	text = wordKey(strings.Join(strings.Fields(text), " "))
	for start := 0; start < len(text); {
		at := strings.Index(text[start:], expression)
		if at < 0 {
			return false
		}
		at += start
		end := at + len(expression)
		before := at == 0
		after := end == len(text)
		if !before {
			r, _ := utf8.DecodeLastRuneInString(text[:at])
			before = !unicode.IsLetter(r) && !unicode.IsMark(r)
		}
		if !after {
			r, _ := utf8.DecodeRuneInString(text[end:])
			after = !unicode.IsLetter(r) && !unicode.IsMark(r)
		}
		if before && after {
			return true
		}
		start = at + 1
	}
	return false
}
func executeProfileWord(arguments string, history []api.Message, subject api.Subject) (*api.WordExplanation, string) {
	if subject != api.English {
		return executeWordExplanationTool(arguments, history)
	}
	var word api.WordExplanation
	decoder := json.NewDecoder(strings.NewReader(arguments))
	decoder.DisallowUnknownFields()
	if len(arguments) > 8192 || decoder.Decode(&word) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, "La scheda bilingue non è valida. Continua in italiano."
	}
	word.Word = strings.TrimSpace(word.Word)
	word.Meaning = strings.TrimSpace(word.Meaning)
	word.Example = strings.TrimSpace(word.Example)
	if !shortText(word.Word, 80) || !shortText(word.Meaning, 240) || !shortText(word.Example, 240) || word.SourceWord == nil || !shortText(*word.SourceWord, 80) || word.SourceLanguage == nil || (*word.SourceLanguage != "it" && *word.SourceLanguage != "en") || word.ExampleTranslation == nil || !shortText(*word.ExampleTranslation, 240) {
		return nil, "Servono espressione richiesta, lingua, parola inglese, significato italiano ed esempio con traduzione."
	}
	if *word.SourceLanguage == "en" && wordKey(word.Word) != wordKey(*word.SourceWord) {
		return nil, "Mantieni l'espressione inglese richiesta senza cambiarne la forma."
	}
	for _, m := range history {
		if m.Role == "user" && requestedExpression(*word.SourceWord, m.Text) {
			return &word, ""
		}
	}
	return nil, "L'espressione originale deve essere presente nella richiesta dell'utente."
}
func executeProfileSentenceMap(arguments string, history []api.Message, subject api.Subject) (*api.SentenceMap, string) {
	result, problem := executeSentenceMapTool(arguments, history)
	if result == nil || subject != api.English {
		return result, problem
	}
	if result.Language == nil || (*result.Language != "it" && *result.Language != "en") || result.Translation == nil || !shortText(*result.Translation, 600) {
		return nil, "Indica la lingua e la traduzione completa della frase."
	}
	for _, part := range result.Parts {
		if part.Translation == nil || !shortText(*part.Translation, 240) {
			return nil, "Ogni pezzo deve avere una traduzione."
		}
	}
	return result, ""
}
func executeProfileTopicMap(arguments string, subject api.Subject) (*api.TopicMap, string) {
	result, problem := executeTopicMapTool(arguments)
	if result == nil || subject != api.English {
		return result, problem
	}
	if result.LabelLanguage == nil || *result.LabelLanguage != "en" {
		return nil, "La mappa inglese deve indicare etichette inglesi e spiegazioni italiane."
	}
	return result, ""
}
