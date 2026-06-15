import { useEffect, useRef, useCallback, type ReactNode } from 'react'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { json } from '@codemirror/lang-json'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter } from '@codemirror/language'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'

interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
  /** 右上角覆盖工具栏（格式化、压缩等按钮） */
  toolbar?: ReactNode
  /** 底部错误信息 */
  error?: ReactNode
}

export function JsonEditor({ value, onChange, placeholder, minHeight, toolbar, error }: JsonEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const handleChange = useCallback(() => {
    if (viewRef.current) {
      onChangeRef.current(viewRef.current.state.doc.toString())
    }
  }, [])

  useEffect(() => {
    if (!editorRef.current) return

    const extensions = [
      json(),
      bracketMatching(),
      foldGutter(),
      syntaxHighlighting(defaultHighlightStyle),
      keymap.of([...defaultKeymap, indentWithTab]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) handleChange()
      }),
      EditorView.lineWrapping,
    ]

    if (placeholder) extensions.push(cmPlaceholder(placeholder))

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: editorRef.current,
    })

    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (viewRef.current) {
      const cur = viewRef.current.state.doc.toString()
      if (cur !== value) {
        viewRef.current.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
      }
    }
  }, [value])

  return (
    <div className="relative">
      {/* 工具栏覆盖层 */}
      {toolbar && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1.5">
          {toolbar}
        </div>
      )}

      {/* 编辑器 */}
      <div
        ref={editorRef}
        className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-all focus-within:border-accent focus-within:shadow-[0_0_0_4px_rgba(37,99,235,0.1)] [&_.cm-content]:px-3 [&_.cm-content]:py-2 [&_.cm-editor]:font-mono [&_.cm-editor]:text-sm [&_.cm-gutters]:border-r [&_.cm-gutters]:border-slate-200 [&_.cm-gutters]:bg-slate-50"
        style={minHeight ? { minHeight } : undefined}
      />

      {/* 错误信息 */}
      {error && (
        <div className="mt-2 animate-fade-up text-[12px] text-danger">
          {error}
        </div>
      )}
    </div>
  )
}
