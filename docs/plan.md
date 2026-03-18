# Plan: Server vs deployment health check

**Fonte di verità** per l'implementazione del health check a livello deployment (GET endpoint configurabile). Server = port probe only; deployment = path opzionale + GET.

**Metodologia**: piano strutturato con Sequential Thinking (scomposizione server vs deployment, scelta app-layer per GET, fallback e timeout); revisione Councilor (phase deliberation) con integrazione dei finding.

**Obiettivo**: distinguere (1) health **server** = port probe (processo/porta su?), (2) health **deployment** = GET a endpoint configurabile (l'app risponde?). Un server può avere più deployment, ogni app con il proprio endpoint.

---

## 1. Scopo e confini

- **Server health**: resta "porta HTTP raggiungibile" (port probe). Usato in `doStartInternal` e `doStatusRefresh`. Nessun URL in `ServerConfig`. Il plugin `healthCheck(config)` continua a fare solo port probe (TomcatPlugin attuale).
- **Deployment health**: nuovo. Ogni deployment può avere un path opzionale (es. `/myapp/health`, `/actuator/health`). GET `http://{server.host}:{server.ports.http}{path}`; timeout configurabile; success = 2xx. Non cambia `DeploymentState`; la health è informativa (tooltip/descrizione nodo). **Nessun comando**: il check avviene solo in automatico allo start del server e al refresh della view (come per lo server).

---

## 2. Modello dati

- **DeploymentConfig** (`src/core/types/domain.ts`): aggiungere campo opzionale
  - `healthCheckPath?: string` — path relativo, es. `"/health"`, `"/myapp/actuator/health"`. Default assente = "nessun health check configurato".
  - `healthCheckTimeoutMs?: number` — timeout per la GET in ms; default **5000**. Nessun retry in v1.
  - Opzionale in futuro: `expectedStatusCodes?: number[]` (default 2xx).
- **ServerConfig**: nessun nuovo campo per health (port probe usa host/ports già esistenti).
- **Fallback quando `healthCheckPath` non è configurato**: non eseguire GET; allo start e al refresh si salta il check per quel deployment.

---

## 3. Dove implementare la GET (deployment)

- **Opzione A (scelta proposta)**: **app layer** — un modulo che, dati `ServerConfig` + `DeploymentConfig`, costruisce l'URL e fa GET (fetch con timeout). Nessuna nuova API sul plugin: la GET è generica (host/port da server, path da deployment).
- **Raccomandazione**: Opzione A. Creare un **HealthCheckClient** che espone `get(url: string, timeoutMs: number): Promise<Result<HealthReport, JsmError>>` (GET, solo status **2xx = ok**, misura latencyMs; timeout obbligatorio, nessun retry in v1). Il chiamante costruisce l'URL da server host/port e `dep.healthCheckPath`; se path assente non chiamare il client.

---

## 4. Quando eseguire il deployment health check (solo automatico)

- **Allo start del server**: dopo che il server è passato a `running` (in `doStartInternal` dopo `plugin.healthCheck` server), per ogni deployment del server in stato **synced** con `healthCheckPath` impostato, eseguire la GET. Risultato solo informativo (log o output; opzionale mostrarlo in UI/tooltip).
- **Al refresh della view**: quando l'utente esegue `jsm.view.refresh`, oltre a `refreshStatus` per i server in running/starting, eseguire il deployment health check per ogni deployment in stato **synced** che ha `healthCheckPath`; risultato in tooltip o descrizione del nodo deployment (senza nuovo stato persistito).
- **Nessun comando** da triggerare: niente `jsm.deployment.checkHealth`; tutto automatico come per lo server (start + refresh).

---

## 5. Server health (nessun cambio funzionale)

- **TomcatPlugin.healthCheck**: lasciare com'è (port probe). Significato: "il server/porta è su".
- **ServerLifecycle**: nessun cambio (doStartInternal e doStatusRefresh continuano a usare `plugin.healthCheck` per il server).

---

## 6. File da toccare (checklist)

| Area | File | Modifiche |
|------|------|-----------|
| Domain | `src/core/types/domain.ts` | Aggiungere `healthCheckPath?: string`, `healthCheckTimeoutMs?: number` a `DeploymentConfig`. |
| Schema | Schema JSON server/deployment config (se presente) | Campo opzionale `healthCheckPath`. |
| Infra/App | Nuovo modulo (es. `src/infra/http/HealthCheckClient.ts`) | GET con fetch + timeout; ritorna `Result<HealthReport, JsmError>`. |
| UI form | Form edit deployment (DeploymentFormPanel) | Campo opzionale "Health check path". |
| ServerLifecycle | `src/app/server/ServerLifecycle.ts` | Dopo health check server in doStartInternal: per ogni deployment synced con healthCheckPath, eseguire GET (servizio deployment health) e log/UI se necessario. |
| Refresh | `src/ui/commands/server-commands.ts` (jsm.view.refresh) | Oltre a refreshStatus per server running/starting: per ogni deployment synced con healthCheckPath (deployment list da workspaceRegistry + deployService.getDeploymentState), eseguire deployment health check; aggiornare tree/tooltip con risultato. |
| Plugin | `src/plugins/tomcat/TomcatPlugin.ts` | Nessun cambio (opz. commento "server/port only"). |

---

## 7. Test

- Unit: HealthCheckClient — GET 200 vs 404 vs timeout; verifica `ok` e `latencyMs`.
- Integrazione (opz.): deployment con `healthCheckPath` salvato e riletto da config. Test che allo start e al refresh venga invocato il check per deployment synced con path.

---

## 8. Ordine di implementazione suggerito

1. Domain: `healthCheckPath` (+ `healthCheckTimeoutMs`) in `DeploymentConfig`.
2. HealthCheckClient (GET + timeout), tipo `HealthReport` riusato.
3. Form: campo Health check path nel deployment form.
4. Integrazione in **doStartInternal** (dopo server health): per deployment synced con healthCheckPath, eseguire GET.
5. Integrazione in **jsm.view.refresh**: per deployment synced con healthCheckPath, eseguire GET e aggiornare tooltip/descrizione nodo.

---

## 9. Rischio e semplificazioni

- **Rischio**: GET a URL non fidato. Mitigazione: solo path relativo, timeout basso; host/port da server config.
- **Semplificazione**: nessun "DeploymentHealthState" persistito; health solo automatica (start + refresh), risultato in UI/tooltip senza cambiare FSM.
- **Conseguenze fallimento health**: la GET **non** cambia `DeploymentState`; solo informativo.
- **Security**: endpoint health assunti non protetti (locale); nessun auth; documentare limite.
- **Validazione Councilor**: timeout 5000, fallback path assente = skip, status 2xx = healthy.

---

## 10. Councilor (phase deliberation)

- **Verdict**: Revise. **Confidence**: 0.85.
- **Finding e integrazioni**: (1) Robustness — timeout/retry: healthCheckTimeoutMs default 5000, nessun retry in v1. (2) Security — auth: assunto endpoint non protetti in locale; documentato limite. (3) Completeness — fallback path assente: skip GET. (4) Consistency — health non cambia DeploymentState. (5) Observation — solo 2xx = healthy. **Nessun comando**: check solo automatico allo start e al refresh.
