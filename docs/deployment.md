# Lumi: immagini private GHCR e deploy SSH

GitHub Actions pubblica immagini `linux/amd64` private in `ghcr.io/lucax88x/lumi`; il VPS scarica un digest preciso e usa Compose senza compilare. Questi file preparano il flusso: non creano il repository GitHub, non pubblicano immagini e non attivano servizi sul VPS. Non è prevista l’importazione automatica di installazioni precedenti.

## Servizi e porte

Caddy gira come servizio sull’host e termina HTTPS. Compose esegue Lumi, Keycloak e PostgreSQL. Lumi ascolta su `127.0.0.1:18080`, Keycloak su `127.0.0.1:19090`; PostgreSQL non pubblica porte. Il firewall pubblico deve consentire soltanto SSH e le porte HTTP/HTTPS di Caddy.

`compose.yaml` definisce PostgreSQL, Keycloak e il job `keycloak-init`. `compose.prod.yaml` aggiunge Lumi con `LUMI_IMAGE` obbligatoria e senza `build`. Ogni immagine contiene questi file, `.env.example`, inizializzazione e tema Keycloak in `/opt/lumi-deploy/`. Il deploy li estrae da un container temporaneo mai avviato: applicazione e configurazione provengono dallo stesso digest. Per compilare sul computer, `just docker-prod-build` e `just docker-prod-up` aggiungono `compose.build.yaml`. Lo sviluppo con `just local-up` e `just dev` continua a usare `compose.local.yaml`, Mailpit e il gateway locale.

L’URL pubblico è configurato da `PUBLIC_ORIGIN`, per esempio `https://lumi.example.com`, senza slash finale. Keycloak usa `/keycloak` sulla stessa origine. Il backend raggiunge discovery, token e chiavi attraverso la rete Docker privata, mantenendo la verifica dell’issuer pubblico.

Caddy pubblica soltanto `/keycloak/realms/lumi/*` e `/keycloak/resources/*`. Non pubblicare `/keycloak/admin`, `/keycloak/realms/master`, la radice Keycloak o le porte di management. Anche `/healthz` resta privato.

## Repository GitHub e immagini private

1. Il codice viene pubblicato nel repository **pubblico** `lucax88x/lumi`, con ramo principale `main`; le immagini GHCR restano **private**. Controlla prima di ogni push che nessun `.env`, database o directory `data/` sia incluso. Abilita Actions e la possibilità di pubblicare pacchetti.
2. Il workflow `Publish` (`.github/workflows/publish.yml`) viene eseguito a ogni push su `main` o manualmente da **Actions → Publish → Run workflow → main**. Prima di pubblicare richiama `Check`: codice generato, analisi Go, tipi TypeScript, test backend/frontend, test degli script e regressioni browser desktop/Android. Gli altri rami e le pull request eseguono soltanto i controlli. Una pubblicazione manuale su altri rami non pubblica immagini.
3. Soltanto il job di pubblicazione ha `packages: write` e usa `GITHUB_TOKEN`. Il tag è `run-RUN_ID-RUN_ATTEMPT`, con label OCI per repository e commit. L’artifact `lumi-release-RUN_ID-RUN_ATTEMPT` contiene `release.json` con digest, commit e identificativo del run. Non si usa un tag mobile per attivare servizi.
4. Dopo la prima pubblicazione verifica che il pacchetto GHCR sia **Private**, collegato a `lucax88x/lumi` e accessibile dall’account che eseguirà il pull sul VPS. Non renderlo pubblico. Conserva gli artifact per scegliere run espliciti (retention configurata: 90 giorni); le release già estratte restano disponibili per rollback anche dopo la scadenza dell’artifact.

GitHub raccomanda `GITHUB_TOKEN` per pubblicare dal workflow e un PAT classic con `read:packages` per scaricare pacchetti privati dal server: [autenticazione GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-to-the-container-registry).

## Prima configurazione del VPS

