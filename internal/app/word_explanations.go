package app

import (
	"encoding/json"
	"io"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/responses"
	"golang.org/x/text/unicode/norm"
	"lumi/internal/api"
)

const wordExplanationInstructions = `SCHEDE DELLA PAROLA: per spiegare UNA SOLA parola richiesta dall'utente devi usare lumi.show_word_explanation. Vale sia per una parola da sola («vigoroso») sia per domande come «Cosa significa vigoroso?», anche con una frase di contesto. Non usarlo per spiegare frasi intere, modi di dire composti da più parole, saluti, risposte come «sì», richieste di mappe o immagini, né per parole solo menzionate o inventate nei tuoi esempi. Se il significato è ambiguo e manca il contesto, chiedi prima un chiarimento: usa lo strumento quando puoi spiegare il senso giusto.
La scheda contiene la parola esatta richiesta, un significato e un esempio. Come significato scegli un sinonimo più semplice e familiare, se mantiene il senso nel contesto: per esempio vigoroso → forte. Basta il sinonimo, senza una definizione aggiuntiva. Se non c'è un sinonimo facile e preciso, usa una spiegazione molto breve in italiano semplice. L'esempio è una frase quotidiana e concreta che usa la parola nel senso spiegato. Non cambiare la forma della parola richiesta con un lemma diverso. Non inserire Markdown, etichette o l'esempio dentro il significato.
L'app mostra automaticamente significato ed esempio in due schede separate e li legge ad alta voce. Non ripeterli nel testo normale e non scrivere JSON: dopo il successo dello strumento puoi terminare senza altro testo. La scheda viene salvata nel dizionario solo se il turno si completa: non promettere il salvataggio in anticipo. Nei turni successivi usa la scheda nella cronologia; per «Più facile» o «Fammi un esempio» sulla parola corrente crea una scheda aggiornata completa di significato ed esempio. Una spiegazione di parola e una mappa sono alternative nello stesso turno; le immagini restano indipendenti e solo su richiesta. In caso di errore dello strumento continua con una spiegazione a parole.`

func wordExplanationTool() responses.NamespaceToolToolUnionParam {
	text := func(max int) map[string]any {
		return map[string]any{"type": "string", "minLength": 1, "maxLength": max}
	}
	return responses.NamespaceToolToolUnionParam{OfFunction: &responses.NamespaceToolToolFunctionParam{
		Name: "show_word_explanation", Strict: openai.Bool(true),
		Description: openai.String("Mostra il significato e un esempio in due schede per una sola parola richiesta dall'utente. Preferisci un sinonimo facile come significato."),
		Parameters: map[string]any{
			"type": "object", "additionalProperties": false, "required": []string{"word", "meaning", "example"},
			"properties": map[string]any{"word": text(80), "meaning": text(240), "example": text(240)},
		},
	}}
}

var lexicalWord = regexp.MustCompile(`\p{L}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*`)

func wordKey(word string) string {
	return strings.ToLower(norm.NFC.String(strings.ReplaceAll(strings.TrimSpace(word), "’", "'")))
}

func executeWordExplanationTool(arguments string, history []api.Message) (*api.WordExplanation, string) {
	var result api.WordExplanation
	decoder := json.NewDecoder(strings.NewReader(arguments))
	decoder.DisallowUnknownFields()
	if len(arguments) > 8192 || decoder.Decode(&result) != nil || decoder.Decode(new(any)) != io.EOF {
		return nil, "La scheda non è valida. Continua con una spiegazione a parole."
	}
	result.Word = norm.NFC.String(strings.TrimSpace(result.Word))
	result.Meaning = strings.TrimSpace(result.Meaning)
	result.Example = strings.TrimSpace(result.Example)
	if result.Word == "" || lexicalWord.FindString(result.Word) != result.Word || utf8.RuneCountInString(result.Word) > 80 ||
		result.Meaning == "" || utf8.RuneCountInString(result.Meaning) > 240 || result.Example == "" || utf8.RuneCountInString(result.Example) > 240 {
		return nil, "Usa una sola parola, un significato breve e un esempio breve."
	}
	for _, m := range history {
		if m.Role != "user" {
			continue
		}
		for _, word := range lexicalWord.FindAllString(norm.NFC.String(m.Text), -1) {
			key := wordKey(word)
			if key == wordKey(result.Word) {
				return &result, ""
			}
			// Italian questions often attach an elided article to the requested
			// noun: «Che cos'è l'arcobaleno?» still asks about «arcobaleno».
			prefix, noun, elided := strings.Cut(key, "'")
			if elided && noun == wordKey(result.Word) {
				switch prefix {
				case "l", "un", "dell", "all", "nell", "sull", "dall", "coll":
					return &result, ""
				}
			}
		}
	}
	return nil, "La parola deve essere presente in una richiesta dell'utente, non nei tuoi esempi."
}
