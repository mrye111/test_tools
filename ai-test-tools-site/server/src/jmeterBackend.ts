import cors from "cors";
import express, { type Express, type Response as ExpressResponse } from "express";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import { registerTestCaseRoutes } from "./features/testcase/routes.js";

type JsonObject = Record<string, unknown>;

type JmxProperty =
  | { kind: "string" | "bool" | "int" | "long" | "double"; name: string; value: string | number | boolean }
  | { kind: "collection"; name: string; items?: JmxProperty[] }
  | { kind: "element"; name: string; elementType: string; attrs?: Record<string, string>; props?: JmxProperty[] }
  | { kind: "objSaveConfig" };

export type JmxElement = {
  tag: string;
  guiclass: string;
  testclass: string;
  testname: string;
  enabled?: boolean;
  props: JmxProperty[];
  children: JmxElement[];
};

type TreeNodeRef = {
  path: string;
  element: JmxElement;
  parentChildren: JmxElement[] | null;
  index: number;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonObject;
  execute: (args: JsonObject, service: TestPlanService) => string;
};

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "jmeter-mcp-server";
const SERVER_VERSION = "1.0.0";

const empty = (value: unknown): string => (value == null ? "" : String(value));
const boolText = (value: boolean): string => (value ? "true" : "false");

function attrEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pString(name: string, value: unknown): JmxProperty {
  return { kind: "string", name, value: empty(value) };
}

function pBool(name: string, value: boolean): JmxProperty {
  return { kind: "bool", name, value };
}

function pInt(name: string, value: number): JmxProperty {
  return { kind: "int", name, value };
}

function pLong(name: string, value: number | string): JmxProperty {
  return { kind: "long", name, value };
}

function pDouble(name: string, value: number | string): JmxProperty {
  return { kind: "double", name, value };
}

function pCollection(name: string, items: JmxProperty[] = []): JmxProperty {
  return { kind: "collection", name, items };
}

function pElement(
  name: string,
  elementType: string,
  props: JmxProperty[] = [],
  attrs: Record<string, string> = {},
): JmxProperty {
  return { kind: "element", name, elementType, attrs, props };
}

function element(
  tag: string,
  guiclass: string,
  testclass: string,
  testname: string,
  props: JmxProperty[] = [],
): JmxElement {
  return { tag, guiclass, testclass, testname, enabled: true, props, children: [] };
}

function argumentProp(name: string, value: string, http = false, encoded = false): JmxProperty {
  const props = http
    ? [
        pBool("HTTPArgument.always_encode", encoded),
        pString("Argument.value", value),
        pString("Argument.metadata", "="),
        pBool("HTTPArgument.use_equals", true),
        pString("Argument.name", name),
      ]
    : [pString("Argument.name", name), pString("Argument.value", value), pString("Argument.metadata", "=")];
  return pElement(name, http ? "HTTPArgument" : "Argument", props);
}

function argumentsElementProp(name: string, args: Array<[string, string]> = [], http = false): JmxProperty {
  return pElement(
    name,
    "Arguments",
    [pCollection("Arguments.arguments", args.map(([key, value]) => argumentProp(key, value, http, true)))],
    http ? { guiclass: "HTTPArgumentsPanel", testclass: "Arguments", testname: "User Defined Variables" } : {},
  );
}

function jmsPropertiesProp(properties: Array<[string, string]> = [], name = "jms.jmsProperties"): JmxProperty {
  return pElement(
    name,
    "JMSProperties",
    [pCollection("JMSProperties.properties", properties.map(([key, value]) => pElement("", "JMSProperty", [pString("JMSProperty.name", key), pString("JMSProperty.value", value)])))],
  );
}

function parsePairs(value: string | null | undefined, pairDelimiter = ","): Array<[string, string]> {
  if (!value) return [];
  return value
    .split(pairDelimiter)
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => pair.split("=", 2))
    .filter((pair): pair is [string, string] => pair.length === 2)
    .map(([key, val]) => [key.trim(), val.trim()]);
}

function renderProp(prop: JmxProperty, depth: number): string {
  const pad = "  ".repeat(depth);
  if (prop.kind === "string") {
    return `${pad}<stringProp name="${attrEscape(prop.name)}">${textEscape(empty(prop.value))}</stringProp>\n`;
  }
  if (prop.kind === "bool") {
    return `${pad}<boolProp name="${attrEscape(prop.name)}">${boolText(Boolean(prop.value))}</boolProp>\n`;
  }
  if (prop.kind === "int") {
    return `${pad}<intProp name="${attrEscape(prop.name)}">${Number(prop.value)}</intProp>\n`;
  }
  if (prop.kind === "long") {
    return `${pad}<longProp name="${attrEscape(prop.name)}">${textEscape(empty(prop.value))}</longProp>\n`;
  }
  if (prop.kind === "double") {
    return `${pad}<doubleProp name="${attrEscape(prop.name)}">${textEscape(empty(prop.value))}</doubleProp>\n`;
  }
  if (prop.kind === "collection") {
    if (!prop.items || prop.items.length === 0) {
      return `${pad}<collectionProp name="${attrEscape(prop.name)}"/>\n`;
    }
    return `${pad}<collectionProp name="${attrEscape(prop.name)}">\n${prop.items
      .map((item) => renderProp(item, depth + 1))
      .join("")}${pad}</collectionProp>\n`;
  }
  if (prop.kind === "element") {
    const attrs = Object.entries({ name: prop.name, elementType: prop.elementType, ...(prop.attrs ?? {}) })
      .map(([key, value]) => `${key}="${attrEscape(value)}"`)
      .join(" ");
    if (!prop.props || prop.props.length === 0) {
      return `${pad}<elementProp ${attrs}/>\n`;
    }
    return `${pad}<elementProp ${attrs}>\n${prop.props
      .map((item) => renderProp(item, depth + 1))
      .join("")}${pad}</elementProp>\n`;
  }
  return `${pad}<objProp>
${pad}  <name>saveConfig</name>
${pad}  <value class="SampleSaveConfiguration">
${pad}    <time>true</time>
${pad}    <latency>true</latency>
${pad}    <timestamp>true</timestamp>
${pad}    <success>true</success>
${pad}    <label>true</label>
${pad}    <code>true</code>
${pad}    <message>true</message>
${pad}    <threadName>true</threadName>
${pad}    <dataType>true</dataType>
${pad}    <encoding>false</encoding>
${pad}    <assertions>true</assertions>
${pad}    <subresults>true</subresults>
${pad}    <responseData>false</responseData>
${pad}    <samplerData>false</samplerData>
${pad}    <xml>false</xml>
${pad}    <fieldNames>true</fieldNames>
${pad}    <responseHeaders>false</responseHeaders>
${pad}    <requestHeaders>false</requestHeaders>
${pad}    <responseDataOnError>true</responseDataOnError>
${pad}    <saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
${pad}    <assertionsResultsToSave>0</assertionsResultsToSave>
${pad}    <bytes>true</bytes>
${pad}    <sentBytes>true</sentBytes>
${pad}    <url>true</url>
${pad}    <threadCounts>true</threadCounts>
${pad}    <idleTime>true</idleTime>
${pad}    <connectTime>true</connectTime>
${pad}  </value>
${pad}</objProp>\n`;
}

function renderElement(node: JmxElement, depth: number): string {
  const pad = "  ".repeat(depth);
  const attrs = [
    `guiclass="${attrEscape(node.guiclass)}"`,
    `testclass="${attrEscape(node.testclass)}"`,
    `testname="${attrEscape(node.testname)}"`,
    `enabled="${node.enabled === false ? "false" : "true"}"`,
  ].join(" ");
  if (node.props.length === 0) {
    return `${pad}<${node.tag} ${attrs}/>\n`;
  }
  return `${pad}<${node.tag} ${attrs}>\n${node.props.map((prop) => renderProp(prop, depth + 1)).join("")}${pad}</${node.tag}>\n`;
}

function renderHashTree(children: JmxElement[], depth: number): string {
  const pad = "  ".repeat(depth);
  if (children.length === 0) {
    return `${pad}<hashTree/>\n`;
  }
  return `${pad}<hashTree>\n${children
    .map((child) => `${renderElement(child, depth + 1)}${renderHashTree(child.children, depth + 1)}`)
    .join("")}${pad}</hashTree>\n`;
}

export function serializeJmx(root: JmxElement): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">\n${renderHashTree([root], 1)}</jmeterTestPlan>\n`;
}

function resultCollector(type: string, displayName: string, filename?: string): JmxElement | null {
  const guiByType: Record<string, string> = {
    view_results_tree: "ViewResultsFullVisualizer",
    aggregate_report: "StatVisualizer",
    summary_report: "SummaryReport",
    simple_data_writer: "SimpleDataWriter",
    view_results_in_table: "TableVisualizer",
    graph_results: "GraphVisualizer",
    spline_visualizer: "SplineVisualizer",
    response_time_graph: "RespTimeGraphVisualizer",
    assertion_results: "AssertionVisualizer",
    generate_summary_results: "SummariserGui",
  };
  const guiclass = guiByType[type];
  if (!guiclass) return null;
  const props: JmxProperty[] = [pBool("ResultCollector.error_logging", false), { kind: "objSaveConfig" }];
  if (filename) props.unshift(pString("filename", filename));
  return element("ResultCollector", guiclass, "ResultCollector", displayName, props);
}

function defaultControllerName(type: string | null | undefined): string {
  const names: Record<string, string> = {
    if: "If Controller",
    while: "While Controller",
    foreach: "ForEach Controller",
    transaction: "Transaction Controller",
    throughput: "Throughput Controller",
    once_only: "Once Only Controller",
    random_order: "Random Order Controller",
    switch: "Switch Controller",
    runtime: "Runtime Controller",
    loop: "Loop Controller",
    simple: "Simple Controller",
    module: "Module Controller",
    interleave: "Interleave Controller",
    random: "Random Controller",
    critical_section: "Critical Section Controller",
  };
  return type ? names[type] ?? `${type} Controller` : "Controller";
}

export class TestPlanService {
  private root: JmxElement | null = null;
  private scopeStack: JmxElement[] = [];
  private jmeterHome: string | null = process.env.JMETER_HOME ?? null;

  initialize(jmeterHome: string): string {
    this.jmeterHome = jmeterHome;
    return `JMeter initialized with home: ${jmeterHome}`;
  }

  createTestPlan(name: string, comments?: string | null): string {
    const props: JmxProperty[] = [];
    if (comments) props.push(pString("TestPlan.comments", comments));
    props.push(
      pBool("TestPlan.functional_mode", false),
      pBool("TestPlan.serialize_threadgroups", false),
      pBool("TestPlan.tearDown_on_shutdown", true),
      pElement("TestPlan.user_defined_variables", "Arguments", [pCollection("Arguments.arguments")]),
    );
    this.root = element("TestPlan", "TestPlanGui", "TestPlan", name, props);
    this.scopeStack = [this.root];
    return `Test plan created: ${name}`;
  }