Il computer deve avere Python 3, `just`, OpenSSH, l’alias SSH **`lumi-server`** e GitHub CLI autenticata sull’account personale `lucax88x` con accesso in lettura al repository e agli artifact Actions. Il client legge il token di quell’account con `gh auth token --hostname github.com --user lucax88x` per i soli sottoprocessi necessari: non cambia l’account globale e ignora eventuali token di lavoro ereditati dall’ambiente.

Docker è già installato sul VPS. Il flusso richiede anche Compose, Bash, Python 3, curl, flock e systemd: setup ne verifica la disponibilità senza installare pacchetti. Tutte le operazioni del deploy passano da una sessione SSH con terminale e da `machinectl shell serviceman@.host /bin/bash`; completa l’autenticazione Polkit esistente quando richiesta. `just ssh` esegue esattamente `ssh lumi-server`.

```sh
just deploy-setup
just ssh
# Nella sessione SSH:
machinectl shell serviceman@.host /bin/bash
# Ora dentro la shell serviceman:
cd "$HOME/lumi"
editor config/.env
docker login ghcr.io --username lucax88x
```

Al prompt password di Docker inserisci un PAT classic con il solo scope **`read:packages`**, appartenente a un account autorizzato al pacchetto privato. Non metterlo nella riga di comando o in chat. Usa il credential helper già disponibile, se configurato; le credenziali devono appartenere all’ambiente Docker di serviceman. Non copiare `.env` o `.env.local` dal computer.

`deploy-setup` risolve `$HOME/lumi` **dentro serviceman**, crea directory `0700` e `config/.env` `0600` soltanto se assente. Non sovrascrive configurazioni. Verifica il contesto Docker effettivo, un socket Unix locale, architettura amd64, Compose con `--wait` e persistenza del daemon. Può avviare un servizio Docker utente già installato se il socket standard rootless è inattivo. Non installa pacchetti, non abilita servizi, non cambia sudo, gruppi Docker o autorizzazioni machinectl e non modifica il daemon di sistema.

