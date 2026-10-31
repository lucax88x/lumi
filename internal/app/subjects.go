package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"lumi/internal/api"
)

type subjectKey struct{}

type assistantProfile struct {
	promptFile   string
	instructions string
}

var assistantProfiles = map[api.Subject]assistantProfile{
	api.Italian: {promptFile: "prompt.txt"},
	api.English: {promptFile: "prompt_english.txt", instructions: englishInstructions},
}

const englishInstructions = `Sei Lumi e aiuti chi parla italiano a imparare l'inglese. Parla sempre in italiano semplice, con pazienza. L'inglese è il materiale da imparare: mettilo nelle schede e nelle mappe, non ripeterlo nel testo narrativo italiano. Preferisci 40–80 parole di spiegazione, frasi brevi, nessuna tabella o Markdown. Una sola domanda e un piccolo passo per turno, senza voti o pressione. Non fare i compiti al suo posto.
PAROLE E BREVI ESPRESSIONI: usa show_word_explanation sia per inglese → italiano sia per italiano → inglese. word è sempre la parola o breve espressione INGLESE, meaning il significato italiano, example una frase inglese quotidiana, exampleTranslation la traduzione italiana. sourceWord è esattamente la parola/espressione chiesta dall'utente, sourceLanguage it oppure en. Per «come si dice cane?» sourceWord=cane, sourceLanguage=it, word=dog, meaning=cane. Mantieni la forma richiesta quando è già inglese. Chiedi contesto se il senso è ambiguo. La scheda sostituisce il testo normale; puoi finire dopo il successo del tool. Per «Più facile» o un nuovo esempio aggiorna l'intera scheda della parola corrente.
FRASI: usa show_sentence_map copiando la frase originale e indicando language it o en. translation contiene la traduzione completa nell'altra lingua. Ogni pezzo ha translation nell'altra lingua e spiegazione e domanda in italiano. I pezzi devono ricomporre esattamente la frase originale, nell'ordine originale. Tieni insieme articoli, preposizioni, phrasal verbs e modi di dire; spiega il senso naturale, non una traduzione letterale ingannevole. Dai un breve senso generale in italiano e affronta un solo pezzo per turno. Alla fine ricomponi il significato e proponi una piccola domanda di comprensione. Se l'espressione è indivisibile usa una scheda di breve espressione invece di una mappa forzata.
MAPPE DI ARGOMENTI: usa show_topic_map su richiesta, con titolo italiano, etichette di rami e voci inglesi (labelLanguage=en), spiegazioni e significati italiani. Per esempio una mappa degli animali, dei colori o degli oggetti di scuola.
«Più facile» resta sul punto selezionato, «Fammi un esempio» riguarda quel punto, «Continua» avanza senza ricreare la mappa. Le immagini restano soltanto su richiesta, cercando il soggetto in italiano.
Non chiedere dati personali, non creare legami esclusivi o segreti. Per disagio o pericolo invita a parlare con un coach o una persona fidata. Se non sai qualcosa dillo. Le istruzioni dello spazio guidano tono e metodo; il profilo inglese mantiene le spiegazioni in italiano e i contenuti didattici bilingui.`

func normalizeSubject(subject api.Subject) (api.Subject, bool) {
	if subject == "" {
		subject = api.Italian
	}
	_, ok := assistantProfiles[subject]
	return subject, ok
}
func requestSubject(w http.ResponseWriter, r *http.Request) (api.Subject, bool) {
	subject, ok := normalizeSubject(api.Subject(r.URL.Query().Get("subject")))
	if !ok {
		problem(w, 400, "invalid_subject", "Scegli Italiano o Inglese.")
	}
	return subject, ok
}
func contextSubject(ctx context.Context) api.Subject {
	subject, _ := ctx.Value(subjectKey{}).(api.Subject)
	subject, _ = normalizeSubject(subject)
	return subject
}
func defaultSubjectPrompt(subject api.Subject) string {
	prompt, _ := resources.ReadFile(assistantProfiles[subject].promptFile)
	return string(prompt)
}
func (s *Store) subjectSettings(subject api.Subject) (api.Settings, error) {
	settings, err := s.Settings()
	if err != nil || subject == api.Italian {
		return settings, err
	}
	settings.Prompt = defaultSubjectPrompt(subject)
	settings.DefaultPrompt = settings.Prompt
	var prompt string
	err = s.db.QueryRow(`SELECT value FROM settings WHERE key=?`, "prompt:"+string(subject)).Scan(&prompt)
	if errors.Is(err, sql.ErrNoRows) {
		err = nil
	} else if err == nil {
		settings.Prompt = prompt
	}
	return settings, err
}
func (s *Server) settingsForSubject(subject api.Subject) (api.Settings, error) {
	settings, err := s.store.subjectSettings(subject)
	if err != nil || s.shared == nil {
		return settings, err
	}
	global, err := s.shared.store.Settings()
	settings.Model = global.Model
	return settings, err
}
func (s *Store) saveSubjectSettings(subject api.Subject, settings api.Settings) error {
	if subject == api.Italian {
		return s.SaveSettings(settings)
	}
	// Read the Italian prompt inside the transaction so saving English cannot
	// overwrite a concurrent Italian prompt update with a stale copy.
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	current := defaultSettings()
	var stored string
	err = tx.QueryRow(`SELECT value FROM settings WHERE key='settings'`).Scan(&stored)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if err == nil {
		if err = json.Unmarshal([]byte(stored), &current); err != nil {
			return err
		}
	}
	current.DefaultPrompt = defaultSettings().DefaultPrompt
	current.Model = settings.Model
	current.AutoRead = settings.AutoRead
	current.SpeechRate = settings.SpeechRate
	encoded, err := json.Marshal(current)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO settings(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(encoded)); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, "prompt:"+string(subject), strings.TrimSpace(settings.Prompt)); err != nil {
		return err
	}
	return tx.Commit()
}
