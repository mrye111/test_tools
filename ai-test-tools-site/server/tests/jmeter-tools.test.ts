import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { JmeterMcpRuntime } from "../src/mcp-runtime.js";
import type { JsonObject } from "../src/jmx-serializer.js";

// ── Helpers ──

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "jmeter-tools-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

/** A runtime with a plan, one thread group and one HTTP sampler:
 *  /0 = TestPlan, /0/0 = ThreadGroup, /0/0/0 = HTTP sampler. */
function preppedRuntime(): { runtime: JmeterMcpRuntime; dir: string } {
  const runtime = new JmeterMcpRuntime();
  const dir = makeTempDir();
  callOk(runtime, "create_test_plan", { name: "IT Plan" });
  callOk(runtime, "add_thread_group", { name: "TG", num_threads: 2, ramp_up: 1, loops: 1 });
  callOk(runtime, "add_http_request", { name: "Req", method: "GET", domain: "example.com", path: "/" });
  return { runtime, dir };
}

/** Call a tool and assert it succeeded; return the message text. */
function callOk(runtime: JmeterMcpRuntime, name: string, args: JsonObject = {}): string {
  const result = runtime.callTool(name, args);
  expect(result.ok, `tool ${name} failed: ${result.ok ? "" : result.error.message}`).toBe(true);
  return result.ok ? result.message : "";
}

/** Call a tool and assert it failed as a tool error (not "unknown tool"); return the error text. */
function callErr(runtime: JmeterMcpRuntime, name: string, args: JsonObject = {}): string {
  const result = runtime.callTool(name, args);
  expect(result.ok, `tool ${name} unexpectedly succeeded`).toBe(false);
  if (result.ok) return "";
  expect(result.error.message).not.toContain("Unknown tool");
  return result.error.message;
}

function treeLines(runtime: JmeterMcpRuntime): string[] {
  return callOk(runtime, "list_test_plan_tree")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
}

function treeText(runtime: JmeterMcpRuntime): string {
  return treeLines(runtime).join("\n");
}

/** Assert the tool exists, succeeds with `args`, and grows the plan tree. */
function expectTreeMutation(name: string, args: JsonObject, mustContain?: string | RegExp): void {
  it(`adds elements via ${name}`, () => {
    const { runtime } = preppedRuntime();
    const before = treeLines(runtime).length;
    callOk(runtime, name, args);
    const after = treeLines(runtime);
    expect(after.length).toBeGreaterThan(before);
    if (mustContain) expect(treeText(runtime)).toMatch(mustContain);
  });
}

// ── Registry surface ──

describe("jmeter tool registry", () => {
  it("registers exactly 48 tools including the 5 sampler tools the frontend templates call", () => {
    const runtime = new JmeterMcpRuntime();
    expect(runtime.tools.size).toBe(48);
    for (const name of ["add_jdbc_request", "add_tcp_sampler", "add_smtp_sampler", "add_ftp_sampler", "add_system_sampler"]) {
      expect(runtime.tools.has(name), `tool ${name} must be registered`).toBe(true);
    }
  });

  it("rejects unknown tools", () => {
    const runtime = new JmeterMcpRuntime();
    const result = runtime.callTool("definitely_not_a_tool");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not-found");
      expect(result.error.message).toContain("Unknown tool");
    }
  });
});

// ── Full tool surface smoke ──

