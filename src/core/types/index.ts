// src/types/index.ts

import { ChildProcess } from 'child_process'; // Per ServerRuntimeInfo
import { FSWatcher } from 'chokidar'; // Per DeploymentRuntimeInfo

// 1.1. Tipi Dato di Base

/**
 * Stati possibili di un server.
 * 'stopped': Il server è fermo.
 * 'starting': Il server è in fase di avvio.
 * 'running': Il server è avviato e operativo.
 * 'stopping': Il server è in fase di arresto.
 * 'error': Il server è in uno stato di errore.
 */
export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

/**
 * Stati possibili di un deployment.
 * 'undeployed': Il deployment non è presente sul server (o è stato rimosso).
 * 'deploying': Il deployment è in corso.
 * 'synced': Il deployment è distribuito e sincronizzato.
 * 'error': Si è verificato un errore durante il deployment/sync.
 */
export type DeploymentState = 'undeployed' | 'deploying' | 'synced' | 'error';

/**
 * Tipi di server supportati.
 * 'tomcat': Apache Tomcat.
 * 'jetty': Eclipse Jetty.
 * 'jboss': JBoss/WildFly.
 * 'custom': Un tipo di server definito dall'utente o tramite plugin.
 */
export type ServerType = 'tomcat' | 'jetty' | 'jboss' | 'custom';

/**
 * Modalità di avvio del server.
 * 'run': Avvio normale.
 * 'debug': Avvio in modalità debug (abilita porta di debug).
 */
export type ServerStartMode = 'run' | 'debug';

/**
 * Interfaccia per errori personalizzati dell'estensione JSM.
 */
export interface JsmExtensionError extends Error {
  code: string; // Codice errore univoco (es: 'INVALID_CONFIG', 'PROCESS_NOT_FOUND')
  details?: any; // Dettagli aggiuntivi sull'errore
}

// 1.2. Modello Server
export interface ServerConfig {
  id: string; // UUID univoco per il server
  name: string; // Nome visualizzato del server
  type: ServerType; // Tipo di server (tomcat, jetty, ecc.)
  javaHome: string; // Path alla JDK da utilizzare per questo server
  serverHome: string; // Path alla directory root del server (es. CATALINA_HOME per Tomcat)
  host: string; // Hostname (default: 'localhost')
  port: number; // Porta principale del server (es. 8080)
  deployments: DeploymentConfig[]; // Array dei deployment associati a questo server
  state: ServerState; // Stato corrente del server (in-memory, ma può essere salvato come stato iniziale)
  pid?: number; // Process ID del server quando è in esecuzione
  autoSync: boolean; // Flag per la sincronizzazione automatica
  logPath?: string; // Path custom per i file di log del server (opzionale)
  envVars?: Record<string, string>; // Variabili d'ambiente custom per l'avvio del server
  vmArgs?: string; // Argomenti VM aggiuntivi (es. -Xmx512m)
  debugPort?: number; // Porta specifica per il debug (se diversa dalla porta principale o gestita diversamente)
  debugArgs?: string; // Argomenti specifici per la JVM in modalità debug
}

// 1.3. Modello Deployment
export interface DeploymentConfig {
  id: string; // UUID univoco per il deployment
  name: string; // Nome del deployment visualizzato nella UI (es. nome del file WAR o cartella)
  sourcePath: string; // Path al file WAR o alla cartella exploded sorgente
  targetPath: string; // Path di deployment relativo alla directory di deploy del server (es. 'webapps/myapp.war' o 'myapp')
  type: 'war' | 'exploded'; // Tipo di deployment
  state: DeploymentState; // Stato corrente del deployment
  isDirty?: boolean; // Indica se ci sono modifiche locali che necessitano di sync/deploy
  error?: string; // Messaggio di errore relativo a questo deployment
  contextPath?: string; // Il context path dell'applicazione (es. /myapp)
}

