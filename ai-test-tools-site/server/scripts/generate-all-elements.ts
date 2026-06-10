import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { JmeterMcpRuntime } from "../src/jmeterBackend.js";

const runtime = new JmeterMcpRuntime();
const calledTools = new Set<string>();
const outputDir = resolve(process.cwd(), "server", "generated");
const outputPath = resolve(outputDir, "all-jmeter-elements.jmx");
const fragmentPath = resolve(outputDir, "include-fragment.jmx");

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  fragmentPath,
  `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Fragment Wrapper" enabled="true"/>
    <hashTree>
      <TestFragmentController guiclass="TestFragmentControllerGui" testclass="TestFragmentController" testname="Reusable Fragment" enabled="true"/>
      <hashTree/>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
`,
  "utf8",
);

function call(name: string, args: Record<string, unknown> = {}, allowError = false): string {
  calledTools.add(name);
  const result = runtime.callTool(name, args);
  if (!allowError && result.startsWith("Error")) {
    throw new Error(`${name} failed: ${result}`);
  }
  return result;
}

function findPathByName(name: string): string {
  const tree = call("list_test_plan_tree");
  const line = tree.split(/\r?\n/).find((item) => item.includes(`| ${name} |`));
  if (!line) throw new Error(`Cannot find path for ${name}`);
  return line.split("|")[0].trim();
}

call("create_test_plan", {
  name: "AI测试工具 TypeScript 全量 JMeter 元素测试",
  comments: "由 TypeScript 后端生成，用于验证参考 jmeter-mcp 服务能力还原。",
});
call("add_thread_group", { name: "Main TG", num_threads: 2, ramp_up: 1, loops: 1 });

const tgPath = "/0/0";

call("add_config", { type: "csv_data_set", filename: "users.csv", variable_names: "user,pass" });
call("add_config", { type: "random_variable", variable_names: "rand_id", min: "1", max: "999" });
call("add_config", { type: "http_cookie_manager", clear_each_iteration: true });
call("add_config", { type: "http_cache_manager", clear_each_iteration: false });
call("add_config", { type: "http_authorization_manager", auth_url: "https://example.com", auth_user: "demo", auth_pass: "secret" });
call("add_config", { type: "user_defined_variables", variable_names: "baseUrl=https://example.com,token=abc" });
call("add_more_configs", { type: "http_defaults", name: "HTTP Defaults", domain: "example.com", protocol: "https", path: "/" });
call("add_more_configs", { type: "http_header_manager", name: "Header Manager", headers: "Content-Type=application/json;Accept=application/json" });
call("add_more_configs", { type: "jdbc_config", name: "JDBC Config", connection_url: "jdbc:h2:mem:test", driver_class: "org.h2.Driver" });
call("add_more_configs", { type: "keystore", name: "Keystore Config", variable_name: "certAlias" });
call("add_more_configs", { type: "login_config", name: "Login Config", username_var: "${user}", password_var: "${pass}" });
call("add_more_configs", { type: "tcp_config", name: "TCP Config", reuse_connection: "true" });
call("add_more_configs", { type: "ftp_config", name: "FTP Config", binary_mode: "true" });
call("add_counter_config", { name: "Global Counter", variable_name: "counter" });

call("add_http_request", {
  name: "HTTP Request",
  method: "POST",
  domain: "example.com",
  path: "/api/demo",
  protocol: "https",
  content_type: "application/json",
  body_data: "{\"ok\":true}",
  headers: [{ name: "X-Test", value: "1" }],
  params: [{ name: "q", value: "search" }],
});
call("add_script", { name: "JSR223 Sampler", type: "sampler", language: "groovy", script: "SampleResult.setSuccessful(true)" });
call("add_script", { name: "BeanShell Sampler", type: "sampler", language: "beanshell", script: "ResponseCode=\"200\";" });
call("add_script", { name: "JSR223 Pre via add_script", type: "pre_processor", language: "groovy", script: "vars.put('pre','1')" });
call("add_script", { name: "JSR223 Post via add_script", type: "post_processor", language: "groovy", script: "vars.put('post','1')" });
call("add_jdbc_request", { name: "JDBC Request", dataSource: "JDBC Config", query_type: "Select Statement", sql: "select 1" });
call("add_tcp_sampler", { name: "TCP Sampler", server: "localhost", port: 7, request_data: "ping" });
call("add_ftp_sampler", { name: "FTP Sampler", server: "ftp.example.com", remote_filename: "/remote.txt", local_filename: "local.txt" });
call("add_jms_sampler", { name: "JMS Publisher", jms_type: "publisher", destination: "queue.demo", text_message: "hello" });
call("add_jms_sampler", { name: "JMS Subscriber", jms_type: "subscriber", destination: "queue.demo" });
call("add_jms_sampler", { name: "JMS P2P", jms_type: "p2p", destination: "queue.demo" });
call("add_smtp_sampler", { name: "SMTP Sampler", server: "smtp.example.com", sender: "a@example.com", receiver: "b@example.com" });
call("add_system_sampler", { name: "System Sampler", command: "echo", command_parameters: "hello world" });
call("add_ldap_sampler", { name: "LDAP Sampler", server: "ldap.example.com", rootdn: "dc=example,dc=com" });
call("add_ldap_sampler", { name: "LDAP Ext Sampler", type: "extended", server: "ldap.example.com", rootdn: "dc=example,dc=com" });
call("add_mail_reader_sampler", { name: "Mail Reader", server: "mail.example.com", username: "demo", password: "secret" });
call("add_test_action", { name: "Pause Action", action: "pause", duration: 100 });

