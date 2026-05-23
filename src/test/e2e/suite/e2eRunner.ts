import { readdir } from 'node:fs/promises';
import path from 'node:path';

type E2eContext = {
  timeout: (timeoutMs: number) => void;
};

type E2eCallback = (this: E2eContext) => void | Promise<void>;

export type E2eRunnerOptions = {
  suiteDir: string;
  pattern: RegExp;
  timeoutMs: number;
};

type RegisteredTest = {
  title: string;
  run: E2eCallback;
};

type GlobalWithE2e = typeof globalThis & {
  suite?: (title: string, run: E2eCallback) => void;
  test?: (title: string, run: E2eCallback) => void;
};

async function collectMatchingFiles(root: string, pattern: RegExp): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const matches = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return collectMatchingFiles(entryPath, pattern);
    }
    return pattern.test(path.relative(root, entryPath)) ? [entryPath] : [];
  }));

  return matches.flat().sort((a, b) => a.localeCompare(b));
}

async function runWithTimeout(test: RegisteredTest, defaultTimeoutMs: number): Promise<void> {
  let timeoutMs = defaultTimeoutMs;
  const context: E2eContext = {
    timeout(nextTimeoutMs) {
      if (Number.isFinite(nextTimeoutMs) && nextTimeoutMs > 0) {
        timeoutMs = nextTimeoutMs;
      }
    },
  };

  const execution = test.run.call(context);
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve(execution),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function runE2eSuite(options: E2eRunnerOptions): Promise<void> {
  const files = await collectMatchingFiles(options.suiteDir, options.pattern);
  if (files.length === 0) {
    throw new Error(`No E2E files matched ${options.pattern} in ${options.suiteDir}`);
  }

  const globalObject = globalThis as GlobalWithE2e;
  const previousSuite = globalObject.suite;
  const previousTest = globalObject.test;
  const suiteStack: string[] = [];
  const tests: RegisteredTest[] = [];

  globalObject.suite = (title, run) => {
    suiteStack.push(title);
    try {
      run.call({ timeout: () => undefined });
    } finally {
      suiteStack.pop();
    }
  };
  globalObject.test = (title, run) => {
    tests.push({
      title: [...suiteStack, title].join(' > '),
      run,
    });
  };

  try {
    for (const file of files) {
      await import(file);
    }

    if (tests.length === 0) {
      throw new Error(`No E2E tests were registered from ${files.length} file(s).`);
    }

    for (const registeredTest of tests) {
      try {
        await runWithTimeout(registeredTest, options.timeoutMs);
        console.log(`ok ${registeredTest.title}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${registeredTest.title}: ${message}`);
      }
    }
  } finally {
    if (previousSuite) {
      globalObject.suite = previousSuite;
    } else {
      Reflect.deleteProperty(globalObject, 'suite');
    }

    if (previousTest) {
      globalObject.test = previousTest;
    } else {
      Reflect.deleteProperty(globalObject, 'test');
    }
  }
}
