import { describe, expect, it, beforeEach } from "vitest";

/**
 * sanitizeLegacyErrorMessages 依赖真实 MySQL 连接，默认跳过；
 * 本地验证时以 TEST_MYSQL=1 开启（与 repository-contract 测试同一约定）。
 */
if (process.env.TEST_MYSQL === "1") {
  // 真库测试一律指向独立测试库，避免清空开发库数据
  process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE || "ai_test_tools_test";
  describe("sanitizeLegacyErrorMessages", async () => {
    const { resolveChatDb } = await import("../db/pool.js");
    const { sanitizeLegacyErrorMessages } = await import("./migrate.js");
    const { MysqlChatRepository } = await import("./mysql-repository.js");

    const handle = await resolveChatDb();
    if (!handle.pool) {
      throw new Error("TEST_MYSQL 已启用但无法连接 MySQL");
    }
    const pool = handle.pool;

    beforeEach(async () => {
      await pool.execute("DELETE FROM ra_session_files");
      await pool.execute("DELETE FROM ra_messages");
      await pool.execute("DELETE FROM ra_sessions");
      await pool.execute("DELETE FROM ra_library_files");
    });

    it("将旧格式脏错误消息改写为归一化友好文案", async () => {
      const repo = new MysqlChatRepository(pool);
      const session = await repo.createSession({ title: "S", agentTemplate: "mindmap" });
      await repo.createMessage({
        sessionId: session.id,
        role: "assistant",
        content:
          '处理失败：AI request failed: HTTP 400 {"error":{"code":"InvalidSubscription","message":"Your account (1) does not have a valid CodingPlan subscription, or your subscription has expired.","type":"Bad Request"}}',
        status: "error",
      });
      await repo.createMessage({
        sessionId: session.id,
        role: "assistant",
        content: "处理失败：网络异常",
        status: "error",
      });

      const cleaned = await sanitizeLegacyErrorMessages(pool);

      expect(cleaned).toBe(2);
      const messages = await repo.listMessages(session.id);
      expect(messages[0].content).toBe("模型服务订阅无效或已过期，请到供应商控制台检查订阅或续费状态后重试。");
      // 已是中文的消息直通保持不变
      expect(messages[1].content).toBe("网络异常");
    });

    it("无脏数据时返回 0", async () => {
      expect(await sanitizeLegacyErrorMessages(pool)).toBe(0);
    });
  });
} else {
  describe.skip("sanitizeLegacyErrorMessages（需 TEST_MYSQL=1）", () => {});
}