call("add_timer", { type: "constant", delay: 100 });
call("add_timer", { type: "uniform_random", delay: 100, max_delay: 250 });
call("add_timer", { type: "gaussian", delay: 100, range: 25 });
call("add_timer", { type: "constant_throughput", throughput: "60", throughput_mode: 2 });
call("add_timer", { type: "sync", group_size: 2, sync_timeout: 1000 });
call("add_more_timers", { type: "poisson", name: "Poisson Timer", delay: 100, range: 30 });
call("add_more_timers", { type: "beanshell", name: "BeanShell Timer", script: "return 10;" });

call("add_assertion", { name: "Response Assertion", type: "response", test_field: "response_code", patterns: ["200"] });
call("add_assertion", { name: "JSONPath Assertion", type: "json_path", json_path: "$.ok", expected_value: "true" });
call("add_assertion", { name: "Duration Assertion", type: "duration", max_duration: 5000 });
call("add_extended_assertion", { name: "Size Assertion", type: "size", size: 2048 });
call("add_extended_assertion", { name: "XPath Assertion", type: "xpath", xpath: "//*[local-name()='ok']" });
call("add_extended_assertion", { name: "JMESPath Assertion", type: "jmespath", jmespath: "ok", expected_value: "true" });
call("add_extended_assertion", { name: "HTML Assertion", type: "html", html_doc: "index.html" });
call("add_more_assertions", { type: "xml_schema", name: "XML Schema Assertion", xsd_filename: "schema.xsd" });
call("add_more_assertions", { type: "md5hex", name: "MD5 Assertion", md5_hex: "d41d8cd98f00b204e9800998ecf8427e" });
call("add_more_assertions", { type: "beanshell", name: "BeanShell Assertion", script: "Failure=false;" });
call("add_more_assertions", { type: "jsr223", name: "JSR223 Assertion", script_content: "AssertionResult.setFailure(false)" });
call("add_more_assertions", { type: "compare", name: "Compare Assertion" });
call("add_xml_assertion", { name: "XML Assertion" });
call("add_xml_schema_assertion", { name: "Standalone XML Schema Assertion", xsd_filename: "schema.xsd" });
call("add_beanshell_assertion", { name: "Standalone BeanShell Assertion", script: "Failure=false;" });
call("add_jsr223_assertion", { name: "Standalone JSR223 Assertion", script: "AssertionResult.setFailure(false)" });
call("add_md5hex_assertion", { name: "Standalone MD5 Assertion", md5_hex: "d41d8cd98f00b204e9800998ecf8427e" });

call("add_extractor", { type: "regex", ref_name: "rx", regex: "(.+)", template: "$1$", default_value: "NA" });
call("add_extractor", { type: "boundary", ref_name: "bd", left_boundary: "<id>", right_boundary: "</id>" });
call("add_extractor", { type: "css_jquery", ref_name: "css", css_expr: "title" });
call("add_extractor", { type: "xpath", ref_name: "xp", xpath: "//id" });
call("add_extractor", { type: "xpath2", ref_name: "xp2", xpath: "//id" });
call("add_extractor", { type: "json", ref_name: "json", json_path: "$.id" });
call("add_extractor", { type: "jmespath", ref_name: "jm", jmespath: "id" });

