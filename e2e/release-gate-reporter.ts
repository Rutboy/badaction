import type {
  FullResult,
  FullConfig,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

class ReleaseGateReporter implements Reporter {
  private testCount = 0;
  private readonly finalStatuses = new Map<string, TestResult["status"]>();

  onBegin(_config: FullConfig, suite: Suite) {
    this.finalStatuses.clear();
    this.testCount = suite.allTests().length;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.finalStatuses.set(test.id, result.status);
  }

  async onEnd(): Promise<{ status?: FullResult["status"] } | void> {
    if (process.argv.includes("--list")) {
      return;
    }

    const skippedCount = [...this.finalStatuses.values()].filter(
      (status) => status === "skipped",
    ).length;
    const missingCount = this.testCount - this.finalStatuses.size;

    if (this.testCount === 0 || skippedCount > 0 || missingCount > 0) {
      console.error(
        `Playwright release gate rejected the run: ${this.testCount} discovered, ${skippedCount} skipped, ${Math.max(missingCount, 0)} not executed.`,
      );
      return { status: "failed" };
    }
  }

  printsToStdio() {
    return false;
  }
}

export default ReleaseGateReporter;
