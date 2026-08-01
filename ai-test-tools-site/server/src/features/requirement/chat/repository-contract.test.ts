import { describe, expect, it, beforeEach } from "vitest";
import {
  type ChatRepository,
  MAX_MESSAGES_PER_SESSION,
  MAX_SESSION_FILES_PER_SESSION,
  MAX_LIBRARY_FILES,
} from "./types.js";
import { MemoryChatRepository } from "./repository.js";
import { MysqlChatRepository } from "./mysql-repository.js";

export function runContractTests(
  name: string,
  factory: () => ChatRepository | Promise<ChatRepository>,
): void {
  describe(`ChatRepository contract (${name})`, () => {
    let repo: ChatRepository;

    beforeEach(async () => {
      repo = await factory();
    });

    describe("会话 CRUD", () => {
      it("createSession 生成 sess_ 前缀 id 并记录时间", async () => {
        const session = await repo.createSession({
          title: "需求",
          agentTemplate: "mindmap",
        });
        expect(session.id.startsWith("sess_")).toBe(true);
        expect(session.title).toBe("需求");
        expect(session.agentTemplate).toBe("mindmap");
        expect(session.createdAt).toBeInstanceOf(Date);
        expect(session.updatedAt).toBeInstanceOf(Date);
      });

      it("listSessions 按 updated_at 倒序并限制条数", async () => {
        const s1 = await repo.createSession({
          title: "A",
          agentTemplate: "mindmap",
        });
        await new Promise((r) => setTimeout(r, 5));
        const s2 = await repo.createSession({
          title: "B",
          agentTemplate: "cause-effect",
        });
        await new Promise((r) => setTimeout(r, 5));
        const s3 = await repo.createSession({
          title: "C",
          agentTemplate: "decision-table",
        });

        const all = await repo.listSessions(50);
        expect(all.map((s) => s.id)).toEqual([s3.id, s2.id, s1.id]);

        const limited = await repo.listSessions(2);
        expect(limited).toHaveLength(2);
        expect(limited[0].id).toBe(s3.id);
        expect(limited[1].id).toBe(s2.id);
      });

      it("getSession 可读取已创建会话，不存在返回 null", async () => {
        const session = await repo.createSession({
          title: "T",
          agentTemplate: "orthogonal",
        });
        const found = await repo.getSession(session.id);
        expect(found?.id).toBe(session.id);
        expect(await repo.getSession("sess_missing")).toBeNull();
      });

      it("renameSession 更新标题并返回更新后对象", async () => {
        const session = await repo.createSession({
          title: "旧",
          agentTemplate: "mindmap",
        });
        await new Promise((r) => setTimeout(r, 5));
        const updated = await repo.renameSession(session.id, "新");
        expect(updated.title).toBe("新");
        expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
          session.updatedAt.getTime(),
        );

        const fromList = await repo.listSessions(1);
        expect(fromList[0].title).toBe("新");
      });

      it("renameSession 不存在时抛错", async () => {
        await expect(repo.renameSession("sess_missing", "X")).rejects.toThrow();
      });
    });

    describe("消息", () => {
      it("createMessage 追加 msg_ 前缀消息", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "user",
          content: "hello",
          status: "done",
        });
        expect(msg.id.startsWith("msg_")).toBe(true);
        expect(msg.sessionId).toBe(session.id);
        expect(msg.reasoning).toBeNull();
      });

      it("listMessages 按 created_at 升序", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const m1 = await repo.createMessage({
          sessionId: session.id,
          role: "user",
          content: "1",
          status: "done",
        });
        await new Promise((r) => setTimeout(r, 5));
        const m2 = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "2",
          status: "streaming",
        });
        await new Promise((r) => setTimeout(r, 5));
        const m3 = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "3",
          status: "done",
        });

        const list = await repo.listMessages(session.id);
        expect(list.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
      });

      it("createMessage 不存在会话时抛错", async () => {
        await expect(
          repo.createMessage({
            sessionId: "sess_missing",
            role: "user",
            content: "x",
            status: "done",
          }),
        ).rejects.toThrow();
      });

      it("updateMessageStatus 切换状态", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "...",
          status: "streaming",
        });
        const updated = await repo.updateMessageStatus(msg.id, "done");
        expect(updated.status).toBe("done");
      });

      it("updateMessageStatus 不存在时抛错", async () => {
        await expect(
          repo.updateMessageStatus("msg_missing", "done"),
        ).rejects.toThrow();
      });

      it("消息达到上限时抛错", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        for (let i = 0; i < MAX_MESSAGES_PER_SESSION; i += 1) {
          await repo.createMessage({
            sessionId: session.id,
            role: "user",
            content: String(i),
            status: "done",
          });
        }
        await expect(
          repo.createMessage({
            sessionId: session.id,
            role: "user",
            content: "overflow",
            status: "done",
          }),
        ).rejects.toThrow(/上限|200|limit|exceeded/i);
      });
    });

    describe("会话文件", () => {
      it("createSessionFile 生成 sf_ 前缀文件", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        const file = await repo.createSessionFile({
          sessionId: session.id,
          messageId: msg.id,
          kind: "mindmap",
          title: "思维导图",
          payload: { tree: { id: "1", title: "根", children: [] } },
        });
        expect(file.id.startsWith("sf_")).toBe(true);
        expect(file.sessionId).toBe(session.id);
        expect(file.messageId).toBe(msg.id);
        expect(file.savedToLibrary).toBe(false);
      });

      it("getSessionFile 可读取文件", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        const file = await repo.createSessionFile({
          sessionId: session.id,
          messageId: msg.id,
          kind: "flowchart",
          title: "流程图",
          payload: { nodes: [] },
        });
        const found = await repo.getSessionFile(file.id);
        expect(found?.id).toBe(file.id);
        expect(await repo.getSessionFile("sf_missing")).toBeNull();
      });

      it("updateSessionFileBoard 写回 board 并更新 updatedAt", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        const file = await repo.createSessionFile({
          sessionId: session.id,
          messageId: msg.id,
          kind: "mindmap",
          title: "M",
          payload: { board: { a: 1 } },
        });
        await new Promise((r) => setTimeout(r, 5));
        const updated = await repo.updateSessionFileBoard(file.id, { a: 2 });
        expect(updated.payload).toEqual({ a: 2 });
        expect(updated.updatedAt.getTime()).toBeGreaterThan(
          file.updatedAt.getTime(),
        );
      });

      it("countSessionFiles 统计会话内文件数", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        expect(await repo.countSessionFiles(session.id)).toBe(0);
        await repo.createSessionFile({
          sessionId: session.id,
          messageId: msg.id,
          kind: "mindmap",
          title: "1",
          payload: {},
        });
        expect(await repo.countSessionFiles(session.id)).toBe(1);
      });

      it("会话文件达到上限时抛错", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        for (let i = 0; i < MAX_SESSION_FILES_PER_SESSION; i += 1) {
          await repo.createSessionFile({
            sessionId: session.id,
            messageId: msg.id,
            kind: "mindmap",
            title: String(i),
            payload: {},
          });
        }
        await expect(
          repo.createSessionFile({
            sessionId: session.id,
            messageId: msg.id,
            kind: "mindmap",
            title: "overflow",
            payload: {},
          }),
        ).rejects.toThrow(/上限|30|limit|exceeded/i);
      });
    });

    describe("文件库", () => {
      it("修改库文件不影响源会话文件", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        const source = await repo.createSessionFile({
          sessionId: session.id,
          messageId: msg.id,
          kind: "mindmap",
          title: "源",
          payload: { tree: { id: "1", title: "根", children: [] } },
        });
        const library = await repo.createLibraryFile(source);
        (library.payload as { tree: { title: string } }).tree.title = "库已改";

        const reloadedLibrary = await repo.getLibraryFile(library.id);
        expect(
          (reloadedLibrary?.payload as { tree: { title: string } }).tree.title,
        ).toBe("根");

        const reloadedSource = await repo.getSessionFile(source.id);
        expect(
          (reloadedSource?.payload as { tree: { title: string } }).tree.title,
        ).toBe("根");
      });

      it("createLibraryFile 从 SessionFile 深拷贝快照", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        const source = await repo.createSessionFile({
          sessionId: session.id,
          messageId: msg.id,
          kind: "mindmap",
          title: "源",
          payload: { tree: { id: "1", title: "根", children: [] } },
        });
        const library = await repo.createLibraryFile(source);
        expect(library.id.startsWith("lf_")).toBe(true);
        expect(library.title).toBe(source.title);
        expect(library.kind).toBe(source.kind);
        expect(library.sourceSessionTitle).toBe(session.title);
        expect(library.payload).toEqual(source.payload);
        // 深拷贝：修改源不应影响库副本
        (source.payload as { tree: { title: string } }).tree.title = "被改";
        const reloaded = await repo.getLibraryFile(library.id);
        expect((reloaded?.payload as { tree: { title: string } }).tree.title).toBe(
          "根",
        );
      });

      it("markSavedToLibrary 幂等并标记源文件", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        const source = await repo.createSessionFile({
          sessionId: session.id,
          messageId: msg.id,
          kind: "mindmap",
          title: "源",
          payload: {},
        });
        const first = await repo.markSavedToLibrary(source.id);
        expect(first.savedToLibrary).toBe(true);
        const second = await repo.markSavedToLibrary(source.id);
        expect(second.savedToLibrary).toBe(true);
        expect(second.id).toBe(first.id);
      });

      it("countLibraryFiles 与 listLibraryFiles 一致", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        const source = await repo.createSessionFile({
          sessionId: session.id,
          messageId: msg.id,
          kind: "mindmap",
          title: "源",
          payload: {},
        });
        await repo.createLibraryFile(source);
        expect(await repo.countLibraryFiles()).toBe(1);
        expect(await repo.listLibraryFiles()).toHaveLength(1);
      });

      it("文件库达到上限时抛错", async () => {
        // 每会话文件上限 30，要生成 500 份库文件需跨多个会话
        const filesPerSession = MAX_SESSION_FILES_PER_SESSION;
        const sessionsNeeded = Math.ceil(MAX_LIBRARY_FILES / filesPerSession);
        for (let s = 0; s < sessionsNeeded; s += 1) {
          const session = await repo.createSession({
            title: `S${s}`,
            agentTemplate: "mindmap",
          });
          const msg = await repo.createMessage({
            sessionId: session.id,
            role: "assistant",
            content: "x",
            status: "done",
          });
          const remaining = MAX_LIBRARY_FILES - (await repo.countLibraryFiles());
          const count = Math.min(filesPerSession, remaining);
          for (let i = 0; i < count; i += 1) {
            const source = await repo.createSessionFile({
              sessionId: session.id,
              messageId: msg.id,
              kind: "mindmap",
              title: `${s}-${i}`,
              payload: {},
            });
            await repo.createLibraryFile(source);
          }
        }
        expect(await repo.countLibraryFiles()).toBe(MAX_LIBRARY_FILES);

        const extraSession = await repo.createSession({
          title: "Extra",
          agentTemplate: "mindmap",
        });
        const extraMsg = await repo.createMessage({
          sessionId: extraSession.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        const overflow = await repo.createSessionFile({
          sessionId: extraSession.id,
          messageId: extraMsg.id,
          kind: "mindmap",
          title: "overflow",
          payload: {},
        });
        await expect(repo.createLibraryFile(overflow)).rejects.toThrow(
          /上限|500|limit|exceeded/i,
        );
      });
    });

    describe("级联删除", () => {
      it("deleteSession 级联删除消息与会话文件，但不删文件库", async () => {
        const session = await repo.createSession({
          title: "S",
          agentTemplate: "mindmap",
        });
        const msg = await repo.createMessage({
          sessionId: session.id,
          role: "assistant",
          content: "x",
          status: "done",
        });
        const source = await repo.createSessionFile({
          sessionId: session.id,
          messageId: msg.id,
          kind: "mindmap",
          title: "源",
          payload: {},
        });
        const library = await repo.createLibraryFile(source);

        await repo.deleteSession(session.id);

        expect(await repo.getSession(session.id)).toBeNull();
        expect(await repo.listMessages(session.id)).toHaveLength(0);
        expect(await repo.getSessionFile(source.id)).toBeNull();
        expect(await repo.countSessionFiles(session.id)).toBe(0);
        expect(await repo.getLibraryFile(library.id)).not.toBeNull();
        expect(await repo.countLibraryFiles()).toBe(1);
      });
    });
  });
}

describe("MemoryChatRepository contract", () => {
  runContractTests("memory", () => new MemoryChatRepository());
});

if (process.env.TEST_MYSQL === "1") {
  describe("MysqlChatRepository 契约", async () => {
    const { resolveChatDb } = await import("../db/pool.js");
    const handle = await resolveChatDb();
    if (!handle.pool) {
      throw new Error("TEST_MYSQL 已启用但无法连接 MySQL");
    }

    beforeEach(async () => {
      await handle.pool!.execute("DELETE FROM ra_session_files");
      await handle.pool!.execute("DELETE FROM ra_messages");
      await handle.pool!.execute("DELETE FROM ra_sessions");
      await handle.pool!.execute("DELETE FROM ra_library_files");
    });

    runContractTests("mysql", () => new MysqlChatRepository(handle.pool!));
  });
} else {
  describe.skip("MysqlChatRepository 契约", () => {});
}
