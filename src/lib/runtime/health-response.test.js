import assert from "node:assert/strict";
import test from "node:test";
import {
  beginApplicationDraining,
  isApplicationDraining,
} from "./application-draining.ts";
import { createHealthResponse } from "./health-response.ts";

test("health response becomes unavailable before checking the database while draining", async () => {
  let validationCalls = 0;
  let databaseCalls = 0;
  assert.equal(isApplicationDraining(), false);
  beginApplicationDraining();

  const response = await createHealthResponse(
    new Request("http://localhost:3000/api/health"),
    {
      isDatabaseHealthy: async () => {
        databaseCalls += 1;
        return true;
      },
      validateRuntimeConfiguration: () => {
        validationCalls += 1;
      },
    },
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { status: "unavailable" });
  assert.equal(validationCalls, 0);
  assert.equal(databaseCalls, 0);
});

test("health response preserves the database readiness contract", async () => {
  const healthyResponse = await createHealthResponse(
    new Request("http://localhost:3000/api/health"),
    {
      isApplicationDraining: () => false,
      isDatabaseHealthy: async () => true,
      validateRuntimeConfiguration: () => undefined,
    },
  );
  assert.equal(healthyResponse.status, 200);
  assert.equal(healthyResponse.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await healthyResponse.json(), { status: "ok" });

  const unavailableResponse = await createHealthResponse(
    new Request("http://localhost:3000/api/health"),
    {
      isApplicationDraining: () => false,
      isDatabaseHealthy: async () => true,
      validateRuntimeConfiguration: () => {
        throw new Error("invalid runtime configuration");
      },
    },
  );
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), {
    status: "unavailable",
  });
});
