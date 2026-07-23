export const SWAGGER_CONTEXT_LIMIT = 80_000;
export const SWAGGER_CONTEXT_MARKER = "【Swagger/OpenAPI 文档】";

const HTTP_METHODS = new Set(["get", "post", "put", "delete", "patch", "head", "options", "trace"]);

export type SwaggerContextParts = {
  requirement: string;
  swagger: string;
};

// 前端组装 context 时以固定标记分隔需求描述和 Swagger 全文，这里按标记还原两段。
export function extractSwaggerContext(context: string): SwaggerContextParts | null {
  const markerIndex = context.indexOf(SWAGGER_CONTEXT_MARKER);
  if (markerIndex < 0) return null;
  const swagger = context.slice(markerIndex + SWAGGER_CONTEXT_MARKER.length).trim();
  if (!swagger) return null;
  return { requirement: context.slice(0, markerIndex).trim(), swagger };
}

export type SwaggerGroup = {
  name: string;
  endpoints: string[];
  document: string;
};

export type SwaggerSplitResult = {
  requirement: string;
  groups: SwaggerGroup[];
};

// 超限的 Swagger 文档自动拆分：只做顶层 JSON 解析，把 paths 按接口分组成 ≤ limit 的若干份，
// 每份还原成一份"瘦身文档"（保留 openapi/swagger/info，剥离 components 以控制体积）。
// 不展开 $ref、不保证理解语义——YAML 或残缺文档解析失败时返回 null，由调用方走单批次兜底。
export function splitSwaggerContext(context: string, limit = SWAGGER_CONTEXT_LIMIT): SwaggerSplitResult | null {
  if (context.length <= limit) return null;
  const parts = extractSwaggerContext(context);
  if (!parts) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(parts.swagger);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const doc = parsed as Record<string, unknown>;
  const paths = doc.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) return null;
  const entries = Object.entries(paths as Record<string, unknown>);
  if (entries.length < 2) return null;

  const base: Record<string, unknown> = {};
  for (const key of ["openapi", "swagger", "info"]) {
    if (doc[key] !== undefined) base[key] = doc[key];
  }
  const baseSize = JSON.stringify(base).length + 16;

  const rawGroups: Array<Array<[string, unknown]>> = [];
  let current: Array<[string, unknown]> = [];
  let currentSize = baseSize;
  for (const entry of entries) {
    const entrySize = JSON.stringify({ [entry[0]]: entry[1] }).length + 1;
    if (current.length > 0 && currentSize + entrySize > limit) {
      rawGroups.push(current);
      current = [];
      currentSize = baseSize;
    }
    current.push(entry);
    currentSize += entrySize;
  }
  if (current.length > 0) rawGroups.push(current);
  if (rawGroups.length <= 1) return null;

  return {
    requirement: parts.requirement,
    groups: rawGroups.map((group, index) => ({
      name: `接口分组 ${index + 1}/${rawGroups.length}`,
      endpoints: group.flatMap(([path, operations]) => {
        if (!operations || typeof operations !== "object") return [path];
        const methods = Object.keys(operations as Record<string, unknown>).filter((key) => HTTP_METHODS.has(key.toLowerCase()));
        return methods.length > 0 ? methods.map((method) => `${method.toUpperCase()} ${path}`) : [path];
      }),
      document: JSON.stringify({ ...base, paths: Object.fromEntries(group) }),
    })),
  };
}