call("add_user_parameters", { name: "User Parameters", parameter_names: "u,p", parameter_values: "demo,secret" });
call("add_jdbc_pre_processor", { name: "JDBC PreProcessor", dataSource: "JDBC Config", query_type: "Select Statement", sql: "select 1" });
call("add_http_url_rewriting_modifier", { name: "URL Rewriting", argument_name: "sid", path_extension: true });
call("add_sample_timeout", { name: "Sample Timeout", timeout: 5000 });
call("add_regex_user_parameters", { name: "RegEx User Parameters", reg_ex_ref_name: "rx", param_names_group_nr: "1", param_values_group_nr: "2" });

call("add_listener", { type: "view_results_tree" });
call("add_listener", { type: "aggregate_report" });
call("add_listener", { type: "summary_report" });
call("add_listener", { type: "simple_data_writer", filename: "results.jtl" });
call("add_extended_listener", { type: "view_results_in_table" });
call("add_extended_listener", { type: "graph_results" });
call("add_extended_listener", { type: "response_time_graph" });
call("add_extended_listener", { type: "assertion_results" });
call("add_extended_listener", { type: "generate_summary_results" });
call("add_more_listeners", { type: "beanshell", name: "BeanShell Listener", script: "log.info('ok')" });
call("add_more_listeners", { type: "jsr223", name: "JSR223 Listener", script: "log.info('ok')" });
call("add_more_listeners", { type: "save_response", name: "Save Response", output_directory: outputDir });
call("add_backend_listener", { name: "Backend Listener", influxdb_url: "http://localhost:8086/write" });
call("add_aggregate_graph", { name: "Aggregate Graph" });

