# Lumi

Una PWA per capire parole e frasi, pensata per prima e seconda elementare. Lumi è una lucciola: ascolta una domanda e accompagna la comprensione un pezzetto alla volta.

L’accesso è protetto da Keycloak. Un amministratore può creare gli account; con SMTP abilitato è disponibile anche la registrazione email/password. Google è opzionale. Un amministratore deve assegnare il ruolo `portal-access` prima di entrare. Il browser usa soltanto un cookie di sessione opaco: i token OIDC restano nel backend.

## Prova locale

Servono Docker con Compose e i tool definiti in `mise.toml`.

```sh
mise trust
just setup
just local-up
just dev
```

Apri **http://localhost:15173**. Go e Vite girano sul computer con `just dev`; Compose avvia solo i servizi di supporto. La configurazione privata viene generata in `.env.stack.local`, senza leggere `.env` e senza sovrascrivere file esistenti. I volumi `lumi-local_*` sono separati dalla produzione. Nessun dato precedente viene importato.

- `compose.yaml`: PostgreSQL, Keycloak e il job di configurazione `keycloak-init`, comuni ai due ambienti.
- `compose.local.yaml`: aggiunge Mailpit e il gateway locale di Keycloak su **http://localhost:15183/keycloak/**; disabilita la cache dei temi Keycloak.
- `compose.prod.yaml`: aggiunge il container Lumi e il suo volume dati, solo in produzione. Caddy gira sull’host VPS.

- Keycloak admin: **http://localhost:19090/keycloak/admin/**. Utente e password sono in `.env.stack.local`.
- Email di verifica e recupero password: **http://localhost:18025** (Mailpit).
- Registrati, verifica l’email in Mailpit e assegna `portal-access` al nuovo utente dal realm **lumi**, in **Users → Role mapping → Assign role**.
- Assegna anche `portal-admin` ai soli amministratori che devono gestire il collegamento condiviso. Rientra in Lumi e apri **Admin** per collegare ChatGPT una volta per tutte le famiglie.
- Per Google, configura le credenziali come descritto nella [guida operativa](docs/deployment.md). Senza credenziali il pulsante Google non appare.

```sh
just local-status
just local-logs -f
just local-down       # Ferma i container, conserva i volumi.
just test-auth        # Ferma prima just dev; i test avviano il proprio backend nativo.
```

I test di autenticazione richiedono i servizi di `just local-up`, compilano Lumi e avviano un backend nativo su **http://localhost:15173**, con dati separati in `data/auth-tests`. Rimuovono gli account di prova da Keycloak e conservano i dati delle famiglie nella directory di test. Non chiamano Google o OpenAI. Le credenziali di test non vengono aggiunte alla configurazione di produzione.

## Famiglie e permessi

Un account approvato può creare più famiglie e far parte di altre. La persona che crea una famiglia ne diventa il primo genitore. Ogni famiglia conserva separatamente conversazioni, istruzioni didattiche e preferenze vocali. Tutte le famiglie riutilizzano lo stesso collegamento ChatGPT, modello e chiave API del server.

I membri condividono le scoperte della propria famiglia. Solo i genitori possono modificare le preferenze didattiche e vocali, gestire la cronologia e invitare o rimuovere persone. Una persona può essere genitore in una famiglia e membro in un’altra. Non si può rimuovere o declassare l’ultimo genitore. Il ruolo Keycloak **`portal-admin`**, assegnato esplicitamente oltre a `portal-access`, abilita la sezione **Admin** (`/admin`): essere genitore non concede accesso alle connessioni condivise e gli amministratori non ottengono accesso alle conversazioni delle altre famiglie.

Gli inviti sono link copiabili, validi sette giorni e utilizzabili una sola volta dall’indirizzo email verificato indicato. Un invito non concede `portal-access`: l’approvazione resta all’amministratore Keycloak.

In produzione SMTP è opzionale e spento per impostazione predefinita: con `SMTP_ENABLED=false`, host e mittente possono restare vuoti e Keycloak disabilita registrazione autonoma e recupero password. Crea gli utenti nella console del realm **lumi**, imposta email verificata e password e assegna i ruoli richiesti. Per abilitare le email in seguito, imposta `SMTP_ENABLED=true`, configura i campi `SMTP_*` e riesegui il deploy. Lo sviluppo locale usa Mailpit con SMTP abilitato.

## Collegare il piano ChatGPT

1. Accedi con un account con `portal-access` e `portal-admin` e apri **Admin** dalla pagina famiglie o dalla navigazione.
2. Premi **Continue with ChatGPT**, poi **Apri il consenso ChatGPT**.
3. Autorizza l’utilizzo del tuo piano.
4. Il ritorno prova ad aprire `http://127.0.0.1:1455/auth/callback?...`. Copia l’URL completo dalla barra degli indirizzi, anche se la pagina non si apre.
5. Incollalo in **URL finale di ritorno** entro dieci minuti.
6. Scegli un modello disponibile e premi **Salva modello**. Il piano e il modello valgono per tutte le famiglie, comprese quelle create in seguito.

Il backend verifica PKCE, state, nonce, firma, audience e utilizzo singolo del ritorno. Il collegamento è distinto dal login Keycloak e appartiene all’installazione. Una sola istanza OAuth coordina i rinnovi per tutte le famiglie. **Scollega per tutti** interrompe anche le generazioni attive delle famiglie. Non copiare lo stesso grant tra installazioni: i refresh token ruotano.

