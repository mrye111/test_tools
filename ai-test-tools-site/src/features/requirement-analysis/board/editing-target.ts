/** 文本编辑目标 */
export type EditingTarget =
  | { elementId: string; field: 'node-text' | 'cell' | 'factor' | 'level'; path: string[] }
  | null