call("add_config_at_path", { parent_path: tgPath, name: "Path CSV", config_type: "csv_data_set", csv_filename: "path.csv" });
call("add_config_at_path", { parent_path: tgPath, name: "Path Random", config_type: "random_variable", random_var_name: "pathRand" });
call("add_config_at_path", { parent_path: tgPath, name: "Path Cookie", config_type: "http_cookie_manager" });
call("add_config_at_path", { parent_path: tgPath, name: "Path Cache", config_type: "http_cache_manager" });
call("add_config_at_path", { parent_path: tgPath, name: "Path Header", config_type: "http_header_manager", headers_json: "X-Path=1" });
call("add_config_at_path", { parent_path: tgPath, name: "Path HTTP Defaults", config_type: "http_defaults" });
call("add_config_at_path", { parent_path: tgPath, name: "Path Counter", config_type: "counter", counter_var_name: "pathCounter" });
call("add_config_at_path", { parent_path: tgPath, name: "Path Variables", config_type: "user_defined_variables", variables_json: "pathVar=1" });
call("add_sampler_at_path", { parent_path: tgPath, name: "Path HTTP Sampler", sampler_type: "http", method: "GET", domain: "example.com", path: "/" });
call("add_sampler_at_path", { parent_path: tgPath, name: "Path JSR223 Sampler", sampler_type: "jsr223", script: "SampleResult.setSuccessful(true)" });
call("add_sampler_at_path", { parent_path: tgPath, name: "Path BeanShell Sampler", sampler_type: "beanshell", script: "ResponseCode=\"200\";" });
call("add_preprocessor_at_path", { parent_path: tgPath, name: "Path JSR223 Pre", preprocessor_type: "jsr223", script: "vars.put('p','1')" });
call("add_preprocessor_at_path", { parent_path: tgPath, name: "Path BeanShell Pre", preprocessor_type: "beanshell", script: "vars.put('p','1');" });
call("add_preprocessor_at_path", { parent_path: tgPath, name: "Path Sample Timeout", preprocessor_type: "sample_timeout", timeout: 3000 });
call("add_postprocessor_at_path", { parent_path: tgPath, name: "Path JSR223 Post", postprocessor_type: "jsr223", script: "vars.put('p','1')" });
call("add_postprocessor_at_path", { parent_path: tgPath, name: "Path BeanShell Post", postprocessor_type: "beanshell", script: "vars.put('p','1');" });
call("add_extractor_at_path", { parent_path: tgPath, name: "Path Regex Extractor", extractor_type: "regex", ref_name: "pathRx", regex: "(.+)" });
call("add_extractor_at_path", { parent_path: tgPath, name: "Path JSON Extractor", extractor_type: "json_path", ref_name: "pathJson", json_path: "$.id" });
call("add_extractor_at_path", { parent_path: tgPath, name: "Path XPath Extractor", extractor_type: "xpath", ref_name: "pathXpath", xpath: "//id" });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path Response Assertion", assertion_type: "response", patterns: ["200"] });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path JSON Assertion", assertion_type: "json_path", json_path: "$.ok" });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path Duration Assertion", assertion_type: "duration", max_duration: 1000 });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path Size Assertion", assertion_type: "size", size: 100 });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path XPath Assertion", assertion_type: "xpath", xpath: "//ok" });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path JMES Assertion", assertion_type: "jmespath", jmespath: "ok" });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path XML Schema Assertion", assertion_type: "xml_schema", xpath: "schema.xsd" });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path MD5 Assertion", assertion_type: "md5hex", expected_value: "d41d8cd98f00b204e9800998ecf8427e" });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path HTML Assertion", assertion_type: "html", expected_value: "index.html" });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path BeanShell Assertion", assertion_type: "beanshell", xpath: "Failure=false;" });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path JSR223 Assertion", assertion_type: "jsr223", xpath: "AssertionResult.setFailure(false)" });
call("add_assertion_at_path", { parent_path: tgPath, name: "Path Compare Assertion", assertion_type: "compare" });
call("add_timer_at_path", { parent_path: tgPath, name: "Path Constant Timer", timer_type: "constant", delay: 50 });
call("add_timer_at_path", { parent_path: tgPath, name: "Path Uniform Timer", timer_type: "uniform_random", delay: 50, max_delay: 100 });
call("add_timer_at_path", { parent_path: tgPath, name: "Path Gaussian Timer", timer_type: "gaussian", delay: 50, range: 10 });
call("add_timer_at_path", { parent_path: tgPath, name: "Path Throughput Timer", timer_type: "constant_throughput", throughput: "30" });
call("add_timer_at_path", { parent_path: tgPath, name: "Path Sync Timer", timer_type: "sync", group_size: 2 });
call("add_timer_at_path", { parent_path: tgPath, name: "Path Poisson Timer", timer_type: "poisson", delay: 50, range: 10 });
call("add_timer_at_path", { parent_path: tgPath, name: "Path BeanShell Timer", timer_type: "beanshell" });
call("add_listener_at_path", { parent_path: tgPath, name: "Path View Tree", listener_type: "view_results_tree" });
call("add_listener_at_path", { parent_path: tgPath, name: "Path Aggregate", listener_type: "aggregate_report" });
call("add_listener_at_path", { parent_path: tgPath, name: "Path Summary", listener_type: "summary_report" });
call("add_listener_at_path", { parent_path: tgPath, name: "Path Writer", listener_type: "simple_data_writer" });
call("add_listener_at_path", { parent_path: tgPath, name: "Path BeanShell Listener", listener_type: "beanshell", script: "log.info('ok')" });
call("add_listener_at_path", { parent_path: tgPath, name: "Path JSR223 Listener", listener_type: "jsr223", script: "log.info('ok')" });
call("add_controller_at_path", { parent_path: tgPath, name: "Path Simple Controller", controller_type: "simple" });
call("add_controller_at_path", { parent_path: tgPath, name: "Path Loop Controller", controller_type: "loop", loops: 2 });
call("add_controller_at_path", { parent_path: tgPath, name: "Path If Controller", controller_type: "if", condition: "${ok}" });

call("add_controller", { type: "if", name: "If Controller", condition: "${ok}" });
call("add_controller", { type: "while", name: "While Controller", condition: "${loop}" });
call("add_controller", { type: "foreach", name: "ForEach Controller", input_var: "item", output_var: "current" });
call("add_controller", { type: "transaction", name: "Transaction Controller" });
call("add_controller", { type: "throughput", name: "Throughput Controller", throughput_value: "50" });
call("add_controller", { type: "once_only", name: "Once Only Controller" });
call("add_controller", { type: "random_order", name: "Random Order Controller" });
call("add_controller", { type: "switch", name: "Switch Controller", switch_value: "0" });
call("add_controller", { type: "runtime", name: "Runtime Controller", runtime_seconds: 1 });
call("add_controller", { type: "loop", name: "Loop Controller", runtime_seconds: 2 });
call("add_controller", { type: "simple", name: "Simple Controller" });
call("add_controller", { type: "module", name: "Module Controller" });
call("add_controller", { type: "interleave", name: "Interleave Controller" });
call("add_controller", { type: "random", name: "Random Controller" });
call("add_controller", { type: "critical_section", name: "Critical Section Controller", condition: "globalLock" });
call("add_include_controller", { name: "Include Controller", include_path: fragmentPath });