  saveTestPlan(path: string): string {
    try {
      this.ensureTestPlan();
      const outputPath = resolve(path);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, serializeJmx(this.root!), "utf8");
      return `Test plan saved: ${path}`;
    } catch (error) {
      return `Error saving test plan: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  loadTestPlan(path: string): string {
    try {
      if (!existsSync(path)) return `Error: File not found: ${path}`;
      const xml = readFileSync(path, "utf8");
      this.root = this.parseLoadedPlan(xml);
      this.scopeStack = [this.root];
      return `Test plan loaded: ${path}`;
    } catch (error) {
      return `Error loading test plan: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  runTestPlan(path?: string | null, jtlPath?: string | null): string {
    if (!this.jmeterHome) return "Error: JMeter not initialized. Call initialize() first.";
    const executable = process.platform === "win32" ? "jmeter.bat" : "jmeter";
    const jmeterBin = resolve(this.jmeterHome, "bin", executable);
    if (!existsSync(jmeterBin)) return `Error running test plan: JMeter executable not found: ${jmeterBin}`;
    const planPath = path && path.length > 0 ? path : resolve(process.cwd(), "jmeter-mcp-current.jmx");
    if (!path) this.saveTestPlan(planPath);
    const args = ["-n", "-t", planPath];
    if (jtlPath) args.push("-l", jtlPath);
    const result = spawnSync(jmeterBin, args, { encoding: "utf8", shell: process.platform === "win32" });
    if (result.status !== 0) {
      return `Error running test plan: ${result.stderr || result.stdout || `exit code ${result.status}`}`;
    }
    return "Test plan execution completed";
  }

  listTestPlanTree(): string {
    try {
      this.ensureTestPlan();
      const lines: string[] = [];
      this.appendTree(lines, [this.root!], "", 0);
      return `${lines.join("\n")}\n`;
    } catch (error) {
      return `Error listing test plan tree: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  updateElement(path: string, name?: string | null, enabled?: boolean | null, properties?: Record<string, string> | null): string {
    try {
      const ref = this.resolvePath(path);
      if (name) ref.element.testname = name;
      if (enabled !== null && enabled !== undefined) ref.element.enabled = enabled;
      if (properties) {
        for (const [key, value] of Object.entries(properties)) {
          this.setStringProperty(ref.element, key, value);
        }
      }
      return `Element updated: ${ref.path} ${ref.element.testname}`;
    } catch (error) {
      return `Error updating element: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  deleteElement(path: string): string {
    try {
      const ref = this.resolvePath(path);
      if (!ref.parentChildren) return "Error deleting element: root tree cannot be deleted";
      ref.parentChildren.splice(ref.index, 1);
      return `Element deleted: ${ref.path} ${ref.element.testname}`;
    } catch (error) {
      return `Error deleting element: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  moveElement(sourcePath: string, targetParentPath: string): string {
    try {
      const source = this.resolvePath(sourcePath);
      const target = this.resolvePath(targetParentPath);
      if (!source.parentChildren) return "Error moving element: root tree cannot be moved";
      if (target.path.startsWith(`${source.path}/`)) {
        return "Error moving element: target parent cannot be inside the source subtree";
      }
      const [node] = source.parentChildren.splice(source.index, 1);
      target.element.children.push(node);
      return `Element moved: ${source.path} -> ${target.path}`;
    } catch (error) {
      return `Error moving element: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  replaceScript(
    path: string,
    language?: string | null,
    script?: string | null,
    filename?: string | null,
    parameters?: string | null,
    cacheCompiled?: boolean | null,
  ): string {
    try {
      const ref = this.resolvePath(path);
      if (language !== null && language !== undefined) this.setStringProperty(ref.element, "scriptLanguage", language);
      if (script !== null && script !== undefined) this.setStringProperty(ref.element, "script", script);
      if (filename !== null && filename !== undefined) this.setStringProperty(ref.element, "filename", filename);
      if (parameters !== null && parameters !== undefined) this.setStringProperty(ref.element, "parameters", parameters);
      if (cacheCompiled !== null && cacheCompiled !== undefined) {
        this.setStringProperty(ref.element, "cacheKey", cacheCompiled ? ref.element.testname : "");
      }
      return `Script replaced: ${ref.path} ${ref.element.testname}`;
    } catch (error) {
      return `Error replacing script: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  validateTestPlan(): string {
    try {
      this.ensureTestPlan();
      const errors: string[] = [];
      const warnings: string[] = [];
      this.validateNode(this.root!, "/0", errors, warnings);
      let out = `Validation summary: errors=${errors.length}, warnings=${warnings.length}\n`;
      if (errors.length) out += `Errors:\n${errors.map((item) => `- ${item}`).join("\n")}\n`;
      if (warnings.length) out += `Warnings:\n${warnings.map((item) => `- ${item}`).join("\n")}\n`;
      if (!errors.length && !warnings.length) out += "No structural issues found.";
      return out;
    } catch (error) {
      return `Error validating test plan: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addThreadGroup(name: string, numThreads: number, rampUp: number, loops: number, duration: number, delay: number): string {
    try {
      this.ensureTestPlan();
      const node = this.threadGroup("ThreadGroup", "ThreadGroupGui", "ThreadGroup", name, numThreads, rampUp, loops, duration, delay);
      this.pushThreadGroup(node);
      return `Thread group added: ${name} (threads=${numThreads}, rampUp=${rampUp}, loops=${loops}${duration > 0 ? `, duration=${duration}s` : ""})`;
    } catch (error) {
      return `Error adding thread group: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addSetupThreadGroup(name: string, numThreads: number, rampUp: number, loops: number): string {
    try {
      this.ensureTestPlan();
      this.pushThreadGroup(this.threadGroup("SetupThreadGroup", "SetupThreadGroupGui", "SetupThreadGroup", name, numThreads, rampUp, loops, 0, 0));
      return `Setup thread group added: ${name}`;
    } catch (error) {
      return `Error adding setup thread group: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addPostThreadGroup(name: string, numThreads: number, rampUp: number, loops: number): string {
    try {
      this.ensureTestPlan();
      this.pushThreadGroup(this.threadGroup("PostThreadGroup", "PostThreadGroupGui", "PostThreadGroup", name, numThreads, rampUp, loops, 0, 0));
      return `Post thread group added: ${name}`;
    } catch (error) {
      return `Error adding post thread group: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addHttpRequest(
    name: string,
    method: string,
    domain: string,
    port: number,
    path: string,
    protocol?: string | null,
    contentType?: string | null,
    bodyData?: string | null,
    headers?: string[] | null,
    params?: string[] | null,
  ): string {
    try {
      this.ensureThreadGroup();
      const sampler = this.httpSampler(name, method, domain, port, protocol || "https", path, bodyData || "", "", params ?? []);
      if (contentType) sampler.props.push(pString("HTTPSampler.contentType", contentType));
      const attached = this.attach(sampler);
      if (headers?.length) attached.children.push(this.headerManager(`${name} Headers`, headers.map((line) => line.replace(/:\s*/, "=")).join(";")));
      return `HTTP request added: ${name} ${method} ${domain}${path}`;
    } catch (error) {
      return `Error adding HTTP request: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addScriptElement(name: string, type: string, language?: string | null, script?: string | null, filename?: string | null): string {
    try {
      this.ensureThreadGroup();
      const safeLang = language || "groovy";
      if ((type || "sampler") === "sampler") {
        this.attach(safeLang.toLowerCase() === "beanshell"
          ? this.beanShellSampler(name, script || "", filename || "", "")
          : this.jsr223Sampler(name, safeLang, script || "", filename || "", ""));
        return `Script sampler added: ${name}`;
      }
      if (type === "pre_processor") {
        this.attach(this.jsr223PreProcessor(name, safeLang, script || "", filename || "", "", false));
        return `Pre-processor added: ${name}`;
      }
      if (type === "post_processor") {
        this.attach(this.jsr223PostProcessor(name, safeLang, script || "", filename || "", "", false));
        return `Post-processor added: ${name}`;
      }
      return `Error: unknown script type '${type}'`;
    } catch (error) {
      return `Error adding script: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addResponseAssertion(name: string, testField?: string | null, matchType?: string | null, patterns?: string[] | null, isNot = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(this.responseAssertion(name, testField || "response_data", matchType || "substring", patterns ?? [], isNot));
      return `Response assertion added: ${name}`;
    } catch (error) {
      return `Error adding assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addJsonPathAssertion(name: string, jsonPath?: string | null, expectedValue?: string | null, jsonValidation = false, expectNull = false, invert = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("JSONPathAssertion", "JSONPathAssertionGui", "JSONPathAssertion", name, [
        pString("JSON_PATH", jsonPath || ""),
        pString("EXPECTED_VALUE", expectedValue || ""),
        pBool("JSONVALIDATION", jsonValidation),
        pBool("EXPECT_NULL", expectNull),
        pBool("INVERT", invert),
      ]));
      return `JSON Path assertion added: ${name}`;
    } catch (error) {
      return `Error adding JSON Path assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addDurationAssertion(name: string, maxDuration: number): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("DurationAssertion", "DurationAssertionGui", "DurationAssertion", name, [pLong("DurationAssertion.duration", maxDuration)]));
      return `Duration assertion added: ${name} (max=${maxDuration}ms)`;
    } catch (error) {
      return `Error adding duration assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addSizeAssertion(name: string, testField: string, comparator: number, size: number): string {
    try {
      this.ensureThreadGroup();
      this.attach(this.sizeAssertion(name, testField, comparator, size));
      return `Size assertion added: ${name}`;
    } catch (error) {
      return `Error adding size assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addXPathAssertion(name: string, xpath?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("XPath2Assertion", "XPath2AssertionGui", "XPath2Assertion", name, [pString("XPath2Assertion.xpath", xpath || "")]));
      return `XPath assertion added: ${name}`;
    } catch (error) {
      return `Error adding XPath assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addJMESPathAssertion(name: string, jmesPath?: string | null, expectedValue?: string | null, jsonValidation = false, expectNull = false, invert = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("JMESPathAssertion", "JMESPathAssertionGui", "JMESPathAssertion", name, [
        pString("JMESPathAssertion.jmesPath", jmesPath || ""),
        pString("JMESPathAssertion.expectedValue", expectedValue || ""),
        pBool("JMESPathAssertion.jsonValidation", jsonValidation),
        pBool("JMESPathAssertion.expectNull", expectNull),
        pBool("JMESPathAssertion.invert", invert),
      ]));
      return `JMESPath assertion added: ${name}`;
    } catch (error) {
      return `Error adding JMESPath assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addHTMLAssertion(name: string, document?: string | null, doctype = 1, format = false, errorsOnly = false, showSuccesses = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("HTMLAssertion", "HTMLAssertionGui", "HTMLAssertion", name, [
        pString("filename", document || ""),
        pString("doctype", String(doctype)),
        pBool("errorsonly", errorsOnly),
        pBool("format", format),
        pBool("showSuccess", showSuccesses),
      ]));
      return `HTML assertion added: ${name}`;
    } catch (error) {
      return `Error adding HTML assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addXmlSchemaAssertion(name: string, xsdFilename?: string | null, xsdContent?: string | null): string {
    try {
      this.ensureThreadGroup();
      const props = [pString("xmlschema_assertion_filename", xsdFilename || "")];
      if (xsdContent) props.push(pString("xmlschema_assertion_content", xsdContent));
      this.attach(element("XMLSchemaAssertion", "XMLSchemaAssertionGUI", "XMLSchemaAssertion", name, props));
      return `XML Schema assertion added: ${name}`;
    } catch (error) {
      return `Error adding XML Schema assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addMd5HexAssertion(name: string, md5Hex?: string | null, useMd5 = true): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("MD5HexAssertion", "MD5HexAssertionGUI", "MD5HexAssertion", name, [pString("MD5HexAssertion.size", md5Hex || "")]));
      return `MD5 Hex assertion added: ${name}`;
    } catch (error) {
      return `Error adding MD5 Hex assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addBeanShellAssertion(name: string, script?: string | null, filename?: string | null, parameters?: string | null, resetInterpreter = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(this.beanShellAssertion(name, script || "", filename || "", parameters || "", resetInterpreter));
      return `BeanShell assertion added: ${name}`;
    } catch (error) {
      return `Error adding BeanShell assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addJsr223Assertion(name: string, language?: string | null, script?: string | null, filename?: string | null, parameters?: string | null, cacheCompiled = true): string {
    try {
      this.ensureThreadGroup();
      this.attach(this.jsr223Assertion(name, language || "groovy", script || "", filename || "", parameters || "", cacheCompiled));
      return `JSR223 assertion added: ${name}`;
    } catch (error) {
      return `Error adding JSR223 assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addCompareAssertion(name: string, compareContent?: string | null, compareType?: string | null, useResponseData = true): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("CompareAssertion", "TestBeanGUI", "CompareAssertion", name, [
        pBool("compareContent", useResponseData),
        pLong("compareTime", -1),
        pCollection("stringsToSkip"),
      ]));
      return `Compare assertion added: ${name}`;
    } catch (error) {
      return `Error adding Compare assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addXmlAssertion(name: string): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("XMLAssertion", "XMLAssertionGui", "XMLAssertion", name));
      return `XML assertion added: ${name}`;
    } catch (error) {
      return `Error adding XML assertion: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addListener(type: string, filename?: string | null): string {
    try {
      this.ensurePlan();
      const listener = resultCollector(type || "view_results_tree", type || "view_results_tree", filename || "");
      if (!listener) return `Error: unknown listener type '${type}'`;
      this.attach(listener);
      return `Listener added: ${type}`;
    } catch (error) {
      return `Error adding listener: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addExtendedListener(type: string, filename?: string | null): string {
    try {
      this.ensurePlan();
      const listener = resultCollector(type || "view_results_tree", type || "view_results_tree", filename || "");
      if (!listener) return `Error: unknown listener type '${type}'`;
      this.attach(listener);
      return `Listener added: ${type}`;
    } catch (error) {
      return `Error adding extended listener: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addBeanShellListener(name: string, script?: string | null, filename?: string | null, parameters?: string | null, resetInterpreter = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("BeanShellListener", "TestBeanGUI", "BeanShellListener", name, [
        pString("script", script || ""),
        pString("filename", filename || ""),
        pString("parameters", parameters || ""),
        pBool("resetInterpreter", resetInterpreter),
      ]));
      return `BeanShell listener added: ${name}`;
    } catch (error) {
      return `Error adding BeanShell listener: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addJsr223Listener(name: string, language?: string | null, script?: string | null, filename?: string | null, parameters?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("JSR223Listener", "TestBeanGUI", "JSR223Listener", name, [
        pString("scriptLanguage", language || "groovy"),
        pString("script", script || ""),
        pString("filename", filename || ""),
        pString("parameters", parameters || ""),
        pString("cacheKey", name || ""),
      ]));
      return `JSR223 listener added: ${name}`;
    } catch (error) {
      return `Error adding JSR223 listener: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addSaveResponseListener(name: string, outputDirectory?: string | null, filenamePrefix?: string | null, successOnly = true): string {
    try {
      this.ensureThreadGroup();
      const file = outputDirectory ? `${outputDirectory}/${filenamePrefix || "response"}` : filenamePrefix || "response";
      this.attach(element("ResultCollector", "SimpleDataWriter", "ResultCollector", name, [
        pString("filename", file),
        pBool("ResultCollector.error_logging", !successOnly),
        { kind: "objSaveConfig" },
      ]));
      return `Save response listener added: ${name}`;
    } catch (error) {
      return `Error adding save response listener: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addBackendListener(
    name: string,
    backendImpl?: string | null,
    influxdbUrl?: string | null,
    influxdbToken?: string | null,
    influxdbOrg?: string | null,
    influxdbBucket?: string | null,
    influxdbMeasurement?: string | null,
    graphiteHost?: string | null,
    graphitePort = 2003,
    graphitePrefix?: string | null,
  ): string {
    try {
      this.ensureThreadGroup();
      const backendClass = backendImpl || "org.apache.jmeter.visualizers.backend.influxdb.InfluxdbBackendListenerClient";
      const args: Array<[string, string]> = [
        ["influxdbUrl", influxdbUrl || ""],
        ["influxdbToken", influxdbToken || ""],
        ["influxdbOrg", influxdbOrg || ""],
        ["influxdbBucket", influxdbBucket || ""],
        ["measurement", influxdbMeasurement || "jmeter"],
        ["graphiteHost", graphiteHost || ""],
        ["graphitePort", String(graphitePort || 2003)],
        ["graphitePrefix", graphitePrefix || ""],
        ["summaryOnly", "false"],
        ["samplersRegex", ".*"],
        ["percentiles", "99;95;90"],
        ["testTitle", name || "JMeter Test"],
        ["eventTags", ""],
      ];
      if (backendClass.includes(".influxdb.")) {
        args.unshift(["influxdbMetricsSender", "org.apache.jmeter.visualizers.backend.influxdb.HttpMetricsSender"]);
      }
      this.attach(element("BackendListener", "BackendListenerGui", "BackendListener", name, [
        pString("classname", backendClass),
        argumentsElementProp("arguments", args),
      ]));
      return `Backend listener added: ${name}`;
    } catch (error) {
      return `Error adding backend listener: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addAggregateGraph(name: string, filename?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("ResultCollector", "StatGraphVisualizer", "ResultCollector", name, [
        ...(filename ? [pString("filename", filename)] : []),
        pBool("ResultCollector.error_logging", false),
        { kind: "objSaveConfig" },
      ]));
      return `Aggregate graph listener added: ${name}`;
    } catch (error) {
      return `Error adding aggregate graph: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addTimer(type: string, delay: number, range: number, maxDelay: number, throughput: number, throughputMode: number, groupSize: number, syncTimeout: number): string {
    try {
      this.ensureThreadGroup();
      const timer = this.timer(type || "constant", "", delay, range, maxDelay, throughput, throughputMode, groupSize, syncTimeout);
      if (!timer) return `Error: unknown timer type '${type}'`;
      this.attach(timer);
      return `Timer added: ${type || "constant"}`;
    } catch (error) {
      return `Error adding timer: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addPoissonTimer(name: string, delay: number, range: number): string {
    try {
      this.ensureThreadGroup();
      this.attach(this.timer("poisson", name, delay, range, range, 0, 0, 0, 0)!);
      return `Poisson timer added: ${name}`;
    } catch (error) {
      return `Error adding Poisson timer: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addBeanShellTimer(name: string, script?: string | null, filename?: string | null, parameters?: string | null, resetInterpreter = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("BeanShellTimer", "TestBeanGUI", "BeanShellTimer", name, [
        pString("BeanShellTimer.script", script || ""),
        pString("BeanShellTimer.filename", filename || ""),
        pString("BeanShellTimer.parameters", parameters || ""),
        pBool("BeanShellTimer.resetInterpreter", resetInterpreter),
      ]));
      return `BeanShell timer added: ${name}`;
    } catch (error) {
      return `Error adding BeanShell timer: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addTimerAtPath(parentPath: string, name: string | null, type: string, delay: number, range: number, maxDelay: number, throughput: number, throughputMode: number, groupSize: number, syncTimeout: number): string {
    try {
      const ref = this.resolvePath(parentPath);
      const timer = this.timer(type || "constant", name || "", delay, range, maxDelay, throughput, throughputMode, groupSize, syncTimeout);
      if (!timer) return `Error: unknown timer type '${type}'`;
      ref.element.children.push(timer);
      return `Timer added at ${parentPath}: ${timer.testname} (${type})`;
    } catch (error) {
      return `Error adding timer at path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addListenerAtPath(parentPath: string, name: string | null, listenerType: string, filename?: string | null, script?: string | null, language?: string | null, parameters?: string | null, resetInterpreter = false): string {
    try {
      const ref = this.resolvePath(parentPath);
      let listener: JmxElement | null = null;
      const listenerName = name || listenerType.replace(/_/g, " ");
      if (["view_results_tree", "aggregate_report", "summary_report", "simple_data_writer"].includes(listenerType)) {
        listener = resultCollector(listenerType, listenerName, filename || "");
      } else if (listenerType === "beanshell") {
        listener = element("BeanShellListener", "TestBeanGUI", "BeanShellListener", listenerName, [
          pString("filename", filename || ""),
          pString("script", script || ""),
          pString("parameters", parameters || ""),
          pBool("resetInterpreter", resetInterpreter),
        ]);
      } else if (listenerType === "jsr223") {
        listener = element("JSR223Listener", "TestBeanGUI", "JSR223Listener", listenerName, [
          pString("filename", filename || ""),
          pString("script", script || ""),
          pString("scriptLanguage", language || "groovy"),
          pString("parameters", parameters || ""),
          pString("cacheKey", "true"),
        ]);
      }
      if (!listener) return `Error: unknown listener type '${listenerType}'`;
      ref.element.children.push(listener);
      return `Listener added at ${parentPath}: ${listenerName} (${listenerType})`;
    } catch (error) {
      return `Error adding listener at path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addAssertionAtPath(
    parentPath: string,
    name: string | null,
    assertionType: string,
    testField?: string | null,
    matchType?: string | null,
    patterns?: string[] | null,
    isNot = false,
    jsonPath?: string | null,
    expectedValue?: string | null,
    jsonValidation = false,
    expectNull = false,
    invert = false,
    maxDuration = 0,
    size = 0,
    sizeOperator?: string | null,
    xpath?: string | null,
    validateXml = false,
    ignoreWhitespace = false,
    useTolerantParser = false,
    jmespath?: string | null,
    jmespathExpectedValue?: string | null,
    jmespathInvert = false,
  ): string {
    try {
      const ref = this.resolvePath(parentPath);
      const assertionName = name || defaultAssertionName(assertionType);
      const assertion = this.assertionByType(assertionName, assertionType, {
        testField,
        matchType,
        patterns,
        isNot,
        jsonPath,
        expectedValue,
        jsonValidation,
        expectNull,
        invert,
        maxDuration,
        size,
        sizeOperator,
        xpath,
        jmespath,
        jmespathExpectedValue,
        jmespathInvert,
      });
      if (!assertion) return `Error: unknown assertion type '${assertionType}'`;
      ref.element.children.push(assertion);
      return `Assertion added at ${parentPath}: ${assertionName} (${assertionType})`;
    } catch (error) {
      return `Error adding assertion at path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addExtractor(
    type: string,
    refName: string,
    regex?: string | null,
    template?: string | null,
    matchNumber = 1,
    defaultValue?: string | null,
    leftBoundary?: string | null,
    rightBoundary?: string | null,
    jsonPath?: string | null,
    xpath?: string | null,
    cssExpr?: string | null,
    jmesPath?: string | null,
    useField?: string | null,
    computeConcatenation = false,
  ): string {
    try {
      this.ensureThreadGroup();
      const extractor = this.extractorByType(type || "regex", `Extractor: ${refName}`, refName, {
        regex,
        template,
        matchNumber,
        defaultValue,
        leftBoundary,
        rightBoundary,
        jsonPath,
        xpath,
        cssExpr,
        jmesPath,
        useField,
        computeConcatenation,
      });
      if (!extractor) return `Error: unknown extractor type '${type}'`;
      this.attach(extractor);
      return `Extractor added: ${type || "regex"} (${refName})`;
    } catch (error) {
      return `Error adding extractor: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addExtractorAtPath(parentPath: string, name: string | null, extractorType: string, refName: string, regex?: string | null, template?: string | null, matchNumber = 1, defaultValue?: string | null, jsonPath?: string | null, computeConcatenation = false, xpath?: string | null, useNamespaces = false, cssExpr?: string | null, attribute?: string | null, leftBoundary?: string | null, rightBoundary?: string | null, jmesPath?: string | null, useField?: string | null): string {
    try {
      const ref = this.resolvePath(parentPath);
      const extractorName = name || `Extractor: ${refName}`;
      const extractor = this.extractorByType(extractorType || "regex", extractorName, refName, {
        regex,
        template,
        matchNumber,
        defaultValue,
        jsonPath,
        computeConcatenation,
        xpath,
        cssExpr,
        attribute,
        leftBoundary,
        rightBoundary,
        jmesPath,
        useField,
      });
      if (!extractor) return `Error: unknown extractor type '${extractorType}'`;
      ref.element.children.push(extractor);
      return `Extractor added at ${parentPath}: ${extractorName}`;
    } catch (error) {
      return `Error adding extractor at path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addConfigElement(type: string, filename?: string | null, variableNames?: string | null, delimiter = ",", shareMode = "shareMode.all", recycle = true, stopThread = false, ignoreFirstLine = false, quotedData = false, encoding?: string | null, min = "1", max = "100", outputFormat = "", randomSeed?: string | null, perThread = false, cookiePolicy?: string | null, clearEachIteration = false, authUrl?: string | null, authUser?: string | null, authPass?: string | null): string {
    try {
      this.ensurePlan();
      const config = this.configByType(type || "csv_data_set", {
        filename,
        variableNames,
        delimiter,
        shareMode,
        recycle,
        stopThread,
        ignoreFirstLine,
        quotedData,
        encoding,
        min,
        max,
        outputFormat,
        randomSeed,
        perThread,
        cookiePolicy,
        clearEachIteration,
        authUrl,
        authUser,
        authPass,
      });
      if (!config) return `Error: unknown config type '${type}'`;
      this.attach(config);
      return `Config added: ${type || "csv_data_set"}${filename ? ` (${filename})` : ""}`;
    } catch (error) {
      return `Error adding config: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addHttpDefaults(name: string, domain?: string | null, port?: string | null, protocol?: string | null, path?: string | null, contentEncoding?: string | null, implementation?: string | null, connectTimeout?: string | null, responseTimeout?: string | null): string {
    try {
      this.ensurePlan();
      this.attach(element("ConfigTestElement", "HttpDefaultsGui", "ConfigTestElement", name || "HTTP Request Defaults", [
        pString("HTTPSampler.domain", domain || ""),
        pString("HTTPSampler.port", port || ""),
        pString("HTTPSampler.protocol", protocol || ""),
        pString("HTTPSampler.path", path || ""),
        pString("HTTPSampler.contentEncoding", contentEncoding || ""),
        pString("HTTPSampler.implementation", implementation || ""),
        pString("HTTPSampler.connect_timeout", connectTimeout || ""),
        pString("HTTPSampler.response_timeout", responseTimeout || ""),
        argumentsElementProp("HTTPsampler.Arguments", [], true),
      ]));
      return `HTTP defaults added: ${name}`;
    } catch (error) {
      return `Error adding HTTP defaults: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addHttpHeaderManager(name: string, headers?: string | null): string {
    try {
      this.ensurePlan();
      this.attach(this.headerManager(name, headers || ""));
      return `HTTP header manager added: ${name}`;
    } catch (error) {
      return `Error adding HTTP header manager: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addJdbcConfig(name: string, poolMax?: string | null, username?: string | null, password?: string | null, connectionUrl?: string | null, driverClass?: string | null, validationQuery?: string | null, maxAge?: string | null, timeout?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(this.jdbcConfig(name, poolMax, username, password, connectionUrl, driverClass, validationQuery, maxAge, timeout));
      return `JDBC config added: ${name}`;
    } catch (error) {
      return `Error adding JDBC config: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addKeystoreConfig(name: string, preload?: string | null, variableName?: string | null, clientCertAliasVar?: string | null, keystoreType?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("KeystoreConfig", "TestBeanGUI", "KeystoreConfig", name, [
        pString("preload", preload || "true"),
        pString("startIndex", variableName || ""),
        pString("clientCertAliasVarName", clientCertAliasVar || ""),
        pString("keystoreType", keystoreType || "jks"),
      ]));
      return `Keystore config added: ${name}`;
    } catch (error) {
      return `Error adding keystore config: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addLoginConfig(name: string, usernameVar?: string | null, passwordVar?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("ConfigTestElement", "LoginConfigGui", "ConfigTestElement", name, [
        pString("ConfigTestElement.username", usernameVar || ""),
        pString("ConfigTestElement.password", passwordVar || ""),
      ]));
      return `Login config added: ${name}`;
    } catch (error) {
      return `Error adding login config: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addTcpConfig(name: string, reuseConnection?: string | null, closeConnection?: string | null, nodelay?: string | null, timeout?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("ConfigTestElement", "TCPConfigGui", "ConfigTestElement", name, [
        pBool("TCPSampler.reUseConnection", reuseConnection?.toLowerCase() === "true"),
        pBool("TCPSampler.closeConnection", closeConnection?.toLowerCase() === "true"),
        pBool("TCPSampler.nodelay", nodelay?.toLowerCase() === "true"),
        pString("TCPSampler.timeout", timeout || "0"),
      ]));
      return `TCP config added: ${name}`;
    } catch (error) {
      return `Error adding TCP config: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addFtpConfig(name: string, binaryMode?: string | null, saveResponse?: string | null, encoding?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("ConfigTestElement", "FtpConfigGui", "ConfigTestElement", name, [
        pBool("FTPSampler.binarymode", binaryMode?.toLowerCase() === "true"),
        pBool("FTPSampler.saveresponse", saveResponse?.toLowerCase() === "true"),
        pString("FTPSampler.fileencoding", encoding || ""),
      ]));
      return `FTP config added: ${name}`;
    } catch (error) {
      return `Error adding FTP config: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addCounterConfig(name: string, start?: string | null, end?: string | null, increment?: string | null, format?: string | null, variableName?: string | null, perThread = true, resetOnThreadGroupIteration = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(this.counterConfig(name, variableName || "", Number(start || 0), Number(increment || 1), end ? Number(end) : Number.MAX_SAFE_INTEGER, format || "", perThread, resetOnThreadGroupIteration));
      return `Counter config added: ${name}`;
    } catch (error) {
      return `Error adding counter config: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addController(type: string, name?: string | null, condition?: string | null, inputVar?: string | null, outputVar?: string | null, startIndex?: string | null, endIndex?: string | null, throughputStyle = 0, throughputValue?: string | null, perThread = false, runtimeSeconds = 1, switchValue?: string | null, includeTimers = true, generateParent = false): string {
    try {
      this.ensureThreadGroup();
      const safeName = name || defaultControllerName(type || "if");
      const controller = this.controllerByType(type || "if", safeName, {
        condition,
        inputVar,
        outputVar,
        startIndex,
        endIndex,
        throughputStyle,
        throughputValue,
        perThread,
        runtimeSeconds,
        switchValue,
        includeTimers,
        generateParent,
      });
      if (!controller) return `Error: unknown controller type '${type}'`;
      this.pushController(controller);
      return `Controller added: ${type || "if"}`;
    } catch (error) {
      return `Error adding controller: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addIncludeController(name: string, includePath: string): string {
    try {
      this.ensureThreadGroup();
      const validation = this.validateIncludeControllerPath(includePath);
      if (validation) return validation;
      this.attach(element("IncludeController", "IncludeControllerGui", "IncludeController", name, [pString("IncludeController.includepath", includePath)]));
      return `Include controller added: ${name}`;
    } catch (error) {
      return `Error adding include controller: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addJmsSampler(name: string, jmsType?: string | null, jndiInitialContextFactory?: string | null, jndiProviderUrl?: string | null, jndiConnectionFactoryName?: string | null, destination?: string | null, useAuth?: string | null, username?: string | null, password?: string | null, messageType?: string | null, textMessage?: string | null, objectMessage?: string | null, jmsProperties?: string | null, timeout = 2000, jmsSelector?: string | null, clientId?: string | null, durable?: string | null, jmsAcknowledgement?: string | null): string {
    try {
      this.ensureThreadGroup();
      const safeType = jmsType || "publisher";
      if (safeType === "publisher") {
        this.attach(element("PublisherSampler", "JMSPublisherGui", "PublisherSampler", name, [
          pString("jms.initial_context_factory", jndiInitialContextFactory || ""),
          pString("jms.provider_url", jndiProviderUrl || ""),
          pString("jms.connection_factory", jndiConnectionFactoryName || ""),
          pString("jms.topic", destination || ""),
          pBool("jms.authenticate", useAuth?.toLowerCase() === "true"),
          pString("jms.security_principle", username || ""),
          pString("jms.security_credentials", password || ""),
          pString("jms.config_msg_type", messageType || "text"),
          pString("jms.text_message", textMessage || ""),
          pString("jms.object_message", objectMessage || ""),
          pString("jms.jndi_properties", "true"),
          jmsPropertiesProp(parsePairs(jmsProperties || "", ";")),
          pString("jms.timeout", String(timeout || 2000)),
          pString("jms.clientId", clientId || ""),
        ]));
        return `JMS publisher added: ${name}`;
      }
      if (safeType === "subscriber") {
        this.attach(element("SubscriberSampler", "JMSSubscriberGui", "SubscriberSampler", name, [
          pString("jms.initial_context_factory", jndiInitialContextFactory || ""),
          pString("jms.provider_url", jndiProviderUrl || ""),
          pString("jms.connection_factory", jndiConnectionFactoryName || ""),
          pString("jms.destination", destination || ""),
          jmsPropertiesProp(parsePairs(jmsProperties || "", ";")),
          pString("jms.timeout", String(timeout || 2000)),
          pString("jms.selector", jmsSelector || ""),
          pString("jms.client_id", clientId || ""),
          pString("jms.durableSubscriptionId", durable?.toLowerCase() === "true" ? name : ""),
        ]));
        return `JMS subscriber added: ${name}`;
      }
      this.attach(element("JMSSampler", "JMSSamplerGui", "JMSSampler", name, [
        pString("JMSSampler.initialContextFactory", jndiInitialContextFactory || ""),
        pString("JMSSampler.contextProviderUrl", jndiProviderUrl || ""),
        pString("JMSSampler.queueconnectionfactory", jndiConnectionFactoryName || ""),
        pString("JMSSampler.SendQueue", destination || ""),
        pString("JMSSampler.ReceiveQueue", ""),
        pString("HTTPSamper.xml_data", textMessage || objectMessage || ""),
        pInt("JMSSampler.communicationStyle", 0),
        pBool("JMSSampler.isNonPersistent", false),
        pBool("JMSSampler.useReqMsgIdAsCorrelId", false),
        pBool("JMSSampler.useResMsgIdAsCorrelId", false),
        pString("jms.connection_factory", jndiConnectionFactoryName || ""),
        pString("jms.topic", destination || ""),
        jmsPropertiesProp(parsePairs(jmsProperties || "", ";"), "arguments"),
        argumentsElementProp("JMSSampler.jndiProperties"),
        pString("JMSSampler.timeout", String(timeout || 2000)),
        pString("JMSSampler.expiration", "0"),
        pString("JMSSampler.priority", "4"),
        pString("JMSSampler.jmsSelector", jmsSelector || ""),
        pString("JMSSampler.jmsNumberOfSamplesToAggregate", "1"),
        pString("jms.acknowledgement", jmsAcknowledgement || ""),
      ]));
      return `JMS point-to-point sampler added: ${name}`;
    } catch (error) {
      return `Error adding JMS sampler: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addLdapRequest(name: string, server?: string | null, port = 389, rootdn?: string | null, searchFilter?: string | null, searchBase?: string | null, attributes?: string | null, scope?: string | null, useSsl = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("LDAPSampler", "LdapTestSamplerGui", "LDAPSampler", name, [
        pString("servername", server || ""),
        pString("port", String(port || 389)),
        pString("rootdn", rootdn || ""),
        pString("searchfilter", searchFilter || ""),
        pString("search_base", searchBase || ""),
        pString("attributes", attributes || ""),
        pString("scope", scope || "2"),
        pBool("secure", useSsl),
      ]));
      return `LDAP sampler added: ${name}`;
    } catch (error) {
      return `Error adding LDAP sampler: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addLdapExtRequest(name: string, server?: string | null, port = 389, rootdn?: string | null, searchFilter?: string | null, searchBase?: string | null, scope?: string | null, useSsl = false, connectionTimeout?: string | null, maxResults?: string | null, useUserDn = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("LDAPExtSampler", "LdapExtTestSamplerGui", "LDAPExtSampler", name, [
        pString("servername", server || ""),
        pString("port", String(port || 389)),
        pString("rootdn", rootdn || ""),
        pString("searchfilter", searchFilter || ""),
        pString("search_base", searchBase || ""),
        pString("scope", scope || "2"),
        pString("secure", useSsl ? "true" : "false"),
        pString("connTimeOut", connectionTimeout || ""),
        pString("countlim", maxResults || ""),
        pString("userDN", useUserDn ? "true" : "false"),
      ]));
      return `LDAP extended sampler added: ${name}`;
    } catch (error) {
      return `Error adding LDAP extended sampler: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addMailReaderRequest(name: string, serverType?: string | null, server?: string | null, username?: string | null, password?: string | null, folder?: string | null, numMessages = 1, useSsl = false, useStartTls = false): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("MailReaderSampler", "MailReaderSamplerGui", "MailReaderSampler", name, [
        pString("serverType", serverType || "pop3"),
        pString("server", server || ""),
        pString("username", username || ""),
        pString("password", password || ""),
        pString("folder", folder || "INBOX"),
        pInt("num_messages", numMessages),
        pBool("mail.use_ssl", useSsl),
        pBool("mail.use_starttls", useStartTls),
      ]));
      return `Mail reader sampler added: ${name}`;
    } catch (error) {
      return `Error adding mail reader sampler: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addSmtpSampler(name: string, server?: string | null, port = 25, useAuth?: string | null, username?: string | null, password?: string | null, useSsl?: string | null, useTls?: string | null, starttls?: string | null, sender?: string | null, receiver?: string | null, cc?: string | null, bcc?: string | null, subject?: string | null, body?: string | null, suppressSubject?: string | null, attachFile?: string | null, message?: string | null, plainBody?: string | null, enableDebug?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("SmtpSampler", "SmtpSamplerGui", "SmtpSampler", name, [
        pString("SMTPSampler.server", server || ""),
        pString("SMTPSampler.serverPort", String(port || 25)),
        pBool("SMTPSampler.useAuth", useAuth?.toLowerCase() === "true"),
        pString("SMTPSampler.username", username || ""),
        pString("SMTPSampler.password", password || ""),
        pBool("SMTPSampler.useSSL", useSsl?.toLowerCase() === "true"),
        pBool("SMTPSampler.useTLS", useTls?.toLowerCase() === "true"),
        pBool("SMTPSampler.starttls", starttls?.toLowerCase() === "true"),
        pString("SMTPSampler.mailFrom", sender || ""),
        pString("SMTPSampler.receiverTo", receiver || ""),
        pString("SMTPSampler.receiverCc", cc || ""),
        pString("SMTPSampler.receiverBcc", bcc || ""),
        pString("SMTPSampler.subject", subject || ""),
        pString("SMTPSampler.message", body || ""),
        pBool("SMTPSampler.suppressSubject", suppressSubject?.toLowerCase() === "true"),
        pString("SMTPSampler.attachFile", attachFile || ""),
        pString("SMTPSampler.contentType", message || ""),
        pString("SMTPSampler.plainBody", plainBody || ""),
        pBool("SMTPSampler.enableDebug", enableDebug?.toLowerCase() === "true"),
      ]));
      return `SMTP sampler added: ${name}`;
    } catch (error) {
      return `Error adding SMTP sampler: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addTcpSampler(name: string, server?: string | null, port = 0, reUseConnection?: string | null, closeConnection?: string | null, nodelay?: string | null, requestData?: string | null, username?: string | null, password?: string | null, timeout?: string | null, eolByte?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("TCPSampler", "TCPSamplerGui", "TCPSampler", name, [
        pString("TCPSampler.server", server || ""),
        pString("TCPSampler.port", String(port)),
        pBool("TCPSampler.reUseConnection", reUseConnection?.toLowerCase() === "true"),
        pString("TCPSampler.closeConnection", closeConnection?.toLowerCase() === "true" ? "true" : "false"),
        pBool("TCPSampler.nodelay", nodelay?.toLowerCase() === "true"),
        pString("TCPSampler.request", requestData || ""),
        pString("TCPSampler.username", username || ""),
        pString("TCPSampler.password", password || ""),
        pString("TCPSampler.timeout", timeout || ""),
        pString("TCPSampler.EolByte", eolByte || ""),
      ]));
      return `TCP sampler added: ${name}`;
    } catch (error) {
      return `Error adding TCP sampler: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addSystemSampler(name: string, command?: string | null, commandParameters?: string | null, environmentVariables?: string | null, workingDirectory?: string | null, stdoutFilename?: string | null, stderrFilename?: string | null, timeout = 0, checkReturnCode?: string | null, expectedReturnCode = 0, interpreter?: string | null): string {
    try {
      this.ensureThreadGroup();
      const commandArgs = commandParameters?.trim()
        ? commandParameters.trim().split(/\s+/).map((token): [string, string] => ["", token])
        : [];
      this.attach(element("SystemSampler", "SystemSamplerGui", "SystemSampler", name, [
        pString("SystemSampler.command", command || ""),
        argumentsElementProp("SystemSampler.arguments", commandArgs),
        argumentsElementProp("SystemSampler.environment", parsePairs(environmentVariables || "", ";")),
        pString("SystemSampler.directory", workingDirectory || ""),
        pString("SystemSampler.stdout", stdoutFilename || ""),
        pString("SystemSampler.stderr", stderrFilename || ""),
        pInt("SystemSampler.timeout", timeout),
        pBool("SystemSampler.checkReturnCode", checkReturnCode?.toLowerCase() === "true"),
        pInt("SystemSampler.expectedReturnCode", expectedReturnCode),
        pString("SystemSampler.interpreter", interpreter || ""),
        pString("SystemSampler.stdin", ""),
      ]));
      return `System sampler added: ${name}`;
    } catch (error) {
      return `Error adding system sampler: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addTestAction(name: string, action?: string | null, duration = 0): string {
    try {
      this.ensureThreadGroup();
      const actionMap: Record<string, number> = { pause: 0, stop: 1, stop_now: 2, next_iteration: 3, next_loop: 4, break: 5 };
      this.attach(element("TestAction", "TestActionGui", "TestAction", name, [
        pInt("ActionProcessor.action", actionMap[action || "pause"] ?? 0),
        pString("ActionProcessor.duration", String(duration)),
      ]));
      return `Test action added: ${name}`;
    } catch (error) {
      return `Error adding test action: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addUserParameters(name: string, parameterNames?: string | null, parameterValues?: string | null, perIteration = false): string {
    try {
      this.ensureThreadGroup();
      const names = (parameterNames || "").split(",").map((item) => item.trim()).filter(Boolean);
      const values = (parameterValues || "").split(",").map((item) => item.trim()).filter(Boolean);
      this.attach(element("UserParameters", "UserParametersGui", "UserParameters", name, [
        pCollection("UserParameters.names", names.map((item) => pString(item, item))),
        pCollection("UserParameters.thread_values", [pCollection("user_1", values.map((item) => pString(item, item)))]),
        pBool("UserParameters.per_iteration", perIteration),
      ]));
      return `User parameters added: ${name}`;
    } catch (error) {
      return `Error adding user parameters: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addRegExUserParameters(name: string, regExRefName?: string | null, paramNamesGroupNr?: string | null, paramValuesGroupNr?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("RegExUserParameters", "RegExUserParametersGui", "RegExUserParameters", name, [
        pString("RegExUserParameters.regex_ref_name", regExRefName || ""),
        pString("RegExUserParameters.param_names_gr_nr", paramNamesGroupNr || ""),
        pString("RegExUserParameters.param_values_gr_nr", paramValuesGroupNr || ""),
      ]));
      return `RegEx user parameters added: ${name}`;
    } catch (error) {
      return `Error adding RegEx user parameters: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addSampleTimeout(name: string, timeout = 0): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("SampleTimeout", "SampleTimeoutGui", "SampleTimeout", name, [pString("InterruptTimer.timeout", String(timeout))]));
      return `Sample timeout added: ${name}`;
    } catch (error) {
      return `Error adding sample timeout: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addFtpSampler(name: string, server?: string | null, port = 21, username?: string | null, password?: string | null, localFile?: string | null, remoteFile?: string | null, getOrPut?: string | null, binaryMode?: string | null, saveResponse?: string | null, encoding?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("FTPSampler", "FtpTestSamplerGui", "FTPSampler", name, [
        pString("FTPSampler.server", server || ""),
        pString("FTPSampler.port", String(port || 21)),
        pString("FTPSampler.username", username || ""),
        pString("FTPSampler.password", password || ""),
        pString("FTPSampler.filename", localFile || ""),
        pString("FTPSampler.remoteFilename", remoteFile || ""),
        pString("FTPSampler.action", getOrPut || ""),
        pBool("FTPSampler.binarymode", binaryMode?.toLowerCase() === "true"),
        pBool("FTPSampler.saveresponse", saveResponse?.toLowerCase() === "true"),
        pString("FTPSampler.fileencoding", encoding || ""),
      ]));
      return `FTP sampler added: ${name}`;
    } catch (error) {
      return `Error adding FTP sampler: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addHttpUrlRewritingModifier(name: string, argumentName?: string | null, pathExtension = false, pathExtensionNoEquals = false, pathExtensionNoQuestionmark = true, cacheVarnr?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(element("URLRewritingModifier", "URLRewritingModifierGui", "URLRewritingModifier", name, [
        pString("argument_name", argumentName || ""),
        pBool("path_extension", pathExtension),
        pBool("path_extension_no_equals", pathExtensionNoEquals),
        pBool("path_extension_no_questionmark", pathExtensionNoQuestionmark),
        pString("cache_varnr", cacheVarnr || ""),
      ]));
      return `HTTP URL rewriting modifier added: ${name}`;
    } catch (error) {
      return `Error adding HTTP URL rewriting modifier: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addJdbcRequest(name: string, queryType?: string | null, sql?: string | null, parameterValues?: string | null, parameterTypes?: string | null, variableNames?: string | null, resultVariable?: string | null, queryTimeout = 0, dataSourceName?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(this.jdbcLike("JDBCSampler", "TestBeanGUI", "JDBCSampler", name, queryType, sql, parameterValues, parameterTypes, variableNames, resultVariable, queryTimeout, dataSourceName));
      return `JDBC request added: ${name}`;
    } catch (error) {
      return `Error adding JDBC request: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addJdbcPreProcessor(name: string, queryType?: string | null, sql?: string | null, parameterValues?: string | null, parameterTypes?: string | null, variableNames?: string | null, resultVariable?: string | null, queryTimeout = 0, dataSourceName?: string | null): string {
    try {
      this.ensureThreadGroup();
      this.attach(this.jdbcLike("JDBCPreProcessor", "TestBeanGUI", "JDBCPreProcessor", name, queryType, sql, parameterValues, parameterTypes, variableNames, resultVariable, queryTimeout, dataSourceName));
      return `JDBC pre-processor added: ${name}`;
    } catch (error) {
      return `Error adding JDBC pre-processor: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addPreProcessorAtPath(parentPath: string, name: string | null, preprocessorType: string, script?: string | null, filename?: string | null, language?: string | null, parameters?: string | null, cacheCompiled = true, timeout = 0): string {
    try {
      const ref = this.resolvePath(parentPath);
      const ppName = name || "Pre-Processor";
      let preprocessor: JmxElement | null = null;
      if ((preprocessorType || "jsr223") === "jsr223") preprocessor = this.jsr223PreProcessor(ppName, language || "groovy", script || "", filename || "", parameters || "", cacheCompiled);
      if (preprocessorType === "beanshell") preprocessor = element("BeanShellPreProcessor", "TestBeanGUI", "BeanShellPreProcessor", ppName, [pString("filename", filename || ""), pString("script", script || ""), pString("parameters", parameters || ""), pBool("resetInterpreter", false)]);
      if (preprocessorType === "sample_timeout") preprocessor = element("SampleTimeout", "SampleTimeoutGui", "SampleTimeout", ppName, [pString("InterruptTimer.timeout", String(timeout))]);
      if (!preprocessor) return `Error: unknown preprocessor type '${preprocessorType}'`;
      ref.element.children.push(preprocessor);
      return `Pre-processor added at ${parentPath}: ${ppName}`;
    } catch (error) {
      return `Error adding pre-processor at path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addPostProcessorAtPath(parentPath: string, name: string | null, postprocessorType: string, script?: string | null, filename?: string | null, language?: string | null, parameters?: string | null, cacheCompiled = true): string {
    try {
      const ref = this.resolvePath(parentPath);
      const ppName = name || "Post-Processor";
      let postprocessor: JmxElement | null = null;
      if ((postprocessorType || "jsr223") === "jsr223") postprocessor = this.jsr223PostProcessor(ppName, language || "groovy", script || "", filename || "", parameters || "", cacheCompiled);
      if (postprocessorType === "beanshell") postprocessor = element("BeanShellPostProcessor", "TestBeanGUI", "BeanShellPostProcessor", ppName, [pString("filename", filename || ""), pString("script", script || ""), pString("parameters", parameters || ""), pBool("resetInterpreter", false)]);
      if (!postprocessor) return `Error: unknown postprocessor type '${postprocessorType}'`;
      ref.element.children.push(postprocessor);
      return `Post-processor added at ${parentPath}: ${ppName}`;
    } catch (error) {
      return `Error adding post-processor at path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addConfigAtPath(parentPath: string, name: string | null, configType: string, csvFilename?: string | null, csvVariableNames?: string | null, csvDelimiter = ",", csvRecycleOnEof = true, csvStopThreadOnEof = false, csvSharingMode = "all", randomVarName?: string | null, randomMin?: string | null, randomMax?: string | null, randomFormat?: string | null, cookieClearEachIteration = false, cookiePolicy?: string | null, headersJson?: string | null, counterVarName?: string | null, counterStart = 0, counterIncrement = 1, counterMaximum = Number.MAX_SAFE_INTEGER, counterFormat?: string | null, counterPerUser = false, counterResetOnTgIteration = false, variablesJson?: string | null): string {
    try {
      const ref = this.resolvePath(parentPath);
      const configName = name || "Config Element";
      let config: JmxElement | null = null;
      switch (configType || "user_defined_variables") {
        case "csv_data_set":
          config = element("CSVDataSet", "TestBeanGUI", "CSVDataSet", configName, [pString("filename", csvFilename || ""), pString("variableNames", csvVariableNames || ""), pString("delimiter", csvDelimiter), pString("shareMode", csvSharingMode), pBool("recycle", csvRecycleOnEof), pBool("stopThread", csvStopThreadOnEof)]);
          break;
        case "random_variable":
          config = element("RandomVariableConfig", "TestBeanGUI", "RandomVariableConfig", configName, [pString("variableName", randomVarName || ""), pString("minimumValue", randomMin || "1"), pString("maximumValue", randomMax || "100"), pString("outputFormat", randomFormat || "")]);
          break;
        case "http_cookie_manager":
          config = this.cookieManager(configName, cookieClearEachIteration, cookiePolicy || "");
          break;
        case "http_cache_manager":
          config = element("CacheManager", "CacheManagerGui", "CacheManager", configName, [pBool("clearEachIteration", cookieClearEachIteration), pBool("useExpires", false)]);
          break;
        case "http_header_manager":
          config = this.headerManager(configName, headersJson || "");
          break;
        case "http_defaults":
          config = element("ConfigTestElement", "HttpDefaultsGui", "ConfigTestElement", configName, [pString("HTTPSampler.protocol", ""), pString("HTTPSampler.domain", ""), pString("HTTPSampler.path", ""), argumentsElementProp("HTTPsampler.Arguments", [], true)]);
          break;
        case "user_defined_variables":
          config = element("Arguments", "ArgumentsPanel", "Arguments", configName, [pCollection("Arguments.arguments", parsePairs(variablesJson || ",").map(([key, value]) => argumentProp(key, value)))]);
          break;
        case "counter":
          config = this.counterConfig(configName, counterVarName || "counter", counterStart, counterIncrement, counterMaximum, counterFormat || "", counterPerUser, counterResetOnTgIteration);
          break;
      }
      if (!config) return `Error: unknown config type '${configType}' (simplified implementation)`;
      ref.element.children.push(config);
      return `Config added at ${parentPath}: ${configName}`;
    } catch (error) {
      return `Error adding config at path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addControllerAtPath(parentPath: string, name: string | null, controllerType: string, condition?: string | null, evaluateAll = false, useExpression = true, inputVar?: string | null, outputVar?: string | null, addUnderscore = true, loops = -1, generateParentSample = false, includeTimers = false, throughputValue = 1, perUser = false, percentBased = true, switchValue?: string | null, runtimeSeconds = 0, lockName?: string | null): string {
    try {
      const ref = this.resolvePath(parentPath);
      const ctrlName = name || defaultControllerName(controllerType);
      let controller: JmxElement | null = null;
      if ((controllerType || "simple") === "simple") controller = element("GenericController", "LogicControllerGui", "GenericController", ctrlName);
      if (controllerType === "loop") controller = element("LoopController", "LoopControlPanel", "LoopController", ctrlName, [pInt("LoopController.loops", loops), pBool("LoopController.continue_forever", false)]);
      if (controllerType === "if") controller = element("IfController", "IfControllerPanel", "IfController", ctrlName, [pString("IfController.condition", condition || ""), pBool("IfController.evaluateAll", evaluateAll), pBool("IfController.useExpression", useExpression)]);
      if (!controller) return `Error: unknown controller type '${controllerType}' (simplified implementation)`;
      ref.element.children.push(controller);
      return `Controller added at ${parentPath}: ${ctrlName}`;
    } catch (error) {
      return `Error adding controller at path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  addSamplerAtPath(parentPath: string, name: string, samplerType: string, method?: string | null, domain?: string | null, port = 0, protocol?: string | null, path?: string | null, bodyData?: string | null, contentEncoding?: string | null, script?: string | null, language?: string | null, filename?: string | null, parameters?: string | null): string {
    try {
      const ref = this.resolvePath(parentPath);
      const samplerName = name || "Sampler";
      let sampler: JmxElement | null = null;
      if ((samplerType || "http") === "http") sampler = this.httpSampler(samplerName, method || "GET", domain || "", port, protocol || "http", path || "", bodyData || "", contentEncoding || "");
      if (samplerType === "jsr223") sampler = this.jsr223Sampler(samplerName, language || "groovy", script || "", filename || "", parameters || "");
      if (samplerType === "beanshell") sampler = this.beanShellSampler(samplerName, script || "", filename || "", parameters || "");
      if (!sampler) return `Error: unknown sampler type '${samplerType}'`;
      ref.element.children.push(sampler);
      return `Sampler added at ${parentPath}: ${samplerName} (${samplerType})`;
    } catch (error) {
      return `Error adding sampler at path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private ensureTestPlan(): void {
    if (!this.root) throw new Error("No test plan exists. Call create_test_plan first.");
  }

  private ensurePlan(): void {
    this.ensureTestPlan();
  }

  private ensureThreadGroup(): void {
    this.ensureTestPlan();
    if (!this.scopeStack.some((node) => ["ThreadGroup", "SetupThreadGroup", "PostThreadGroup"].includes(node.tag))) {
      throw new Error("No thread group exists. Call add_thread_group first.");
    }
  }

  private attach(node: JmxElement): JmxElement {
    this.ensureTestPlan();
    const scope = this.scopeStack[this.scopeStack.length - 1] ?? this.root!;
    scope.children.push(node);
    return node;
  }

  private pushThreadGroup(node: JmxElement): void {
    this.ensureTestPlan();
    this.scopeStack = [this.root!];
    this.root!.children.push(node);
    this.scopeStack.push(node);
  }

  private pushController(node: JmxElement): void {
    this.ensureThreadGroup();
    const scope = this.scopeStack[this.scopeStack.length - 1];
    scope.children.push(node);
    this.scopeStack.push(node);
  }

  private resolvePath(path: string): TreeNodeRef {
    this.ensureTestPlan();
    if (!path || !path.trim()) throw new Error("path is required, for example /0/1/2");
    const parts = path.replace(/^\/+/, "").split("/").filter(Boolean).map((part) => {
      const index = Number(part);
      if (!Number.isInteger(index)) throw new Error(`path segment must be a number: ${part}`);
      return index;
    });
    if (!parts.length) throw new Error("path must point to an element, for example /0");
    let currentChildren = [this.root!];
    let parentChildren: JmxElement[] | null = null;
    let elementRef: JmxElement | null = null;
    let currentPath = "";
    let indexRef = -1;
    for (let depth = 0; depth < parts.length; depth += 1) {
      const index = parts[depth];
      if (index < 0 || index >= currentChildren.length) throw new Error(`path index out of range at ${index}`);
      parentChildren = depth === 0 ? null : currentChildren;
      elementRef = currentChildren[index];
      indexRef = index;
      currentPath += `/${index}`;
      currentChildren = elementRef.children;
    }
    const rootPath = parts.length === 1 && parts[0] === 0;
    return { path: currentPath, element: elementRef!, parentChildren: rootPath ? null : parentChildren, index: indexRef };
  }

  private appendTree(lines: string[], nodes: JmxElement[], parentPath: string, depth: number): void {
    nodes.forEach((node, index) => {
      const path = parentPath ? `${parentPath}/${index}` : `/${index}`;
      lines.push(`${"  ".repeat(depth)}${path} | ${node.testname} | ${node.testclass} | enabled=${node.enabled !== false}`);
      if (node.children.length) this.appendTree(lines, node.children, path, depth + 1);
    });
  }

  private validateNode(node: JmxElement, path: string, errors: string[], warnings: string[]): void {
    if (!node.testname) warnings.push(`${path} has no testname`);
    if (!node.testclass) warnings.push(`${path} ${node.testname || node.tag} has no testclass`);
    if (!node.guiclass) warnings.push(`${path} ${node.testname || node.tag} has no guiclass`);
    if ((node.tag.includes("JSR223") || node.tag.includes("BeanShell")) && !this.findPropValue(node, "script") && !this.findPropValue(node, "BeanShellSampler.query") && !this.findPropValue(node, "BeanShellAssertion.query") && !this.findPropValue(node, "filename")) {
      warnings.push(`${path} ${node.testname} has neither inline script nor filename`);
    }
    node.children.forEach((child, index) => this.validateNode(child, `${path}/${index}`, errors, warnings));
  }

  private findPropValue(node: JmxElement, name: string): string | undefined {
    const prop = node.props.find((item) => "name" in item && item.name === name);
    return prop && "value" in prop ? String(prop.value) : undefined;
  }

  private setStringProperty(node: JmxElement, name: string, value: string): void {
    const prop = node.props.find((item) => "name" in item && item.name === name);
    if (prop && "value" in prop) {
      prop.value = value;
    } else {
      node.props.push(pString(name, value));
    }
  }

  private threadGroup(tag: string, gui: string, test: string, name: string, numThreads: number, rampUp: number, loops: number, duration: number, delay: number): JmxElement {
    const loop = pElement("ThreadGroup.main_controller", "LoopController", [
      pInt("LoopController.loops", loops < 0 ? -1 : loops),
      pBool("LoopController.continue_forever", false),
    ], { guiclass: "LoopControlPanel", testclass: "LoopController", testname: "Loop Controller" });
    const props: JmxProperty[] = [pInt("ThreadGroup.num_threads", numThreads), pInt("ThreadGroup.ramp_time", rampUp), loop];
    if (duration > 0 || delay > 0) props.push(pBool("ThreadGroup.scheduler", true));
    if (duration > 0) props.push(pLong("ThreadGroup.duration", duration));
    if (delay > 0) props.push(pLong("ThreadGroup.delay", delay));
    return element(tag, gui, test, name, props);
  }

  private httpSampler(name: string, method: string, domain: string, port: number, protocol: string, path: string, bodyData = "", contentEncoding = "", params: string[] = []): JmxElement {
    const args: Array<[string, string]> = [];
    if (bodyData) args.push(["", bodyData]);
    params.forEach((param) => {
      const [key, value] = param.split("=", 2);
      if (key !== undefined && value !== undefined) args.push([key, value]);
    });
    const props: JmxProperty[] = [
      argumentsElementProp("HTTPsampler.Arguments", args, true),
      pString("HTTPSampler.method", method.toUpperCase()),
      pString("HTTPSampler.domain", domain),
      pInt("HTTPSampler.port", port),
      pString("HTTPSampler.protocol", protocol),
      pString("HTTPSampler.path", path),
    ];
    if (bodyData) props.push(pBool("HTTPSampler.postBodyRaw", true));
    if (contentEncoding) props.push(pString("HTTPSampler.contentEncoding", contentEncoding));
    return element("HTTPSamplerProxy", "HttpTestSampleGui", "HTTPSamplerProxy", name, props);
  }

  private jsr223Sampler(name: string, language: string, script: string, filename: string, parameters: string): JmxElement {
    return element("JSR223Sampler", "TestBeanGUI", "JSR223Sampler", name, [
      pString("scriptLanguage", language),
      pString("script", script),
      pString("filename", filename),
      pString("parameters", parameters),
    ]);
  }

  private beanShellSampler(name: string, script: string, filename: string, parameters: string): JmxElement {
    return element("BeanShellSampler", "BeanShellSamplerGui", "BeanShellSampler", name, [
      pString("BeanShellSampler.query", script),
      pString("BeanShellSampler.filename", filename),
      pString("BeanShellSampler.parameters", parameters),
      pBool("BeanShellSampler.resetInterpreter", false),
    ]);
  }

  private jsr223PreProcessor(name: string, language: string, script: string, filename: string, parameters: string, cacheCompiled: boolean): JmxElement {
    return element("JSR223PreProcessor", "TestBeanGUI", "JSR223PreProcessor", name, [
      pString("scriptLanguage", language),
      pString("script", script),
      pString("filename", filename),
      pString("parameters", parameters),
      pString("cacheKey", cacheCompiled ? name : ""),
    ]);
  }

  private jsr223PostProcessor(name: string, language: string, script: string, filename: string, parameters: string, cacheCompiled: boolean): JmxElement {
    return element("JSR223PostProcessor", "TestBeanGUI", "JSR223PostProcessor", name, [
      pString("scriptLanguage", language),
      pString("script", script),
      pString("filename", filename),
      pString("parameters", parameters),
      pString("cacheKey", cacheCompiled ? name : ""),
    ]);
  }

  private responseAssertion(name: string, testField: string, matchType: string, patterns: string[], isNot: boolean): JmxElement {
    const fieldMap: Record<string, string> = {
      response_code: "Assertion.response_code",
      response_headers: "Assertion.response_headers",
      response_data: "Assertion.response_data",
    };
    const typeMap: Record<string, number> = { equals: 8, contains: 2, matches: 1, substring: 16 };
    return element("ResponseAssertion", "AssertionGui", "ResponseAssertion", name, [
      pCollection("Asserion.test_strings", patterns.map((pattern) => pString(String(hashCode(pattern)), pattern))),
      pString("Assertion.test_field", fieldMap[testField] || "Assertion.response_data"),
      pInt("Assertion.test_type", (typeMap[matchType] || 16) + (isNot ? 4 : 0)),
    ]);
  }

  private sizeAssertion(name: string, testField: string, comparator: number, size: number): JmxElement {
    const fieldMap: Record<string, string> = {
      response_headers: "SizeAssertion.response_headers",
      response_code: "SizeAssertion.response_code",
      response_data: "SizeAssertion.response_data",
    };
    return element("SizeAssertion", "SizeAssertionGui", "SizeAssertion", name, [
      pString("Assertion.test_field", fieldMap[testField] || "SizeAssertion.response_data"),
      pInt("SizeAssertion.operator", comparator),
      pString("SizeAssertion.size", String(size)),
    ]);
  }

  private beanShellAssertion(name: string, script: string, filename: string, parameters: string, resetInterpreter: boolean): JmxElement {
    return element("BeanShellAssertion", "BeanShellAssertionGui", "BeanShellAssertion", name, [
      pString("BeanShellAssertion.query", script),
      pString("BeanShellAssertion.filename", filename),
      pString("BeanShellAssertion.parameters", parameters),
      pBool("BeanShellAssertion.resetInterpreter", resetInterpreter),
    ]);
  }

  private jsr223Assertion(name: string, language: string, script: string, filename: string, parameters: string, cacheCompiled: boolean): JmxElement {
    return element("JSR223Assertion", "TestBeanGUI", "JSR223Assertion", name, [
      pString("scriptLanguage", language),
      pString("script", script),
      pString("filename", filename),
      pString("parameters", parameters),
      pString("cacheKey", cacheCompiled ? name : ""),
    ]);
  }

  private assertionByType(name: string, type: string, args: Record<string, unknown>): JmxElement | null {
    switch (type || "response") {
      case "response":
        return this.responseAssertion(name, empty(args.testField || "response_data"), empty(args.matchType || "substring"), (args.patterns as string[]) || [], Boolean(args.isNot));
      case "json_path":
        return element("JSONPathAssertion", "JSONPathAssertionGui", "JSONPathAssertion", name, [pString("JSON_PATH", args.jsonPath || ""), pString("EXPECTED_VALUE", args.expectedValue || ""), pBool("JSONVALIDATION", Boolean(args.jsonValidation)), pBool("EXPECT_NULL", Boolean(args.expectNull)), pBool("INVERT", Boolean(args.invert))]);
      case "duration":
        return element("DurationAssertion", "DurationAssertionGui", "DurationAssertion", name, [pLong("DurationAssertion.duration", Number(args.maxDuration || 0))]);
      case "size": {
        const opMap: Record<string, number> = { equal: 0, notequal: 1, greater: 2, less: 3, greaterorequal: 4, lessorequal: 5 };
        return this.sizeAssertion(name, empty(args.testField || "response_data"), opMap[empty(args.sizeOperator)] ?? 3, Number(args.size || 0));
      }
      case "xpath":
        return element("XPath2Assertion", "XPath2AssertionGui", "XPath2Assertion", name, [pString("XPath2Assertion.xpath", args.xpath || "")]);
      case "jmespath":
        return element("JMESPathAssertion", "JMESPathAssertionGui", "JMESPathAssertion", name, [pString("JMESPathAssertion.jmesPath", args.jmespath || ""), pString("JMESPathAssertion.expectedValue", args.jmespathExpectedValue || ""), pBool("JMESPathAssertion.invert", Boolean(args.jmespathInvert))]);
      case "xml_schema":
        return element("XMLSchemaAssertion", "XMLSchemaAssertionGUI", "XMLSchemaAssertion", name, [pString("xmlschema_assertion_filename", args.xpath || "")]);
      case "md5hex":
        return element("MD5HexAssertion", "MD5HexAssertionGUI", "MD5HexAssertion", name, [pString("MD5HexAssertion.size", args.expectedValue || "")]);
      case "html":
        return element("HTMLAssertion", "HTMLAssertionGui", "HTMLAssertion", name, [pString("filename", args.expectedValue || ""), pString("doctype", String(args.size || 1)), pBool("errorsonly", Boolean(args.isNot))]);
      case "beanshell":
        return this.beanShellAssertion(name, empty(args.xpath), empty(args.jsonPath), empty(args.jmespath), Boolean(args.invert));
      case "jsr223":
        return this.jsr223Assertion(name, empty(args.expectedValue || "groovy"), empty(args.xpath), empty(args.jsonPath), empty(args.jmespath), Boolean(args.jsonValidation));
      case "compare":
        return element("CompareAssertion", "TestBeanGUI", "CompareAssertion", name, [pBool("compareContent", Boolean(args.isNot)), pLong("compareTime", Number(args.maxDuration || -1)), pCollection("stringsToSkip")]);
      default:
        return null;
    }
  }

  private timer(type: string, name: string, delay: number, range: number, maxDelay: number, throughput: number, throughputMode: number, groupSize: number, syncTimeout: number): JmxElement | null {
    switch (type) {
      case "constant":
        return element("ConstantTimer", "ConstantTimerGui", "ConstantTimer", name || "Constant Timer", [pString("ConstantTimer.delay", String(delay))]);
      case "uniform_random":
        return element("UniformRandomTimer", "UniformRandomTimerGui", "UniformRandomTimer", name || "Uniform Random Timer", [pString("ConstantTimer.delay", String(delay)), pString("RandomTimer.range", String(maxDelay))]);
      case "gaussian":
        return element("GaussianRandomTimer", "GaussianRandomTimerGui", "GaussianRandomTimer", name || "Gaussian Random Timer", [pString("ConstantTimer.delay", String(delay)), pString("RandomTimer.range", String(range))]);
      case "constant_throughput":
        return element("ConstantThroughputTimer", "TestBeanGUI", "ConstantThroughputTimer", name || "Constant Throughput Timer", [pDouble("throughput", throughput), pInt("calcMode", throughputMode)]);
      case "sync":
        return element("SyncTimer", "TestBeanGUI", "SyncTimer", name || "Synchronizing Timer", [pInt("groupSize", groupSize), pLong("timeoutInMs", syncTimeout)]);
      case "poisson":
        return element("PoissonRandomTimer", "PoissonRandomTimerGui", "PoissonRandomTimer", name || "Poisson Random Timer", [pString("ConstantTimer.delay", String(delay)), pString("RandomTimer.range", String(maxDelay || range))]);
      case "beanshell":
        return element("BeanShellTimer", "TestBeanGUI", "BeanShellTimer", name || "BeanShell Timer", [pString("BeanShellTimer.query", ""), pString("BeanShellTimer.filename", ""), pString("BeanShellTimer.parameters", ""), pBool("BeanShellTimer.resetInterpreter", false)]);
      default:
        return null;
    }
  }

  private extractorByType(type: string, name: string, refName: string, args: Record<string, unknown>): JmxElement | null {
    switch (type) {
      case "regex":
        return element("RegexExtractor", "RegexExtractorGui", "RegexExtractor", name.startsWith("Extractor:") ? `Regex Extractor: ${refName}` : name, [pString("RegexExtractor.refname", refName), pString("RegexExtractor.regex", args.regex || ""), pString("RegexExtractor.template", args.template || "$1$"), pInt("RegexExtractor.match_number", Number(args.matchNumber || 1)), pString("RegexExtractor.default", args.defaultValue || ""), ...(args.useField ? [pString("RegexExtractor.useHeaders", args.useField)] : [])]);
      case "boundary":
        return element("BoundaryExtractor", "BoundaryExtractorGui", "BoundaryExtractor", name, [pString("BoundaryExtractor.refname", refName), pString("BoundaryExtractor.lboundary", args.leftBoundary || ""), pString("BoundaryExtractor.rboundary", args.rightBoundary || ""), pInt("BoundaryExtractor.match_number", Number(args.matchNumber || 1)), pString("BoundaryExtractor.default", args.defaultValue || "")]);
      case "css_jquery":
        return element("HtmlExtractor", "HtmlExtractorGui", "HtmlExtractor", name, [pString("HtmlExtractor.refname", refName), pString("HtmlExtractor.expr", args.cssExpr || ""), pString("HtmlExtractor.attribute", args.attribute || ""), pInt("HtmlExtractor.match_number", Number(args.matchNumber || 1)), pString("HtmlExtractor.default", args.defaultValue || "")]);
      case "xpath":
        return element("XPathExtractor", "XPathExtractorGui", "XPathExtractor", name, [pString("XPathExtractor.refname", refName), pString("XPathExtractor.xpathQuery", args.xpath || ""), pString("XPathExtractor.default", args.defaultValue || "")]);
      case "xpath2":
        return element("XPath2Extractor", "XPath2ExtractorGui", "XPath2Extractor", name, [pString("XPath2Extractor.refname", refName), pString("XPath2Extractor.xpathQuery", args.xpath || ""), pString("XPath2Extractor.default", args.defaultValue || "")]);
      case "json":
      case "json_path":
        return element("JSONPostProcessor", "JSONPostProcessorGui", "JSONPostProcessor", name, [pString("JSONPostProcessor.referenceNames", refName), pString("JSONPostProcessor.jsonPathExprs", args.jsonPath || ""), pString("JSONPostProcessor.defaultValues", args.defaultValue || ""), pString("JSONPostProcessor.match_numbers", String(args.matchNumber || 1)), pBool("JSONPostProcessor.compute_concat", Boolean(args.computeConcatenation))]);
      case "jmespath":
        return element("JMESPathExtractor", "JMESPathExtractorGui", "JMESPathExtractor", name, [pString("JMESPathExtractor.refname", refName), pString("JMESPathExtractor.jmesPathExpr", args.jmesPath || ""), pString("JMESPathExtractor.default", args.defaultValue || ""), pString("JMESPathExtractor.match_number", String(args.matchNumber || 1))]);
      default:
        return null;
    }
  }

  private configByType(type: string, args: Record<string, unknown>): JmxElement | null {
    switch (type) {
      case "csv_data_set":
        return element("CSVDataSet", "TestBeanGUI", "CSVDataSet", `CSV Data Set: ${empty(args.filename)}`, [pString("filename", args.filename || ""), pString("variableNames", args.variableNames || ""), pString("delimiter", args.delimiter || ","), pString("shareMode", args.shareMode || "shareMode.all"), pBool("recycle", Boolean(args.recycle)), pBool("stopThread", Boolean(args.stopThread)), pBool("ignoreFirstLine", Boolean(args.ignoreFirstLine)), pBool("quotedData", Boolean(args.quotedData)), pString("fileEncoding", args.encoding || "")]);
      case "random_variable":
        return element("RandomVariableConfig", "TestBeanGUI", "RandomVariableConfig", `Random Variable: ${empty(args.variableNames) || "(unset)"}`, [pString("variableName", args.variableNames || ""), pString("minimumValue", args.min || "1"), pString("maximumValue", args.max || "100"), pString("outputFormat", args.outputFormat || ""), pString("randomSeed", args.randomSeed || ""), pBool("perThread", Boolean(args.perThread))]);
      case "http_cookie_manager":
        return this.cookieManager("HTTP Cookie Manager", Boolean(args.clearEachIteration), empty(args.cookiePolicy));
      case "http_cache_manager":
        return element("CacheManager", "CacheManagerGui", "CacheManager", "HTTP Cache Manager", [pBool("clearEachIteration", Boolean(args.clearEachIteration)), pBool("useExpires", false)]);
      case "http_authorization_manager":
        return element("AuthManager", "AuthPanel", "AuthManager", "HTTP Authorization Manager", [pCollection("AuthManager.auth_list", args.authUrl && args.authUser ? [pElement("", "Authorization", [pString("Authorization.url", args.authUrl), pString("Authorization.username", args.authUser), pString("Authorization.password", args.authPass || "")])] : [])]);
      case "user_defined_variables":
        return element("Arguments", "ArgumentsPanel", "Arguments", "User Defined Variables", [pCollection("Arguments.arguments", parsePairs(empty(args.variableNames)).map(([key, value]) => argumentProp(key, value)))]);
      default:
        return null;
    }
  }

  private headerManager(name: string, headers: string): JmxElement {
    const headerItems = parsePairs(headers, ";").map(([key, value]) => pElement("", "Header", [pString("Header.name", key), pString("Header.value", value)]));
    return element("HeaderManager", "HeaderPanel", "HeaderManager", name, [pCollection("HeaderManager.headers", headerItems)]);
  }

  private cookieManager(name: string, clearEachIteration: boolean, policy?: string): JmxElement {
    const props = [pCollection("CookieManager.cookies"), pBool("CookieManager.clearEachIteration", clearEachIteration)];
    if (policy) props.push(pString("CookieManager.policy", policy));
    return element("CookieManager", "CookiePanel", "CookieManager", name, props);
  }

  private jdbcConfig(name: string, poolMax?: string | null, username?: string | null, password?: string | null, connectionUrl?: string | null, driverClass?: string | null, validationQuery?: string | null, maxAge?: string | null, timeout?: string | null): JmxElement {
    return element("JDBCDataSource", "TestBeanGUI", "DataSourceElement", name, [pString("dataSource", name), pString("poolMax", poolMax || "10"), pString("username", username || ""), pString("password", password || ""), pString("dbUrl", connectionUrl || ""), pString("driver", driverClass || ""), pString("checkQuery", validationQuery || "Select 1"), pString("connectionAge", maxAge || "5000"), pString("timeout", timeout || "10000")]);
  }

  private counterConfig(name: string, variableName: string, start: number, increment: number, end: number, format: string, perThread: boolean, reset: boolean): JmxElement {
    return element("CounterConfig", "CounterConfigGui", "CounterConfig", name, [pString("CounterConfig.name", variableName), pLong("CounterConfig.start", start), pLong("CounterConfig.incr", increment), pLong("CounterConfig.end", end), pBool("CounterConfig.per_user", perThread), pString("CounterConfig.format", format), pBool("CounterConfig.reset_on_tg_iteration", reset)]);
  }

  private controllerByType(type: string, name: string, args: Record<string, unknown>): JmxElement | null {
    switch (type) {
      case "if":
        return element("IfController", "IfControllerPanel", "IfController", name, [pString("IfController.condition", args.condition || ""), pBool("IfController.useExpression", true)]);
      case "while":
        return element("WhileController", "WhileControllerGui", "WhileController", name, [pString("WhileController.condition", args.condition || "")]);
      case "foreach":
        return element("ForeachController", "ForeachControlPanel", "ForeachController", name, [pString("ForeachController.inputVal", args.inputVar || ""), pString("ForeachController.returnVal", args.outputVar || ""), pString("ForeachController.startIndex", args.startIndex || "0"), pString("ForeachController.endIndex", args.endIndex || ""), pBool("ForeachController.useSeparator", true)]);
      case "transaction":
        return element("TransactionController", "TransactionControllerGui", "TransactionController", name, [pBool("TransactionController.includeTimers", Boolean(args.includeTimers)), pBool("TransactionController.parent", Boolean(args.generateParent))]);
      case "throughput":
        return element("ThroughputController", "ThroughputControllerGui", "ThroughputController", name, [pInt("ThroughputController.style", Number(args.throughputStyle || 0)), pBool("ThroughputController.perThread", Boolean(args.perThread)), pString("ThroughputController.maxThroughput", args.throughputValue || "1"), pString("ThroughputController.percentThroughput", args.throughputValue || "100")]);
      case "once_only":
        return element("OnceOnlyController", "OnceOnlyControllerGui", "OnceOnlyController", name);
      case "random_order":
        return element("RandomOrderController", "RandomOrderControllerGui", "RandomOrderController", name);
      case "switch":
        return element("SwitchController", "SwitchControllerGui", "SwitchController", name, [pString("SwitchController.value", args.switchValue || "")]);
      case "runtime":
        return element("RunTime", "RunTimeGui", "RunTime", name, [pLong("RunTime.seconds", Number(args.runtimeSeconds || 1))]);
      case "loop":
        return element("LoopController", "LoopControlPanel", "LoopController", name, [pInt("LoopController.loops", Number(args.runtimeSeconds || 1)), pBool("LoopController.continue_forever", false)]);
      case "simple":
        return element("GenericController", "LogicControllerGui", "GenericController", name);
      case "module":
        return element("ModuleController", "ModuleControllerGui", "ModuleController", name);
      case "interleave":
        return element("InterleaveControl", "InterleaveControlGui", "InterleaveControl", name);
      case "random":
        return element("RandomController", "RandomControlGui", "RandomController", name);
      case "critical_section":
        return element("CriticalSectionController", "CriticalSectionControllerGui", "CriticalSectionController", name, [pString("CriticalSectionController.lockName", args.condition || "")]);
      default:
        return null;
    }
  }

  private jdbcLike(tag: string, gui: string, testclass: string, name: string, queryType?: string | null, sql?: string | null, parameterValues?: string | null, parameterTypes?: string | null, variableNames?: string | null, resultVariable?: string | null, queryTimeout = 0, dataSourceName?: string | null): JmxElement {
    return element(tag, gui, testclass, name, [pString("queryType", queryType || ""), pString("query", sql || ""), pString("queryArguments", parameterValues || ""), pString("queryArgumentsTypes", parameterTypes || ""), pString("variableNames", variableNames || ""), pString("resultVariable", resultVariable || ""), pString("queryTimeout", String(queryTimeout)), pString("dataSource", dataSourceName || "")]);
  }

  private validateIncludeControllerPath(includePath: string): string | null {
    if (!includePath) return "Error adding include controller: include_path is required";
    if (!existsSync(includePath)) return `Error adding include controller: include_path not found: ${includePath}`;
    try {
      const content = readFileSync(includePath, "utf8");
      if (!content.includes("TestFragmentController")) {
        return "Error adding include controller: included JMX must contain a Test Fragment (TestFragmentController). Use JMeter's 'Save as Test Fragment' format.";
      }
      return null;
    } catch (error) {
      return `Error adding include controller: failed to load include_path: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private parseLoadedPlan(xml: string): JmxElement {
    try {
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", preserveOrder: true, trimValues: false });
      const parsed = parser.parse(xml) as Array<Record<string, unknown>>;
      const jmeterNode = parsed.find((entry) => "jmeterTestPlan" in entry) as Record<string, unknown> | undefined;
      const children = (jmeterNode?.jmeterTestPlan as unknown[]) ?? [];
      const hashTreeNode = children.find((entry) => typeof entry === "object" && entry && "hashTree" in (entry as Record<string, unknown>)) as Record<string, unknown> | undefined;
      const roots = this.parseHashTree((hashTreeNode?.hashTree as unknown[]) ?? []);
      return roots[0] ?? element("TestPlan", "TestPlanGui", "TestPlan", "Loaded Test Plan", [pString("TestPlan.comments", "Loaded by TypeScript backend")]);
    } catch {
      return element("TestPlan", "TestPlanGui", "TestPlan", "Loaded Test Plan", [pString("TestPlan.comments", "Loaded XML parsing fallback")]);
    }
  }

  private parseHashTree(entries: unknown[]): JmxElement[] {
    const nodes: JmxElement[] = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i] as Record<string, unknown>;
      if (!entry || "hashTree" in entry || ":@" in entry) continue;
      const tag = Object.keys(entry).find((key) => key !== ":@");
      if (!tag) continue;
      const attrs = (entry[":@"] as Record<string, string> | undefined) ?? {};
      const node = element(tag, attrs.guiclass || tag, attrs.testclass || tag, attrs.testname || tag);
      node.enabled = attrs.enabled !== "false";
      const maybeTree = entries[i + 1] as Record<string, unknown> | undefined;
      if (maybeTree && "hashTree" in maybeTree) node.children = this.parseHashTree((maybeTree.hashTree as unknown[]) ?? []);
      nodes.push(node);
    }
    return nodes;
  }
}

function hashCode(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
  }
  return Math.abs(hash);
}

function defaultAssertionName(type: string): string {
  const names: Record<string, string> = {
    response: "Response Assertion",
    json_path: "JSON Path Assertion",
    duration: "Duration Assertion",
    size: "Size Assertion",
    xpath: "XPath Assertion",
    jmespath: "JMESPath Assertion",
    xml_schema: "XML Schema Assertion",
    md5hex: "MD5Hex Assertion",
    html: "HTML Assertion",
    beanshell: "BeanShell Assertion",
    jsr223: "JSR223 Assertion",
    compare: "Compare Assertion",
  };
  return names[type] || "Assertion";
}

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

function toolSchema(properties: Record<string, JsonObject> = {}, required: string[] = []): JsonObject {
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

function prop(type: "string" | "integer" | "boolean", description: string, defaultValue?: string | number | boolean): JsonObject {
  return defaultValue === undefined ? { type, description } : { type, description, default: defaultValue };
}

export function createTools(): McpTool[] {
  const tools: McpTool[] = [
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
        return `Error: unknown assertion type '${type}'`;
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
      execute: (a, s) => (!str(a, "parent_path") ? "Error: parent_path is required" : s.addTimerAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "timer_type", "constant"), intValue(a, "delay", 1000), intValue(a, "range", 100), intValue(a, "max_delay", 0), numValue(a, "throughput", 0), intValue(a, "throughput_mode", 0), intValue(a, "group_size", 0), intValue(a, "sync_timeout", 0))),
    },
    {
      name: "add_listener_at_path",
      description: "Add a listener to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), name: prop("string", "Name"), listener_type: prop("string", "Listener type") }),
      execute: (a, s) => (!str(a, "parent_path") ? "Error: parent_path is required" : s.addListenerAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "listener_type", "view_results_tree"), maybeStr(a, "filename"), maybeStr(a, "script"), maybeStr(a, "language") || "groovy", maybeStr(a, "parameters"), boolValue(a, "reset_interpreter"))),
    },
    {
      name: "add_assertion_at_path",
      description: "Add an assertion to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), assertion_type: prop("string", "Assertion type"), name: prop("string", "Name") }),
      execute: (a, s) => (!str(a, "parent_path") ? "Error: parent_path is required" : s.addAssertionAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "assertion_type", "response"), maybeStr(a, "test_field"), maybeStr(a, "match_type"), arrayStrings(a, "patterns"), boolValue(a, "is_not"), maybeStr(a, "json_path"), maybeStr(a, "expected_value"), boolValue(a, "json_validation"), boolValue(a, "expect_null"), boolValue(a, "invert"), intValue(a, "max_duration", 0), intValue(a, "size", 0), maybeStr(a, "size_operator"), maybeStr(a, "xpath"), boolValue(a, "validate_xml"), boolValue(a, "ignore_whitespace"), boolValue(a, "use_tolerant_parser"), maybeStr(a, "jmespath"), maybeStr(a, "jmespath_expected_value"), boolValue(a, "jmespath_invert"))),
    },
    {
      name: "add_extractor_at_path",
      description: "Add an extractor to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), extractor_type: prop("string", "Extractor type"), ref_name: prop("string", "Variable") }),
      execute: (a, s) => {
        if (!str(a, "parent_path")) return "Error: parent_path is required";
        if (!str(a, "ref_name")) return "Error: ref_name is required";
        return s.addExtractorAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "extractor_type", "regex"), str(a, "ref_name"), maybeStr(a, "regex"), maybeStr(a, "template"), intValue(a, "match_number", 1), maybeStr(a, "default_value"), maybeStr(a, "json_path"), boolValue(a, "compute_concatenation"), maybeStr(a, "xpath"), boolValue(a, "use_namespaces"), maybeStr(a, "css_expr"), maybeStr(a, "attribute"), maybeStr(a, "left_boundary"), maybeStr(a, "right_boundary"), maybeStr(a, "jmespath"), maybeStr(a, "use_field"));
      },
    },
    {
      name: "add_preprocessor_at_path",
      description: "Add a pre-processor to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), preprocessor_type: prop("string", "Type") }),
      execute: (a, s) => (!str(a, "parent_path") ? "Error: parent_path is required" : s.addPreProcessorAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "preprocessor_type", "jsr223"), maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "language") || "groovy", maybeStr(a, "parameters"), boolValue(a, "cache_compiled", true), intValue(a, "timeout", 0))),
    },
    {
      name: "add_postprocessor_at_path",
      description: "Add a post-processor to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), postprocessor_type: prop("string", "Type") }),
      execute: (a, s) => (!str(a, "parent_path") ? "Error: parent_path is required" : s.addPostProcessorAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "postprocessor_type", "jsr223"), maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "language") || "groovy", maybeStr(a, "parameters"), boolValue(a, "cache_compiled", true))),
    },
    {
      name: "add_config_at_path",
      description: "Add a config element to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), config_type: prop("string", "Config type") }),
      execute: (a, s) => (!str(a, "parent_path") ? "Error: parent_path is required" : s.addConfigAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "config_type", "user_defined_variables"), maybeStr(a, "csv_filename"), maybeStr(a, "csv_variable_names"), str(a, "csv_delimiter", ","), boolValue(a, "csv_recycle_on_eof", true), boolValue(a, "csv_stop_thread_on_eof"), str(a, "csv_sharing_mode", "all"), maybeStr(a, "random_var_name"), maybeStr(a, "random_min"), maybeStr(a, "random_max"), maybeStr(a, "random_format"), boolValue(a, "cookie_clear_each_iteration"), maybeStr(a, "cookie_policy"), maybeStr(a, "headers_json"), maybeStr(a, "counter_var_name"), intValue(a, "counter_start", 0), intValue(a, "counter_increment", 1), intValue(a, "counter_maximum", Number.MAX_SAFE_INTEGER), maybeStr(a, "counter_format"), boolValue(a, "counter_per_user"), boolValue(a, "counter_reset_on_tg_iteration"), maybeStr(a, "variables_json"))),
    },
    {
      name: "add_controller_at_path",
      description: "Add a controller to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), controller_type: prop("string", "Controller type") }),
      execute: (a, s) => (!str(a, "parent_path") ? "Error: parent_path is required" : s.addControllerAtPath(str(a, "parent_path"), maybeStr(a, "name"), str(a, "controller_type", "simple"), maybeStr(a, "condition"), boolValue(a, "evaluate_all"), boolValue(a, "use_expression", true), maybeStr(a, "input_var"), maybeStr(a, "output_var"), boolValue(a, "add_underscore", true), intValue(a, "loops", -1), boolValue(a, "generate_parent_sample"), boolValue(a, "include_timers"), intValue(a, "throughput_value", 1), boolValue(a, "per_user"), boolValue(a, "percent_based", true), maybeStr(a, "switch_value"), intValue(a, "runtime_seconds", 0), maybeStr(a, "lock_name"))),
    },
    {
      name: "add_sampler_at_path",
      description: "Add a sampler to a loaded test plan at a specific parent path.",
      inputSchema: toolSchema({ parent_path: prop("string", "Parent path"), name: prop("string", "Name"), sampler_type: prop("string", "Sampler type") }),
      execute: (a, s) => (!str(a, "parent_path") ? "Error: parent_path is required" : s.addSamplerAtPath(str(a, "parent_path"), str(a, "name", "Sampler"), str(a, "sampler_type", "http"), maybeStr(a, "method"), maybeStr(a, "domain"), intValue(a, "port", 0), maybeStr(a, "protocol"), maybeStr(a, "path"), maybeStr(a, "body_data"), maybeStr(a, "content_encoding"), maybeStr(a, "script"), maybeStr(a, "language"), maybeStr(a, "filename"), maybeStr(a, "parameters"))),
    },
    {
      name: "add_extractor",
      description: "Add a post-processor extractor to capture response data into variables.",
      inputSchema: toolSchema({ type: prop("string", "Extractor type"), ref_name: prop("string", "Variable") }),
      execute: (a, s) => s.addExtractor(str(a, "type", "regex"), str(a, "ref_name"), maybeStr(a, "regex"), maybeStr(a, "template"), intValue(a, "match_number", 1), maybeStr(a, "default_value"), maybeStr(a, "left_boundary"), maybeStr(a, "right_boundary"), maybeStr(a, "json_path"), maybeStr(a, "xpath"), maybeStr(a, "css_expr"), maybeStr(a, "jmespath"), maybeStr(a, "use_field"), boolValue(a, "compute_concatenation")),
    },
    {
      name: "add_config",
      description: "Add a configuration element.",
      inputSchema: toolSchema({ type: prop("string", "Config type") }),
      execute: (a, s) => s.addConfigElement(str(a, "type", "csv_data_set"), maybeStr(a, "filename"), maybeStr(a, "variable_names"), str(a, "delimiter", ","), str(a, "share_mode", "shareMode.all"), boolValue(a, "recycle", true), boolValue(a, "stop_thread"), boolValue(a, "ignore_first_line"), boolValue(a, "quoted_data"), maybeStr(a, "encoding"), str(a, "min", "1"), str(a, "max", "100"), str(a, "output_format", ""), maybeStr(a, "random_seed"), boolValue(a, "per_thread"), maybeStr(a, "cookie_policy"), boolValue(a, "clear_each_iteration"), maybeStr(a, "auth_url"), maybeStr(a, "auth_user"), maybeStr(a, "auth_pass")),
    },
    {
      name: "add_controller",
      description: "Add a logic controller to control execution flow.",
      inputSchema: toolSchema({ type: prop("string", "Controller type") }),
      execute: (a, s) => s.addController(str(a, "type", "if"), maybeStr(a, "name"), maybeStr(a, "condition"), maybeStr(a, "input_var"), maybeStr(a, "output_var"), str(a, "start_index", "0"), str(a, "end_index", ""), intValue(a, "throughput_style", 0), str(a, "throughput_value", "1"), boolValue(a, "per_thread"), intValue(a, "runtime_seconds", 1), maybeStr(a, "switch_value"), boolValue(a, "include_timers", true), boolValue(a, "generate_parent")),
    },
    { name: "load_test_plan", description: "Load an existing JMX file into the MCP in-memory context.", inputSchema: toolSchema({ path: prop("string", "Path") }, ["path"]), execute: (a, s) => s.loadTestPlan(str(a, "path")) },
    { name: "list_test_plan_tree", description: "List the currently loaded JMX tree with stable index paths.", inputSchema: toolSchema(), execute: (_a, s) => s.listTestPlanTree() },
    {
      name: "update_element",
      description: "Update an existing JMX element by tree path.",
      inputSchema: toolSchema({ path: prop("string", "Path"), name: prop("string", "Name"), enabled: prop("boolean", "Enabled", true), properties: { type: "object" } }, ["path"]),
      execute: (a, s) => s.updateElement(str(a, "path"), maybeStr(a, "name"), a.enabled === undefined ? null : boolValue(a, "enabled"), (a.properties as Record<string, string> | undefined) ?? null),
    },
    { name: "delete_element", description: "Delete an existing JMX element and its subtree by path.", inputSchema: toolSchema({ path: prop("string", "Path") }, ["path"]), execute: (a, s) => s.deleteElement(str(a, "path")) },
    { name: "move_element", description: "Move an existing JMX element, including its subtree.", inputSchema: toolSchema({ source_path: prop("string", "Source"), target_parent_path: prop("string", "Target") }, ["source_path", "target_parent_path"]), execute: (a, s) => s.moveElement(str(a, "source_path"), str(a, "target_parent_path")) },
    { name: "replace_script", description: "Replace inline script or script filename for an existing script element.", inputSchema: toolSchema({ path: prop("string", "Path") }, ["path"]), execute: (a, s) => s.replaceScript(str(a, "path"), maybeStr(a, "language"), maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), a.cache_compiled === undefined ? null : boolValue(a, "cache_compiled", true)) },
    { name: "validate_test_plan", description: "Validate the currently loaded test plan for common structural issues.", inputSchema: toolSchema(), execute: (_a, s) => s.validateTestPlan() },
    { name: "save_test_plan", description: "Save the current test plan to a .jmx file.", inputSchema: toolSchema({ path: prop("string", "Path") }, ["path"]), execute: (a, s) => s.saveTestPlan(str(a, "path")) },
    { name: "run_test_plan", description: "Run a JMeter test plan in non-GUI mode.", inputSchema: toolSchema({ path: prop("string", "Path"), jtl_path: prop("string", "JTL") }), execute: (a, s) => s.runTestPlan(maybeStr(a, "path"), maybeStr(a, "jtl_path")) },
    { name: "add_jdbc_request", description: "Add a JDBC request sampler.", inputSchema: toolSchema({ name: prop("string", "Name"), dataSource: prop("string", "Data source") }, ["name", "dataSource"]), execute: (a, s) => s.addJdbcRequest(str(a, "name"), maybeStr(a, "query_type"), maybeStr(a, "sql"), maybeStr(a, "parameter_values"), maybeStr(a, "parameter_types"), maybeStr(a, "variable_names"), maybeStr(a, "result_variable"), intValue(a, "query_timeout", 0), str(a, "dataSource")) },
    { name: "add_tcp_sampler", description: "Add a TCP sampler.", inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "Server"), port: prop("integer", "Port") }, ["name", "server", "port"]), execute: (a, s) => s.addTcpSampler(str(a, "name"), str(a, "server"), intValue(a, "port", 0), maybeStr(a, "reUseConnection"), maybeStr(a, "closeConnection"), maybeStr(a, "nodelay"), maybeStr(a, "request_data"), maybeStr(a, "username"), maybeStr(a, "password"), maybeStr(a, "timeout"), maybeStr(a, "eolByte")) },
    { name: "add_ftp_sampler", description: "Add an FTP sampler.", inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "Server") }, ["name", "server"]), execute: (a, s) => s.addFtpSampler(str(a, "name"), str(a, "server"), intValue(a, "port", 21), maybeStr(a, "username"), maybeStr(a, "password"), maybeStr(a, "local_filename"), maybeStr(a, "remote_filename"), maybeStr(a, "ftp_action"), maybeStr(a, "binary_mode"), maybeStr(a, "save_response"), maybeStr(a, "encoding")) },
    { name: "add_jms_sampler", description: "Add a JMS sampler.", inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]), execute: (a, s) => s.addJmsSampler(str(a, "name"), maybeStr(a, "jms_type"), maybeStr(a, "jndi_initial_context_factory"), maybeStr(a, "jndi_provider_url"), maybeStr(a, "jndi_connection_factory_name"), maybeStr(a, "destination"), maybeStr(a, "use_auth"), maybeStr(a, "username"), maybeStr(a, "password"), maybeStr(a, "message_type"), maybeStr(a, "text_message"), maybeStr(a, "object_message"), maybeStr(a, "jms_properties"), intValue(a, "timeout", 2000), maybeStr(a, "jms_selector"), maybeStr(a, "client_id"), maybeStr(a, "durable"), maybeStr(a, "jms_acknowledgement")) },
    { name: "add_smtp_sampler", description: "Add an SMTP sampler.", inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "Server") }, ["name", "server"]), execute: (a, s) => s.addSmtpSampler(str(a, "name"), str(a, "server"), intValue(a, "port", 25), maybeStr(a, "use_auth"), maybeStr(a, "username"), maybeStr(a, "password"), maybeStr(a, "use_ssl"), maybeStr(a, "use_tls"), maybeStr(a, "starttls"), maybeStr(a, "sender"), maybeStr(a, "receiver"), maybeStr(a, "cc"), maybeStr(a, "bcc"), maybeStr(a, "subject"), maybeStr(a, "body"), maybeStr(a, "suppress_subject"), maybeStr(a, "attach_file"), maybeStr(a, "message"), maybeStr(a, "plain_body"), maybeStr(a, "enable_debug")) },
    { name: "add_system_sampler", description: "Add a System sampler.", inputSchema: toolSchema({ name: prop("string", "Name"), command: prop("string", "Command") }, ["name", "command"]), execute: (a, s) => s.addSystemSampler(str(a, "name"), str(a, "command"), maybeStr(a, "command_parameters"), maybeStr(a, "environment_variables"), maybeStr(a, "working_directory"), maybeStr(a, "stdout_filename"), maybeStr(a, "stderr_filename"), intValue(a, "timeout", 0), maybeStr(a, "check_return_code"), intValue(a, "expected_return_code", 0), maybeStr(a, "interpreter")) },
    { name: "add_user_parameters", description: "Add User Parameters pre-processor.", inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]), execute: (a, s) => s.addUserParameters(str(a, "name"), maybeStr(a, "parameter_names"), maybeStr(a, "parameter_values"), boolValue(a, "per_iteration")) },
    { name: "add_jdbc_pre_processor", description: "Add a JDBC pre-processor.", inputSchema: toolSchema({ name: prop("string", "Name"), dataSource: prop("string", "Data source") }, ["name", "dataSource"]), execute: (a, s) => s.addJdbcPreProcessor(str(a, "name"), maybeStr(a, "query_type"), maybeStr(a, "sql"), maybeStr(a, "parameter_values"), maybeStr(a, "parameter_types"), maybeStr(a, "variable_names"), maybeStr(a, "result_variable"), intValue(a, "query_timeout", 0), str(a, "dataSource")) },
    { name: "add_http_url_rewriting_modifier", description: "Add an HTTP URL rewriting modifier.", inputSchema: toolSchema({ name: prop("string", "Name"), argument_name: prop("string", "Argument") }, ["name", "argument_name"]), execute: (a, s) => s.addHttpUrlRewritingModifier(str(a, "name"), str(a, "argument_name"), boolValue(a, "path_extension"), boolValue(a, "path_extension_no_equals"), boolValue(a, "cache_session_id", true), maybeStr(a, "path_extension_separator")) },
    {
      name: "add_more_assertions",
      description: "Add additional assertion types.",
      inputSchema: toolSchema({ type: prop("string", "Assertion type") }, ["type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        const name = str(a, "name", `${type} assertion`);
        if (type === "xml_schema") return s.addXmlSchemaAssertion(name, maybeStr(a, "xsd_filename"), maybeStr(a, "xsd_content"));
        if (type === "md5hex") return s.addMd5HexAssertion(name, maybeStr(a, "md5_hex"), boolValue(a, "use_md5", true));
        if (type === "beanshell") return s.addBeanShellAssertion(name, maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "reset_interpreter"));
        if (type === "jsr223") return s.addJsr223Assertion(name, maybeStr(a, "language") || "groovy", maybeStr(a, "script_content"), maybeStr(a, "script_file"), maybeStr(a, "parameters"), boolValue(a, "cache_compiled", true));
        if (type === "compare") return s.addCompareAssertion(name, maybeStr(a, "compare_content"), maybeStr(a, "compare_type"), boolValue(a, "use_response_data", true));
        return `Error: unknown assertion type '${type}'`;
      },
    },
    {
      name: "add_more_timers",
      description: "Add additional timer types.",
      inputSchema: toolSchema({ type: prop("string", "Timer type") }, ["type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        const name = str(a, "name", `${type} timer`);
        if (type === "poisson") return s.addPoissonTimer(name, intValue(a, "delay", 300), intValue(a, "range", 100));
        if (type === "beanshell") return s.addBeanShellTimer(name, maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "reset_interpreter"));
        return `Error: unknown timer type '${type}'`;
      },
    },
    {
      name: "add_more_configs",
      description: "Add additional configuration elements.",
      inputSchema: toolSchema({ type: prop("string", "Config type") }, ["type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        const name = str(a, "name", `${type} config`);
        if (type === "http_defaults") return s.addHttpDefaults(name, maybeStr(a, "domain"), maybeStr(a, "port"), maybeStr(a, "protocol") || "http", maybeStr(a, "path"), maybeStr(a, "content_encoding"), maybeStr(a, "implementation"), maybeStr(a, "connect_timeout"), maybeStr(a, "response_timeout"));
        if (type === "http_header_manager") return s.addHttpHeaderManager(name, maybeStr(a, "headers"));
        if (type === "jdbc_config") return s.addJdbcConfig(name, maybeStr(a, "pool_max") || "10", maybeStr(a, "username"), maybeStr(a, "password"), maybeStr(a, "connection_url"), maybeStr(a, "driver_class"), maybeStr(a, "validation_query") || "Select 1", maybeStr(a, "max_age"), maybeStr(a, "timeout") || "5000");
        if (type === "keystore") return s.addKeystoreConfig(name, maybeStr(a, "preload") || "true", maybeStr(a, "variable_name"), maybeStr(a, "client_cert_alias_var"), maybeStr(a, "keystore_type") || "jks");
        if (type === "login_config") return s.addLoginConfig(name, maybeStr(a, "username_var"), maybeStr(a, "password_var"));
        if (type === "tcp_config") return s.addTcpConfig(name, maybeStr(a, "reuse_connection") || "true", maybeStr(a, "close_connection") || "false", maybeStr(a, "nodelay") || "false", maybeStr(a, "timeout") || "0");
        if (type === "ftp_config") return s.addFtpConfig(name, maybeStr(a, "binary_mode") || "false", maybeStr(a, "save_response") || "false", maybeStr(a, "encoding"));
        return `Error: unknown config type '${type}'`;
      },
    },
    {
      name: "add_more_listeners",
      description: "Add additional listener types.",
      inputSchema: toolSchema({ type: prop("string", "Listener type") }, ["type"]),
      execute: (a, s) => {
        const type = str(a, "type");
        const name = str(a, "name", `${type} listener`);
        if (type === "beanshell") return s.addBeanShellListener(name, maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "reset_interpreter"));
        if (type === "jsr223") return s.addJsr223Listener(name, maybeStr(a, "language") || "groovy", maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"));
        if (type === "save_response") return s.addSaveResponseListener(name, maybeStr(a, "output_directory"), maybeStr(a, "filename_prefix") || "response", boolValue(a, "success_only", true));
        return `Error: unknown listener type '${type}'`;
      },
    },
    { name: "add_ldap_sampler", description: "Add an LDAP sampler.", inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "Server") }, ["name", "server"]), execute: (a, s) => (str(a, "type", "basic") === "extended" ? s.addLdapExtRequest(str(a, "name"), str(a, "server"), intValue(a, "port", 389), maybeStr(a, "rootdn"), maybeStr(a, "search_filter"), maybeStr(a, "search_base"), maybeStr(a, "scope") || "2", boolValue(a, "use_ssl"), maybeStr(a, "connection_timeout"), maybeStr(a, "max_results"), boolValue(a, "use_user_dn")) : s.addLdapRequest(str(a, "name"), str(a, "server"), intValue(a, "port", 389), maybeStr(a, "rootdn"), maybeStr(a, "search_filter"), maybeStr(a, "search_base"), maybeStr(a, "attributes"), maybeStr(a, "scope") || "2", boolValue(a, "use_ssl"))) },
    { name: "add_mail_reader_sampler", description: "Add a mail reader sampler.", inputSchema: toolSchema({ name: prop("string", "Name"), server: prop("string", "Server"), username: prop("string", "Username") }, ["name", "server", "username"]), execute: (a, s) => s.addMailReaderRequest(str(a, "name"), maybeStr(a, "server_type") || "pop3", str(a, "server"), str(a, "username"), maybeStr(a, "password"), maybeStr(a, "folder") || "INBOX", intValue(a, "num_messages", 1), boolValue(a, "use_ssl"), boolValue(a, "use_starttls")) },
    { name: "add_test_action", description: "Add a Test Action sampler.", inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]), execute: (a, s) => s.addTestAction(str(a, "name"), maybeStr(a, "action") || "pause", intValue(a, "duration", 0)) },
    { name: "add_counter_config", description: "Add a Counter config element.", inputSchema: toolSchema({ name: prop("string", "Name"), variable_name: prop("string", "Variable") }, ["name", "variable_name"]), execute: (a, s) => s.addCounterConfig(str(a, "name"), maybeStr(a, "start") || "0", maybeStr(a, "end"), maybeStr(a, "increment") || "1", maybeStr(a, "format"), str(a, "variable_name"), boolValue(a, "per_thread", true), boolValue(a, "reset_on_tg_iteration")) },
    { name: "add_sample_timeout", description: "Add a Sample Timeout pre-processor.", inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]), execute: (a, s) => s.addSampleTimeout(str(a, "name"), intValue(a, "timeout", 0)) },
    { name: "add_regex_user_parameters", description: "Add RegEx User Parameters.", inputSchema: toolSchema({ name: prop("string", "Name"), reg_ex_ref_name: prop("string", "Ref") }, ["name", "reg_ex_ref_name"]), execute: (a, s) => s.addRegExUserParameters(str(a, "name"), str(a, "reg_ex_ref_name"), maybeStr(a, "param_names_group_nr"), maybeStr(a, "param_values_group_nr")) },
    { name: "add_xml_assertion", description: "Add an XML assertion.", inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]), execute: (a, s) => s.addXmlAssertion(str(a, "name")) },
    { name: "add_xml_schema_assertion", description: "Add an XML Schema assertion.", inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]), execute: (a, s) => s.addXmlSchemaAssertion(str(a, "name"), maybeStr(a, "xsd_filename"), maybeStr(a, "xsd_content")) },
    { name: "add_beanshell_assertion", description: "Add a BeanShell assertion.", inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]), execute: (a, s) => s.addBeanShellAssertion(str(a, "name"), maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "reset_interpreter")) },
    { name: "add_jsr223_assertion", description: "Add a JSR223 assertion.", inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]), execute: (a, s) => s.addJsr223Assertion(str(a, "name"), maybeStr(a, "language") || "groovy", maybeStr(a, "script"), maybeStr(a, "filename"), maybeStr(a, "parameters"), boolValue(a, "cache_compiled", true)) },
    { name: "add_md5hex_assertion", description: "Add an MD5 Hex assertion.", inputSchema: toolSchema({ name: prop("string", "Name"), md5_hex: prop("string", "Hash") }, ["name", "md5_hex"]), execute: (a, s) => s.addMd5HexAssertion(str(a, "name"), str(a, "md5_hex"), boolValue(a, "use_md5", true)) },
    { name: "add_backend_listener", description: "Add a Backend Listener.", inputSchema: toolSchema({ name: prop("string", "Name") }, ["name"]), execute: (a, s) => s.addBackendListener(str(a, "name"), maybeStr(a, "backend_impl"), maybeStr(a, "influxdb_url"), maybeStr(a, "influxdb_token"), maybeStr(a, "influxdb_org"), maybeStr(a, "influxdb_bucket"), maybeStr(a, "influxdb_measurement"), maybeStr(a, "graphite_host"), intValue(a, "graphite_port", 2003), maybeStr(a, "graphite_prefix")) },
    { name: "add_aggregate_graph", description: "Add an Aggregate Graph listener.", inputSchema: toolSchema({ name: prop("string", "Name") }), execute: (a, s) => s.addAggregateGraph(str(a, "name", "Aggregate Graph"), maybeStr(a, "filename")) },
    { name: "add_include_controller", description: "Add an Include Controller.", inputSchema: toolSchema({ name: prop("string", "Name"), include_path: prop("string", "Path") }, ["name", "include_path"]), execute: (a, s) => s.addIncludeController(str(a, "name"), str(a, "include_path")) },
  ];
  return tools;
}

export class JmeterMcpRuntime {
  readonly service = new TestPlanService();
  readonly tools = new Map<string, McpTool>();

  constructor() {
    for (const tool of createTools()) this.tools.set(tool.name, tool);
  }

  dispatch(request: JsonObject): JsonObject | null {
    const id = request.id;
    const method = typeof request.method === "string" ? request.method : null;
    if (!method) return id === undefined ? null : this.error(id, -32600, "Missing method");
    if (id === undefined || id === null) return null;
    if (method === "initialize") {
      const params = (request.params as JsonObject | undefined) ?? {};
      return this.success(id, {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }
    if (method === "ping") return this.success(id, {});
    if (method === "tools/list") {
      return this.success(id, {
        tools: [...this.tools.values()].map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }
    if (method === "tools/call") {
      const params = (request.params as JsonObject | undefined) ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const tool = this.tools.get(name);
      if (!tool) return this.error(id, -32602, `Unknown tool: ${name}`);
      try {
        const text = tool.execute(((params.arguments as JsonObject | undefined) ?? {}) as JsonObject, this.service);
        return this.success(id, { content: [{ type: "text", text }] });
      } catch (error) {
        return this.success(id, {
          content: [{ type: "text", text: `Error executing tool '${name}': ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        });
      }
    }
    return this.error(id, -32601, `Method not found: ${method}`);
  }

  callTool(name: string, args: JsonObject = {}): string {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool.execute(args, this.service);
  }

  private success(id: unknown, result: JsonObject): JsonObject {
    return { jsonrpc: "2.0", id, result };
  }

  private error(id: unknown, code: number, message: string): JsonObject {
    return { jsonrpc: "2.0", id, error: { code, message } };
  }
}

type SseSession = {
  id: string;
  response: ExpressResponse;
};

type AiModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

type AiToolCall = {
  name: string;
  arguments: JsonObject;
};

type AiGeneratedPlan = {
  planName: string;
  summary: string;
  notes: string[];
  toolCalls: AiToolCall[];
};

const AI_CONSTRUCTION_TOOL_DENYLIST = new Set([
  "load_test_plan",
  "save_test_plan",
  "run_test_plan",
  "update_element",
  "delete_element",
  "move_element",
  "replace_script",
  "list_test_plan_tree",
  "validate_test_plan",
]);

function sendSseEvent(response: ExpressResponse, event: string, data: string): void {
  response.write(`event: ${event}\n`);
  for (const line of data.split("\n")) response.write(`data: ${line}\n`);
  response.write("\n");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publicAiConfigStatus(): JsonObject {
  return {
    ok: true,
    mode: "client_supplied",
    serverStoresConfig: false,
    message: "AI 配置由前端随请求传入，后端不读取 ai.md、不持久化密钥。",
    required: ["ai_config.base_url", "ai_config.api_key", "ai_config.model"],
    aliases: {
      base_url: ["base_url", "baseUrl", "baseurl", "url"],
      api_key: ["api_key", "apiKey", "key"],
      model: ["model", "model_id", "modelId", "id"],
    },
  };
}

function firstText(args: JsonObject, keys: string[]): string {
  for (const key of keys) {
    const value = args[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function parseAiModelConfig(body: JsonObject): AiModelConfig {
  const rawConfig = isJsonObject(body.ai_config)
    ? body.ai_config
    : isJsonObject(body.aiConfig)
      ? body.aiConfig
      : {};
  const config = Object.keys(rawConfig).length ? rawConfig : body;
  const baseUrl = firstText(config, ["base_url", "baseUrl", "baseurl", "url"]);
  const apiKey = firstText(config, ["api_key", "apiKey", "key"]);
  const model = firstText(config, ["model", "model_id", "modelId", "id"]);

  if (!baseUrl || !apiKey || !model) {
    throw new Error("ai_config.base_url, ai_config.api_key and ai_config.model are required.");
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error("ai_config.base_url must start with http:// or https://.");
  }

  return { baseUrl, apiKey, model };
}

function sanitizeAiErrorText(text: string, config: AiModelConfig): string {
  return text.split(config.apiKey).join("[redacted]").slice(0, 500);
}

function extractJsonObjectText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI response does not contain a JSON object.");
  return candidate.slice(start, end + 1);
}

function safeFilename(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || `ai-jmeter-${Date.now()}`;
}

function resolveGeneratedJmxPath(generatedRoot: string, requested: string | null | undefined, planName: string): string {
  const fallback = resolve(generatedRoot, `${safeFilename(planName)}.jmx`);
  const trimmed = requested?.trim() ?? "";
  const requestedPath = trimmed && /[\\/]/.test(trimmed) ? trimmed : trimmed ? resolve(generatedRoot, trimmed) : "";
  const outputPath = requested && requested.trim()
    ? resolve(requestedPath)
    : fallback;
  const normalized = outputPath.toLowerCase().endsWith(".jmx") ? outputPath : `${outputPath}.jmx`;
  const relativePath = relative(generatedRoot, normalized);
  const insideGeneratedDir = relativePath !== "" && !relativePath.startsWith("..") && !relativePath.includes(":");
  if (!insideGeneratedDir) {
    throw new Error("AI generated JMX can only be saved under server/generated.");
  }
  return normalized;
}

function aiToolCatalog(runtime: JmeterMcpRuntime): JsonObject[] {
  return [...runtime.tools.values()]
    .filter((tool) => !AI_CONSTRUCTION_TOOL_DENYLIST.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
}

function buildAiSystemPrompt(runtime: JmeterMcpRuntime): string {
  return [
    "你是资深 JMeter 性能测试工程师。",
    "你的任务是把用户的自然语言性能测试需求转换为后端可执行的 JMeter 工具调用计划，而不是直接编写 JMX XML。",
    "必须只输出一个 JSON 对象，不要输出 Markdown，不要输出解释性正文。",
    "JSON 结构必须为：",
    "{\"plan_name\":\"string\",\"summary\":\"string\",\"notes\":[\"string\"],\"tool_calls\":[{\"name\":\"tool_name\",\"arguments\":{}}]}",
    "规则：",
    "1. tool_calls 第一项必须是 create_test_plan。",
    "2. create_test_plan 后必须至少调用一次 add_thread_group。",
    "3. 除非用户明确要求，否则不要调用保存、运行、加载、更新、删除、移动类工具。",
    "4. HTTP 场景优先使用 add_more_configs(type=http_defaults)、add_more_configs(type=http_header_manager)、add_http_request、add_assertion、add_listener。",
    "5. 性能测试默认添加 aggregate_report 和 summary_report 监听器；调试场景可以添加 view_results_tree。",
    "6. 参数必须符合工具 inputSchema；未知信息使用合理默认值，不要臆造真实密码或密钥。",
    "7. URL 拆分为 protocol/domain/path/port；domain 不要包含协议头。",
    "8. JSON 请求体放入 body_data，HTTP Header 用 headers 数组，格式为 {\"name\":\"Content-Type\",\"value\":\"application/json\"}。",
    `可用工具如下：${JSON.stringify(aiToolCatalog(runtime))}`,
  ].join("\n");
}

async function callOpenAiCompatibleChat(config: AiModelConfig, prompt: string, runtime: JmeterMcpRuntime, temperature: number, maxTokens: number): Promise<string> {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const bodyBase = {
    model: config.model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: buildAiSystemPrompt(runtime) },
      { role: "user", content: prompt },
    ],
  };

  const request = async (withJsonMode: boolean): Promise<Response> => fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(withJsonMode ? { ...bodyBase, response_format: { type: "json_object" } } : bodyBase),
  });

  let response = await request(true);
  let text = await response.text();
  if (!response.ok && /response_format|json_object|unsupported/i.test(text)) {
    response = await request(false);
    text = await response.text();
  }

  if (!response.ok) {
    throw new Error(`AI request failed: HTTP ${response.status} ${sanitizeAiErrorText(text, config)}`);
  }

  const data = JSON.parse(text) as JsonObject;
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0] as JsonObject | undefined;
  const message = first && isJsonObject(first.message) ? first.message : {};
  const content = typeof message.content === "string" ? message.content : "";
  if (!content.trim()) throw new Error("AI response has no message content.");
  return content;
}

function normalizeAiToolCall(value: unknown): AiToolCall | null {
  if (!isJsonObject(value)) return null;
  const name = typeof value.name === "string" ? value.name : typeof value.tool === "string" ? value.tool : "";
  const args = isJsonObject(value.arguments) ? value.arguments : isJsonObject(value.args) ? value.args : {};
  if (!name) return null;
  return { name, arguments: args };
}

function normalizeAiGeneratedPlan(rawText: string, fallbackPrompt: string): AiGeneratedPlan {
  const parsed = JSON.parse(extractJsonObjectText(rawText)) as JsonObject;
  const planName = String(parsed.plan_name ?? parsed.planName ?? `AI JMeter Test Plan ${Date.now()}`);
  const summary = String(parsed.summary ?? "AI generated JMeter test plan.");
  const notes = Array.isArray(parsed.notes) ? parsed.notes.map((item) => String(item)) : [];
  const rawCalls = Array.isArray(parsed.tool_calls)
    ? parsed.tool_calls
    : Array.isArray(parsed.toolCalls)
      ? parsed.toolCalls
      : Array.isArray(parsed.steps)
        ? parsed.steps
        : [];

  const toolCalls = rawCalls
    .map(normalizeAiToolCall)
    .filter((item): item is AiToolCall => item !== null);

  if (!toolCalls.some((call) => call.name === "create_test_plan")) {
    toolCalls.unshift({
      name: "create_test_plan",
      arguments: {
        name: planName,
        comments: `AI generated from prompt: ${fallbackPrompt.slice(0, 200)}`,
      },
    });
  }

  const createIndex = toolCalls.findIndex((call) => call.name === "create_test_plan");
  if (createIndex > 0) {
    const [createCall] = toolCalls.splice(createIndex, 1);
    toolCalls.unshift(createCall);
  }

  if (!toolCalls.some((call) => call.name === "add_thread_group")) {
    toolCalls.splice(1, 0, {
      name: "add_thread_group",
      arguments: {
        name: "主线程组",
        num_threads: 10,
        ramp_up: 10,
        loops: 1,
      },
    });
  } else {
    const firstThreadGroupIndex = toolCalls.findIndex((call) => call.name === "add_thread_group");
    if (firstThreadGroupIndex > 1) {
      const [threadGroupCall] = toolCalls.splice(firstThreadGroupIndex, 1);
      toolCalls.splice(1, 0, threadGroupCall);
    }
  }

  if (!toolCalls.some((call) => call.name === "add_listener" || call.name === "add_extended_listener" || call.name === "add_more_listeners" || call.name === "add_backend_listener" || call.name === "add_aggregate_graph")) {
    toolCalls.push({ name: "add_listener", arguments: { type: "aggregate_report" } });
    toolCalls.push({ name: "add_listener", arguments: { type: "summary_report" } });
  }

  return { planName, summary, notes, toolCalls };
}

function executeAiPlan(runtime: JmeterMcpRuntime, plan: AiGeneratedPlan): Array<{ name: string; arguments: JsonObject; result: string }> {
  const results: Array<{ name: string; arguments: JsonObject; result: string }> = [];
  for (const call of plan.toolCalls) {
    if (AI_CONSTRUCTION_TOOL_DENYLIST.has(call.name)) {
      throw new Error(`AI plan contains disallowed tool: ${call.name}`);
    }
    if (!runtime.tools.has(call.name)) {
      throw new Error(`AI plan contains unknown tool: ${call.name}`);
    }
    const result = runtime.callTool(call.name, call.arguments);
    results.push({ name: call.name, arguments: call.arguments, result });
    if (result.startsWith("Error")) {
      throw new Error(`Tool ${call.name} failed: ${result}`);
    }
  }
  return results;
}

async function generateJmeterWithAi(runtime: JmeterMcpRuntime, body: JsonObject, generatedRoot: string): Promise<JsonObject> {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new Error("prompt is required.");

  const config = parseAiModelConfig(body);
  const temperature = Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.2;
  const maxTokens = Number.isFinite(Number(body.max_tokens)) ? Number(body.max_tokens) : 6000;
  const raw = await callOpenAiCompatibleChat(config, prompt, runtime, temperature, maxTokens);
  const plan = normalizeAiGeneratedPlan(raw, prompt);
  const outputPath = resolveGeneratedJmxPath(generatedRoot, typeof body.output_path === "string" ? body.output_path : null, plan.planName);
  const calls = executeAiPlan(runtime, plan);
  const validation = runtime.callTool("validate_test_plan");
  const saveResult = runtime.callTool("save_test_plan", { path: outputPath });
  if (saveResult.startsWith("Error")) throw new Error(saveResult);
  const tree = runtime.callTool("list_test_plan_tree");

  return {
    ok: true,
    model: config.model,
    summary: plan.summary,
    notes: plan.notes,
    planName: plan.planName,
    outputPath,
    downloadUrl: `/files?path=${encodeURIComponent(outputPath)}`,
    toolCalls: calls,
    validation,
    saveResult,
    tree,
  };
}

export function createMcpExpressApp(runtime = new JmeterMcpRuntime()): Express {
  const app = express();
  const sessions = new Map<string, SseSession>();
  const generatedRoot = resolve(process.cwd(), "server", "generated");
  app.use(cors());
  app.use(express.json({ limit: "20mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION, tools: runtime.tools.size });
  });

  app.get("/tools", (_req, res) => {
    res.json([...runtime.tools.values()].map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })));
  });

  registerTestCaseRoutes(app);

  app.get("/ai/config", (_req, res) => {
    res.json(publicAiConfigStatus());
  });

  app.post("/ai/generate-jmeter", async (req, res) => {
    try {
      res.json(await generateJmeterWithAi(runtime, (req.body ?? {}) as JsonObject, generatedRoot));
    } catch (error) {
      res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/tools/:name", (req, res) => {
    try {
      res.json({ content: [{ type: "text", text: runtime.callTool(req.params.name, req.body ?? {}) }] });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/files", (req, res) => {
    const requested = typeof req.query.path === "string" ? req.query.path.trim() : "";
    if (!requested) {
      res.status(400).json({ error: "Missing path query parameter" });
      return;
    }

    const filePath = resolve(requested);
    const fileRelativePath = relative(generatedRoot, filePath);
    const insideGeneratedDir = fileRelativePath !== "" && !fileRelativePath.startsWith("..") && !fileRelativePath.includes(":");

    if (!insideGeneratedDir) {
      res.status(403).json({ error: "Only files under server/generated are allowed" });
      return;
    }

    if (!filePath.toLowerCase().endsWith(".jmx")) {
      res.status(400).json({ error: "Only .jmx files can be downloaded" });
      return;
    }

    if (!existsSync(filePath)) {
      res.status(404).json({ error: `File not found: ${requested}` });
      return;
    }

    const filename = basename(filePath).replace(/"/g, "");
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  });

  app.get("/sse", (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    const sessionId = randomUUID();
    sessions.set(sessionId, { id: sessionId, response: res });
    sendSseEvent(res, "endpoint", `/messages?sessionId=${sessionId}`);
    const keepalive = setInterval(() => res.write(": keepalive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(keepalive);
      sessions.delete(sessionId);
    });
  });

  app.post("/messages", (req, res) => {
    const sessionId = String(req.query.sessionId ?? "");
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(400).json({ jsonrpc: "2.0", error: { code: -32600, message: "Invalid session" }, id: null });
      return;
    }
    res.status(202).end();
    const response = runtime.dispatch(req.body as JsonObject);
    if (response) sendSseEvent(session.response, "message", JSON.stringify(response));
  });

  app.post("/rpc", (req, res) => {
    const response = runtime.dispatch(req.body as JsonObject);
    if (response) res.json(response);
    else res.status(204).end();
  });

  return app;
}

export async function startStdio(runtime = new JmeterMcpRuntime()): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const request = JSON.parse(trimmed) as JsonObject;
      const response = runtime.dispatch(request);
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse or dispatch error: ${error instanceof Error ? error.message : String(error)}` } }) + "\n");
    }
  }
}