describe("tool surface", () => {
  it("create_test_plan creates a plan", () => {
    const runtime = new JmeterMcpRuntime();
    callOk(runtime, "create_test_plan", { name: "Fresh" });
    expect(treeText(runtime)).toContain("Fresh");
  });

  it("save_test_plan writes a JMX file and returns structured data.path", () => {
    const { runtime, dir } = preppedRuntime();
    const target = join(dir, "out.jmx");
    const result = runtime.callTool("save_test_plan", { path: target });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toBe(`Test plan saved: ${target}`);
      expect(result.data?.path).toBe(target);
    }
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8")).toContain("jmeterTestPlan");
  });

  it("load_test_plan loads a saved JMX file", () => {
    const { runtime, dir } = preppedRuntime();
    const target = join(dir, "out.jmx");
    callOk(runtime, "save_test_plan", { path: target });
    const other = new JmeterMcpRuntime();
    callOk(other, "load_test_plan", { path: target });
    expect(treeText(other)).toContain("IT Plan");
  });

  it("load_test_plan reports a missing file as a tool error", () => {
    const runtime = new JmeterMcpRuntime();
    expect(callErr(runtime, "load_test_plan", { path: join(makeTempDir(), "nope.jmx") })).toContain("File not found");
  });

  it("run_test_plan without JMeter fails as a tool error, not an unknown tool", () => {
    const { runtime } = preppedRuntime();
    expect(callErr(runtime, "run_test_plan")).toContain("JMeter not initialized");
  });

  it("list_test_plan_tree lists the tree", () => {
    const { runtime } = preppedRuntime();
    const text = treeText(runtime);
    expect(text).toContain("/0 | IT Plan");
    expect(text).toContain("/0/0 | TG");
    expect(text).toContain("/0/0/0 | Req");
  });

  it("get_element_details returns element JSON", () => {
    const { runtime } = preppedRuntime();
    const details = JSON.parse(callOk(runtime, "get_element_details", { path: "/0/0" })) as { name: string; tag: string };
    expect(details.name).toBe("TG");
    expect(details.tag).toBe("ThreadGroup");
  });

  it("validate_test_plan validates", () => {
    const { runtime } = preppedRuntime();
    expect(callOk(runtime, "validate_test_plan")).toContain("Validation summary");
  });

  it("update_element renames an element", () => {
    const { runtime } = preppedRuntime();
    callOk(runtime, "update_element", { path: "/0/0", name: "Renamed TG" });
    expect(treeText(runtime)).toContain("Renamed TG");
  });

  it("delete_element removes an element", () => {
    const { runtime } = preppedRuntime();
    const before = treeLines(runtime).length;
    callOk(runtime, "delete_element", { path: "/0/0/0" });
    expect(treeLines(runtime).length).toBe(before - 1);
    expect(treeText(runtime)).not.toContain("| Req |");
  });

  it("move_element moves an element under a new parent", () => {
    const { runtime } = preppedRuntime();
    callOk(runtime, "move_element", { source_path: "/0/0/0", target_parent_path: "/0" });
    expect(treeText(runtime)).toContain("/0/1 | Req");
  });

  it("replace_script patches script properties", () => {
    const { runtime } = preppedRuntime();
    callOk(runtime, "add_script", { name: "Script", type: "sampler", language: "groovy", script: "old" });
    callOk(runtime, "replace_script", { path: "/0/0/1", script: "new-script" });
    const details = JSON.parse(callOk(runtime, "get_element_details", { path: "/0/0/1" })) as { script: { script: string } };
    expect(details.script.script).toBe("new-script");
  });

  it("add_thread_group adds main/setup/post groups", () => {
    const { runtime } = preppedRuntime();
    callOk(runtime, "add_thread_group", { name: "Setup", type: "setup" });
    callOk(runtime, "add_thread_group", { name: "Post", type: "post" });
    const text = treeText(runtime);
    expect(text).toContain("SetupThreadGroup");
    expect(text).toContain("PostThreadGroup");
  });

  expectTreeMutation("add_http_request", { name: "HTTP2", method: "POST", domain: "api.example.com", path: "/x", body_data: "{}" }, "HTTP2");
  expectTreeMutation("add_script", { name: "Pre", type: "pre_processor", script: "1" }, "JSR223PreProcessor");
  expectTreeMutation("add_assertion", { name: "RA", type: "response", test_field: "response_code", patterns: ["200"] }, "ResponseAssertion");
  expectTreeMutation("add_extended_assertion", { type: "xpath", name: "XA", xpath: "//ok" }, "XPath2Assertion");
  expectTreeMutation("add_listener", { type: "view_results_tree" }, "ResultCollector");
  expectTreeMutation("add_extended_listener", { type: "aggregate_report" }, "aggregate_report");
  expectTreeMutation("add_timer", { type: "constant", delay: 100 }, "ConstantTimer");
  expectTreeMutation("add_timer_at_path", { parent_path: "/0/0", timer_type: "constant" }, "ConstantTimer");
  expectTreeMutation("add_listener_at_path", { parent_path: "/0/0", listener_type: "view_results_tree" }, "ResultCollector");
  expectTreeMutation("add_assertion_at_path", { parent_path: "/0/0", assertion_type: "duration", max_duration: 1000 }, "DurationAssertion");
  expectTreeMutation("add_extractor_at_path", { parent_path: "/0/0", extractor_type: "regex", ref_name: "tok", regex: "token=(.+)" }, "RegexExtractor");
  expectTreeMutation("add_preprocessor_at_path", { parent_path: "/0/0", preprocessor_type: "jsr223", script: "1" }, "JSR223PreProcessor");
  expectTreeMutation("add_postprocessor_at_path", { parent_path: "/0/0", postprocessor_type: "jsr223", script: "1" }, "JSR223PostProcessor");
  expectTreeMutation("add_more_assertions", { type: "md5hex", name: "MD5", md5_hex: "d41d8cd98f00b204e9800998ecf8427e" }, "MD5HexAssertion");
  expectTreeMutation("add_more_timers", { type: "poisson", name: "PT" }, "PoissonRandomTimer");
  expectTreeMutation("add_more_configs", { type: "http_header_manager", name: "HM", headers: "A=B" }, "HeaderManager");
  expectTreeMutation("add_more_listeners", { type: "jsr223", name: "JL", script: "1" }, "JSR223Listener");
  expectTreeMutation("add_ldap_sampler", { name: "LDAP", server: "ldap.example.com" }, "LDAPSampler");
  expectTreeMutation("add_mail_reader_sampler", { name: "Mail", server: "mail.example.com", username: "u" }, "MailReaderSampler");
  expectTreeMutation("add_test_action", { name: "Pause", action: "pause", duration: 10 }, "TestAction");
  expectTreeMutation("add_counter_config", { name: "Counter", variable_name: "c" }, "CounterConfig");
  expectTreeMutation("add_sample_timeout", { name: "Timeout", timeout: 500 }, "SampleTimeout");
  expectTreeMutation("add_regex_user_parameters", { name: "RUP", reg_ex_ref_name: "ref" }, "RegExUserParameters");
  expectTreeMutation("add_xml_assertion", { name: "XMLA" }, "XMLAssertion");
  expectTreeMutation("add_xml_schema_assertion", { name: "XSD", xsd_filename: "schema.xsd" }, "XMLSchemaAssertion");
  expectTreeMutation("add_beanshell_assertion", { name: "BSA", script: "Failure=false;" }, "BeanShellAssertion");
  expectTreeMutation("add_jsr223_assertion", { name: "JSA", script: "1" }, "JSR223Assertion");
  expectTreeMutation("add_md5hex_assertion", { name: "MD5A", md5_hex: "d41d8cd98f00b204e9800998ecf8427e" }, "MD5HexAssertion");
  expectTreeMutation("add_backend_listener", { name: "BL" }, "BackendListener");
  expectTreeMutation("add_aggregate_graph", { name: "AG" }, "| AG |");
  expectTreeMutation("add_jdbc_request", { name: "JDBC", dataSource: "jdbc_pool", query_type: "Select Statement", sql: "select 1" }, "JDBCSampler");
  expectTreeMutation("add_tcp_sampler", { name: "TCP", server: "localhost", port: 7, request_data: "ping" }, "TCPSampler");
  expectTreeMutation("add_smtp_sampler", { name: "SMTP", server: "smtp.example.com", sender: "a@example.com", receiver: "b@example.com" }, "SmtpSampler");
  expectTreeMutation("add_ftp_sampler", { name: "FTP", server: "ftp.example.com", remote_filename: "/r.txt" }, "FTPSampler");
  expectTreeMutation("add_system_sampler", { name: "SYS", command: "echo", command_parameters: "hi" }, "SystemSampler");

  it("add_include_controller accepts a test fragment file", () => {
    const { runtime, dir } = preppedRuntime();
    const fragment = join(dir, "fragment.jmx");
    writeFileSync(
      fragment,
      `<?xml version="1.0" encoding="UTF-8"?>\n<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">\n  <hashTree>\n    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Fragment Wrapper" enabled="true"/>\n    <hashTree>\n      <TestFragmentController guiclass="TestFragmentControllerGui" testclass="TestFragmentController" testname="Reusable Fragment" enabled="true"/>\n      <hashTree/>\n    </hashTree>\n  </hashTree>\n</jmeterTestPlan>\n`,
      "utf8",
    );
    callOk(runtime, "add_include_controller", { name: "IC", include_path: fragment });
    expect(treeText(runtime)).toContain("IncludeController");
  });

  it("add_include_controller rejects a missing fragment path", () => {
    const { runtime } = preppedRuntime();
    expect(callErr(runtime, "add_include_controller", { name: "IC", include_path: join(makeTempDir(), "missing.jmx") })).toContain("include_path not found");
  });

  it("typed-error branches stay tool errors, not crashes", () => {
    const { runtime } = preppedRuntime();
    expect(callErr(runtime, "add_listener", { type: "bogus_listener" })).toContain("unknown listener type");
    expect(callErr(runtime, "add_timer", { type: "bogus_timer" })).toContain("unknown timer type");
    expect(callErr(runtime, "add_extended_assertion", { type: "bogus" })).toContain("unknown assertion type");
    expect(callErr(runtime, "add_more_configs", { type: "bogus" })).toContain("unknown config type");
    expect(callErr(runtime, "get_element_details", { path: "/9/9" })).toContain("out of range");
  });

  it("uses stable error codes", () => {
    const { runtime } = preppedRuntime();
    const unknownType = runtime.callTool("add_listener", { type: "bogus" });
    expect(unknownType.ok).toBe(false);
    if (!unknownType.ok) expect(unknownType.error.code).toBe("unknown-type");

    const notFound = runtime.callTool("get_element_details", { path: "/9/9" });
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.error.code).toBe("not-found");

    const invalidArgs = runtime.callTool("delete_element", { path: "/0" });
    expect(invalidArgs.ok).toBe(false);
    if (!invalidArgs.ok) expect(invalidArgs.error.code).toBe("invalid-args");

    const invalidState = new JmeterMcpRuntime().callTool("list_test_plan_tree");
    expect(invalidState.ok).toBe(false);
    if (!invalidState.ok) expect(invalidState.error.code).toBe("invalid-state");
  });
});