call("add_sampler_at_path", { parent_path: tgPath, name: "Temp Move Sampler", sampler_type: "http", domain: "example.com", path: "/move" });
const movePath = findPathByName("Temp Move Sampler");
call("move_element", { source_path: movePath, target_parent_path: "/0" });
const movedPath = findPathByName("Temp Move Sampler");
call("update_element", { path: movedPath, name: "Moved Sampler Updated", enabled: true, properties: { custom_note: "updated" } });
call("add_sampler_at_path", { parent_path: tgPath, name: "Temp Delete Sampler", sampler_type: "http", domain: "example.com", path: "/delete" });
call("delete_element", { path: findPathByName("Temp Delete Sampler") });
call("replace_script", { path: findPathByName("JSR223 Sampler"), script: "SampleResult.setResponseCode('200')", cache_compiled: true });

call("add_thread_group", { name: "Setup TG", type: "setup", num_threads: 1, ramp_up: 1, loops: 1 });
call("add_thread_group", { name: "Post TG", type: "post", num_threads: 1, ramp_up: 1, loops: 1 });

call("validate_test_plan");
call("save_test_plan", { path: outputPath });
call("load_test_plan", { path: outputPath });
call("run_test_plan", { path: outputPath }, true);

const missingTools = [...runtime.tools.keys()].filter((name) => !calledTools.has(name));
if (missingTools.length) {
  throw new Error(`Smoke did not call tools: ${missingTools.join(", ")}`);
}

if (!existsSync(outputPath)) {
  throw new Error(`JMX file was not generated: ${outputPath}`);
}

const xml = readFileSync(outputPath, "utf8");
const requiredTags = [
  "TestPlan",
  "ThreadGroup",
  "SetupThreadGroup",
  "PostThreadGroup",
  "HTTPSamplerProxy",
  "JSR223Sampler",
  "BeanShellSampler",
  "JDBCSampler",
  "TCPSampler",
  "FTPSampler",
  "PublisherSampler",
  "SubscriberSampler",
  "JMSSampler",
  "SmtpSampler",
  "SystemSampler",
  "LDAPSampler",
  "LDAPExtSampler",
  "MailReaderSampler",
  "TestAction",
  "ConstantTimer",
  "UniformRandomTimer",
  "GaussianRandomTimer",
  "ConstantThroughputTimer",
  "SyncTimer",
  "PoissonRandomTimer",
  "BeanShellTimer",
  "ResponseAssertion",
  "JSONPathAssertion",
  "DurationAssertion",
  "SizeAssertion",
  "XPath2Assertion",
  "JMESPathAssertion",
  "HTMLAssertion",
  "XMLSchemaAssertion",
  "MD5HexAssertion",
  "BeanShellAssertion",
  "JSR223Assertion",
  "CompareAssertion",
  "XMLAssertion",
  "RegexExtractor",
  "BoundaryExtractor",
  "HtmlExtractor",
  "XPathExtractor",
  "XPath2Extractor",
  "JSONPostProcessor",
  "JMESPathExtractor",
  "UserParameters",
  "JDBCPreProcessor",
  "URLRewritingModifier",
  "SampleTimeout",
  "RegExUserParameters",
  "ResultCollector",
  "BeanShellListener",
  "JSR223Listener",
  "BackendListener",
  "CSVDataSet",
  "RandomVariableConfig",
  "CookieManager",
  "CacheManager",
  "AuthManager",
  "Arguments",
  "ConfigTestElement",
  "HeaderManager",
  "JDBCDataSource",
  "KeystoreConfig",
  "CounterConfig",
  "IfController",
  "WhileController",
  "ForeachController",
  "TransactionController",
  "ThroughputController",
  "OnceOnlyController",
  "RandomOrderController",
  "SwitchController",
  "RunTime",
  "LoopController",
  "GenericController",
  "ModuleController",
  "InterleaveControl",
  "RandomController",
  "CriticalSectionController",
  "IncludeController",
];

const missingTags = requiredTags.filter((tag) => !xml.includes(`<${tag}`));
if (missingTags.length) {
  throw new Error(`Generated JMX is missing tags: ${missingTags.join(", ")}`);
}

console.log(JSON.stringify({
  ok: true,
  tools: runtime.tools.size,
  calledTools: calledTools.size,
  jmx: outputPath,
  fragment: fragmentPath,
  requiredTags: requiredTags.length,
}, null, 2));
