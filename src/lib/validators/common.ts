import { z } from "zod";

// PostgreSQL UUID comparison is case-insensitive while HMAC/rate-limit scopes
// are byte-sensitive. Always return the canonical lowercase representation so
// alternate hex casing cannot create a second security identity.
export const uuidParamSchema = z.string().uuid().transform((value) => value.toLowerCase());