Per Docker rootless il servizio utente deve essere già abilitato e `Linger=yes`; altrimenti il controllo fallisce con un messaggio da risolvere nell’amministrazione esistente. Per un daemon di sistema già accessibile a serviceman verifica che sia attivo e abilitato, senza modificarlo. Lo stato letto dall’account SSH ordinario non sostituisce queste verifiche. [Docker documenta servizio utente e lingering](https://docs.docker.com/engine/security/rootless/tips/).

Compila `config/.env` sul server: origine HTTPS reale senza slash finale, porte loopback coerenti con Caddy e tre segreti distinti per amministratore, database e client OIDC. Per generare ciascun segreto puoi usare `openssl rand -hex 32`. SMTP è spento per impostazione predefinita (`SMTP_ENABLED=false`); puoi lasciare vuoti `SMTP_HOST`, `SMTP_FROM` e le credenziali email. `OPENAI_API_KEY` e Google restano opzionali secondo l’uso previsto.

Senza SMTP, `keycloak-init` disabilita registrazione autonoma e recupero password e rimuove la configurazione email del realm, anche se già esistente. La verifica dell’identità resta richiesta: crea gli utenti dalla console Keycloak del realm **lumi**, imposta email e **Email verified**, configura la password in **Credentials** e assegna `portal-access` (anche `portal-admin` per gli amministratori Lumi). L’account bootstrap del realm master serve a gestire Keycloak e non è un account dell’applicazione. Gli utenti già verificati possono continuare ad accedere.

Quando serviranno le email, imposta `SMTP_ENABLED=true` e compila host, porta, mittente, autenticazione e STARTTLS/SSL nel file sul server, poi riesegui il deploy. Con SMTP abilitato, host e mittente sono obbligatori; `keycloak-init` aggiorna il realm e riabilita registrazione autonoma e recupero password. In sviluppo locale SMTP rimane abilitato tramite Mailpit.

La configurazione **Caddy esistente resta invariata**. Prima del primo deploy verifica che il dominio e gli upstream corrispondano alle porte in `config/.env` e alle regole descritte sopra. `deploy/Caddyfile.example` è un riferimento per la revisione manuale; nessun comando di questo flusso ricarica o sovrascrive Caddy. Il proxy deve inoltrare immediatamente SSE.

La struttura risultante è:

```text
$HOME/lumi/                 # HOME di serviceman
  config/.env               # produzione, mai dentro una release
  releases/RUN_ID-ATTEMPT/   # bundle estratto + release.json
  current -> releases/…     # aggiornato soltanto dopo i controlli di salute
  previous -> releases/…
  .deployment.lock
```

## Deploy, verifica e rollback

Dal computer:

```sh
just deploy --check                 # ultima pubblicazione riuscita su main
just deploy                         # attiva la stessa selezione predefinita
just deploy --check --run 123456789  # controlla un run esplicito
just deploy --run 123456789          # attiva quel run riuscito su main
just deploy --rollback 123456789-1   # riattiva una release già conservata sul VPS
```

`--check` convalida run, artifact, digest, configurazione e prerequisiti, scarica le immagini ed estrae il bundle in una directory temporanea poi rimossa. Non avvia servizi e non modifica `current`/`previous`. Ogni comando prende un lock non bloccante: una seconda operazione concorrente fallisce. Alla prima installazione il template incompleto causa il fallimento prima dell’attivazione.

Il deploy scarica il digest e verifica la label del commit, conserva il bundle in `releases/`, risolve Compose senza mostrare segreti, controlla immagine, assenza di build, volumi e binding loopback, scarica le dipendenze e avvia con `--no-build --pull never --wait --wait-timeout 300`. Il nome progetto è sempre **`lumi`**, quindi i volumi rimangono **`lumi_lumi-data`** e **`lumi_keycloak-db`** anche cambiando directory. Un’installazione con un nome progetto diverso richiede una migrazione pianificata prima di usare questi comandi.

Prima di spostare atomicamente `current`, controlla `/healthz` privato, discovery Keycloak privata e pubblica con issuer corretto, risposte anonime `401` della sessione privata e del gateway HTTPS, redirect di `/auth/login` al realm Lumi e `404` pubblici per salute, amministrazione e realm master. La salute interna di PostgreSQL e Keycloak è verificata da Compose. I file e le immagini sono conservati; nessun volume viene cancellato. Anche un aggiornamento può comportare una breve indisponibilità durante la ricreazione dei container.

Se l’attivazione o un controllo fallisce, il comando prova a riavviare e verificare la release che era `current`, mantenendo esito di errore. Il rollback esplicito usa le immagini conservate senza richiedere GitHub o il registry. In caso di prima installazione fallita non esiste una release precedente: ispeziona i servizi parzialmente avviati. Se anche il ripristino fallisce, intervieni sul server e usa un backup compatibile. Le migrazioni dei database **non vengono mai annullate automaticamente**.

La shell remota emette un marcatore casuale con il proprio stato finale: [`machinectl shell` non propaga lo stato del comando](https://www.freedesktop.org/software/systemd/man/latest/machinectl.html). Un marcatore assente, annullamento Polkit o disconnessione SSH è un errore, anche se machinectl esce con zero. Dopo una disconnessione l’esito dell’attivazione può essere incerto: riconnettiti, verifica `current`, i servizi e il lock prima di riprovare. I segnali intercettabili tentano il ripristino; un crash host o una terminazione forzata richiedono verifica manuale.

Per ispezionare i servizi entra nuovamente nella shell serviceman e usa il digest registrato:

```sh
cd "$HOME/lumi/current"
export LUMI_IMAGE="$(python3 -c 'import json; print(json.load(open("release.json"))["image"])')"
docker compose -p lumi --env-file "$HOME/lumi/config/.env" -f compose.yaml -f compose.prod.yaml ps
docker compose -p lumi --env-file "$HOME/lumi/config/.env" -f compose.yaml -f compose.prod.yaml logs --tail 100
```

L’import del realm avviene soltanto alla prima creazione. Gli avvii successivi non sovrascrivono utenti o configurazione Keycloak. `keycloak-init` configura l’URL privato del realm master ed eventualmente Google; Lumi non riceve credenziali di amministrazione Keycloak.

## Amministrazione solo tramite SSH

Dal computer locale:

```sh
ssh -N -L 19090:127.0.0.1:19090 lumi-server
```

Apri **http://localhost:19090/keycloak/admin/** e usa le credenziali amministrative. Mantieni porta e URL coerenti con `KEYCLOAK_ADMIN_ORIGIN`. Il tunnel cifra il traffico; la porta remota resta bindata al loopback.

L’account bootstrap Keycloak è destinato all’avvio iniziale. Crea un amministratore permanente nel realm master, abilita le protezioni desiderate e aggiorna `KEYCLOAK_ADMIN_USER`/`KEYCLOAK_ADMIN_PASSWORD` prima di rimuovere il bootstrap: `keycloak-init` deve poter autenticarsi agli avvii successivi. Conserva l’accesso amministrativo in modo privato.

Gli account del portale appartengono al realm **lumi**, non a master. Per approvare una persona: **Users → persona → Role mapping → Assign role → portal-access**. Non aggiungere questo ruolo ai ruoli predefiniti del realm. Dopo l’approvazione la persona può usare **Controlla l’accesso**; la revoca viene recepita entro la scadenza del token, cinque minuti.

Per amministrare le connessioni condivise assegna anche **`portal-admin`** ai soli responsabili. Non aggiungerlo ai ruoli predefiniti. `keycloak-init` crea il ruolo anche nei realm esistenti senza assegnarlo a utenti. Dopo una nuova autenticazione l’account vede **Admin** (`/admin`): collega lì ChatGPT e scegli il modello per tutte le famiglie. I genitori gestiscono istruzioni, voce, membri e cronologia della propria famiglia; non possono sostituire o scollegare il piano comune. Anche la revoca del ruolo amministrativo viene recepita al rinnovo del token, entro cinque minuti. L’upgrade aggiunge `portal_admin` alle sessioni tramite la migrazione di controllo `002_portal_admin.sql`; le sessioni già esistenti acquisiscono il nuovo ruolo al rinnovo o a un nuovo login.

`OPENAI_API_KEY` rimane in `config/.env` sul VPS ed è riutilizzata per la trascrizione di tutte le famiglie. Admin mostra soltanto se è configurata, senza riceverne il valore. Per modificarla cambia il file sul server e ricrea il container Lumi.

Il login e le API Lumi usano cookie opachi. Access token, refresh token e ID token restano sul server, inclusa la richiesta di logout. La sessione scade dopo trenta minuti di inattività o dodici ore totali. Un guasto temporaneo al provider impedisce il rinnovo; non abilita accessi alternativi.

## Google

Crea un client OAuth di tipo applicazione web nel progetto Google. Registra gli URL di ritorno esatti:

- Locale: `http://localhost:15183/keycloak/realms/lumi/broker/google/endpoint`
- Produzione: `https://lumi.example.com/keycloak/realms/lumi/broker/google/endpoint` con il dominio reale.

Aggiungi `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` a `$HOME/lumi/config/.env` dentro serviceman, senza commetterli, quindi nella directory `current` con `LUMI_IMAGE` impostata come sopra riesegui:

```sh
docker compose -p lumi --env-file "$HOME/lumi/config/.env" -f compose.yaml -f compose.prod.yaml up -d --no-build --force-recreate keycloak-init
```

In locale usa il progetto `lumi-local`, sostituisci `compose.prod.yaml` con `compose.local.yaml` e usa `.env.stack.local`. Il provider rimane nascosto finché mancano le credenziali. Mantieni il flusso di primo accesso predefinito, con verifica dell’identità per collegare account esistenti: non abilitare il collegamento automatico basato sull’email.

La riuscita dei test con password non dimostra il funzionamento del client Google. Verifica un consenso reale prima di dichiarare pronto quel metodo.

## Dati, aggiornamenti e backup

Il volume `lumi-data` contiene `portal/control.db` per sessioni, famiglie e inviti, `chatgpt.json` per l’unico grant ChatGPT, `lumi.db` per il modello condiviso e `families/ID/` con SQLite, cronologia e preferenze di ciascuna famiglia. Un grant globale già presente viene conservato; in assenza di questo, un singolo grant collegato per famiglia viene promosso insieme al modello. Con più grant preesistenti, Admin deve collegare l’account scelto. I vecchi file delle famiglie restano conservati ma non vengono più caricati: evita avvii paralleli o rollback che riutilizzino copie obsolete dei refresh token. `keycloak-db` contiene il database PostgreSQL. Directory e database Lumi hanno permessi privati. I backup contengono credenziali e token: conservali cifrati e fuori dal VPS.

Per un backup consistente:

1. Ferma `lumi` e `keycloak`, lasciando PostgreSQL attivo.
2. Esegui `pg_dump -U keycloak -d keycloak -Fc` nel servizio `keycloak-db`, salvandolo in un file privato sull’host.
3. Archivia integralmente il volume `lumi_lumi-data`, inclusi eventuali file WAL/SHM, `config/.env` con permessi preservati, `current/release.json` e il bundle della release corrente. Registra digest e immagini delle dipendenze; verifica che restino scaricabili anche in caso di perdita del VPS.
4. Riavvia i servizi, verifica la salute e prova periodicamente un ripristino isolato.

Esegui questi comandi Compose nella shell serviceman con `-p lumi`, il file ambiente assoluto e il digest della release corrente, come nell’esempio di ispezione. Prima di ogni aggiornamento esegui il backup, poi `just deploy --check` e `just deploy`. Non usare `down -v` o pulizie automatiche delle immagini. Le migrazioni del controllo portale e dei database delle famiglie sono versionate; un rollback del codice non annulla le migrazioni. Per ripristinare usa dati, PostgreSQL e configurazione della stessa istantanea, senza avviare due copie degli stessi grant ChatGPT.

## Verifiche locali e prima esposizione pubblica

```sh
just local-up
just check
just test-e2e
just test-auth
```

Verifica anche:

- richieste anonime a pagine e API: redirect al login oppure `401`, senza contenuti privati;
- account registrato senza ruolo: accesso in attesa; invito senza approvazione: nessun accesso;
- email di verifica e recupero password se SMTP è abilitato, consenso Google reale se configurato;
- separazione tra due famiglie, ruoli differenti, inviti e protezione dell’ultimo genitore;
- cookie HttpOnly/Secure in HTTPS, CSRF, logout e assenza di JWT in risposte/storage/URL del frontend;
- amministrazione e realm master non raggiungibili dal gateway pubblico, ma console utilizzabile attraverso SSH;
- layout mobile, audio, SSE, aggiornamenti PWA e persistenza dopo riavvio.

I test locali utilizzano Mailpit su `127.0.0.1:18025` e volumi dedicati. `just test-auth` avvia un backend nativo con dati in `data/auth-tests`; ferma prima `just dev` per liberare la porta `15173`. Non richiedono né modificano un VPS.

`just test-deploy` simula selezione run/artifact, quoting, annullamento Polkit, disconnessione, stato remoto mascherato da machinectl, registry negato, estrazione fallita, configurazione mancante, lock, salute fallita, rollback e ripristino fallito. `just check` lo include. `just test-deploy-compose` è opzionale: costruisce l’immagine amd64, estrae il bundle da un container mai avviato e attiva due directory di release in un progetto locale con nome casuale, porte libere, gateway Caddy di test e volumi isolati. Controlla immagine effettivamente avviata, salute, gate anonimo, redirect di login, discovery privata/pubblica, route private, archivi condivisi, SMTP disabilitato/abilitato/disabilitato e persistenza di un file nel volume dati dopo il cambio di directory. Alla fine rimuove soltanto i container e volumi di quel progetto di test. Richiede spazio Docker sufficiente. Per riutilizzare un’immagine già costruita: `just test-deploy-compose --image NOME`; un’immagine nativa verifica Compose ma non certifica la build amd64. Il test non legge gli ambienti privati del computer e non contatta il VPS o GHCR.
