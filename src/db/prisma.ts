import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;

export const prisma = new PrismaClient(
  databaseUrl
    ? {
        datasources: {
          db: {
            url: databaseUrl,
          },
        },
      }
    : undefined
);
