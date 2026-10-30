import { parse } from 'acorn'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Syntax = { type: string; start: number; end: number; name?: string; value?: unknown; operator?: string; argument?: Syntax; elements?: (Syntax | null)[]; properties?: Syntax[]; key?: Syntax; computed?: boolean; kind?: string; method?: boolean; shorthand?: boolean; body?: Syntax[]; declaration?: Syntax; declarations?: Syntax[]; id?: Syntax; init?: Syntax; specifiers?: Syntax[]; exported?: Syntax }
type Parsed = { options: Record<string, Json>; object: Syntax | null; comments: { start: number; end: number }[] }

function literal(node: Syntax): Json {
  if (node.type === 'Literal' && (node.value === null || ['number', 'string', 'boolean'].includes(typeof node.value))) return node.value as Json
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument) { const v = literal(node.argument); if (typeof v === 'number') return -v }
  if (node.type === 'ArrayExpression' && node.elements) return node.elements.map(x => { if (!x) throw Error('不支持稀疏数组'); return literal(x) })
  if (node.type === 'ObjectExpression' && node.properties) {
    const result: Record<string, Json> = Object.create(null) as Record<string, Json>
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.computed || property.kind !== 'init' || property.method || property.shorthand || !property.key || !property.value) throw Error('包含动态属性')
      const key = property.key.type === 'Identifier' ? property.key.name : property.key.value
      if (typeof key !== 'string' || Object.hasOwn(result, key)) throw Error('包含重复或不支持的属性')
      result[key] = literal(property.value as Syntax)
    }
    return result
  }
  throw Error('包含变量、函数或动态表达式')
}

export function readOptions(source: string): Parsed {
  const comments: { start: number; end: number }[] = []
  let program: Syntax
  try { program = parse(source, { ecmaVersion: 'latest', sourceType: 'module', onComment: (_block, _text, start, end) => { comments.push({start, end}) } }) as unknown as Syntax }
  catch { throw Error('脚本语法无法解析，请先修正源码') }
  let object: Syntax | null = null
  for (const statement of program.body ?? []) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
    for (const entry of declaration?.declarations ?? []) {
      if (entry.id?.name !== 'options') continue
      if (statement.type !== 'ExportNamedDeclaration' || object || entry.init?.type !== 'ObjectExpression') throw Error('options 不是可直接编辑的导出字面量')
      object = entry.init
    }
    if (statement.specifiers?.some(s => s.exported?.name === 'options')) throw Error('options 使用间接导出，无法安全同步')
  }
  if (!object) return { options: {}, object, comments }
  const value = literal(object)
  return { options: value as Record<string, Json>, object, comments }
}

export function writeOption(source: string, key: string, value: Json): string {
  const parsed = readOptions(source)
  if (!parsed.object) return `${source.trimEnd()}\n\nexport const options = ${JSON.stringify({ [key]: value }, null, 2)};\n`
  const property = parsed.object.properties?.find(p => p.key?.name === key || p.key?.value === key)
  if (property) {
    const field = property.value as Syntax
    if (parsed.comments.some(c => c.start >= field.start && c.end <= field.end)) throw Error('该参数包含注释，无法无损修改；请直接编辑源码')
    return source.slice(0, field.start) + JSON.stringify(value, null, 2) + source.slice(field.end)
  }
  const offset = parsed.object.end - 1
  const previous = source.slice(parsed.object.start + 1, offset).trimEnd()
  return source.slice(0, offset) + `${previous && !previous.endsWith(',') ? ',' : ''}\n  ${JSON.stringify(key)}: ${JSON.stringify(value, null, 2)}\n` + source.slice(offset)
}

export function removeOption(source: string, key: string): string {
  const parsed = readOptions(source)
  const properties = parsed.object?.properties ?? []
  const index = properties.findIndex(p => p.key?.name === key || p.key?.value === key)
  if (index < 0) return source
  const current = properties[index]
  const start = index > 0 ? properties[index - 1].end : current.start
  const end = index > 0 ? current.end : properties.length > 1 ? properties[1].start : current.end
  if (parsed.comments.some(c => c.start >= start && c.end <= end)) throw Error('该参数附近包含注释，无法无损删除；请直接编辑源码')
  return source.slice(0, start) + source.slice(end)
}

export type { Json }
