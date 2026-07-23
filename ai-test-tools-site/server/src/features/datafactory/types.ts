export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface ToolParam {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'boolean';
  default?: JsonValue;
  options?: { label: string; value: string }[];
  placeholder?: string;
  required?: boolean;
  helper?: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  icon?: string;
  params: ToolParam[];
  execute: (args: JsonObject) => JsonValue | Promise<JsonValue>;
}

export interface ToolCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  tools: string[];
}

export interface ExecuteRequest {
  tool: string;
  args?: JsonObject;
}

export interface BatchRequest {
  tool: string;
  count?: number;
  args?: JsonObject;
}
