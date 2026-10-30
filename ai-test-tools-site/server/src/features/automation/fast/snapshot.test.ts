import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { takeSnapshot } from "./snapshot.js";

/** 真实 Chromium 下的快照集成测试（登录表单夹具：角色/命名/可见性/下拉选项展开）。 */

const FIXTURE = `data:text/html;charset=utf-8,<!DOCTYPE html><html><head><title>登录页</title></head><body style="margin:0">
  <h1>登录</h1>
  <form>
    <label for="u">账号</label>
    <input id="u" type="text" placeholder="请输入账号" style="position:absolute;left:100px;top:60px;width:200px;height:28px">
    <label for="p">密码</label>
    <input id="p" type="password" style="position:absolute;left:100px;top:100px;width:200px;height:28px">
    <select id="s" style="position:absolute;left:100px;top:140px;width:120px;height:26px">
      <option value="cn" selected>中文</option>
      <option value="en">English</option>
      <option value="disabled-one" disabled>禁用项</option>
    </select>
    <button id="login" style="position:absolute;left:100px;top:180px;width:80px;height:32px">登 录</button>
    <button id="hidden-btn" style="position:absolute;left:100px;top:220px;display:none">隐藏按钮</button>
    <a href="/help" style="position:absolute;left:100px;top:260px">帮助中心</a>
  </form>
</body></html>`;

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

describe("takeSnapshot（真实 Chromium）", () => {
  it("收集可见可交互元素：角色/命名/kind 正确，隐藏元素排除，密码框也纳入", async () => {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    await page.goto(FIXTURE);
    const snapshot = await takeSnapshot(page);
    await page.context().close();

    expect(snapshot.title).toBe("登录页");
    expect(snapshot.text).toContain("账号");

    const byName = new Map(snapshot.elements.map((el) => [el.name, el]));
    // 账号输入框：label 关联命名，fill kind，textbox 角色
    const username = byName.get("账号");
    expect(username).toBeDefined();
    expect(username?.kind).toBe("fill");
    expect(username?.role).toBe("textbox");
    // 密码框也在（safe 只排 file/hidden，密码框保留——真实执行需要填密码）
    const password = byName.get("密码");
    expect(password).toBeDefined();
    expect(password?.kind).toBe("fill");
    // 登录按钮：click kind，名字去空白
    const login = byName.get("登 录") ?? byName.get("登录");
    expect(login).toBeDefined();
    expect(login?.kind).toBe("click");
    expect(login?.role).toBe("button");
    // 隐藏按钮被排除
    expect(byName.get("隐藏按钮")).toBeUndefined();
    // 链接
    const help = byName.get("帮助中心");
    expect(help?.role).toBe("link");
    // 序号从 1 连续
    expect(snapshot.elements.map((el) => el.index)).toEqual(snapshot.elements.map((_, i) => i + 1));
  });

  it("select 展开候选选项（i:j 复合序号，禁用项排除），元素打上 data-at-fidx 标记", async () => {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
    await page.goto(FIXTURE);
    const snapshot = await takeSnapshot(page);

    const select = snapshot.elements.find((el) => el.kind === "select");
    expect(select).toBeDefined();
    expect(select?.role).toBe("combobox");
    expect(select?.value).toBe("中文");
    expect(select?.options?.map((o) => [o.index, o.label, o.value])).toEqual([
      [`${select!.index}:1`, "中文", "cn"],
      [`${select!.index}:2`, "English", "en"],
    ]);

    const marked = await page.evaluate(`document.querySelectorAll('[data-at-fidx]').length`);
    expect(marked).toBe(snapshot.elements.length);
    await page.context().close();
  });
});
