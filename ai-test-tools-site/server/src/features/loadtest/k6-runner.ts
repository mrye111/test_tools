/**
 * k6 进程执行器：拉起原生 k6 二进制运行脚本，行缓冲回调日志，支持优雅停止。
 * 二进制解析顺序：环境变量 K6_BIN → <serverCwd>/tools/k6/k6.exe → PATH 中的 k6。
 * （tools/ 内置二进制的由来见 docs/adr/0011-online-loadtest-k6-native.md）
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface K6RunSpec {
  runId: string;
  /** 脚本文件绝对路径 */
  scriptPath: string;
  /** 请求体文件绝对路径，无则 null（不设 PAYLOAD_FILE） */
  payloadPath: string | null;
  /** 注入进程的环境变量（TEST_ID / API_BASE / STAGES 等） */
  env: Record<string, string>;
  /** 工作目录（日志等产物落在这里） */
  workDir: string;
  prometheusUrl?: string;
}

export interface K6RunResult {
  /** 进程退出码；被 stop() 终止时为 -1 */
  exitCode: number;
}

export interface K6Runner {
  /** 启动执行，onLog 按行回调（stdout/stderr 合流），进程退出后 resolve */
  start(spec: K6RunSpec, onLog: (line: string) => void): Promise<K6RunResult>;
  /** 请求指定执行停止（先 SIGTERM 优雅收尾，超时后 SIGKILL） */
  stop(runId: string): void;
}

/** k6 二进制解析：K6_BIN → tools/k6/k6.exe（serverCwd 下）→ PATH */
export function resolveK6Binary(serverCwd: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.K6_BIN && existsSync(env.K6_BIN)) return env.K6_BIN;
  const bundled = resolve(serverCwd, "tools", "k6", "k6.exe");
  if (existsSync(bundled)) return bundled;
  return "k6";
}

/** k6 优雅停止宽限：SIGTERM 后超过该时长仍未退出则 SIGKILL */
const STOP_GRACE_MS = 15_000;

/** CLI-only settings are stored with the script so each execution snapshots them. */
export function parseK6CliOptions(script: string): string[] {
  const match = script.match(/^\s*\/\/ nexuskit-k6-args:([^\r\n]*)/);
  if (!match) return [];
  let args: unknown;
  try { args = JSON.parse(match[1]); } catch { throw new Error('k6 命令参数必须是 JSON 字符串数组'); }
  if (!Array.isArray(args) || args.length > 100 || args.some(arg => typeof arg !== 'string' || arg.length > 2048 || !/^--[a-z][a-z0-9-]*(?:=[^\r\n]*)?$/.test(arg))) {
    throw new Error('k6 命令参数必须使用 --参数=值 或 --参数 格式');
  }
  if (args.some(arg => /^--summary-export(?:=|$)/.test(arg) || /^--tag=testid=/.test(arg))) {
    throw new Error('摘要路径和 testid 标签由系统管理');
  }
  return args as string[];
}

export class ProcessK6Runner implements K6Runner {
  private children = new Map<string, ChildProcess>();

  constructor(private deps: { serverCwd: string }) {}

  start(spec: K6RunSpec, onLog: (line: string) => void): Promise<K6RunResult> {
    const k6 = resolveK6Binary(this.deps.serverCwd);
    const env: Record<string, string> = { ...process.env, ...spec.env } as Record<string, string>;
    if (spec.payloadPath) env.PAYLOAD_FILE = spec.payloadPath;
    env.TEST_ID = spec.runId;
    env.K6_NO_USAGE_REPORT = "true";

    return new Promise((resolvePromise, reject) => {
      let child: ChildProcess;
      try {
        const args = ["run", ...parseK6CliOptions(readFileSync(spec.scriptPath, 'utf8')), "--summary-export", resolve(spec.workDir, "summary.json")];
        if (spec.prometheusUrl) {
          args.push("-o", "experimental-prometheus-rw", "--tag", `testid=${spec.runId}`);
          env.K6_PROMETHEUS_RW_SERVER_URL = `${spec.prometheusUrl}/api/v1/write`;
          env.K6_PROMETHEUS_RW_TREND_STATS = "p(95),p(99),avg";
        }
        child = spawn(k6, [...args, spec.scriptPath], { cwd: spec.workDir, env });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.children.set(spec.runId, child);

      let buffer = "";
      const flushLines = (chunk: Buffer | string): void => {
        buffer += chunk.toString();
        let index = buffer.search(/[\r\n]/);
        while (index >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, "");
          buffer = buffer.slice(index + 1);
          if (line) onLog(line);
          index = buffer.search(/[\r\n]/);
        }
      };
      child.stdout?.on("data", flushLines);
      child.stderr?.on("data", flushLines);

      child.on("error", (error) => {
        this.children.delete(spec.runId);
        reject(error);
      });
      child.on("close", (code, signal) => {
        this.children.delete(spec.runId);
        const tail = buffer.replace(/\r$/, "");
        if (tail) onLog(tail);
        resolvePromise({ exitCode: code ?? (signal ? -1 : 1) });
      });
    });
  }

  stop(runId: string): void {
    const child = this.children.get(runId);
    if (!child) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, STOP_GRACE_MS);
    timer.unref?.();
  }
}
