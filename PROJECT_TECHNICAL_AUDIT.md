# A. Executive summary

- **Stato sintetico del progetto:** il repository è a uno stadio di **prototype avanzato / MVP tecnico**, non ancora production-grade. La base architetturale c’è — attivazione extension, CRUD config, plugin registry, `TomcatPlugin`, tree view, webview forms, template manager — ma la convergenza tra codice, specifiche e documentazione è incompleta. Evidenze principali in [src/extension.ts](src/extension.ts#L1-L156), [src/services/ServerService.ts](src/services/ServerService.ts#L1-L411), [src/core/server/plugins/implementations/TomcatPlugin.ts](src/core/server/plugins/implementations/TomcatPlugin.ts#L1-L518), [package.json](package.json#L13-L14).
- **Livello di maturità percepito:** **medio-basso per produzione**, **medio per prototipo funzionante**.
- **Principali rischi:**
  1. **Divergenza forte spec ↔ codice** su modello dati, command catalog, runtime multi-instance, diagnostica e queueing operativo: [specs.md](specs.md#L411-L440), [specs.md](specs.md#L562-L600), [src/core/types/domain.ts](src/core/types/domain.ts#L1-L76), [package.json](package.json#L18-L248).
  2. **Test strategy non operativa**: `typecheck` e `lint` passano, ma `npm test` fallisce per mismatch ESM/CommonJS e suite mancante: [package.json](package.json#L280-L308), [src/test/runTest.ts](src/test/runTest.ts#L1-L20).
  3. **Documentazione sovrastimata/obsoleta**: README e changelog dichiarano stato “production-ready”, mentre il dossier stesso parla di MVP incompleto: [README.md](README.md#L1-L3), [CHANGELOG.md](CHANGELOG.md#L7-L8), [PROJECT_DOSSIER.md](PROJECT_DOSSIER.md#L47-L47).
  4. **Production-hardening insufficiente**: assenza di CI, coverage, diagnostica, structured logging, processo operativo serializzato, gestione cancellazioni e security hardening completo.
- **Priorità immediate:**
  - **P0** riallineare specifiche, manifest e modello config reale.
  - **P0** rendere funzionante il path test/CI minimo.
  - **P0** decidere se il progetto segue davvero il target “Tomcat multi-instance con `runtimeId` + `catalinaBase`” oppure il modello attuale semplificato.
  - **P1** chiudere i gap funzionali più evidenti: `Sync` reale, logs/output coerenti, diagnostica, queueing/cancellation.

# B. Mappa delle fonti analizzate

| Fonte | Ruolo nel progetto | Affidabilità percepita | Note obsolescenza/incompletezza |
|---|---|---:|---|
| [src/](src) | Fonte primaria dello stato reale | Alta | Rappresenta la verità implementativa corrente |
| [package.json](package.json#L1-L315) | Manifest extension, contributes, script, dipendenze | Alta | Molto utile per capire UX reale, build e test |
| [tsconfig.json](tsconfig.json#L1-L20) | Config TypeScript | Alta | Rivela il mismatch ESM/CJS che impatta i test |
| [eslint.config.mjs](eslint.config.mjs#L1-L31) | Regole lint | Alta | Config minima, non particolarmente “hardening-oriented” |
| [esbuild.js](esbuild.js#L1-L41) | Bundling extension | Alta | Setup semplice, entrypoint singolo |
| [README.md](README.md#L1-L267) | Documentazione utente/prodotto | Bassa-Media | Contiene claim forti e boilerplate residuo scaffold VS Code: [README.md](README.md#L220-L255) |
| [CHANGELOG.md](CHANGELOG.md#L1-L79) | Stato dichiarato delle release | Bassa | Cita `TomcatRuntime` “production implementation”, ma nel repo non esiste un file omonimo |
| [PROJECT_DOSSIER.md](PROJECT_DOSSIER.md#L1-L360) | Analisi architetturale/stato progetto | Media | Utile come fotografia ragionata, ma non sempre allineata al codice attuale |
| [PHASE2_MIGRATION_COMPLETED.md](PHASE2_MIGRATION_COMPLETED.md) | Presunto stato migrazione | Nulla | File vuoto |
| [specs.md](specs.md#L1-L2420) | Specifica “frozen” operativa | Alta come intent, bassa come aderenza attuale | È la fonte più completa ma è chiaramente ahead-of-implementation |
| [jsm_specs_v_1_professional_vscode_extension_tomcat_first.md](jsm_specs_v_1_professional_vscode_extension_tomcat_first.md#L1-L1647) | Specifica esecutiva alternativa/estensiva | Media-Alta | Molto ricca, ma parzialmente sovrapposta e non del tutto coerente con `specs.md` |
| [.vscode/servers.json](.vscode/servers.json#L1-L25) | Config workspace locale presente | Media come evidenza di stato | Non è fonte normativa, ma mostra un modello legacy ancora in uso |
| [src/test/runTest.ts](src/test/runTest.ts#L1-L20) | Entry test runner | Alta | Dimostra che l’infrastruttura test è incompleta |
| [test-template-system.js](test-template-system.js#L1-L54) | Script di supporto/claim template system | Media | È più dimostrativo che probante |
| [vsc-extension-quickstart.md](vsc-extension-quickstart.md#L1-L40) | Scaffold originale VS Code | Bassa | Indizio che parte del repository deriva ancora da template iniziale |
| [data/](data) | Artefatti locali | Bassa | Presenza di SQLite taskmanager locale, non funzionale al prodotto extension |

# C. Stato attuale del progetto

## Architettura attuale

L’architettura reale è una stratificazione pragmatica:

- **Entry/UI orchestration:** [src/extension.ts](src/extension.ts#L1-L156)
- **Command layer monolitico:** [src/commands/index.ts](src/commands/index.ts#L1-L864)
- **Facade services:** [src/services/ServerService.ts](src/services/ServerService.ts#L1-L411), [src/services/DeploymentService.ts](src/services/DeploymentService.ts#L1-L311), [src/services/AutoSyncService.ts](src/services/AutoSyncService.ts#L1-L88), [src/services/LogService.ts](src/services/LogService.ts#L1-L67)
- **Core orchestration/state:** [src/core/server/ServerManager.ts](src/core/server/ServerManager.ts#L1-L219), [src/core/server/ServerRuntime.ts](src/core/server/ServerRuntime.ts#L1-L285)
- **Persistence/validation:** [src/core/config/ConfigManager.ts](src/core/config/ConfigManager.ts#L1-L159), [src/core/persistence/ConfigRepo.ts](src/core/persistence/ConfigRepo.ts#L1-L155), [src/core/validation/SchemaValidator.ts](src/core/validation/SchemaValidator.ts#L1-L111)
- **Plugin system:** [src/core/server/plugins/interfaces/IServerPlugin.ts](src/core/server/plugins/interfaces/IServerPlugin.ts#L1-L41), [src/core/server/plugins/registry/PluginRegistry.ts](src/core/server/plugins/registry/PluginRegistry.ts#L1-L79), [src/core/server/plugins/implementations/TomcatPlugin.ts](src/core/server/plugins/implementations/TomcatPlugin.ts#L1-L518)
- **UI:** [src/ui/views/ServerTreeViewProvider.ts](src/ui/views/ServerTreeViewProvider.ts#L1-L169), [src/ui/webviews/ServerFormPanel.ts](src/ui/webviews/ServerFormPanel.ts#L1-L476), [src/ui/webviews/DeploymentFormPanel.ts](src/ui/webviews/DeploymentFormPanel.ts#L1-L573)

### Osservazione chiave
La struttura è coerente come MVP, ma **non implementa l’architettura target descritta nelle specifiche**: mancano `DecisionEngine`, `OperationQueue`, `DiagnosticsService`, `ProcessManager`, registry runtime globale e normalizzazione/migrazioni reali: [specs.md](specs.md#L284-L304), [specs.md](specs.md#L1312-L1560).

## Funzionalità implementate

- Attivazione extension e registrazione tree/commands: [src/extension.ts](src/extension.ts#L1-L156)
- CRUD server via `ConfigManager`/`ServerController`: [src/core/config/ConfigManager.ts](src/core/config/ConfigManager.ts#L39-L64), [src/core/controllers/ServerController.ts](src/core/controllers/ServerController.ts#L29-L118)
- Start/stop/restart server via `ServerManager` + `ServerRuntime`: [src/services/ServerService.ts](src/services/ServerService.ts#L172-L274)
- Singolo plugin Tomcat con detection, start/stop, deploy/undeploy: [src/core/server/plugins/implementations/TomcatPlugin.ts](src/core/server/plugins/implementations/TomcatPlugin.ts#L21-L518)
- Persistenza config workspace in `.vscode/servers.json`: [src/core/persistence/ConfigRepo.ts](src/core/persistence/ConfigRepo.ts#L29-L79)
- Persistenza runtime state deployment separata: [src/core/persistence/DeploymentStateRepo.ts](src/core/persistence/DeploymentStateRepo.ts#L28-L154)
- Tree view server/deployment: [src/ui/views/ServerTreeViewProvider.ts](src/ui/views/ServerTreeViewProvider.ts#L1-L169)
- Form webview per server e deployment: [src/ui/webviews/ServerFormPanel.ts](src/ui/webviews/ServerFormPanel.ts#L1-L476), [src/ui/webviews/DeploymentFormPanel.ts](src/ui/webviews/DeploymentFormPanel.ts#L1-L573)
- Template CRUD persistente: [src/core/templates/TemplateManager.ts](src/core/templates/TemplateManager.ts#L1-L227)

## Funzionalità solo parzialmente implementate

- **AutoSync**: esiste, ma pubblica sempre in modalità `'incremental'`; il plugin Tomcat non implementa `deployIncremental`, quindi il comportamento degrada implicitamente a deploy pieno lato `DeploymentService`: [src/services/AutoSyncService.ts](src/services/AutoSyncService.ts#L48-L67), [src/services/DeploymentService.ts](src/services/DeploymentService.ts#L118-L130), [src/core/server/plugins/interfaces/IServerPlugin.ts](src/core/server/plugins/interfaces/IServerPlugin.ts#L28-L33).
- **Deploy/redeploy da comandi server**: i comandi `jsm.server.deployChanges` e `jsm.server.fullRedeploy` mostrano messaggi di successo ma non orchestrano davvero le operazioni: [src/commands/index.ts](src/commands/index.ts#L251-L303).
- **Log viewing**: servizio presente ma con integrazione fragile/incompleta; usa un metodo `getLogPath` non definito nel contratto plugin e tratta il path come relativo prima di aprire il documento: [src/services/LogService.ts](src/services/LogService.ts#L52-L57), [src/core/server/plugins/interfaces/IServerPlugin.ts](src/core/server/plugins/interfaces/IServerPlugin.ts#L1-L41).
- **Template-to-instance flow**: l’UX c’è, ma la creazione da template non precompila davvero il form con i dati del template; apre il form generico e salva il payload restituito: [src/commands/index.ts](src/commands/index.ts#L772-L800).
- **Crash recovery / runtime reconciliation**: dichiarata in README, ma il codice corrente registra i runtime tutti come `stopped` in `loadWorkspace()` senza vera riconciliazione di processo o PID: [README.md](README.md#L9-L19), [src/services/ServerService.ts](src/services/ServerService.ts#L296-L334).

## Aree mancanti o non chiare

- Multi-instance Tomcat con `runtimeId` + `catalinaBase`
- Registry runtime globale
- Migrazione schema e `schemaVersion`
- Queue per server, cancellazione, priorità operazioni
- Diagnostica copiabile
- Output channels per server distinti
- CI/CD e test suite reale
- Plugin oltre Tomcat
- Configurazione ignore globs avanzata
- Sicurezza/secrets storage

## Qualità complessiva del codice e della struttura

- **Positivi**
  - Naming generalmente leggibile
  - Uso sistematico di `Result<T,E>`
  - Separazione discreta tra servizio, persistence e UI
  - `TomcatPlugin` è corposo ma comprensibile

- **Criticità**
  - Architettura ancora ibrida/migrating
  - `commands/index.ts` è troppo denso per manutenibilità
  - Core dipendente da VS Code in più punti, in conflitto con le specifiche: [src/core/EventBus.ts](src/core/EventBus.ts#L1-L52), [src/core/config/ConfigManager.ts](src/core/config/ConfigManager.ts#L1-L159), [src/core/debug/DebugManager.ts](src/core/debug/DebugManager.ts#L1-L125), [src/core/utils/logger.ts](src/core/utils/logger.ts#L1-L61)
  - Presenza di file vuoti o residui: [src/extension.new.ts](src/extension.new.ts), [PHASE2_MIGRATION_COMPLETED.md](PHASE2_MIGRATION_COMPLETED.md), [vsc-extension-quickstart.md](vsc-extension-quickstart.md#L1-L40)

# D. Gap analysis rispetto alle specifiche

| Area | Requisito/spec attesa | Evidenza nel codice | Stato | Impatto | Note |
|---|---|---|---|---|---|
| Config model | `.vscode/jsm.servers.json` con `schemaVersion`, `runtimeId`, `catalinaBase` | Il repo usa `.vscode/servers.json` legacy e schema semplificato: [.vscode/servers.json](.vscode/servers.json#L1-L25), [src/core/config/schema/jsm.server.schema.json](src/core/config/schema/jsm.server.schema.json#L1-L117) vs [specs.md](specs.md#L411-L440) | in conflitto | Alto | Gap strutturale |
| Multi-instance Tomcat | `CATALINA_HOME` condiviso + `CATALINA_BASE` per server | `TomcatPlugin` imposta entrambi da `config.serverHome`: [src/core/server/plugins/implementations/TomcatPlugin.ts](src/core/server/plugins/implementations/TomcatPlugin.ts#L364-L365) | mancante | Alto | Non c’è isolamento per server |
| Runtime registry globale | Runtime storage separato e riuso | Nessuna implementazione; solo detection plugin runtime path: [src/services/ServerService.ts](src/services/ServerService.ts#L382-L390) | mancante | Alto | Blocca il modello spec |
| Command catalog | `jsm.server.add`, `jsm.deployment.sync`, `jsm.diagnostics.copy`, ecc. | Il manifest reale legacy usava `jsm.server.add`, `jsm.server.deployChanges`, `jsm.server.copyInfo`, ecc.; la superficie pubblica va mantenuta generica anche se l'implementazione resta Tomcat-first: [package.json](package.json#L18-L248), [docs/specs.md](docs/specs.md#L569-L600) | parziale | Medio | Serve ancora completare il resto del catalogo senza introdurre comandi fittizi |
| Tree minimal + inline complete | Tree minimale sì, ma con Run/Debug/Stop/Restart/Cancel/Edit/Output coerenti | Tree minimale sì: [src/ui/views/ServerTreeViewProvider.ts](src/ui/views/ServerTreeViewProvider.ts#L1-L169); mancano `openOutput`/`cancelOperation` nel manifest reale: [package.json](package.json#L141-L248) | parziale | Medio-Alto | UI parzialmente allineata |
| Single Sync decision engine | Un solo comando `Sync` con scelta automatica | Deployment usa `forceDeploy`; server usa stub `deployChanges`/`fullRedeploy`: [package.json](package.json#L58-L63), [package.json](package.json#L103-L108), [src/commands/index.ts](src/commands/index.ts#L251-L303), [src/commands/index.ts](src/commands/index.ts#L431-L460) | parziale | Alto | Strategia non centralizzata |
| Decision engine | `DecisionEngine` puro e deterministico | Non esiste nel codice; previsto solo in spec: [specs.md](specs.md#L1312-L1364) | mancante | Alto | Impatta deploy, fallback, UX |
| Operation queue / cancel | Serializzazione, cancellazione, priorità op | Assente; `ServerManager` chiama direttamente il runtime: [src/core/server/ServerManager.ts](src/core/server/ServerManager.ts#L59-L123) | mancante | Alto | Rischio race/incoerenze |
| Deploy atomicity | staging → swap → rollback | `TomcatPlugin` usa `copyFileSync`/`rmSync` diretti: [src/core/server/plugins/implementations/TomcatPlugin.ts](src/core/server/plugins/implementations/TomcatPlugin.ts#L194-L229) | mancante | Alto | Rischio deploy parziali |
| Logs/output | `Open Logs`, `Open Output`, channels `JSM` e `JSM: <server>` | Logger centrale unico su `JSM: Extension`: [src/core/utils/logger.ts](src/core/utils/logger.ts#L1-L61); log service fragile: [src/services/LogService.ts](src/services/LogService.ts#L1-L67) | parziale | Medio-Alto | Osservabilità debole |
| Diagnostics | `Copy Diagnostics` deterministico | Nessuna implementazione nel codice; in spec previsto esplicitamente: [specs.md](specs.md#L1557-L1580) | mancante | Alto | UX supporto insufficiente |
| Migrations | Migrazione schema legacy → nuovo | Nessuna migrazione reale in codice; solo spec dettagliata: [specs.md](specs.md#L467-L537) | mancante | Alto | Debito evolutivo |
| Security | Debug bind `127.0.0.1`, no shell, secrets storage | `DebugManager` attacca su `localhost`: [src/core/debug/DebugManager.ts](src/core/debug/DebugManager.ts#L65-L73); `TomcatPlugin` usa JDWP `address=${debugPort}` senza bind esplicito: [src/core/server/plugins/implementations/TomcatPlugin.ts](src/core/server/plugins/implementations/TomcatPlugin.ts#L372-L374); niente secrets storage | parziale | Alto | Hardening incompleto |
| Tests | Unit/integration/e2e + CI minimal | Solo entry runner; suite assente; test command rotto: [src/test/runTest.ts](src/test/runTest.ts#L1-L20), [package.json](package.json#L280-L308) | mancante | Alto | Gate qualità assente |
| Build/package | compile/package funzionanti | `check-types`, `lint`, `compile` passano; `test` fallisce | parziale | Medio | Pipeline incompleta |
| Plugin-oriented extensibility | Core pronto per Jetty/WildFly/etc. | Enum dichiara più tipi: [src/core/types/domain.ts](src/core/types/domain.ts#L5-L7); registry registra solo Tomcat: [src/core/server/plugins/registry/PluginRegistry.ts](src/core/server/plugins/registry/PluginRegistry.ts#L69-L76) | parziale | Medio | Contratto c’è, ecosistema no |
| Docs quality | Docs coerenti e non obsolete | README con boilerplate residuo: [README.md](README.md#L220-L255); changelog sovrastima “TomcatRuntime”: [CHANGELOG.md](CHANGELOG.md#L7-L8) | in conflitto | Medio-Alto | Rischio decisionale |

# E. Revisione critica delle specifiche

## 1. Doppio corpus di specifiche sovrapposto
- **Problema rilevato:** esistono due specifiche molto ampie, [specs.md](specs.md#L1-L2420) e [jsm_specs_v_1_professional_vscode_extension_tomcat_first.md](jsm_specs_v_1_professional_vscode_extension_tomcat_first.md#L1-L1647), con ampia sovrapposizione ma dettagli diversi.
- **Perché è un problema:** crea ambiguità su quale documento sia normativo quando emergono conflitti su command catalog, layering, storage e DoD.
- **Proposta di revisione:** consolidare in **una sola source of truth** con appendici distinte: prodotto, architettura target, piano di migrazione, acceptance criteria.

## 2. Specifica troppo “target architecture”, poco “migration-aware”
- **Problema rilevato:** le specifiche descrivono un target molto più avanzato del codice corrente, ma non separano chiaramente “as-is”, “transitional”, “to-be”.
- **Perché è un problema:** rende ogni audit un confronto binario ingiusto e rende difficile capire cosa è realmente “mancante” vs “ancora non migrato”.
- **Proposta di revisione:** introdurre 3 livelli per ogni area: **current baseline**, **transition milestone**, **v1 frozen target**.

## 3. Command catalog e manifest non armonizzati
- **Problema rilevato:** i command ID in specifica non coincidono con quelli presenti in manifest/codice: [specs.md](specs.md#L569-L600) vs [package.json](package.json#L18-L248).
- **Perché è un problema:** spezza tracciabilità requisito → comando → handler → test.
- **Proposta di revisione:** definire una tabella normativa `command_id / label / menu placement / handler expected / acceptance`.

## 4. Specifiche storage/config troppo avanti rispetto al repo
- **Problema rilevato:** le specifiche pretendono `runtimeId`, `catalinaBase`, `schemaVersion`, runtime registry globale e migrazioni complete: [specs.md](specs.md#L411-L537).
- **Perché è un problema:** oggi il repository non è neppure coerente su file e shape config; senza piano di migrazione, la spec è corretta come vision ma non come baseline operativa.
- **Proposta di revisione:** scindere “canonical schema target” da “legacy schema supportato”, con stato e scadenza.

## 5. Requirements troppo mescolati tra prodotto, design e implementazione
- **Problema rilevato:** nelle specifiche convivono requisiti utente, dettagli architetturali, pseudocodice, decisioni tecniche e perfino snippet di implementazione.
- **Perché è un problema:** aumenta il costo di manutenzione e rende obsoleto il documento appena il codice cambia.
- **Proposta di revisione:** separare in:
  - Product spec
  - Architecture decision record
  - Migration plan
  - Acceptance tests / scenarios

## 6. Production-grade non sufficientemente definito a livello di gate
- **Problema rilevato:** “production-ready” è usato in più documenti, ma i gate minimi non sono espressi in modo sintetico e verificabile.
- **Perché è un problema:** facilita sovrastime documentali come quelle in README/CHANGELOG.
- **Proposta di revisione:** introdurre una sezione compatta “Production Readiness Gates” con criteri minimi: CI verde, test operativi, no stub commands, config migration verificata, diagnostics disponibili, logging per server, error matrix coperta.

## 7. Mancano chiarimenti su backward compatibility
- **Problema rilevato:** la spec parla di migrazione, ma non chiarisce compatibilità, fallback o support window del modello legacy.
- **Perché è un problema:** impatta direttamente utenti esistenti e complessità implementativa.
- **Proposta di revisione:** aggiungere matrice compatibilità: legacy supported / auto-migrated / rejected-with-fix.

## 8. Mancano confini espliciti tra raccomandazioni e requisiti obbligatori
- **Problema rilevato:** alcune sezioni sembrano vincolanti, altre sono aspirazionali.
- **Perché è un problema:** complica prioritizzazione backlog.
- **Proposta di revisione:** taggare ogni item con `mandatory`, `target-v1`, `recommended`, `future`.

# F. Analisi production-readiness

| Area | Stato attuale | Rischio | Raccomandazione | Priorità |
|---|---|---|---|---|
| Architettura e modularità | Buona base MVP, ma non allineata all’architettura target; `commands/index.ts` è monolitico e il core importa VS Code in più punti: [src/commands/index.ts](src/commands/index.ts#L1-L864), [src/core/EventBus.ts](src/core/EventBus.ts#L1-L52) | Medio-Alto | Stabilire una baseline architetturale reale e fermare la “migrazione implicita”; separare UI/core/infra in modo esplicito | P1 |
| Affidabilità e gestione errori | Pattern `Result` presente, ma niente queueing/cancellation robusta, hooks non realmente awaitati: [src/core/hooks/HookManager.ts](src/core/hooks/HookManager.ts#L53-L64) | Alto | Implementare `OperationQueue`, correzione hook execution, politiche stop/retry coerenti | P0 |
| Configurazione e persistenza | Persistenza semplice e leggibile, ma schema legacy e senza migrazioni/versioning: [src/core/persistence/ConfigRepo.ts](src/core/persistence/ConfigRepo.ts#L29-L155) | Alto | Decidere schema canonico, introdurre `schemaVersion`, migrazioni e compatibilità | P0 |
| Sicurezza | No `shell: true`, ma debug bind non esplicitamente localhost lato Tomcat e nessun secrets storage: [src/core/server/plugins/implementations/TomcatPlugin.ts](src/core/server/plugins/implementations/TomcatPlugin.ts#L372-L374) | Alto | Hardening debug bind, path validation, secret segregation, sanitizzazione log | P0 |
| Logging/telemetria/osservabilità | Logger unico e non strutturato; manca diagnostica, ring buffer, output per server: [src/core/utils/logger.ts](src/core/utils/logger.ts#L1-L61) | Alto | Structured logging minimo, per-server output channel, diagnostics bundle | P1 |
| Test e coverage strategica | Infrastruttura test rotta, nessuna suite, nessuna coverage: [src/test/runTest.ts](src/test/runTest.ts#L1-L20) | Critico | Ripristinare `npm test`, aggiungere unit test core + smoke integration | P0 |
| Packaging/build/release | `compile` e `package` risultano plausibilmente funzionanti; CI assente | Medio-Alto | Aggiungere CI base: lint, typecheck, test, package | P0 |
| Estendibilità plugin-oriented | Interfacce e registry esistono, ma solo Tomcat è reale: [src/core/server/plugins/registry/PluginRegistry.ts](src/core/server/plugins/registry/PluginRegistry.ts#L69-L76) | Medio | Prima chiudere Tomcat e il contratto plugin; poi stub controllati per altri server | P2 |
| DX/manutenibilità | Buon uso di TS strict e `Result`, ma codice ibrido, doc non affidabile, file residui | Medio-Alto | Ridurre monoliti, eliminare residui, riallineare docs a repo truth | P1 |
| UX operativa della extension | Tree e form esistono, ma comandi/inline/context non corrispondono alla UX spec; alcuni comandi sono stub | Alto | Riallineare manifest e comandi reali; eliminare azioni finte | P0 |

# G. Backlog di interventi raccomandati

| ID | Titolo | Descrizione | Categoria | Priorità | Dipendenze | Criterio di completamento |
|---|---|---|---|---|---|---|
| B-001 | Unificare source of truth spec | Consolidare `specs` e specifica esecutiva in un documento normativo unico | gap specifica | P0 | Nessuna | Documento unico approvato con sezioni current/transition/target |
| B-002 | Decidere il modello config canonico | Confermare se il prodotto resta su schema legacy semplificato o migra a `runtimeId`/`catalinaBase` | architettura | P0 | B-001 | ADR approvato + matrice compatibilità legacy |
| B-003 | Ripristinare test runner | Rendere `npm test` eseguibile correggendo ESM/CJS e aggiungendo una suite minima reale | test | P0 | B-002 | `npm test` verde in locale |
| B-004 | Aggiungere CI minima | Pipeline con lint, typecheck, test, package | packaging/build/release | P0 | B-003 | CI verde su push/PR |
| B-005 | Rimuovere comandi stub | Sostituire o rimuovere `deployChanges` e `fullRedeploy` server-level finti | bug | P0 | B-002 | Nessun comando utente termina con successo senza eseguire lavoro reale |
| B-006 | Riallineare manifest e command IDs | Allineare `package.json`, comandi e tree context alla spec scelta | refactor | P0 | B-001, B-002 | Tabella comando→handler→menu coerente e verificata |
| B-007 | Implementare diagnostics minima | Comando diagnostica e bundle copiabile | hardening | P1 | B-002 | Esiste `Copy Diagnostics` con output deterministic minimo |
| B-008 | Hardening logging/output | Output per server, logger strutturato minimo, fix `LogService` | hardening | P1 | B-006 | Open logs/output funziona e routing log è coerente |
| B-009 | Formalizzare operation orchestration | Introdurre `OperationQueue`/cancellation o definire esplicitamente un modello alternativo | architettura | P1 | B-002 | Stop/start/sync serializzati e cancellabili per server |
| B-010 | Hardening sicurezza runtime | Binding debug a localhost, path validation, redaction secrets | security | P1 | B-002 | Checklist security di base soddisfatta |
| B-011 | Rifattorizzare command layer | Spezzare [src/commands/index.ts](src/commands/index.ts#L1-L864) in moduli per dominio | refactor | P2 | B-006 | Modulo server/deployment/template separati |
| B-012 | Stabilizzare autosync | Rendere esplicito il comportamento incremental/full e i limiti storm protection | hardening | P2 | B-009 | AutoSync produce strategia verificabile e testata |
| B-013 | Pulizia documentale | Aggiornare README/CHANGELOG/dossier allo stato reale ed eliminare boilerplate residuo | docs | P2 | B-001, B-006 | Nessun claim “production-ready” senza evidenza |
| B-014 | Chiudere residui di migrazione | Valutare/eliminare [src/extension.new.ts](src/extension.new.ts), [PHASE2_MIGRATION_COMPLETED.md](PHASE2_MIGRATION_COMPLETED.md), scaffold docs | docs | P3 | Nessuna | Repo senza file vuoti/residui ingannevoli |

# H. Proposta di agenti/skill specializzati

## 1. Architecture Auditor
- **Missione:** verificare coerenza architetturale reale vs target.
- **Ambito:** layering, dipendenze, ownership moduli, boundary violations.
- **Input che deve leggere:** [src/extension.ts](src/extension.ts#L1-L156), [src/core/](src/core), [src/services/](src/services), [src/ui/](src/ui), [specs.md](specs.md).
- **Checklist di analisi:**
  - `core` importa VS Code?
  - esistono orchestratori impliciti/duplicati?
  - i singleton impediscono testabilità?
  - ci sono moduli target mancanti ma “assunti” dalla spec?
- **Output atteso:** mappa as-is/to-be + ADR gap.
- **Segnali di rischio:** dipendenze circolari, monoliti, stato globale, naming da migrazione.
- **Quando usarlo:** all’inizio di ogni fase di refactor o roadmap tecnica.

## 2. Spec & Docs Reconciler
- **Missione:** unificare requirement reali, docs e spec normative.
- **Ambito:** coerenza tra README, changelog, dossier, spec.
- **Input:** [README.md](README.md#L1-L267), [CHANGELOG.md](CHANGELOG.md#L1-L79), [PROJECT_DOSSIER.md](PROJECT_DOSSIER.md#L1-L360), [specs.md](specs.md#L1-L2420), [jsm_specs_v_1_professional_vscode_extension_tomcat_first.md](jsm_specs_v_1_professional_vscode_extension_tomcat_first.md#L1-L1647).
- **Checklist:**
  - claim supportati dal codice?
  - documenti duplicati o confliggenti?
  - command names coerenti?
  - DoD verificabile?
- **Output:** matrice doc truth / stale / conflict.
- **Segnali di rischio:** “production-ready” non dimostrato, documenti vuoti, boilerplate residuo.
- **Quando usarlo:** prima di backlog planning e prima di release.

## 3. Code Quality & Refactor Scout
- **Missione:** rilevare hot spot di manutenibilità.
- **Ambito:** complessità, duplicazioni, code smells, dead code.
- **Input:** [src/commands/index.ts](src/commands/index.ts#L1-L864), [src/services/](src/services), [src/core/](src/core).
- **Checklist:**
  - file > 400 linee critici?
  - responsabilità multiple?
  - metodi stub?
  - codice vuoto/legacy?
- **Output:** shortlist refactor a ROI alto.
- **Segnali di rischio:** file vuoti, commenti “This would typically be handled...”, API non usate.
- **Quando usarlo:** dopo il riallineamento spec.

## 4. Security Hardening Reviewer
- **Missione:** audit di sicurezza operativa della extension.
- **Ambito:** process spawn, path validation, debug binding, secrets, redaction.
- **Input:** [src/core/server/plugins/implementations/TomcatPlugin.ts](src/core/server/plugins/implementations/TomcatPlugin.ts#L1-L518), [src/core/debug/DebugManager.ts](src/core/debug/DebugManager.ts#L1-L125), [specs.md](specs.md#L2267-L2276).
- **Checklist:**
  - bind debug solo localhost?
  - no shell execution?
  - path user-controlled validati?
  - secrets evitati in config/log?
- **Output:** risk register security + remediation order.
- **Segnali di rischio:** env vars libere, absolute path non validate, log path handling fragile.
- **Quando usarlo:** prima di qualsiasi claim di “production-ready”.

## 5. Test & Reliability Engineer
- **Missione:** rendere affidabile la delivery pipeline.
- **Ambito:** unit, integration, e2e smoke, failure modes.
- **Input:** [package.json](package.json#L273-L308), [src/test/runTest.ts](src/test/runTest.ts#L1-L20), servizi/core.
- **Checklist:**
  - `npm test` funziona?
  - suite minima presente?
  - quali moduli sono puri e testabili subito?
  - quali failure modes vanno coperti per primi?
- **Output:** pyramid test strategy concreta.
- **Segnali di rischio:** test runner rotto, suite mancanti, dipendenze test duplicate.
- **Quando usarlo:** immediatamente, P0.

## 6. Build/Release Custodian
- **Missione:** verificare packaging, bundle, compatibilità e release hygiene.
- **Ambito:** manifest, esbuild, versioning, CI, publishing readiness.
- **Input:** [package.json](package.json#L1-L315), [esbuild.js](esbuild.js#L1-L41), [tsconfig.json](tsconfig.json#L1-L20), [CHANGELOG.md](CHANGELOG.md#L1-L79).
- **Checklist:**
  - scripts coerenti?
  - entrypoint corretto?
  - versioning/release notes affidabili?
  - CI minima assente/presente?
- **Output:** release readiness checklist.
- **Segnali di rischio:** compile verde ma test rotti, changelog non aderente, nessuna automation.
- **Quando usarlo:** prima di ogni milestone.

## 7. Extension UX Examiner
- **Missione:** verificare UX operativa reale della extension.
- **Ambito:** tree view, commands, context menus, forms, microcopy.
- **Input:** [package.json](package.json#L18-L248), [src/ui/views/ServerTreeViewProvider.ts](src/ui/views/ServerTreeViewProvider.ts#L1-L169), [src/ui/webviews/ServerFormPanel.ts](src/ui/webviews/ServerFormPanel.ts#L1-L476), [src/ui/webviews/DeploymentFormPanel.ts](src/ui/webviews/DeploymentFormPanel.ts#L1-L573).
- **Checklist:**
  - inline actions coerenti con stati?
  - form prefill/validation corretti?
  - messaggi utente veritieri?
  - esistono azioni finte?
- **Output:** UX gap list con priorità operativa.
- **Segnali di rischio:** comandi stub, label non coerenti, no-op non dichiarati.
- **Quando usarlo:** dopo riallineamento comandi.

## 8. Runtime/Config Persistence Analyst
- **Missione:** audit del cuore server-management.
- **Ambito:** config schema, persistence, runtime lifecycle, deploy path, autosync.
- **Input:** [src/core/config/ConfigManager.ts](src/core/config/ConfigManager.ts#L1-L159), [src/core/persistence/ConfigRepo.ts](src/core/persistence/ConfigRepo.ts#L1-L155), [src/services/DeploymentService.ts](src/services/DeploymentService.ts#L1-L311), [src/core/server/plugins/implementations/TomcatPlugin.ts](src/core/server/plugins/implementations/TomcatPlugin.ts#L1-L518), [.vscode/servers.json](.vscode/servers.json#L1-L25), [specs.md](specs.md#L411-L537).
- **Checklist:**
  - schema reale vs target?
  - deploy su `serverHome` o `catalinaBase`?
  - autosync davvero incremental?
  - persistence atomica e migrabile?
- **Output:** truth model del runtime + migration recommendations.
- **Segnali di rischio:** legacy shape, no schemaVersion, deploy non atomici, fallback impliciti.
- **Quando usarlo:** come skill centrale del dominio.

# I. Piano operativo consigliato

| Fase | Obiettivo fase | Deliverable | Dipendenze | Criterio di uscita |
|---|---|---|---|---|
| 1 | Stabilire la verità normativa | Spec unificata + ADR su modello config/runtime | Nessuna | È chiaro cosa è v1 reale e cosa è target post-migrazione |
| 2 | Ripristinare i gate di qualità minimi | `npm test` funzionante + CI minima | Fase 1 | Lint, typecheck, test e package sono automatizzabili |
| 3 | Riallineare UX e command surface | Manifest/comandi/context menu coerenti | Fase 1 | Nessun comando utente è stub o fuorviante |
| 4 | Stabilizzare persistence e runtime model | Decisione implementata su legacy vs `runtimeId/catalinaBase`, migrazioni | Fasi 1-2 | Config e deploy path sono coerenti e testati |
| 5 | Hardening operativo | Logging/output/diagnostics/security minima | Fasi 2-4 | Supporto operativo sufficiente per uso team interno |
| 6 | Refactor strutturale | Scomposizione command layer e boundary cleanup | Fasi 3-5 | Architettura più testabile, con meno debito di migrazione |
| 7 | Estensione roadmap | Plugin readiness reale e incremento feature | Fasi 1-6 | Tomcat core stabile e base pronta per nuove capability |

# J. Assunzioni e non-goal

## Assunzioni minime esplicite
- Ho considerato il repository come **fonte primaria della verità implementativa**.
- Ho trattato [specs.md](specs.md#L1-L2420) come specifica principale e [jsm_specs_v_1_professional_vscode_extension_tomcat_first.md](jsm_specs_v_1_professional_vscode_extension_tomcat_first.md#L1-L1647) come specifica estensiva/concorrente.
- Ho considerato [.vscode/servers.json](.vscode/servers.json#L1-L25) come evidenza utile dello stato locale, non come fonte normativa.
- Ho eseguito solo analisi e verifica, senza modificare codice o documentazione.

## Ciò che non è stato valutato o non può essere concluso con certezza
- Non ho validato runtime reale con una installazione Tomcat avviata.
- Non ho eseguito E2E in Extension Host.
- Non posso confermare la UX effettiva end-to-end di webview/tree senza sessione interattiva.
- Non posso stabilire se i file locali non tracciati rappresentino una roadmap ufficiale o artefatti personali.
- Non posso concludere che l’extension sia inutilizzabile: posso però concludere che **non soddisfa oggi lo standard production-grade dichiarato**.
