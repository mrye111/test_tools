import { describe, expect, it } from "vitest";
import { loadDbConfig, loadDotEnv } from "./config.js";

describe("loadDbConfig", () => {
  it("环境变量缺失时使用默认值", () => {
    const config = loadDbConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3306);
    expect(config.user).toBe("root");
    expect(config.password).toBe("123456");
    expect(config.database).toBe("ai_test_tools");
  });

  it("读取显式环境变量", () => {
    const env = {
      MYSQL_HOST: "mysql.example.com",
      MYSQL_PORT: "3307",
      MYSQL_USER: "app",
      MYSQL_PASSWORD: "secret",
      MYSQL_DATABASE: "db",
    };
    const config = loadDbConfig(env);
    expect(config.host).toBe("mysql.example.com");
    expect(config.port).toBe(3307);
    expect(config.user).toBe("app");
    expect(config.password).toBe("secret");
    expect(config.database).toBe("db");
  });

  it("部分缺失补齐默认端口", () => {
    const config = loadDbConfig({ MYSQL_USER: "root", MYSQL_PASSWORD: "x" });
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3306);
    expect(config.database).toBe("ai_test_tools");
  });
});

describe("loadDotEnv", () => {
  it("不会覆盖已有环境变量", () => {
    const original = process.env.MYSQL_USER;
    process.env.MYSQL_USER = "already-set";
    loadDotEnv();
    expect(process.env.MYSQL_USER).toBe("already-set");
    if (original === undefined) {
      delete process.env.MYSQL_USER;
    } else {
      process.env.MYSQL_USER = original;
    }
  });
});
