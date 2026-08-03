import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Commands that only generate the client do not need a live database.
    // Commands that connect to PostgreSQL receive DATABASE_URL from the caller.
    url:
      process.env.DATABASE_URL ??
      "postgresql://prisma:prisma@127.0.0.1:5432/prisma?schema=public",
  },
});
