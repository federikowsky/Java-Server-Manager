export type ErrorSeverity = 'info' | 'warning' | 'error';

export enum ErrorCode {
  InvalidConfig = 'InvalidConfig',
  ValidationFailed = 'ValidationFailed',
  ConfigReadFailed = 'ConfigReadFailed',
  ConfigWriteFailed = 'ConfigWriteFailed',
  MigrationFailed = 'MigrationFailed',
  OperationInProgress = 'OperationInProgress',
  AlreadyRunning = 'AlreadyRunning',
  NotRunning = 'NotRunning',
  ProcessSpawnFailed = 'ProcessSpawnFailed',
  ProcessNotFound = 'ProcessNotFound',
  ProcessKillFailed = 'ProcessKillFailed',
  ScriptNotExecutable = 'ScriptNotExecutable',
  JavaNotFound = 'JavaNotFound',
  PortInUse = 'PortInUse',
  Timeout = 'Timeout',
  DeployFailed = 'DeployFailed',
  UndeployFailed = 'UndeployFailed',
  SourceNotFound = 'SourceNotFound',
  TargetNotWritable = 'TargetNotWritable',
  LogNotFound = 'LogNotFound',
  HookFailed = 'HookFailed',
  Cancelled = 'Cancelled',
  Unsupported = 'Unsupported',
  WorkspaceUntrusted = 'WorkspaceUntrusted',
  SecurityPolicyViolation = 'SecurityPolicyViolation',
  Unknown = 'Unknown',
}

/** Whether the error code is retryable. */
export function isRetryable(code: ErrorCode): boolean {
  return code !== ErrorCode.Unsupported;
}

/** Default severity for each error code. */
const DEFAULT_SEVERITY: Record<ErrorCode, ErrorSeverity> = {
  [ErrorCode.InvalidConfig]: 'error',
  [ErrorCode.ValidationFailed]: 'error',
  [ErrorCode.ConfigReadFailed]: 'error',
  [ErrorCode.ConfigWriteFailed]: 'error',
  [ErrorCode.MigrationFailed]: 'error',
  [ErrorCode.OperationInProgress]: 'info',
  [ErrorCode.AlreadyRunning]: 'info',
  [ErrorCode.NotRunning]: 'info',
  [ErrorCode.ProcessSpawnFailed]: 'error',
  [ErrorCode.ProcessNotFound]: 'warning',
  [ErrorCode.ProcessKillFailed]: 'error',
  [ErrorCode.ScriptNotExecutable]: 'error',
  [ErrorCode.JavaNotFound]: 'error',
  [ErrorCode.PortInUse]: 'error',
  [ErrorCode.Timeout]: 'warning',
  [ErrorCode.DeployFailed]: 'error',
  [ErrorCode.UndeployFailed]: 'warning',
  [ErrorCode.SourceNotFound]: 'error',
  [ErrorCode.TargetNotWritable]: 'error',
  [ErrorCode.LogNotFound]: 'info',
  [ErrorCode.HookFailed]: 'warning',
  [ErrorCode.Cancelled]: 'info',
  [ErrorCode.Unsupported]: 'error',
  [ErrorCode.WorkspaceUntrusted]: 'warning',
  [ErrorCode.SecurityPolicyViolation]: 'error',
  [ErrorCode.Unknown]: 'error',
};

export function defaultSeverity(code: ErrorCode): ErrorSeverity {
  return DEFAULT_SEVERITY[code];
}