Il grant condiviso è salvato privatamente in `DATA_DIR/chatgpt.json` e il modello in `DATA_DIR/lumi.db`. Un collegamento globale già presente viene conservato. Nell’aggiornamento dal precedente modello per famiglia, se esiste un solo grant collegato viene promosso con il suo modello; se ne esistono più di uno, un amministratore deve collegare l’account condiviso da **Admin**. I vecchi file delle famiglie vengono conservati ma non sono più usati: non avviare una vecchia versione in parallelo sullo stesso grant.

Le risposte usano il piano ChatGPT attraverso l’SDK OpenAI e l’API Responses, con `store:false`, streaming e cronologia locale. Non c’è un passaggio automatico alle API a pagamento. I limiti dipendono dal piano collegato.

I vocali usano invece `OPENAI_API_KEY` da `.env` in produzione (`.env.local` nello sviluppo nativo) e `gpt-transcribe`: la fatturazione API è separata. La chiave è comune all’installazione, non viene inserita o restituita dal browser; **Admin** ne mostra soltanto la presenza. Riavvia il backend dopo averla modificata. FFmpeg valida e normalizza le registrazioni; l’audio temporaneo viene eliminato dopo la trascrizione. I test ordinari non consumano il piano.

## Interfaccia e dati

- Le risposte arrivano in streaming. Il testo parziale resta salvato quando una risposta si interrompe; le generazioni non vengono ripetute automaticamente.
- Le mappe di frasi e argomenti vengono conservate insieme alla risposta. Le immagini vengono cercate su Wikipedia solo quando richieste, con attribuzioni Wikimedia.
- Per una singola parola, Lumi mostra significato ed esempio in due schede. Quando possibile usa un sinonimo facile come significato.
- **Il mio dizionario** conserva le nuove parole spiegate nella famiglia, con ricerca, ascolto e ripasso tramite schede. I risultati del ripasso valgono solo per la sessione corrente. Le parole restano anche dopo l’eliminazione delle chat; i genitori possono gestirle separatamente dal loro angolo.
- La lettura usa la voce italiana del dispositivo. La preferenza vocale resta sul dispositivo, non contiene dati di autenticazione.
- Chat e impostazioni rimangono nella famiglia fino alla loro eliminazione. Audio, testo e contesto necessari vengono inviati a OpenAI; evita dati personali nelle domande.
- Il service worker conserva soltanto asset generici. HTML autenticato, API e conversazioni non vengono memorizzati nella cache offline.

Prompt e valutazioni didattiche sono in `internal/app/prompt.txt` e [docs/pedagogy.md](docs/pedagogy.md).

## Sviluppo e verifiche

Stack: Go, SQLite, React, TypeScript, TanStack Query/Router e Vite. Usa le versioni di `mise.toml` e del lockfile pnpm.

```sh
just generate
just check
just test-e2e
just build
```

`api/openapi.json` è il contratto autorevole. Non modificare i file generati in `internal/api` e `web/src/api`.

Per lavorare con Go e Vite, avvia i servizi di supporto e poi l’applicazione:

```sh
just local-up
just dev
```

`just local-setup` aggiunge le impostazioni OIDC mancanti a `.env.local`, preservando quelle già presenti. Per una configurazione locale già personalizzata, assicurati che origine e client secret coincidano con il realm locale. Go usa `127.0.0.1:18080`; Vite serve **http://localhost:15173** e inoltra API e login a Go. Keycloak mantiene il proprio issuer su **http://localhost:15183/keycloak/realms/lumi**. Riavvia Go dopo le modifiche backend. Il microfono funziona sul loopback; per prove da altri dispositivi serve HTTPS.

I test live OpenAI restano opt-in tramite `LUMI_LIVE_TEST_DATA_DIR` e consumano il piano configurato.

## VPS

La [guida operativa](docs/deployment.md) descrive Docker Compose, Caddy sull’host per HTTPS e gateway Caddy in Compose per il routing interno, Google, SMTP, amministrazione tramite SSH e backup. I comandi `docker-prod-*` usano `.env`; quelli `local-*` usano `.env.stack.local`.

Il Caddy host inoltra `ciaolumi.fyi` al gateway su `127.0.0.1:18081`. Il container Lumi serve insieme React e API Go; le porte private `18080` (Lumi) e `19090` (Keycloak) restano disponibili. Configura il blocco host da `deploy/Caddyfile.example` e `PUBLIC_ORIGIN=https://ciaolumi.fyi` sul server prima del primo deploy.

Per le immagini private GHCR, `just deploy-setup` prepara l’ambiente di serviceman, `just deploy --check` verifica l’ultima pubblicazione riuscita su `main` e `just deploy` la attiva. `--run RUN_ID` seleziona un’altra pubblicazione e `--rollback RUN_ID-ATTEMPT` riattiva una release conservata. `just ssh` apre `lumi-server`. Repository pubblico, autenticazione GHCR sul VPS e configurazione iniziale sono descritti nella guida; questi comandi non caricano gli ambienti del computer sul server.

`just deploy --auto-update` esegue il deploy completo e abilita il fork `nicholas-fedor/watchtower`: ogni 5 minuti aggiorna solo l’app Lumi dal tag GHCR `main`. Tema Keycloak e configurazioni richiedono ancora un deploy completo. I deploy senza questa opzione e i rollback sospendono l’automazione. La [guida operativa](docs/deployment.md#aggiornamenti-automatici-dellapplicazione) descrive le credenziali dedicate, i controlli con `--check --auto-update` e i log. `just test-watchtower` esegue una prova Docker isolata.