// ── Frontend template sequences (mirror src/lib/jmeter-builders.ts) ──

type Step = { tool: string; text: string };

function runSequence(runtime: JmeterMcpRuntime, dir: string, seed: string, calls: Array<[string, JsonObject]>): { steps: Step[]; saved: string; tree: string; jmx: string } {
  const steps: Step[] = [];
  for (const [tool, args] of calls) steps.push({ tool, text: callOk(runtime, tool, args) });
  steps.push({ tool: "validate_test_plan", text: callOk(runtime, "validate_test_plan") });
  const target = join(dir, `${seed}.jmx`);
  steps.push({ tool: "save_test_plan", text: callOk(runtime, "save_test_plan", { path: target }) });
  const tree = treeText(runtime);
  steps.push({ tool: "list_test_plan_tree", text: tree });
  expect(existsSync(target)).toBe(true);
  return { steps, saved: target, tree, jmx: readFileSync(target, "utf8") };
}

const tgArgs = { name: "主线程组", num_threads: 10, ramp_up: 5, loops: 2 };

describe("frontend template build sequences", () => {
  it("http-stress", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree } = runSequence(runtime, dir, "http", [
      ["create_test_plan", { name: "HTTP 压测", comments: "由前端 HTTP 模板生成" }],
      ["add_thread_group", tgArgs],
      ["add_more_configs", { type: "http_header_manager", name: "HTTP 请求头管理器", headers: "Authorization=Bearer demo" }],
      ["add_http_request", { name: "HTTP 请求", method: "GET", protocol: "https", domain: "api.example.com", port: 443, path: "/health" }],
      ["add_assertion", { name: "状态码断言", type: "response", test_field: "response_code", match_type: "equals", patterns: ["200"] }],
      ["add_listener", { type: "aggregate_report" }],
    ]);
    expect(tree).toContain("HTTPSamplerProxy");
    expect(tree).toContain("ResponseAssertion");
    expect(tree).toContain("aggregate_report");
  });

  it("jdbc-stress (dataSource arg reaches the JMX)", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree, jmx } = runSequence(runtime, dir, "jdbc", [
      ["create_test_plan", { name: "JDBC 压测", comments: "由前端 JDBC 模板生成" }],
      ["add_thread_group", tgArgs],
      ["add_more_configs", { type: "jdbc_config", name: "jdbc_pool", pool_max: "10", username: "sa", password: "pw", connection_url: "jdbc:h2:mem:test", driver_class: "org.h2.Driver" }],
      ["add_jdbc_request", { name: "JDBC 请求", dataSource: "jdbc_pool", query_type: "Select Statement", sql: "select 1" }],
      ["add_listener", { type: "aggregate_report" }],
    ]);
    expect(tree).toContain("JDBCSampler");
    expect(jmx).toContain("jdbc_pool");
  });

  it("tcp-stress (camelCase reUseConnection arg reaches the JMX)", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree, jmx } = runSequence(runtime, dir, "tcp", [
      ["create_test_plan", { name: "TCP 压测", comments: "由前端 TCP 模板生成" }],
      ["add_thread_group", tgArgs],
      ["add_tcp_sampler", { name: "TCP 请求", server: "localhost", port: 8123, request_data: "ping", reUseConnection: "true" }],
      ["add_listener", { type: "view_results_tree" }],
    ]);
    expect(tree).toContain("TCPSampler");
    expect(jmx).toContain("TCPSampler.reUseConnection");
  });

  it("smtp-stress", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree, jmx } = runSequence(runtime, dir, "smtp", [
      ["create_test_plan", { name: "SMTP 压测", comments: "由前端 SMTP 模板生成" }],
      ["add_thread_group", tgArgs],
      ["add_smtp_sampler", { name: "SMTP 请求", server: "smtp.example.com", port: 25, use_auth: "true", username: "a@example.com", sender: "a@example.com", receiver: "b@example.com", subject: "性能测试邮件", body: "这是一封性能测试邮件", use_ssl: "false" }],
      ["add_listener", { type: "view_results_tree" }],
    ]);
    expect(tree).toContain("SmtpSampler");
    expect(jmx).toContain("b@example.com");
  });

  it("ftp-stress", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree, jmx } = runSequence(runtime, dir, "ftp", [
      ["create_test_plan", { name: "FTP 压测", comments: "由前端 FTP 模板生成" }],
      ["add_thread_group", tgArgs],
      ["add_ftp_sampler", { name: "FTP 请求", server: "ftp.example.com", port: 21, username: "u", password: "p", remote_filename: "/remote/big.bin", local_filename: "big.bin", ftp_action: "get" }],
      ["add_listener", { type: "view_results_tree" }],
    ]);
    expect(tree).toContain("FTPSampler");
    expect(jmx).toContain("/remote/big.bin");
  });

  it("ldap-stress", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree } = runSequence(runtime, dir, "ldap", [
      ["create_test_plan", { name: "LDAP 压测", comments: "由前端 LDAP 模板生成" }],
      ["add_thread_group", tgArgs],
      ["add_ldap_sampler", { name: "LDAP 查询", server: "ldap.example.com", port: 389, search_base: "dc=example,dc=com", search_filter: "(uid=*)", attributes: "cn", use_ssl: false }],
      ["add_listener", { type: "view_results_tree" }],
    ]);
    expect(tree).toContain("LDAPSampler");
  });

  it("jsr223-script", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree, jmx } = runSequence(runtime, dir, "script", [
      ["create_test_plan", { name: "脚本计划", comments: "由前端脚本模板生成" }],
      ["add_thread_group", tgArgs],
      ["add_script", { name: "脚本采样器", type: "sampler", language: "groovy", script: "log.info('hi')" }],
      ["add_listener", { type: "view_results_tree" }],
    ]);
    expect(tree).toContain("JSR223Sampler");
    expect(jmx).toContain("log.info");
  });

  it("system-command", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree, jmx } = runSequence(runtime, dir, "sys", [
      ["create_test_plan", { name: "系统命令", comments: "由前端系统命令模板生成" }],
      ["add_thread_group", tgArgs],
      ["add_system_sampler", { name: "系统命令", command: "echo", command_parameters: "hello world", working_directory: "", interpreter: "cmd.exe", check_return_code: "true" }],
      ["add_listener", { type: "view_results_tree" }],
    ]);
    expect(tree).toContain("SystemSampler");
    expect(jmx).toContain("echo");
  });

  it("blank", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree } = runSequence(runtime, dir, "blank", [
      ["create_test_plan", { name: "空白计划", comments: "由前端空白模板生成" }],
      ["add_thread_group", tgArgs],
      ["add_listener", { type: "view_results_tree" }],
    ]);
    expect(tree).toContain("ThreadGroup");
    expect(tree).toContain("ResultCollector");
  });

  it("custom-script", () => {
    const { runtime, dir } = preppedRuntimeless();
    const { tree } = runSequence(runtime, dir, "custom", [
      ["create_test_plan", { name: "自定义脚本测试计划", comments: "由前端自定义脚本页面生成" }],
      ["add_thread_group", { name: "主线程组", num_threads: 1, ramp_up: 1, loops: 1 }],
      ["add_script", { name: "自定义脚本", type: "sampler", language: "groovy", script: "log.info(\"ok\")" }],
      ["add_listener", { type: "view_results_tree" }],
    ]);
    expect(tree).toContain("JSR223Sampler");
  });
});

function preppedRuntimeless(): { runtime: JmeterMcpRuntime; dir: string } {
  return { runtime: new JmeterMcpRuntime(), dir: makeTempDir() };
}
