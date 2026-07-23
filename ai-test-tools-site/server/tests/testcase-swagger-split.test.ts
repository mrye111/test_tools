import { describe, expect, it } from "vitest";
import { SWAGGER_CONTEXT_MARKER, extractSwaggerContext, splitSwaggerContext } from "../src/features/testcase/swagger-split.js";

function makeDoc(pathCount: number, paddingLength: number) {
  const paths: Record<string, unknown> = {};
  for (let index = 0; index < pathCount; index += 1) {
    paths[`/api/v1/resource-${index}`] = {
      get: { summary: `查询资源 ${index}`, description: "描".repeat(paddingLength), responses: { 200: { description: "OK" } } },
      post: { summary: `创建资源 ${index}`, description: "述".repeat(paddingLength), responses: { 201: { description: "Created" } } },
    };
  }
  return JSON.stringify({ openapi: "3.0.0", info: { title: "测试服务", version: "1.0.0" }, paths, components: { schemas: { Big: { type: "object" } } } });
}

function buildContext(swagger: string, requirement = "订单中心接口需求") {
  return `${requirement}\n\n${SWAGGER_CONTEXT_MARKER}\n${swagger}`;
}

describe("extractSwaggerContext", () => {
  it("按标记拆分需求描述与 Swagger 全文", () => {
    const parts = extractSwaggerContext(buildContext('{"openapi":"3.0.0"}'));
    expect(parts?.requirement).toBe("订单中心接口需求");
    expect(parts?.swagger).toBe('{"openapi":"3.0.0"}');
  });

  it("无标记或标记后无内容时返回 null", () => {
    expect(extractSwaggerContext("普通需求描述")).toBeNull();
    expect(extractSwaggerContext(`需求\n${SWAGGER_CONTEXT_MARKER}\n  `)).toBeNull();
  });
});

describe("splitSwaggerContext", () => {
  it("未超限时不拆分", () => {
    expect(splitSwaggerContext(buildContext(makeDoc(2, 10)), 80_000)).toBeNull();
  });

  it("超限且为合法 OpenAPI JSON 时按接口分组", () => {
    const result = splitSwaggerContext(buildContext(makeDoc(6, 400)), 2_000);
    expect(result).not.toBeNull();
    expect(result!.requirement).toBe("订单中心接口需求");
    expect(result!.groups.length).toBeGreaterThan(1);

    const allEndpoints = result!.groups.flatMap((group) => group.endpoints);
    expect(allEndpoints).toContain("GET /api/v1/resource-0");
    expect(allEndpoints).toContain("POST /api/v1/resource-5");
    expect(allEndpoints).toHaveLength(12);

    for (const group of result!.groups) {
      expect(group.document.length).toBeLessThanOrEqual(2_100);
      const parsed = JSON.parse(group.document);
      expect(parsed.openapi).toBe("3.0.0");
      expect(parsed.paths).toBeTruthy();
      expect(parsed.components).toBeUndefined();
    }
  });

  it("超限但无法解析为 JSON（如 YAML）时返回 null", () => {
    const yaml = `openapi: 3.0.0\npaths:\n${"  /a:\n    get:\n      summary: x\n".repeat(200)}`;
    expect(splitSwaggerContext(buildContext(yaml), 2_000)).toBeNull();
  });

  it("超限但只有单个接口时无法拆分，返回 null", () => {
    expect(splitSwaggerContext(buildContext(makeDoc(1, 5_000)), 2_000)).toBeNull();
  });

  it("没有 Swagger 标记的超长普通需求不拆分", () => {
    expect(splitSwaggerContext("很长的需求".repeat(1_000), 2_000)).toBeNull();
  });
});
