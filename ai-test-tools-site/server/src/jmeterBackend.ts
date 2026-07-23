import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { XMLParser } from "fast-xml-parser";
import { err, ok, ToolError, type ToolErrorCode, type ToolResult } from "./tool-result.js";
import {
  type JsonObject,
  type JmxProperty,
  type JmxElement,
  serializeJmx,
  empty,
  element,
  pString,
  pBool,
  pInt,
  pLong,
  pDouble,
  pCollection,
  pElement,
  argumentsElementProp,
  parsePairs,
  resultCollector,
} from "./jmx-serializer.js";

type TreeNodeRef = {
  path: string;
  element: JmxElement;
  parentChildren: JmxElement[] | null;
  index: number;
};

type ElementDetails = {
  path: string;
  name: string;
  tag: string;
  testClass: string;
  guiClass: string;
  enabled: boolean;
  canDelete: boolean;
  supportsScriptEditing: boolean;
  script: {
    language: string;
    script: string;
    filename: string;
    parameters: string;
    cacheCompiled: boolean;
  } | null;
};

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

function hashCode(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
  }
  return Math.abs(hash);
}

import type { McpTool } from "./tool-registry.js";
import { createTools } from "./tool-registry.js";
import { JmeterMcpRuntime } from "./mcp-runtime.js";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "jmeter-mcp-server";
const SERVER_VERSION = "1.0.0";

// Re-export types from sub-modules for backward compatibility
export type { JsonObject, JmxProperty, JmxElement } from "./jmx-serializer.js";
export { serializeJmx } from "./jmx-serializer.js";
export type { ToolResult, ToolErrorCode } from "./tool-result.js";
export { resultText } from "./tool-result.js";
export type { McpTool } from "./tool-registry.js";
export { createTools } from "./tool-registry.js";
export { JmeterMcpRuntime } from "./mcp-runtime.js";
export { createMcpExpressApp, startStdio } from "./express-app.js";

export class TestPlanService {
  private root: JmxElement | null = null;
  private scopeStack: JmxElement[] = [];
  private jmeterHome: string | null = process.env.JMETER_HOME ?? null;

  initialize(jmeterHome: string): ToolResult {
    this.jmeterHome = jmeterHome;
    return ok(`JMeter initialized with home: ${jmeterHome}`);
  }

  createTestPlan(name: string, comments?: string | null): ToolResult {
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
    return ok(`Test plan created: ${name}`);
  }

