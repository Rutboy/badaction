import { shouldStartApplicationLifecycle } from "./lib/runtime/instrumentation-gate.ts";

export async function register(): Promise<void> {
  // NEXT_RUNTIME must be accessed directly in this module. Next.js replaces
  // this exact expression while compiling the instrumentation entry; passing
  // process.env through a helper leaves a runtime lookup that is undefined in
  // the standalone server.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (
      !shouldStartApplicationLifecycle(
        process.env.NEXT_RUNTIME,
        process.env.NEXT_PHASE,
      )
    ) {
      return;
    }

    const { startApplicationLifecycle } = await import(
      "./lib/runtime/application-lifecycle.ts"
    );
    startApplicationLifecycle();
  }
}
