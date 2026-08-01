import { createLegacyOwnerClaimInvitation } from "../src/lib/access/acl-service.ts";
import { getCanonicalAppOrigin } from "../src/lib/http/app-origin.ts";
import { validateRuntimeConfiguration } from "../src/lib/http/runtime-config.ts";
import { prisma } from "../src/lib/prisma/client.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const [boardId, ...extraArguments] = process.argv.slice(2);

if (!boardId || extraArguments.length > 0 || !UUID_PATTERN.test(boardId)) {
  console.error("Usage: npm run access:claim-owner -- <boardId>");
  process.exitCode = 1;
} else {
  try {
    // Validate all output configuration before mutating invitation state. A
    // malformed or missing production origin must not revoke a prior claim and
    // then make the replacement credential impossible to deliver.
    const operatorEnv = { ...process.env, NODE_ENV: "production" };
    validateRuntimeConfiguration("http://localhost:3000", operatorEnv);
    const canonicalOrigin = getCanonicalAppOrigin("http://localhost:3000", operatorEnv);
    const invitation = await createLegacyOwnerClaimInvitation(boardId, { env: operatorEnv });
    const joinUrl = new URL(`/join#${invitation.token}`, canonicalOrigin);
    console.log(`Owner claim expires at ${invitation.expiresAt.toISOString()}`);
    console.log(joinUrl.toString());
    console.warn("Treat this one-time URL as a credential; send it to the verified owner out of band.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to issue owner claim");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
