export type JsonObject = Record<string, unknown>;

export type JmxProperty =
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

export const empty = (value: unknown): string => (value == null ? "" : String(value));
export const boolText = (value: boolean): string => (value ? "true" : "false");

export function attrEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function textEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function pString(name: string, value: unknown): JmxProperty {
  return { kind: "string", name, value: empty(value) };
}

export function pBool(name: string, value: boolean): JmxProperty {
  return { kind: "bool", name, value };
}

export function pInt(name: string, value: number): JmxProperty {
  return { kind: "int", name, value };
}

export function pLong(name: string, value: number | string): JmxProperty {
  return { kind: "long", name, value };
}

export function pDouble(name: string, value: number | string): JmxProperty {
  return { kind: "double", name, value };
}

export function pCollection(name: string, items: JmxProperty[] = []): JmxProperty {
  return { kind: "collection", name, items };
}

export function pElement(
  name: string,
  elementType: string,
  props: JmxProperty[] = [],
  attrs: Record<string, string> = {},
): JmxProperty {
  return { kind: "element", name, elementType, attrs, props };
}

export function element(
  tag: string,
  guiclass: string,
  testclass: string,
  testname: string,
  props: JmxProperty[] = [],
): JmxElement {
  return { tag, guiclass, testclass, testname, enabled: true, props, children: [] };
}

export function argumentProp(name: string, value: string, http = false, encoded = false): JmxProperty {
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

export function argumentsElementProp(name: string, args: Array<[string, string]> = [], http = false): JmxProperty {
  return pElement(
    name,
    "Arguments",
    [pCollection("Arguments.arguments", args.map(([key, value]) => argumentProp(key, value, http, true)))],
    http ? { guiclass: "HTTPArgumentsPanel", testclass: "Arguments", testname: "User Defined Variables" } : {},
  );
}

export function jmsPropertiesProp(properties: Array<[string, string]> = [], name = "jms.jmsProperties"): JmxProperty {
  return pElement(
    name,
    "JMSProperties",
    [pCollection("JMSProperties.properties", properties.map(([key, value]) => pElement("", "JMSProperty", [pString("JMSProperty.name", key), pString("JMSProperty.value", value)])))],
  );
}

export function parsePairs(value: string | null | undefined, pairDelimiter = ","): Array<[string, string]> {
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

export function resultCollector(type: string, displayName: string, filename?: string): JmxElement | null {
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

export function defaultControllerName(type: string | null | undefined): string {
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
