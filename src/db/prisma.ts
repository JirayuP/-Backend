import { PrismaClient } from "@prisma/client";

const rawUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;

let databaseUrl = rawUrl;
if (databaseUrl && !databaseUrl.includes("connection_limit")) {
  const separator = databaseUrl.includes("?") ? "&" : "?";
  databaseUrl = `${databaseUrl}${separator}connection_limit=10&pool_timeout=30&connect_timeout=30`;
}

const basePrisma = new PrismaClient(
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

// Prisma Client พร้อมระบบ Auto-retry หาก Cloud MySQL หลุดการเชื่อมต่อ (Server has closed the connection)
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ operation, model, args, query }) {
        try {
          return await query(args);
        } catch (error: any) {
          if (
            error.code === "P1017" ||
            error.message?.includes("closed the connection")
          ) {
            console.warn(
              `⚠️ [Prisma Auto-Retry] Reconnecting and retrying ${model}.${operation}...`
            );
            return await query(args);
          }
          throw error;
        }
      },
    },
  },
}) as unknown as PrismaClient;
