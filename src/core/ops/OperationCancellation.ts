import type { CancellationToken } from '@core/types';
import type { Disposable } from '@core/types/disposable';
import { JsmError } from '@core/errors/JsmError';
import { ErrorCode } from '@core/errors/codes';

export interface CancellationTokenSource {
  readonly token: CancellationToken;
  cancel(): void;
}

export function createCancellationTokenSource(): CancellationTokenSource {
  let cancelled = false;
  const listeners = new Set<() => void>();

  const token: CancellationToken = {
    get isCancelled(): boolean {
      return cancelled;
    },
    onCancelled(callback: () => void): Disposable {
      if (cancelled) {
        callback();
        return { dispose: () => {} };
      }

      listeners.add(callback);
      return {
        dispose: () => {
          listeners.delete(callback);
        },
      };
    },
  };

  return {
    token,
    cancel(): void {
      if (cancelled) {
        return;
      }

      cancelled = true;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // Cancellation must stay best-effort and never throw to callers.
        }
      }
      listeners.clear();
    },
  };
}

export function cancellationError(message: string): JsmError {
  return new JsmError({
    code: ErrorCode.Cancelled,
    message,
  });
}

export function throwIfCancelled(token: CancellationToken, message: string): void {
  if (token.isCancelled) {
    throw cancellationError(message);
  }
}

export function cancellationPromise(token: CancellationToken, message: string): Promise<never> {
  if (token.isCancelled) {
    return Promise.reject(cancellationError(message));
  }

  return new Promise((_resolve, reject) => {
    const subscription = token.onCancelled(() => {
      subscription.dispose();
      reject(cancellationError(message));
    });
  });
}
