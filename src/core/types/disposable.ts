/**
 * A resource that can release its underlying handle.
 * Matches the VS Code Disposable contract so adapters pass through directly.
 */
export interface Disposable {
  dispose(): void;
}
