import { describe, expect, it } from "vitest";
import { normalizeErrorMessage } from "./error-message.js";

describe("normalizeErrorMessage（服务端错误文案归一化）", () => {
  it("InvalidSubscription 订阅错误映射为续费指引", () => {
    const raw = 'AI request failed: HTTP 400 {"error":{"code":"InvalidSubscription","message":"Your account (123) does not have a valid CodingPlan subscription, or your subscription has expired.","type":"Bad Request"}}';
    expect(normalizeErrorMessage(raw)).toBe("模型服务订阅无效或已过期，请到供应商控制台检查订阅或续费状态后重试。");
  });

  it("AI 401 映射为认证失败指引", () => {
    expect(normalizeErrorMessage("AI request failed: HTTP 401 unauthorized")).toBe(
      "模型服务认证失败，请检查 API Key 或权限配置后重试。",
    );
  });

  it("额度不足映射", () => {
    expect(normalizeErrorMessage("Error: insufficient user quota")).toBe("模型服务额度不足，请充值或调整配额后重试。");
  });

  it("模型不存在映射", () => {
    expect(normalizeErrorMessage("The model gpt-x does not exist")).toBe(
      "所选模型不存在或未开通，请到模型设置中切换可用模型后重试。",
    );
  });

  it("上下文超长映射", () => {
    expect(normalizeErrorMessage("maximum context length exceeded")).toBe(
      "输入内容超出模型上下文上限，请精简内容或分段后重试。",
    );
  });

  it("HTTP 500 映射为服务不可用", () => {
    expect(normalizeErrorMessage("HTTP 500 internal error")).toBe("服务暂时不可用，请稍后再试。");
  });

  it("网络错误映射", () => {
    expect(normalizeErrorMessage("fetch failed: connect ECONNREFUSED 127.0.0.1")).toBe(
      "无法连接到服务，请检查网络、接口地址或服务状态后重试。",
    );
  });

  it("中文未知消息直通（视为已友好）", () => {
    expect(normalizeErrorMessage("报告记录已达上限（200 条）")).toBe("报告记录已达上限（200 条）");
  });

  it("含中文的混合消息直通", () => {
    expect(normalizeErrorMessage("模型服务认证失败，请检查 API Key 后重试。")).toBe("模型服务认证失败，请检查 API Key 后重试。");
  });

  it("纯英文未知消息返回兜底", () => {
    expect(normalizeErrorMessage("some totally unknown failure")).toBe("操作失败，请稍后重试。");
  });

  it("自定义兜底文案生效", () => {
    expect(normalizeErrorMessage("weird raw", { fallbackMessage: "请求处理失败，请重试。" })).toBe("请求处理失败，请重试。");
  });

  it("Error 实例与非对象输入均可归一化", () => {
    expect(normalizeErrorMessage(new Error("HTTP 429 too many requests"))).toBe("请求过于频繁，请稍等片刻后再试。");
    expect(normalizeErrorMessage(null)).toBe("操作失败，请稍后重试。");
  });
});
