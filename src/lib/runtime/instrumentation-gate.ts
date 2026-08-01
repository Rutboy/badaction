export const shouldStartApplicationLifecycle = (
  runtime: string | undefined,
  phase?: string,
): boolean => runtime === "nodejs" && phase !== "phase-production-build";