  saveTestPlan(path: string): ToolResult {
    return this.run("saving test plan", () => {
      this.ensureTestPlan();
      const outputPath = resolve(path);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, serializeJmx(this.root!), "utf8");
      return ok(`Test plan saved: ${path}`, { path });
    }, "io-error");
  }

  loadTestPlan(path: string): ToolResult {
    return this.run("loading test plan", () => {
      if (!existsSync(path)) return err("not-found", `Error: File not found: ${path}`);
      const xml = readFileSync(path, "utf8");
      this.root = this.parseLoadedPlan(xml);
      this.scopeStack = [this.root];
      return ok(`Test plan loaded: ${path}`, { path });
    }, "io-error");
  }

  runTestPlan(path?: string | null, jtlPath?: string | null): ToolResult {
    if (!this.jmeterHome) return err("invalid-state", "Error: JMeter not initialized. Call initialize() first.");
    const executable = process.platform === "win32" ? "jmeter.bat" : "jmeter";
    const jmeterBin = resolve(this.jmeterHome, "bin", executable);
    if (!existsSync(jmeterBin)) return err("not-found", `Error running test plan: JMeter executable not found: ${jmeterBin}`);
    const planPath = path && path.length > 0 ? path : resolve(process.cwd(), "jmeter-mcp-current.jmx");
    if (!path) this.saveTestPlan(planPath);
    const args = ["-n", "-t", planPath];
    if (jtlPath) args.push("-l", jtlPath);
    const result = spawnSync(jmeterBin, args, { encoding: "utf8", shell: process.platform === "win32" });
    if (result.status !== 0) {
      return err("execution-error", `Error running test plan: ${result.stderr || result.stdout || `exit code ${result.status}`}`);
    }
    return ok("Test plan execution completed");
  }

  listTestPlanTree(): ToolResult {
    return this.run("listing test plan tree", () => {
      this.ensureTestPlan();
      const lines: string[] = [];
      this.appendTree(lines, [this.root!], "", 0);
      return ok(`${lines.join("\n")}\n`);
    });
  }

  getElementDetails(path: string): ToolResult {
    return this.run("getting element details", () => {
      const ref = this.resolvePath(path);
      return ok(JSON.stringify(this.buildElementDetails(ref)));
    });
  }

  updateElement(path: string, name?: string | null, enabled?: boolean | null, properties?: Record<string, string> | null): ToolResult {
    return this.run("updating element", () => {
      const ref = this.resolvePath(path);
      if (name) ref.element.testname = name;
      if (enabled !== null && enabled !== undefined) ref.element.enabled = enabled;
      if (properties) {
        for (const [key, value] of Object.entries(properties)) {
          this.setStringProperty(ref.element, key, value);
        }
      }
      return ok(`Element updated: ${ref.path} ${ref.element.testname}`);
    });
  }

  deleteElement(path: string): ToolResult {
    return this.run("deleting element", () => {
      const ref = this.resolvePath(path);
      if (!ref.parentChildren) return err("invalid-args", "Error deleting element: root tree cannot be deleted");
      ref.parentChildren.splice(ref.index, 1);
      return ok(`Element deleted: ${ref.path} ${ref.element.testname}`);
    });
  }

  moveElement(sourcePath: string, targetParentPath: string): ToolResult {
    return this.run("moving element", () => {
      const source = this.resolvePath(sourcePath);
      const target = this.resolvePath(targetParentPath);
      if (!source.parentChildren) return err("invalid-args", "Error moving element: root tree cannot be moved");
      if (target.path.startsWith(`${source.path}/`)) {
        return err("invalid-args", "Error moving element: target parent cannot be inside the source subtree");
      }
      const [node] = source.parentChildren.splice(source.index, 1);
      target.element.children.push(node);
      return ok(`Element moved: ${source.path} -> ${target.path}`);
    });
  }

  replaceScript(
    path: string,
    language?: string | null,
    script?: string | null,
    filename?: string | null,
    parameters?: string | null,
    cacheCompiled?: boolean | null,
  ): ToolResult {
    return this.run("replacing script", () => {
      const ref = this.resolvePath(path);
      if (language !== null && language !== undefined) this.setStringProperty(ref.element, "scriptLanguage", language);
      if (script !== null && script !== undefined) this.setStringProperty(ref.element, "script", script);
      if (filename !== null && filename !== undefined) this.setStringProperty(ref.element, "filename", filename);
      if (parameters !== null && parameters !== undefined) this.setStringProperty(ref.element, "parameters", parameters);
      if (cacheCompiled !== null && cacheCompiled !== undefined) {
        this.setStringProperty(ref.element, "cacheKey", cacheCompiled ? ref.element.testname : "");
      }
      return ok(`Script replaced: ${ref.path} ${ref.element.testname}`);
    });
  }

  validateTestPlan(): ToolResult {
    return this.run("validating test plan", () => {
      this.ensureTestPlan();
      const errors: string[] = [];
      const warnings: string[] = [];
      this.validateNode(this.root!, "/0", errors, warnings);
      let out = `Validation summary: errors=${errors.length}, warnings=${warnings.length}\n`;
      if (errors.length) out += `Errors:\n${errors.map((item) => `- ${item}`).join("\n")}\n`;
      if (warnings.length) out += `Warnings:\n${warnings.map((item) => `- ${item}`).join("\n")}\n`;
      if (!errors.length && !warnings.length) out += "No structural issues found.";
      return ok(out);
    });
  }

  addThreadGroup(name: string, numThreads: number, rampUp: number, loops: number, duration: number, delay: number): ToolResult {
    return this.run("adding thread group", () => {
      this.ensureTestPlan();
      const node = this.threadGroup("ThreadGroup", "ThreadGroupGui", "ThreadGroup", name, numThreads, rampUp, loops, duration, delay);
      this.pushThreadGroup(node);
      return ok(`Thread group added: ${name} (threads=${numThreads}, rampUp=${rampUp}, loops=${loops}${duration > 0 ? `, duration=${duration}s` : ""})`);
    });
  }

  addSetupThreadGroup(name: string, numThreads: number, rampUp: number, loops: number): ToolResult {
    return this.run("adding setup thread group", () => {
      this.ensureTestPlan();
      this.pushThreadGroup(this.threadGroup("SetupThreadGroup", "SetupThreadGroupGui", "SetupThreadGroup", name, numThreads, rampUp, loops, 0, 0));
      return ok(`Setup thread group added: ${name}`);
    });
  }

  addPostThreadGroup(name: string, numThreads: number, rampUp: number, loops: number): ToolResult {
    return this.run("adding post thread group", () => {
      this.ensureTestPlan();
      this.pushThreadGroup(this.threadGroup("PostThreadGroup", "PostThreadGroupGui", "PostThreadGroup", name, numThreads, rampUp, loops, 0, 0));
      return ok(`Post thread group added: ${name}`);
    });
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
  ): ToolResult {
    return this.run("adding HTTP request", () => {
      this.ensureThreadGroup();
      const sampler = this.httpSampler(name, method, domain, port, protocol || "https", path, bodyData || "", "", params ?? []);
      if (contentType) sampler.props.push(pString("HTTPSampler.contentType", contentType));
      const attached = this.attach(sampler);
      if (headers?.length) attached.children.push(this.headerManager(`${name} Headers`, headers.map((line) => line.replace(/:\s*/, "=")).join(";")));
      return ok(`HTTP request added: ${name} ${method} ${domain}${path}`);
    });
  }

  addScriptElement(name: string, type: string, language?: string | null, script?: string | null, filename?: string | null): ToolResult {
    return this.run("adding script", () => {
      this.ensureThreadGroup();
      const safeLang = language || "groovy";
      if ((type || "sampler") === "sampler") {
        this.attach(safeLang.toLowerCase() === "beanshell"
          ? this.beanShellSampler(name, script || "", filename || "", "")
          : this.jsr223Sampler(name, safeLang, script || "", filename || "", ""));
        return ok(`Script sampler added: ${name}`);
      }
      if (type === "pre_processor") {
        this.attach(this.jsr223PreProcessor(name, safeLang, script || "", filename || "", "", false));
        return ok(`Pre-processor added: ${name}`);
      }
      if (type === "post_processor") {
        this.attach(this.jsr223PostProcessor(name, safeLang, script || "", filename || "", "", false));
        return ok(`Post-processor added: ${name}`);
      }
      return err("unknown-type", `Error: unknown script type '${type}'`);
    });
  }

  addResponseAssertion(name: string, testField?: string | null, matchType?: string | null, patterns?: string[] | null, isNot = false): ToolResult {
    return this.run("adding assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.responseAssertion(name, testField || "response_data", matchType || "substring", patterns ?? [], isNot));
      return ok(`Response assertion added: ${name}`);
    });
  }

  addJsonPathAssertion(name: string, jsonPath?: string | null, expectedValue?: string | null, jsonValidation = false, expectNull = false, invert = false): ToolResult {
    return this.run("adding JSON Path assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.jsonPathAssertionElement(name, jsonPath || "", expectedValue || "", jsonValidation, expectNull, invert));
      return ok(`JSON Path assertion added: ${name}`);
    });
  }

  addDurationAssertion(name: string, maxDuration: number): ToolResult {
    return this.run("adding duration assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.durationAssertionElement(name, maxDuration));
      return ok(`Duration assertion added: ${name} (max=${maxDuration}ms)`);
    });
  }

  addSizeAssertion(name: string, testField: string, comparator: number, size: number): ToolResult {
    return this.run("adding size assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.sizeAssertion(name, testField, comparator, size));
      return ok(`Size assertion added: ${name}`);
    });
  }

  addXPathAssertion(name: string, xpath?: string | null): ToolResult {
    return this.run("adding XPath assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.xpathAssertionElement(name, xpath || ""));
      return ok(`XPath assertion added: ${name}`);
    });
  }

  addJMESPathAssertion(name: string, jmesPath?: string | null, expectedValue?: string | null, jsonValidation = false, expectNull = false, invert = false): ToolResult {
    return this.run("adding JMESPath assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.jmesPathAssertionElement(name, jmesPath || "", expectedValue || "", jsonValidation, expectNull, invert));
      return ok(`JMESPath assertion added: ${name}`);
    });
  }

  addHTMLAssertion(name: string, document?: string | null, doctype = 1, format = false, errorsOnly = false, showSuccesses = false): ToolResult {
    return this.run("adding HTML assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.htmlAssertionElement(name, document || "", doctype, format, errorsOnly, showSuccesses));
      return ok(`HTML assertion added: ${name}`);
    });
  }

  addXmlSchemaAssertion(name: string, xsdFilename?: string | null, xsdContent?: string | null): ToolResult {
    return this.run("adding XML Schema assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.xmlSchemaAssertionElement(name, xsdFilename || "", xsdContent));
      return ok(`XML Schema assertion added: ${name}`);
    });
  }

  addMd5HexAssertion(name: string, md5Hex?: string | null, useMd5 = true): ToolResult {
    return this.run("adding MD5 Hex assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.md5HexAssertionElement(name, md5Hex || ""));
      return ok(`MD5 Hex assertion added: ${name}`);
    });
  }

  addBeanShellAssertion(name: string, script?: string | null, filename?: string | null, parameters?: string | null, resetInterpreter = false): ToolResult {
    return this.run("adding BeanShell assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.beanShellAssertion(name, script || "", filename || "", parameters || "", resetInterpreter));
      return ok(`BeanShell assertion added: ${name}`);
    });
  }

  addJsr223Assertion(name: string, language?: string | null, script?: string | null, filename?: string | null, parameters?: string | null, cacheCompiled = true): ToolResult {
    return this.run("adding JSR223 assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.jsr223Assertion(name, language || "groovy", script || "", filename || "", parameters || "", cacheCompiled));
      return ok(`JSR223 assertion added: ${name}`);
    });
  }

  addCompareAssertion(name: string, compareContent?: string | null, compareType?: string | null, useResponseData = true): ToolResult {
    return this.run("adding Compare assertion", () => {
      this.ensureThreadGroup();
      this.attach(this.compareAssertionElement(name, useResponseData));
      return ok(`Compare assertion added: ${name}`);
    });
  }

  addXmlAssertion(name: string): ToolResult {
    return this.run("adding XML assertion", () => {
      this.ensureThreadGroup();
      this.attach(element("XMLAssertion", "XMLAssertionGui", "XMLAssertion", name));
      return ok(`XML assertion added: ${name}`);
    });
  }

  addListener(type: string, filename?: string | null): ToolResult {
    return this.run("adding listener", () => this.attachListener(type, filename));
  }

  addExtendedListener(type: string, filename?: string | null): ToolResult {
    return this.run("adding extended listener", () => this.attachListener(type, filename));
  }

  private attachListener(type: string, filename?: string | null): ToolResult {
    this.ensureTestPlan();
    const safeType = type || "view_results_tree";
    const listener = this.listenerByType(safeType, safeType, { filename });
    if (!listener) return err("unknown-type", `Error: unknown listener type '${type}'`);
    this.attach(listener);
    return ok(`Listener added: ${type}`);
  }

  addBeanShellListener(name: string, script?: string | null, filename?: string | null, parameters?: string | null, resetInterpreter = false): ToolResult {
    return this.run("adding BeanShell listener", () => {
      this.ensureThreadGroup();
      this.attach(this.beanShellListenerElement(name, script || "", filename || "", parameters || "", resetInterpreter));
      return ok(`BeanShell listener added: ${name}`);
    });
  }

  addJsr223Listener(name: string, language?: string | null, script?: string | null, filename?: string | null, parameters?: string | null): ToolResult {
    return this.run("adding JSR223 listener", () => {
      this.ensureThreadGroup();
      this.attach(this.jsr223ListenerElement(name, language || "groovy", script || "", filename || "", parameters || ""));
      return ok(`JSR223 listener added: ${name}`);
    });
  }

  addSaveResponseListener(name: string, outputDirectory?: string | null, filenamePrefix?: string | null, successOnly = true): ToolResult {
    return this.run("adding save response listener", () => {
      this.ensureThreadGroup();
      const file = outputDirectory ? `${outputDirectory}/${filenamePrefix || "response"}` : filenamePrefix || "response";
      this.attach(element("ResultCollector", "SimpleDataWriter", "ResultCollector", name, [
        pString("filename", file),
        pBool("ResultCollector.error_logging", !successOnly),
        { kind: "objSaveConfig" },
      ]));
      return ok(`Save response listener added: ${name}`);
    });
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
  ): ToolResult {
    return this.run("adding backend listener", () => {
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
      return ok(`Backend listener added: ${name}`);
    });
  }

  addAggregateGraph(name: string, filename?: string | null): ToolResult {
    return this.run("adding aggregate graph", () => {
      this.ensureThreadGroup();
      this.attach(element("ResultCollector", "StatGraphVisualizer", "ResultCollector", name, [
        ...(filename ? [pString("filename", filename)] : []),
        pBool("ResultCollector.error_logging", false),
        { kind: "objSaveConfig" },
      ]));
      return ok(`Aggregate graph listener added: ${name}`);
    });
  }

  addTimer(type: string, delay: number, range: number, maxDelay: number, throughput: number, throughputMode: number, groupSize: number, syncTimeout: number): ToolResult {
    return this.run("adding timer", () => {
      this.ensureThreadGroup();
      const timer = this.timer(type || "constant", "", delay, range, maxDelay, throughput, throughputMode, groupSize, syncTimeout);
      if (!timer) return err("unknown-type", `Error: unknown timer type '${type}'`);
      this.attach(timer);
      return ok(`Timer added: ${type || "constant"}`);
    });
  }

  addPoissonTimer(name: string, delay: number, range: number): ToolResult {
    return this.run("adding Poisson timer", () => {
      this.ensureThreadGroup();
      this.attach(this.timer("poisson", name, delay, range, range, 0, 0, 0, 0)!);
      return ok(`Poisson timer added: ${name}`);
    });
  }

  addBeanShellTimer(name: string, script?: string | null, filename?: string | null, parameters?: string | null, resetInterpreter = false): ToolResult {
    return this.run("adding BeanShell timer", () => {
      this.ensureThreadGroup();
      this.attach(element("BeanShellTimer", "TestBeanGUI", "BeanShellTimer", name, [
        pString("BeanShellTimer.script", script || ""),
        pString("BeanShellTimer.filename", filename || ""),
        pString("BeanShellTimer.parameters", parameters || ""),
        pBool("BeanShellTimer.resetInterpreter", resetInterpreter),
      ]));
      return ok(`BeanShell timer added: ${name}`);
    });
  }

  addTimerAtPath(parentPath: string, name: string | null, type: string, delay: number, range: number, maxDelay: number, throughput: number, throughputMode: number, groupSize: number, syncTimeout: number): ToolResult {
    return this.run("adding timer at path", () => {
      const ref = this.resolvePath(parentPath);
      const timer = this.timer(type || "constant", name || "", delay, range, maxDelay, throughput, throughputMode, groupSize, syncTimeout);
      if (!timer) return err("unknown-type", `Error: unknown timer type '${type}'`);
      ref.element.children.push(timer);
      return ok(`Timer added at ${parentPath}: ${timer.testname} (${type})`);
    });
  }

  addListenerAtPath(parentPath: string, name: string | null, listenerType: string, filename?: string | null, script?: string | null, language?: string | null, parameters?: string | null, resetInterpreter = false): ToolResult {
    return this.run("adding listener at path", () => {
      const ref = this.resolvePath(parentPath);
      const listenerName = name || listenerType.replace(/_/g, " ");
      const listener = this.listenerByType(listenerType, listenerName, { filename, script, language, parameters, resetInterpreter });
      if (!listener) return err("unknown-type", `Error: unknown listener type '${listenerType}'`);
      ref.element.children.push(listener);
      return ok(`Listener added at ${parentPath}: ${listenerName} (${listenerType})`);
    });
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
  ): ToolResult {
    return this.run("adding assertion at path", () => {
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
      if (!assertion) return err("unknown-type", `Error: unknown assertion type '${assertionType}'`);
      ref.element.children.push(assertion);
      return ok(`Assertion added at ${parentPath}: ${assertionName} (${assertionType})`);
    });
  }

  addExtractorAtPath(parentPath: string, name: string | null, extractorType: string, refName: string, regex?: string | null, template?: string | null, matchNumber = 1, defaultValue?: string | null, jsonPath?: string | null, computeConcatenation = false, xpath?: string | null, useNamespaces = false, cssExpr?: string | null, attribute?: string | null, leftBoundary?: string | null, rightBoundary?: string | null, jmesPath?: string | null, useField?: string | null): ToolResult {
    return this.run("adding extractor at path", () => {
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
      if (!extractor) return err("unknown-type", `Error: unknown extractor type '${extractorType}'`);
      ref.element.children.push(extractor);
      return ok(`Extractor added at ${parentPath}: ${extractorName}`);
    });
  }

  addHttpDefaults(name: string, domain?: string | null, port?: string | null, protocol?: string | null, path?: string | null, contentEncoding?: string | null, implementation?: string | null, connectTimeout?: string | null, responseTimeout?: string | null): ToolResult {
    return this.run("adding HTTP defaults", () => {
      this.ensureTestPlan();
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
      return ok(`HTTP defaults added: ${name}`);
    });
  }

  addHttpHeaderManager(name: string, headers?: string | null): ToolResult {
    return this.run("adding HTTP header manager", () => {
      this.ensureTestPlan();
      this.attach(this.headerManager(name, headers || ""));
      return ok(`HTTP header manager added: ${name}`);
    });
  }

  addJdbcConfig(name: string, poolMax?: string | null, username?: string | null, password?: string | null, connectionUrl?: string | null, driverClass?: string | null, validationQuery?: string | null, maxAge?: string | null, timeout?: string | null): ToolResult {
    return this.run("adding JDBC config", () => {
      this.ensureThreadGroup();
      this.attach(this.jdbcConfig(name, poolMax, username, password, connectionUrl, driverClass, validationQuery, maxAge, timeout));
      return ok(`JDBC config added: ${name}`);
    });
  }

  addKeystoreConfig(name: string, preload?: string | null, variableName?: string | null, clientCertAliasVar?: string | null, keystoreType?: string | null): ToolResult {
    return this.run("adding keystore config", () => {
      this.ensureThreadGroup();
      this.attach(element("KeystoreConfig", "TestBeanGUI", "KeystoreConfig", name, [
        pString("preload", preload || "true"),
        pString("startIndex", variableName || ""),
        pString("clientCertAliasVarName", clientCertAliasVar || ""),
        pString("keystoreType", keystoreType || "jks"),
      ]));
      return ok(`Keystore config added: ${name}`);
    });
  }

  addLoginConfig(name: string, usernameVar?: string | null, passwordVar?: string | null): ToolResult {
    return this.run("adding login config", () => {
      this.ensureThreadGroup();
      this.attach(element("ConfigTestElement", "LoginConfigGui", "ConfigTestElement", name, [
        pString("ConfigTestElement.username", usernameVar || ""),
        pString("ConfigTestElement.password", passwordVar || ""),
      ]));
      return ok(`Login config added: ${name}`);
    });
  }

  addTcpConfig(name: string, reuseConnection?: string | null, closeConnection?: string | null, nodelay?: string | null, timeout?: string | null): ToolResult {
    return this.run("adding TCP config", () => {
      this.ensureThreadGroup();
      this.attach(element("ConfigTestElement", "TCPConfigGui", "ConfigTestElement", name, [
        pBool("TCPSampler.reUseConnection", reuseConnection?.toLowerCase() === "true"),
        pBool("TCPSampler.closeConnection", closeConnection?.toLowerCase() === "true"),
        pBool("TCPSampler.nodelay", nodelay?.toLowerCase() === "true"),
        pString("TCPSampler.timeout", timeout || "0"),
      ]));
      return ok(`TCP config added: ${name}`);
    });
  }

  addFtpConfig(name: string, binaryMode?: string | null, saveResponse?: string | null, encoding?: string | null): ToolResult {
    return this.run("adding FTP config", () => {
      this.ensureThreadGroup();
      this.attach(element("ConfigTestElement", "FtpConfigGui", "ConfigTestElement", name, [
        pBool("FTPSampler.binarymode", binaryMode?.toLowerCase() === "true"),
        pBool("FTPSampler.saveresponse", saveResponse?.toLowerCase() === "true"),
        pString("FTPSampler.fileencoding", encoding || ""),
      ]));
      return ok(`FTP config added: ${name}`);
    });
  }

  addCounterConfig(name: string, start?: string | null, end?: string | null, increment?: string | null, format?: string | null, variableName?: string | null, perThread = true, resetOnThreadGroupIteration = false): ToolResult {
    return this.run("adding counter config", () => {
      this.ensureThreadGroup();
      this.attach(this.counterConfig(name, variableName || "", Number(start || 0), Number(increment || 1), end ? Number(end) : Number.MAX_SAFE_INTEGER, format || "", perThread, resetOnThreadGroupIteration));
      return ok(`Counter config added: ${name}`);
    });
  }

  addIncludeController(name: string, includePath: string): ToolResult {
    return this.run("adding include controller", () => {
      this.ensureThreadGroup();
      const validation = this.validateIncludeControllerPath(includePath);
      if (validation) return validation;
      this.attach(element("IncludeController", "IncludeControllerGui", "IncludeController", name, [pString("IncludeController.includepath", includePath)]));
      return ok(`Include controller added: ${name}`);
    });
  }

  addLdapRequest(name: string, server?: string | null, port = 389, rootdn?: string | null, searchFilter?: string | null, searchBase?: string | null, attributes?: string | null, scope?: string | null, useSsl = false): ToolResult {
    return this.run("adding LDAP sampler", () => {
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
      return ok(`LDAP sampler added: ${name}`);
    });
  }

  addLdapExtRequest(name: string, server?: string | null, port = 389, rootdn?: string | null, searchFilter?: string | null, searchBase?: string | null, scope?: string | null, useSsl = false, connectionTimeout?: string | null, maxResults?: string | null, useUserDn = false): ToolResult {
    return this.run("adding LDAP extended sampler", () => {
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
      return ok(`LDAP extended sampler added: ${name}`);
    });
  }

  addMailReaderRequest(name: string, serverType?: string | null, server?: string | null, username?: string | null, password?: string | null, folder?: string | null, numMessages = 1, useSsl = false, useStartTls = false): ToolResult {
    return this.run("adding mail reader sampler", () => {
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
      return ok(`Mail reader sampler added: ${name}`);
    });
  }

  addSmtpSampler(name: string, server?: string | null, port = 25, useAuth?: string | null, username?: string | null, password?: string | null, useSsl?: string | null, useTls?: string | null, starttls?: string | null, sender?: string | null, receiver?: string | null, cc?: string | null, bcc?: string | null, subject?: string | null, body?: string | null, suppressSubject?: string | null, attachFile?: string | null, message?: string | null, plainBody?: string | null, enableDebug?: string | null): ToolResult {
    return this.run("adding SMTP sampler", () => {
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
      return ok(`SMTP sampler added: ${name}`);
    });
  }

  addTcpSampler(name: string, server?: string | null, port = 0, reUseConnection?: string | null, closeConnection?: string | null, nodelay?: string | null, requestData?: string | null, username?: string | null, password?: string | null, timeout?: string | null, eolByte?: string | null): ToolResult {
    return this.run("adding TCP sampler", () => {
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
      return ok(`TCP sampler added: ${name}`);
    });
  }

  addSystemSampler(name: string, command?: string | null, commandParameters?: string | null, environmentVariables?: string | null, workingDirectory?: string | null, stdoutFilename?: string | null, stderrFilename?: string | null, timeout = 0, checkReturnCode?: string | null, expectedReturnCode = 0, interpreter?: string | null): ToolResult {
    return this.run("adding system sampler", () => {
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
      return ok(`System sampler added: ${name}`);
    });
  }

  addTestAction(name: string, action?: string | null, duration = 0): ToolResult {
    return this.run("adding test action", () => {
      this.ensureThreadGroup();
      const actionMap: Record<string, number> = { pause: 0, stop: 1, stop_now: 2, next_iteration: 3, next_loop: 4, break: 5 };
      this.attach(element("TestAction", "TestActionGui", "TestAction", name, [
        pInt("ActionProcessor.action", actionMap[action || "pause"] ?? 0),
        pString("ActionProcessor.duration", String(duration)),
      ]));
      return ok(`Test action added: ${name}`);
    });
  }

  addRegExUserParameters(name: string, regExRefName?: string | null, paramNamesGroupNr?: string | null, paramValuesGroupNr?: string | null): ToolResult {
    return this.run("adding RegEx user parameters", () => {
      this.ensureThreadGroup();
      this.attach(element("RegExUserParameters", "RegExUserParametersGui", "RegExUserParameters", name, [
        pString("RegExUserParameters.regex_ref_name", regExRefName || ""),
        pString("RegExUserParameters.param_names_gr_nr", paramNamesGroupNr || ""),
        pString("RegExUserParameters.param_values_gr_nr", paramValuesGroupNr || ""),
      ]));
      return ok(`RegEx user parameters added: ${name}`);
    });
  }

  addSampleTimeout(name: string, timeout = 0): ToolResult {
    return this.run("adding sample timeout", () => {
      this.ensureThreadGroup();
      this.attach(this.sampleTimeoutElement(name, timeout));
      return ok(`Sample timeout added: ${name}`);
    });
  }

  addFtpSampler(name: string, server?: string | null, port = 21, username?: string | null, password?: string | null, localFile?: string | null, remoteFile?: string | null, getOrPut?: string | null, binaryMode?: string | null, saveResponse?: string | null, encoding?: string | null): ToolResult {
    return this.run("adding FTP sampler", () => {
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
      return ok(`FTP sampler added: ${name}`);
    });
  }

  addJdbcRequest(name: string, queryType?: string | null, sql?: string | null, parameterValues?: string | null, parameterTypes?: string | null, variableNames?: string | null, resultVariable?: string | null, queryTimeout = 0, dataSourceName?: string | null): ToolResult {
    return this.run("adding JDBC request", () => {
      this.ensureThreadGroup();
      this.attach(this.jdbcLike("JDBCSampler", "TestBeanGUI", "JDBCSampler", name, queryType, sql, parameterValues, parameterTypes, variableNames, resultVariable, queryTimeout, dataSourceName));
      return ok(`JDBC request added: ${name}`);
    });
  }

  addPreProcessorAtPath(parentPath: string, name: string | null, preprocessorType: string, script?: string | null, filename?: string | null, language?: string | null, parameters?: string | null, cacheCompiled = true, timeout = 0): ToolResult {
    return this.run("adding pre-processor at path", () => {
      const ref = this.resolvePath(parentPath);
      const ppName = name || "Pre-Processor";
      let preprocessor: JmxElement | null = null;
      if ((preprocessorType || "jsr223") === "jsr223") preprocessor = this.jsr223PreProcessor(ppName, language || "groovy", script || "", filename || "", parameters || "", cacheCompiled);
      if (preprocessorType === "beanshell") preprocessor = this.beanShellPreProcessorElement(ppName, script || "", filename || "", parameters || "");
      if (preprocessorType === "sample_timeout") preprocessor = this.sampleTimeoutElement(ppName, timeout);
      if (!preprocessor) return err("unknown-type", `Error: unknown preprocessor type '${preprocessorType}'`);
      ref.element.children.push(preprocessor);
      return ok(`Pre-processor added at ${parentPath}: ${ppName}`);
    });
  }

  addPostProcessorAtPath(parentPath: string, name: string | null, postprocessorType: string, script?: string | null, filename?: string | null, language?: string | null, parameters?: string | null, cacheCompiled = true): ToolResult {
    return this.run("adding post-processor at path", () => {
      const ref = this.resolvePath(parentPath);
      const ppName = name || "Post-Processor";
      let postprocessor: JmxElement | null = null;
      if ((postprocessorType || "jsr223") === "jsr223") postprocessor = this.jsr223PostProcessor(ppName, language || "groovy", script || "", filename || "", parameters || "", cacheCompiled);
      if (postprocessorType === "beanshell") postprocessor = this.beanShellPostProcessorElement(ppName, script || "", filename || "", parameters || "");
      if (!postprocessor) return err("unknown-type", `Error: unknown postprocessor type '${postprocessorType}'`);
      ref.element.children.push(postprocessor);
      return ok(`Post-processor added at ${parentPath}: ${ppName}`);
    });
  }

  /**
   * Single error boundary for all public methods (ADR-0002): the body returns a
   * ToolResult; ToolError failures keep their stable code, anything else gets the
   * per-method fallback code. The `Error <context>: <message>` text shape is
   * preserved from the legacy string-collapsing catch blocks.
   */
  private run(context: string, fn: () => ToolResult, fallbackCode: ToolErrorCode = "internal"): ToolResult {
    try {
      return fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(error instanceof ToolError ? error.code : fallbackCode, `Error ${context}: ${message}`);
    }
  }

  private ensureTestPlan(): void {
    if (!this.root) throw new ToolError("invalid-state", "No test plan exists. Call create_test_plan first.");
  }

  private ensureThreadGroup(): void {
    this.ensureTestPlan();
    if (!this.scopeStack.some((node) => ["ThreadGroup", "SetupThreadGroup", "PostThreadGroup"].includes(node.tag))) {
      throw new ToolError("invalid-state", "No thread group exists. Call add_thread_group first.");
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
    if (!path || !path.trim()) throw new ToolError("invalid-args", "path is required, for example /0/1/2");
    const parts = path.replace(/^\/+/, "").split("/").filter(Boolean).map((part) => {
      const index = Number(part);
      if (!Number.isInteger(index)) throw new ToolError("invalid-args", `path segment must be a number: ${part}`);
      return index;
    });
    if (!parts.length) throw new ToolError("invalid-args", "path must point to an element, for example /0");
    let currentChildren = [this.root!];
    let parentChildren: JmxElement[] | null = null;
    let elementRef: JmxElement | null = null;
    let currentPath = "";
    let indexRef = -1;
    for (let depth = 0; depth < parts.length; depth += 1) {
      const index = parts[depth];
      if (index < 0 || index >= currentChildren.length) throw new ToolError("not-found", `path index out of range at ${index}`);
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

  private buildElementDetails(ref: TreeNodeRef): ElementDetails {
    const script = this.extractScriptDetails(ref.element);
    return {
      path: ref.path,
      name: ref.element.testname,
      tag: ref.element.tag,
      testClass: ref.element.testclass,
      guiClass: ref.element.guiclass,
      enabled: ref.element.enabled !== false,
      canDelete: ref.parentChildren !== null,
      supportsScriptEditing: script !== null,
      script,
    };
  }

  private extractScriptDetails(node: JmxElement): ElementDetails["script"] {
    const isJsr223 = node.tag.includes("JSR223") || node.testclass.includes("JSR223");
    const isBeanShell = node.tag.includes("BeanShell") || node.testclass.includes("BeanShell");

    if (!isJsr223 && !isBeanShell) return null;

    if (isBeanShell) {
      return {
        language: "beanshell",
        script: this.findPropValue(node, "BeanShellSampler.query")
          ?? this.findPropValue(node, "BeanShellAssertion.query")
          ?? this.findPropValue(node, "script")
          ?? "",
        filename: this.findPropValue(node, "BeanShellSampler.filename")
          ?? this.findPropValue(node, "BeanShellAssertion.filename")
          ?? this.findPropValue(node, "filename")
          ?? "",
        parameters: this.findPropValue(node, "BeanShellSampler.parameters")
          ?? this.findPropValue(node, "BeanShellAssertion.parameters")
          ?? this.findPropValue(node, "parameters")
          ?? "",
        cacheCompiled: false,
      };
    }

    return {
      language: this.findPropValue(node, "scriptLanguage") ?? "groovy",
      script: this.findPropValue(node, "script") ?? "",
      filename: this.findPropValue(node, "filename") ?? "",
      parameters: this.findPropValue(node, "parameters") ?? "",
      cacheCompiled: Boolean(this.findPropValue(node, "cacheKey")),
    };
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

  private jsonPathAssertionElement(name: string, jsonPath: string, expectedValue: string, jsonValidation: boolean, expectNull: boolean, invert: boolean): JmxElement {
    return element("JSONPathAssertion", "JSONPathAssertionGui", "JSONPathAssertion", name, [
      pString("JSON_PATH", jsonPath),
      pString("EXPECTED_VALUE", expectedValue),
      pBool("JSONVALIDATION", jsonValidation),
      pBool("EXPECT_NULL", expectNull),
      pBool("INVERT", invert),
    ]);
  }

  private durationAssertionElement(name: string, maxDuration: number): JmxElement {
    return element("DurationAssertion", "DurationAssertionGui", "DurationAssertion", name, [pLong("DurationAssertion.duration", maxDuration)]);
  }

  private xpathAssertionElement(name: string, xpath: string): JmxElement {
    return element("XPath2Assertion", "XPath2AssertionGui", "XPath2Assertion", name, [pString("XPath2Assertion.xpath", xpath)]);
  }

  private jmesPathAssertionElement(name: string, jmesPath: string, expectedValue: string, jsonValidation: boolean, expectNull: boolean, invert: boolean): JmxElement {
    return element("JMESPathAssertion", "JMESPathAssertionGui", "JMESPathAssertion", name, [
      pString("JMESPathAssertion.jmesPath", jmesPath),
      pString("JMESPathAssertion.expectedValue", expectedValue),
      pBool("JMESPathAssertion.jsonValidation", jsonValidation),
      pBool("JMESPathAssertion.expectNull", expectNull),
      pBool("JMESPathAssertion.invert", invert),
    ]);
  }

  private htmlAssertionElement(name: string, document: string, doctype: number, format: boolean, errorsOnly: boolean, showSuccesses: boolean): JmxElement {
    return element("HTMLAssertion", "HTMLAssertionGui", "HTMLAssertion", name, [
      pString("filename", document),
      pString("doctype", String(doctype)),
      pBool("errorsonly", errorsOnly),
      pBool("format", format),
      pBool("showSuccess", showSuccesses),
    ]);
  }

  private xmlSchemaAssertionElement(name: string, xsdFilename: string, xsdContent?: string | null): JmxElement {
    const props = [pString("xmlschema_assertion_filename", xsdFilename)];
    if (xsdContent) props.push(pString("xmlschema_assertion_content", xsdContent));
    return element("XMLSchemaAssertion", "XMLSchemaAssertionGUI", "XMLSchemaAssertion", name, props);
  }

  private md5HexAssertionElement(name: string, md5Hex: string): JmxElement {
    return element("MD5HexAssertion", "MD5HexAssertionGUI", "MD5HexAssertion", name, [pString("MD5HexAssertion.size", md5Hex)]);
  }

  private compareAssertionElement(name: string, useResponseData: boolean, compareTime = -1): JmxElement {
    return element("CompareAssertion", "TestBeanGUI", "CompareAssertion", name, [
      pBool("compareContent", useResponseData),
      pLong("compareTime", compareTime),
      pCollection("stringsToSkip"),
    ]);
  }

  private assertionByType(name: string, type: string, args: Record<string, unknown>): JmxElement | null {
    switch (type || "response") {
      case "response":
        return this.responseAssertion(name, empty(args.testField || "response_data"), empty(args.matchType || "substring"), (args.patterns as string[]) || [], Boolean(args.isNot));
      case "json_path":
        return this.jsonPathAssertionElement(name, empty(args.jsonPath), empty(args.expectedValue), Boolean(args.jsonValidation), Boolean(args.expectNull), Boolean(args.invert));
      case "duration":
        return this.durationAssertionElement(name, Number(args.maxDuration || 0));
      case "size": {
        const opMap: Record<string, number> = { equal: 0, notequal: 1, greater: 2, less: 3, greaterorequal: 4, lessorequal: 5 };
        return this.sizeAssertion(name, empty(args.testField || "response_data"), opMap[empty(args.sizeOperator)] ?? 3, Number(args.size || 0));
      }
      case "xpath":
        return this.xpathAssertionElement(name, empty(args.xpath));
      case "jmespath":
        return this.jmesPathAssertionElement(name, empty(args.jmespath), empty(args.jmespathExpectedValue), false, false, Boolean(args.jmespathInvert));
      case "xml_schema":
        return this.xmlSchemaAssertionElement(name, empty(args.xpath));
      case "md5hex":
        return this.md5HexAssertionElement(name, empty(args.expectedValue));
      case "html":
        return this.htmlAssertionElement(name, empty(args.expectedValue), Number(args.size || 1), false, Boolean(args.isNot), false);
      case "beanshell":
        return this.beanShellAssertion(name, empty(args.xpath), empty(args.jsonPath), empty(args.jmespath), Boolean(args.invert));
      case "jsr223":
        return this.jsr223Assertion(name, empty(args.expectedValue || "groovy"), empty(args.xpath), empty(args.jsonPath), empty(args.jmespath), Boolean(args.jsonValidation));
      case "compare":
        return this.compareAssertionElement(name, Boolean(args.isNot), Number(args.maxDuration || -1));
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

  private listenerByType(type: string, name: string, args: { filename?: string | null; script?: string | null; language?: string | null; parameters?: string | null; resetInterpreter?: boolean }): JmxElement | null {
    if (type === "beanshell") return this.beanShellListenerElement(name, args.script || "", args.filename || "", args.parameters || "", Boolean(args.resetInterpreter));
    if (type === "jsr223") return this.jsr223ListenerElement(name, args.language || "groovy", args.script || "", args.filename || "", args.parameters || "");
    return resultCollector(type, name, args.filename || "");
  }

  private beanShellListenerElement(name: string, script: string, filename: string, parameters: string, resetInterpreter: boolean): JmxElement {
    return element("BeanShellListener", "TestBeanGUI", "BeanShellListener", name, [
      pString("script", script),
      pString("filename", filename),
      pString("parameters", parameters),
      pBool("resetInterpreter", resetInterpreter),
    ]);
  }

  private jsr223ListenerElement(name: string, language: string, script: string, filename: string, parameters: string): JmxElement {
    return element("JSR223Listener", "TestBeanGUI", "JSR223Listener", name, [
      pString("scriptLanguage", language),
      pString("script", script),
      pString("filename", filename),
      pString("parameters", parameters),
      pString("cacheKey", name),
    ]);
  }

  private beanShellPreProcessorElement(name: string, script: string, filename: string, parameters: string): JmxElement {
    return element("BeanShellPreProcessor", "TestBeanGUI", "BeanShellPreProcessor", name, [pString("filename", filename), pString("script", script), pString("parameters", parameters), pBool("resetInterpreter", false)]);
  }

  private beanShellPostProcessorElement(name: string, script: string, filename: string, parameters: string): JmxElement {
    return element("BeanShellPostProcessor", "TestBeanGUI", "BeanShellPostProcessor", name, [pString("filename", filename), pString("script", script), pString("parameters", parameters), pBool("resetInterpreter", false)]);
  }

  private sampleTimeoutElement(name: string, timeout: number): JmxElement {
    return element("SampleTimeout", "SampleTimeoutGui", "SampleTimeout", name, [pString("InterruptTimer.timeout", String(timeout))]);
  }

  private headerManager(name: string, headers: string): JmxElement {
    const headerItems = parsePairs(headers, ";").map(([key, value]) => pElement("", "Header", [pString("Header.name", key), pString("Header.value", value)]));
    return element("HeaderManager", "HeaderPanel", "HeaderManager", name, [pCollection("HeaderManager.headers", headerItems)]);
  }

  private jdbcConfig(name: string, poolMax?: string | null, username?: string | null, password?: string | null, connectionUrl?: string | null, driverClass?: string | null, validationQuery?: string | null, maxAge?: string | null, timeout?: string | null): JmxElement {
    return element("JDBCDataSource", "TestBeanGUI", "DataSourceElement", name, [pString("dataSource", name), pString("poolMax", poolMax || "10"), pString("username", username || ""), pString("password", password || ""), pString("dbUrl", connectionUrl || ""), pString("driver", driverClass || ""), pString("checkQuery", validationQuery || "Select 1"), pString("connectionAge", maxAge || "5000"), pString("timeout", timeout || "10000")]);
  }

  private counterConfig(name: string, variableName: string, start: number, increment: number, end: number, format: string, perThread: boolean, reset: boolean): JmxElement {
    return element("CounterConfig", "CounterConfigGui", "CounterConfig", name, [pString("CounterConfig.name", variableName), pLong("CounterConfig.start", start), pLong("CounterConfig.incr", increment), pLong("CounterConfig.end", end), pBool("CounterConfig.per_user", perThread), pString("CounterConfig.format", format), pBool("CounterConfig.reset_on_tg_iteration", reset)]);
  }

  private jdbcLike(tag: string, gui: string, testclass: string, name: string, queryType?: string | null, sql?: string | null, parameterValues?: string | null, parameterTypes?: string | null, variableNames?: string | null, resultVariable?: string | null, queryTimeout = 0, dataSourceName?: string | null): JmxElement {
    return element(tag, gui, testclass, name, [pString("queryType", queryType || ""), pString("query", sql || ""), pString("queryArguments", parameterValues || ""), pString("queryArgumentsTypes", parameterTypes || ""), pString("variableNames", variableNames || ""), pString("resultVariable", resultVariable || ""), pString("queryTimeout", String(queryTimeout)), pString("dataSource", dataSourceName || "")]);
  }

  private validateIncludeControllerPath(includePath: string): ToolResult | null {
    if (!includePath) return err("invalid-args", "Error adding include controller: include_path is required");
    if (!existsSync(includePath)) return err("not-found", `Error adding include controller: include_path not found: ${includePath}`);
    try {
      const content = readFileSync(includePath, "utf8");
      if (!content.includes("TestFragmentController")) {
        return err("invalid-args", "Error adding include controller: included JMX must contain a Test Fragment (TestFragmentController). Use JMeter's 'Save as Test Fragment' format.");
      }
      return null;
    } catch (error) {
      return err("io-error", `Error adding include controller: failed to load include_path: ${error instanceof Error ? error.message : String(error)}`);
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
      if (!entry || "hashTree" in entry) continue;
      const tag = Object.keys(entry).find((key) => key !== ":@");
      if (!tag || tag === "#text") continue;
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