// 1.4. Template Server (Globale)
export interface ServerTemplate {
  id: string; // UUID univoco per il template
  name: string; // Nome del template (es. "Tomcat 9 Developer Default")
  type: ServerType; // Tipo di server a cui si applica questo template
  // Omit prende tutti i campi da ServerConfig, tranne 'id', 'state', 'deployments', 'pid', 'lastStarted', 'lastStopped', 'isDirty'
  // e li rende tutti opzionali (Partial)
  defaultConfig: Partial<Omit<ServerConfig, 'id' | 'state' | 'deployments' | 'pid' | 'isDirty' | 'name'>>;
  description?: string; // Descrizione del template
}

// 1.5. Stato Runtime In-Memoria (non persistito su disco direttamente in questa forma)
export interface ServerRuntimeInfo {
  pid: number; // Process ID del server
  process: ChildProcess; // Oggetto ChildProcess di Node.js
  state: ServerState; // Stato runtime effettivo
  mode: ServerStartMode; // Modalità con cui è stato avviato (run/debug)
  attachedDebugger?: boolean; // Indica se un debugger VSCode è collegato (per la modalità debug)
  deployments: Record<string, DeploymentRuntimeInfo>; // Stato runtime dei deployment associati (key: deploymentId)
  logStream?: NodeJS.ReadableStream; // Stream per i log del server (opzionale, se gestito centralmente)
  debugSessionName?: string; // Nome della sessione di debug VSCode
}

export interface DeploymentRuntimeInfo {
  state: DeploymentState; // Stato runtime effettivo del deployment
  watcher?: FSWatcher; // Istanza di Chokidar FSWatcher, se autoSync è true
  error?: string; // Eventuale errore runtime specifico del deployment
  lastAttemptedSync?: string; // Data ISO dell'ultimo tentativo di sync
}

// 1.6. Struttura Configurazione su Disco

/**
 * Struttura del file .vscode/servers.json (configurazione locale al progetto/workspace)
 */
export interface WorkspaceServersConfig {
  servers: ServerConfig[];
}

/**
 * Struttura del file globalStorage/jsm.servers.templates.json (template globali dell'utente)
 */
export interface GlobalServerTemplatesConfig {
  templates: ServerTemplate[];
}

// 1.8. Errori/Result Typing (per i risultati dei comandi e delle operazioni)
export interface CommandResult<T = void> { // T è void se non ci sono dati di ritorno specifici
  success: boolean;
  data?: T;
  error?: JsmExtensionError; // Usa l'errore custom definito sopra
}

// 1.9. Variabili/Costanti chiave
// È meglio definire queste costanti dove vengono usate o in un file `constants.ts` dedicato
// per evitare dipendenze cicliche se `types.ts` diventa troppo grande e altri moduli lo importano.
// Per ora, le lascio qui come riferimento al tuo piano originale.

export const JSM_SERVER_CONFIG_FILENAME = 'servers.json'; // Nome file configurazione locale
export const JSM_GLOBAL_TEMPLATES_FILENAME = 'servers.templates.json'; // Nome file template globali
export const JSM_LOG_CHANNEL_NAME = 'Java Server Manager (JSM)';

// I path specifici per i PID dipendono dal sistema operativo e dovrebbero essere gestiti dinamicamente.
// export const PID_DIR_UNIX = '/var/run/jsm'; // Esempio, potrebbe richiedere permessi elevati
// export const PID_DIR_WIN = '%TEMP%\\jsm'; // Esempio
export const JSM_PID_DIR_NAME = 'jsm_pids'; // Nome di una sottocartella nello storage dell'estensione o temp system

// Tipo per le opzioni di un QuickPick per selezionare un server
export interface ServerQuickPickItem {
    label: string;
    description?: string;
    detail?: string;
    id: string; // Server ID
}

// Tipo per le opzioni di un QuickPick per selezionare un template
export interface TemplateQuickPickItem {
    label: string;
    description?: string;
    detail?: string;
    id: string; // Template ID
}