import { execSync } from "child_process";

// 1. Fallback: If deployed on Railway with MySQL plugin, MYSQL_URL is often provided
if (!process.env.DATABASE_URL && process.env.MYSQL_URL) {
  process.env.DATABASE_URL = process.env.MYSQL_URL;
  console.log("ℹ️  Using MYSQL_URL as DATABASE_URL for Railway deployment.");
}

// 2. Automatically push schema to database if DATABASE_URL is configured
if (process.env.DATABASE_URL) {
  console.log("🔄 Synchronizing Prisma schema with Railway MySQL Database...");
  try {
    execSync("npx prisma db push --skip-generate", {
      stdio: "inherit",
      env: process.env,
    });
    console.log("✅ Database schema synchronized successfully.");
  } catch (error) {
    console.warn("⚠️  Prisma db push encountered an issue, proceeding to start server anyway.");
  }
} else {
  console.warn("⚠️  No DATABASE_URL or MYSQL_URL found in environment variables. Please configure your Database on Railway.");
}

// 3. Start Express Application
console.log("🚀 Starting Smart Lunch Delivery backend server...");
await import("../dist/index.js");
