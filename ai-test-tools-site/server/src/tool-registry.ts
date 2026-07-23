import type { TestPlanService } from "./jmeterBackend.js";
import type { JsonObject } from "./jmx-serializer.js";
import { empty } from "./jmx-serializer.js";
import { err, type ToolResult } from "./tool-result.js";

// ── Types ──

export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonObject;
  execute: (args: JsonObject, service: TestPlanService) => ToolResult;
};

// ── Argument helpers ──

function str(args: JsonObject, key: string, fallback = ""): string {
  const value = args[key];
  return value === undefined || value === null ? fallback : String(value);
}

function maybeStr(args: JsonObject, key: string): string | null {
  const value = args[key];
  return value === undefined || value === null ? null : String(value);
}

function intValue(args: JsonObject, key: string, fallback = 0): number {
  const value = args[key];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numValue(args: JsonObject, key: string, fallback = 0): number {
  return intValue(args, key, fallback);
}

function boolValue(args: JsonObject, key: string, fallback = false): boolean {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() === "true";
}

function arrayStrings(args: JsonObject, key: string): string[] {
  const value = args[key];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function headersArray(args: JsonObject): string[] {
  const headers = args.headers;
  if (!Array.isArray(headers)) return [];
  return headers
    .map((item) => item as Record<string, unknown>)
    .map((item) => `${empty(item.name)}: ${empty(item.value)}`);
}

function paramsArray(args: JsonObject): string[] {
  const params = args.params;
  if (!Array.isArray(params)) return [];
  return params
    .map((item) => item as Record<string, unknown>)
    .map((item) => `${empty(item.name)}=${empty(item.value)}`);
}

// ── Schema helpers ──

function toolSchema(properties: Record<string, JsonObject> = {}, required: string[] = []): JsonObject {
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

function prop(type: "string" | "integer" | "boolean", description: string, defaultValue?: string | number | boolean): JsonObject {
  return defaultValue === undefined ? { type, description } : { type, description, default: defaultValue };
}

// ── Tool registry ──

export function createTools(): McpTool[] {
  const tools: McpTool[] = [
    {
      name: "save_test_plan",
      description: "Save the current JMeter test plan to a file path.",
      inputSchema: toolSchema({ path: prop("string", "Output JMX file path") }, ["path"]),
      execute: (a, s) => s.saveTestPlan(str(a, "path")),
    },
    {
      name: "load_test_plan",
      description: "Load an existing JMeter test plan from a file path.",
      inputSchema: toolSchema({ path: prop("string", "Input JMX file path") }, ["path"]),
      execute: (a, s) => s.loadTestPlan(str(a, "path")),
    },
    {
      name: "run_test_plan",
      description: "Run the current or specified JMeter test plan.",
      inputSchema: toolSchema({ path: prop("string", "Optional JMX file path"), jtl_path: prop("string", "Optional JTL output path") }),
      execute: (a, s) => s.runTestPlan(maybeStr(a, "path"), maybeStr(a, "jtl_path")),
    },
    {
      name: "list_test_plan_tree",
      description: "List the current JMeter test plan tree structure.",
      inputSchema: toolSchema(),
      execute: (_a, s) => s.listTestPlanTree(),
    },
    {
      name: "get_element_details",
      description: "Get details for an element in the loaded test plan by tree path.",
      inputSchema: toolSchema({ path: prop("string", "Tree path of the target element") }, ["path"]),
      execute: (a, s) => s.getElementDetails(str(a, "path")),
    },
    {
      name: "validate_test_plan",
      description: "Validate the current JMeter test plan structure.",
      inputSchema: toolSchema(),
      execute: (_a, s) => s.validateTestPlan(),
    },
    {
      name: "update_element",
      description: "Update an element in the loaded test plan by tree path.",
      inputSchema: toolSchema({
        path: prop("string", "Tree path of the target element"),
        name: prop("string", "Optional new display name"),
        enabled: prop("boolean", "Optional enabled state"),
        properties: { type: "object", description: "Optional string property patch map" },
      }, ["path"]),
      execute: (a, s) => s.updateElement(
        str(a, "path"),
        maybeStr(a, "name"),
        a.enabled === undefined ? null : boolValue(a, "enabled"),
        typeof a.properties === "object" && a.properties !== null ? a.properties as Record<string, string> : null,
      ),
    },
    {
      name: "delete_element",
      description: "Delete an element from the loaded test plan by tree path.",
      inputSchema: toolSchema({ path: prop("string", "Tree path of the target element") }, ["path"]),
      execute: (a, s) => s.deleteElement(str(a, "path")),
    },
    {
      name: "move_element",
      description: "Move an element under another parent path in the loaded test plan.",
      inputSchema: toolSchema({
        source_path: prop("string", "Source element path"),
        target_parent_path: prop("string", "Target parent element path"),
      }, ["source_path", "target_parent_path"]),
      execute: (a, s) => s.moveElement(str(a, "source_path"), str(a, "target_parent_path")),
    },
    {
      name: "replace_script",
      description: "Replace the script details for a script-capable element by tree path.",
      inputSchema: toolSchema({
        path: prop("string", "Tree path of the target element"),
        language: prop("string", "Script language"),
        script: prop("string", "Inline script content"),
        filename: prop("string", "Script file path"),
        parameters: prop("string", "Script parameters"),
        cache_compiled: prop("boolean", "Whether to cache compiled script"),
      }, ["path"]),
      execute: (a, s) => s.replaceScript(
        str(a, "path"),
        maybeStr(a, "language"),
        maybeStr(a, "script"),
        maybeStr(a, "filename"),
        maybeStr(a, "parameters"),
        a.cache_compiled === undefined ? null : boolValue(a, "cache_compiled"),
      ),
    },
    {
      name: "create_test_plan",
      description: "Create a new JMeter test plan. Must be called before adding any elements.",
      inputSchema: toolSchema({ name: prop("string", "Name of the test plan"), comments: prop("string", "Optional comments") }, ["name"]),
      execute: (a, s) => s.createTestPlan(str(a, "name", "Test Plan"), maybeStr(a, "comments")),
    },
    {
      name: "add_thread_group",
      description: "Add a thread group. Supports main, setup, and post types.",
      inputSchema: toolSchema({ name: prop("string", "Name of the thread group"), type: prop("string", "main/setup/post"), num_threads: prop("integer", "Number of threads", 1), ramp_up: prop("integer", "Ramp-up", 1), loops: prop("integer", "Loops", 1), duration: prop("integer", "Duration", 0), delay: prop("integer", "Delay", 0) }, ["name"]),
      execute: (a, s) => {
        const type = str(a, "type", "main");
        if (type === "setup") return s.addSetupThreadGroup(str(a, "name"), intValue(a, "num_threads", 1), intValue(a, "ramp_up", 1), intValue(a, "loops", 1));
        if (type === "post") return s.addPostThreadGroup(str(a, "name"), intValue(a, "num_threads", 1), intValue(a, "ramp_up", 1), intValue(a, "loops", 1));
        return s.addThreadGroup(str(a, "name"), intValue(a, "num_threads", 1), intValue(a, "ramp_up", 1), intValue(a, "loops", 1), intValue(a, "duration", 0), intValue(a, "delay", 0));
      },
    },
    {
      name: "add_http_request",
      description: "Add an HTTP request sampler. Supports GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS.",
      inputSchema: toolSchema({ name: prop("string", "Name"), method: prop("string", "HTTP method"), domain: prop("string", "Server"), path: prop("string", "Path"), protocol: prop("string", "Protocol"), port: prop("integer", "Port", 0), content_type: prop("string", "Content-Type"), body_data: prop("string", "Body"), headers: { type: "array" }, params: { type: "array" } }, ["name", "method", "domain", "path"]),
      execute: (a, s) => s.addHttpRequest(str(a, "name"), str(a, "method", "GET").toUpperCase(), str(a, "domain"), intValue(a, "port", 0), str(a, "path"), maybeStr(a, "protocol") || "https", maybeStr(a, "content_type"), maybeStr(a, "body_data"), headersArray(a), paramsArray(a)),
    },
    {
      name: "add_script",
      description: "Add a JSR223 or BeanShell sampler/pre-processor/post-processor.",
      inputSchema: toolSchema({ name: prop("string", "Name"), type: prop("string", "sampler/pre_processor/post_processor"), language: prop("string", "Language"), script: prop("string", "Script"), filename: prop("string", "Script filename") }, ["name", "type"]),
      execute: (a, s) => s.addScriptElement(str(a, "name"), str(a, "type", "sampler"), maybeStr(a, "language"), maybeStr(a, "script"), maybeStr(a, "filename")),
    },
    {
      name: "add_assertion",
      description: "Add response, JSON Path, or duration assertion.",
      inputSchema: toolSchema({ name: prop("string", "Name"), type: prop("string", "response/json_path/duration"), test_field: prop("string", "Field"), match_type: prop("string", "Match type"), patterns: { type: "array" }, is_not: prop("boolean", "Invert", false), json_path: prop("string", "JSONPath"), expected_value: prop("string", "Expected"), json_validation: prop("boolean", "Validate JSON", false), expect_null: prop("boolean", "Expect null", false), invert: prop("boolean", "Invert", false), max_duration: prop("integer", "Max duration", 5000) }, ["name", "type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        if (type === "json_path") return s.addJsonPathAssertion(str(a, "name"), maybeStr(a, "json_path"), maybeStr(a, "expected_value"), boolValue(a, "json_validation"), boolValue(a, "expect_null"), boolValue(a, "invert"));
        if (type === "duration") return s.addDurationAssertion(str(a, "name"), intValue(a, "max_duration", 5000));
        return s.addResponseAssertion(str(a, "name"), maybeStr(a, "test_field"), maybeStr(a, "match_type"), arrayStrings(a, "patterns"), boolValue(a, "is_not"));
      },
    },
    {
      name: "add_extended_assertion",
      description: "Add size, XPath, JMESPath, or HTML assertion.",
      inputSchema: toolSchema({ type: prop("string", "size/xpath/jmespath/html"), name: prop("string", "Name") }, ["type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        const name = str(a, "name", `${type} assertion`);
        if (type === "size") return s.addSizeAssertion(name, str(a, "test_field", "response_data"), intValue(a, "comparator", 3), intValue(a, "size", 0));
        if (type === "xpath") return s.addXPathAssertion(name, maybeStr(a, "xpath"));
        if (type === "jmespath") return s.addJMESPathAssertion(name, maybeStr(a, "jmespath"), maybeStr(a, "expected_value"), boolValue(a, "json_validation"), boolValue(a, "expect_null"), boolValue(a, "invert"));
        if (type === "html") return s.addHTMLAssertion(name, maybeStr(a, "html_doc"), intValue(a, "doctype", 1), boolValue(a, "format"), boolValue(a, "errors_only"), boolValue(a, "show_successes"));
        return err("unknown-type", `Error: unknown assertion type '${type}'`);
      },
    },
    {
      name: "add_listener",
      description: "Add a listener.",
      inputSchema: toolSchema({ type: prop("string", "Listener type"), name: prop("string", "Name"), filename: prop("string", "Output file") }, ["type"]),
      execute: (a, s) => s.addListener(str(a, "type"), maybeStr(a, "filename")),
    },
    {
      name: "add_extended_listener",
      description: "Add an extended listener.",
      inputSchema: toolSchema({ type: prop("string", "Listener type"), filename: prop("string", "Output file") }, ["type"]),
      execute: (a, s) => s.addExtendedListener(str(a, "type"), maybeStr(a, "filename")),
    },
    {
      name: "add_timer",
      description: "Add a timer.",
      inputSchema: toolSchema({ type: prop("string", "Timer type"), delay: prop("integer", "Delay", 1000), range: prop("integer", "Range", 100), max_delay: prop("integer", "Max delay", 0), throughput: prop("string", "Throughput"), throughput_mode: prop("integer", "Mode", 0), group_size: prop("integer", "Group size", 0), sync_timeout: prop("integer", "Timeout", 0) }),
      execute: (a, s) => s.addTimer(str(a, "type", "constant"), intValue(a, "delay", 1000), intValue(a, "range", 100), intValue(a, "max_delay", 0), numValue(a, "throughput", 0), intValue(a, "throughput_mode", 0), intValue(a, "group_size", 0), intValue(a, "sync_timeout", 0)),
    },
    {
      name: "add_timer_at_path",
      description: "Add a timer to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), name: prop("string", "Name"), timer_type: prop("string", "Timer type") }),
      execute: (a, s) => (!str(a, "parent_path") ? err("invalid-args", "Error: parent_path is required") : s.addTimerAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "timer_type", "constant"), intValue(a, "delay", 1000), intValue(a, "range", 100), intValue(a, "max_delay", 0), numValue(a, "throughput", 0), intValue(a, "throughput_mode", 0), intValue(a, "group_size", 0), intValue(a, "sync_timeout", 0))),
    },
    {
      name: "add_listener_at_path",
      description: "Add a listener to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), name: prop("string", "Name"), listener_type: prop("string", "Listener type") }),
      execute: (a, s) => (!str(a, "parent_path") ? err("invalid-args", "Error: parent_path is required") : s.addListenerAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "listener_type", "view_results_tree"), maybeStr(a, "filename"), maybeStr(a, "script"), maybeStr(a, "language") || "groovy", maybeStr(a, "parameters"), boolValue(a, "reset_interpreter"))),
    },
    {
      name: "add_assertion_at_path",
      description: "Add an assertion to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), assertion_type: prop("string", "Assertion type"), name: prop("string", "Name") }),
      execute: (a, s) => (!str(a, "parent_path") ? err("invalid-args", "Error: parent_path is required") : s.addAssertionAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "assertion_type", "response"), maybeStr(a, "test_field"), maybeStr(a, "match_type"), arrayStrings(a, "patterns"), boolValue(a, "is_not"), maybeStr(a, "json_path"), maybeStr(a, "expected_value"), boolValue(a, "json_validation"), boolValue(a, "expect_null"), boolValue(a, "invert"), intValue(a, "max_duration", 0), intValue(a, "size", 0), maybeStr(a, "size_operator"), maybeStr(a, "xpath"), boolValue(a, "validate_xml"), boolValue(a, "ignore_whitespace"), boolValue(a, "use_tolerant_parser"), maybeStr(a, "jmespath"), maybeStr(a, "jmespath_expected_value"), boolValue(a, "jmespath_invert"))),
    },
    {
      name: "add_extractor_at_path",
      description: "Add an extractor to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), extractor_type: prop("string", "Extractor type"), ref_name: prop("string", "Variable") }),
      execute: (a, s) => {
        if (!str(a, "parent_path")) return err("invalid-args", "Error: parent_path is required");
        if (!str(a, "ref_name")) return err("invalid-args", "Error: ref_name is required");
        return s.addExtractorAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "extractor_type", "regex"), str(a, "ref_name"), maybeStr(a, "regex"), maybeStr(a, "template"), intValue(a, "match_number", 1), maybeStr(a, "default_value"), maybeStr(a, "json_path"), boolValue(a, "compute_concatenation"), maybeStr(a, "xpath"), boolValue(a, "use_namespaces"), maybeStr(a, "css_expr"), maybeStr(a, "attribute"), maybeStr(a, "left_boundary"), maybeStr(a, "right_boundary"), maybeStr(a, "jmespath"), maybeStr(a, "use_field"));
      },
    },
    {
      name: "add_preprocessor_at_path",
      description: "Add a pre-processor to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), preprocessor_type: prop("string", "Type") }),
      execute: (a, s) => (!str(a, "parent_path") ? err("invalid-args", "Error: parent_path is required") : s.addPreProcessorAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "preprocessor_type", "jsr223"), maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "language") || "groovy", maybeStr(a, "parameters"), boolValue(a, "cache_compiled", true), intValue(a, "timeout", 0))),
    },
    {
      name: "add_postprocessor_at_path",
      description: "Add a post-processor to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), postprocessor_type: prop("string", "Type") }),
      execute: (a, s) => (!str(a, "parent_path") ? err("invalid-args", "Error: parent_path is required") : s.addPostProcessorAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "postprocessor_type", "jsr223"), maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "language") || "groovy", maybeStr(a, "parameters"), boolValue(a, "cache_compiled", true))),
    },
    {
      name: "add_more_assertions",
      description: "Add additional assertion types (XML schema, MD5, BeanShell, JSR223, compare).",
      inputSchema: toolSchema({ type: prop("string", "Type"), name: prop("string", "Name") }, ["type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        const name = str(a, "name", `${type} assertion`);
        if (type === "xml_schema") return s.addXmlSchemaAssertion(name, maybeStr(a, "xsd_filename"), maybeStr(a, "xsd_content"));
        if (type === "md5hex") return s.addMd5HexAssertion(name, str(a, "md5_hex"), boolValue(a, "use_md5", true));
        if (type === "beanshell") return s.addBeanShellAssertion(name, maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "reset_interpreter"));
        if (type === "jsr223") return s.addJsr223Assertion(name, maybeStr(a, "language") || "groovy", maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "cache_compiled", true));
        if (type === "compare") return s.addCompareAssertion(name, maybeStr(a, "compare_content"), maybeStr(a, "compare_type"), boolValue(a, "use_response_data", true));
        return err("unknown-type", `Error: unknown assertion type '${type}'`);
      },
    },
    {
      name: "add_more_timers",
      description: "Add additional timer types (Poisson, BeanShell).",
      inputSchema: toolSchema({ type: prop("string", "Type"), name: prop("string", "Name") }, ["type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        const name = str(a, "name", `${type} timer`);
        if (type === "poisson") return s.addPoissonTimer(name, intValue(a, "delay", 300), intValue(a, "range", 100));
        if (type === "beanshell") return s.addBeanShellTimer(name, maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "reset_interpreter"));
        return err("unknown-type", `Error: unknown timer type '${type}'`);
      },
    },
    {
      name: "add_more_configs",
      description: "Add additional config elements (HTTP defaults, header manager, JDBC, etc.).",
      inputSchema: toolSchema({ type: prop("string", "Config type"), name: prop("string", "Name") }, ["type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        const name = str(a, "name", `${type} config`);
        if (type === "http_defaults") return s.addHttpDefaults(name, maybeStr(a, "domain"), maybeStr(a, "port"), maybeStr(a, "protocol") || "http", maybeStr(a, "path"), maybeStr(a, "content_encoding"));
        if (type === "http_header_manager") return s.addHttpHeaderManager(name, maybeStr(a, "headers"));
        if (type === "jdbc_config") return s.addJdbcConfig(name, maybeStr(a, "pool_max") || "10", maybeStr(a, "username"), maybeStr(a, "password"), maybeStr(a, "connection_url"), maybeStr(a, "driver_class"), maybeStr(a, "validation_query") || "Select 1");
        if (type === "keystore") return s.addKeystoreConfig(name, maybeStr(a, "preload") || "true", maybeStr(a, "variable_name"), maybeStr(a, "client_cert_alias_var"), maybeStr(a, "keystore_type") || "jks");
        if (type === "login_config") return s.addLoginConfig(name, maybeStr(a, "username_var"), maybeStr(a, "password_var"));
        if (type === "tcp_config") return s.addTcpConfig(name, maybeStr(a, "reuse_connection") || "true", maybeStr(a, "close_connection"), maybeStr(a, "nodelay"), maybeStr(a, "timeout"));
        if (type === "ftp_config") return s.addFtpConfig(name, maybeStr(a, "binary_mode"), maybeStr(a, "save_response"), maybeStr(a, "encoding"));
        return err("unknown-type", `Error: unknown config type '${type}'`);
      },
    },
    {
      name: "add_more_listeners",
      description: "Add additional listener types (BeanShell, JSR223, save response).",
      inputSchema: toolSchema({ type: prop("string", "Listener type"), name: prop("string", "Name") }, ["type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        const name = str(a, "name", `${type} listener`);
        if (type === "beanshell") return s.addBeanShellListener(name, maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "reset_interpreter"));
        if (type === "jsr223") return s.addJsr223Listener(name, maybeStr(a, "language") || "groovy", maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"));
        if (type === "save_response") return s.addSaveResponseListener(name, maybeStr(a, "output_directory"), maybeStr(a, "filename_prefix") || "response", boolValue(a, "success_only", true));
        return err("unknown-type", `Error: unknown listener type '${type}'`);
      },
    },
    {
      name: "add_ldap_sampler",
      description: "Add an LDAP sampler.",
      inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "Server") }, ["name", "server"]),
      execute: (a, s) => (str(a, "type", "basic") === "extended" ? s.addLdapExtRequest(str(a, "name"), str(a, "server"), intValue(a, "port", 389), maybeStr(a, "rootdn"), maybeStr(a, "search_filter"), maybeStr(a, "search_base"), maybeStr(a, "scope") || "2", boolValue(a, "use_ssl"), maybeStr(a, "connection_timeout"), maybeStr(a, "max_results"), boolValue(a, "use_user_dn")) : s.addLdapRequest(str(a, "name"), str(a, "server"), intValue(a, "port", 389), maybeStr(a, "rootdn"), maybeStr(a, "search_filter"), maybeStr(a, "search_base"), maybeStr(a, "attributes"), maybeStr(a, "scope") || "2", boolValue(a, "use_ssl"))),
    },
    {
      name: "add_mail_reader_sampler",
      description: "Add a mail reader sampler.",
      inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "Server"), username: prop("string", "Username") }, ["name", "server", "username"]),
      execute: (a, s) => s.addMailReaderRequest(str(a, "name"), maybeStr(a, "server_type") || "pop3", str(a, "server"), str(a, "username"), maybeStr(a, "password"), maybeStr(a, "folder") || "INBOX", intValue(a, "num_messages", 1), boolValue(a, "use_ssl"), boolValue(a, "use_starttls")),
    },
    {
      name: "add_jdbc_request",
      description: "Add a JDBC request sampler.",
      inputSchema: toolSchema({ name: prop("string", "Name"), data_source: prop("string", "JDBC pool name (alias: dataSource)"), query_type: prop("string", "Query type"), sql: prop("string", "SQL query"), parameter_values: prop("string", "Parameter values"), parameter_types: prop("string", "Parameter types"), variable_names: prop("string", "Variable names"), result_variable: prop("string", "Result variable"), query_timeout: prop("integer", "Query timeout", 0) }, ["name"]),
      execute: (a, s) => s.addJdbcRequest(str(a, "name"), maybeStr(a, "query_type"), maybeStr(a, "sql"), maybeStr(a, "parameter_values"), maybeStr(a, "parameter_types"), maybeStr(a, "variable_names"), maybeStr(a, "result_variable"), intValue(a, "query_timeout", 0), maybeStr(a, "dataSource") ?? maybeStr(a, "data_source")),
    },
    {
      name: "add_tcp_sampler",
      description: "Add a TCP sampler.",
      inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "Server"), port: prop("integer", "Port", 0), request_data: prop("string", "Request payload"), re_use_connection: prop("string", "Reuse connection (alias: reUseConnection)"), close_connection: prop("string", "Close connection"), nodelay: prop("string", "TCP nodelay"), username: prop("string", "Username"), password: prop("string", "Password"), timeout: prop("string", "Timeout"), eol_byte: prop("string", "EOL byte") }, ["name"]),
      execute: (a, s) => s.addTcpSampler(str(a, "name"), maybeStr(a, "server"), intValue(a, "port", 0), maybeStr(a, "reUseConnection") ?? maybeStr(a, "re_use_connection"), maybeStr(a, "close_connection"), maybeStr(a, "nodelay"), maybeStr(a, "request_data"), maybeStr(a, "username"), maybeStr(a, "password"), maybeStr(a, "timeout"), maybeStr(a, "eol_byte")),
    },
    {
      name: "add_smtp_sampler",
      description: "Add an SMTP sampler.",
      inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "SMTP server"), port: prop("integer", "Port", 25), use_auth: prop("string", "Use auth"), username: prop("string", "Username"), password: prop("string", "Password"), use_ssl: prop("string", "Use SSL"), use_tls: prop("string", "Use TLS"), starttls: prop("string", "Use STARTTLS"), sender: prop("string", "From address"), receiver: prop("string", "To address"), cc: prop("string", "CC"), bcc: prop("string", "BCC"), subject: prop("string", "Subject"), body: prop("string", "Body") }, ["name"]),
      execute: (a, s) => s.addSmtpSampler(str(a, "name"), maybeStr(a, "server"), intValue(a, "port", 25), maybeStr(a, "use_auth"), maybeStr(a, "username"), maybeStr(a, "password"), maybeStr(a, "use_ssl"), maybeStr(a, "use_tls"), maybeStr(a, "starttls"), maybeStr(a, "sender"), maybeStr(a, "receiver"), maybeStr(a, "cc"), maybeStr(a, "bcc"), maybeStr(a, "subject"), maybeStr(a, "body"), maybeStr(a, "suppress_subject"), maybeStr(a, "attach_file"), maybeStr(a, "message"), maybeStr(a, "plain_body"), maybeStr(a, "enable_debug")),
    },
    {
      name: "add_ftp_sampler",
      description: "Add an FTP sampler.",
      inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "FTP server"), port: prop("integer", "Port", 21), username: prop("string", "Username"), password: prop("string", "Password"), local_filename: prop("string", "Local file"), remote_filename: prop("string", "Remote file"), ftp_action: prop("string", "get/put"), binary_mode: prop("string", "Binary mode"), save_response: prop("string", "Save response"), encoding: prop("string", "File encoding") }, ["name"]),
      execute: (a, s) => s.addFtpSampler(str(a, "name"), maybeStr(a, "server"), intValue(a, "port", 21), maybeStr(a, "username"), maybeStr(a, "password"), maybeStr(a, "local_filename"), maybeStr(a, "remote_filename"), maybeStr(a, "ftp_action"), maybeStr(a, "binary_mode"), maybeStr(a, "save_response"), maybeStr(a, "encoding")),
    },
    {
      name: "add_system_sampler",
      description: "Add a System (OS process) sampler.",
      inputSchema: toolSchema({ name: prop("string", "Name"), command: prop("string", "Command"), command_parameters: prop("string", "Command parameters"), environment_variables: prop("string", "Environment variables (k=v;...)"), working_directory: prop("string", "Working directory"), stdout_filename: prop("string", "Stdout file"), stderr_filename: prop("string", "Stderr file"), timeout: prop("integer", "Timeout ms", 0), check_return_code: prop("string", "Check return code"), expected_return_code: prop("integer", "Expected return code", 0), interpreter: prop("string", "Interpreter") }, ["name"]),
      execute: (a, s) => s.addSystemSampler(str(a, "name"), maybeStr(a, "command"), maybeStr(a, "command_parameters"), maybeStr(a, "environment_variables"), maybeStr(a, "working_directory"), maybeStr(a, "stdout_filename"), maybeStr(a, "stderr_filename"), intValue(a, "timeout", 0), maybeStr(a, "check_return_code"), intValue(a, "expected_return_code", 0), maybeStr(a, "interpreter")),
    },
    {
      name: "add_test_action",
      description: "Add a Test Action sampler.",
      inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]),
      execute: (a, s) => s.addTestAction(str(a, "name"), maybeStr(a, "action") || "pause", intValue(a, "duration", 0)),
    },
    {
      name: "add_counter_config",
      description: "Add a Counter config element.",
      inputSchema: toolSchema({ name: prop("string", "Name"), variable_name: prop("string", "Variable") }, ["name", "variable_name"]),
      execute: (a, s) => s.addCounterConfig(str(a, "name"), maybeStr(a, "start") || "0", maybeStr(a, "end"), maybeStr(a, "increment") || "1", maybeStr(a, "format"), str(a, "variable_name"), boolValue(a, "per_thread", true), boolValue(a, "reset_on_tg_iteration")),
    },
    {
      name: "add_sample_timeout",
      description: "Add a Sample Timeout pre-processor.",
      inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]),
      execute: (a, s) => s.addSampleTimeout(str(a, "name"), intValue(a, "timeout", 0)),
    },
    {
      name: "add_regex_user_parameters",
      description: "Add RegEx User Parameters.",
      inputSchema: toolSchema({ name: prop("string", "Name"), reg_ex_ref_name: prop("string", "Ref") }, ["name", "reg_ex_ref_name"]),
      execute: (a, s) => s.addRegExUserParameters(str(a, "name"), str(a, "reg_ex_ref_name"), maybeStr(a, "param_names_group_nr"), maybeStr(a, "param_values_group_nr")),
    },
    {
      name: "add_xml_assertion",
      description: "Add an XML assertion.",
      inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]),
      execute: (a, s) => s.addXmlAssertion(str(a, "name")),
    },
    {
      name: "add_xml_schema_assertion",
      description: "Add an XML Schema assertion.",
      inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]),
      execute: (a, s) => s.addXmlSchemaAssertion(str(a, "name"), maybeStr(a, "xsd_filename"), maybeStr(a, "xsd_content")),
    },
    {
      name: "add_beanshell_assertion",
      description: "Add a BeanShell assertion.",
      inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]),
      execute: (a, s) => s.addBeanShellAssertion(str(a, "name"), maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "reset_interpreter")),
    },
    {
      name: "add_jsr223_assertion",
      description: "Add a JSR223 assertion.",
      inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]),
      execute: (a, s) => s.addJsr223Assertion(str(a, "name"), maybeStr(a, "language") || "groovy", maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "cache_compiled", true)),
    },
    {
      name: "add_md5hex_assertion",
      description: "Add an MD5 Hex assertion.",
      inputSchema: toolSchema({ name: prop("string", "Name"), md5_hex: prop("string", "Hash") }, ["name", "md5_hex"]),
      execute: (a, s) => s.addMd5HexAssertion(str(a, "name"), str(a, "md5_hex"), boolValue(a, "use_md5", true)),
    },
    {
      name: "add_backend_listener",
      description: "Add a Backend Listener.",
      inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]),
      execute: (a, s) => s.addBackendListener(str(a, "name"), maybeStr(a, "backend_impl"), maybeStr(a, "influxdb_url"), maybeStr(a, "influxdb_token"), maybeStr(a, "influxdb_org"), maybeStr(a, "influxdb_bucket"), maybeStr(a, "influxdb_measurement"), maybeStr(a, "graphite_host"), intValue(a, "graphite_port", 2003), maybeStr(a, "graphite_prefix")),
    },
    {
      name: "add_aggregate_graph",
      description: "Add an Aggregate Graph listener.",
      inputSchema: toolSchema({ name: prop("string", "Name") }),
      execute: (a, s) => s.addAggregateGraph(str(a, "name", "Aggregate Graph"), maybeStr(a, "filename")),
    },
    {
      name: "add_include_controller",
      description: "Add an Include Controller.",
      inputSchema: toolSchema({ name: prop("string", "Name"), include_path: prop("string", "Path") }, ["name", "include_path"]),
      execute: (a, s) => s.addIncludeController(str(a, "name"), str(a, "include_path")),
    },
  ];
  return tools;
}
