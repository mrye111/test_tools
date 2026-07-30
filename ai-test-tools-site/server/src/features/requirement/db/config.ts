import fs from "fs";
import path from "path";

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function loadDbConfig(env: NodeJS.ProcessEnv): DbConfig {
  return {
    host: env.MYSQL_HOST || "127.0.0.1",
    port: parseInt(env.MYSQL_PORT || "3306", 10),
    user: env.MYSQL_USER || "root",
    password: env.MYSQL_PASSWORD || "123456",
    database: env.MYSQL_DATABASE || "ai_test_tools",
  };
}

export function loadDotEnv(): void {
  const root = process.cwd();
  const envPath = path.join(root, "server", ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}
