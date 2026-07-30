import { describe, expect, it, vi } from "vitest";
import { loadDbConfig, loadDotEnv } from "./config.js";
import { resolveChatDb, initSchema } from "./pool.js";
import { createPool } from "mysql2/promise";

type Pool = import("mysql2/promise").Pool;

vi.mock("./config.js", async () => {
  const actual = await vi.importActual<typeof import("./config.js")>("./config.js");
  return {
    ...actual,
    loadDotEnv: vi.fn(),
  };
});

vi.mock("mysql2/promise", async () => {
  return {
    createPool: vi.fn(),
  };
});

function makeFakePool() {
  return {
    query: vi.fn(),
    getConnection: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

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

describe("resolveChatDb", () => {
  it("createPool 抛错时降级为 memory 且不抛出", async () => {
    vi.mocked(createPool).mockRejectedValueOnce(new Error("connection refused"));
    const handle = await resolveChatDb();
    expect(handle.pool).toBeNull();
    expect(handle.mode).toBe("memory");
  });

  it("query 成功但 initSchema 抛错时关闭连接池并降级为 memory", async () => {
    const fakePool = makeFakePool();
    fakePool.query.mockResolvedValue([[], []]);
    fakePool.getConnection.mockRejectedValue(new Error("syntax error"));
    vi.mocked(createPool).mockReturnValueOnce(fakePool as unknown as Pool);
    const handle = await resolveChatDb();
    expect(fakePool.query).toHaveBeenCalledWith("SELECT 1");
    expect(fakePool.getConnection).toHaveBeenCalled();
    expect(handle.pool).toBeNull();
    expect(handle.mode).toBe("memory");
    expect(fakePool.end).toHaveBeenCalledOnce();
  });
});

describe("initSchema", () => {
  it("执行所有建表语句并在完成后释放连接", async () => {
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue([[], []]);
    const connection = { query, release };
    const pool = {
      getConnection: vi.fn().mockResolvedValue(connection),
    };
    await initSchema(pool as unknown as Pool);
    expect(query).toHaveBeenCalledTimes(6);
    expect(release).toHaveBeenCalledOnce();
  });
});
