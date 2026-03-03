import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  dialect: "mysql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    host: "gateway01.us-east-1.prod.aws.tidbcloud.com",
    port: 4000,
    user: "4GQrqqS38iHMD7f.root",
    password: "CqLDmzimj6asMiOj",
    database: "test",
    ssl: {
      rejectUnauthorized: true
    }
  },
});
