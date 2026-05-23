type E2eTestContext = {
  timeout(timeoutMs: number): void;
};

declare function suite(title: string, run: (this: E2eTestContext) => void | Promise<void>): void;
declare function test(title: string, run: (this: E2eTestContext) => void | Promise<void>): void;
