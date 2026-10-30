import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'

export function LoadTestScriptEditor({value, onChange}: {value: string; onChange: (value: string) => void}) {
  const parent = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const change = useRef(onChange)
  useEffect(() => { change.current = onChange }, [onChange])
  useEffect(() => {
    if (!parent.current) return
    const editor = new EditorView({parent: parent.current, state: EditorState.create({doc: value, extensions: [bracketMatching(), syntaxHighlighting(defaultHighlightStyle), keymap.of([...defaultKeymap, indentWithTab]), EditorView.lineWrapping, EditorView.contentAttributes.of({'aria-label': 'k6 脚本'}), EditorView.updateListener.of(update => {if (update.docChanged) change.current(update.state.doc.toString())})]})})
    view.current = editor
    return () => {editor.destroy(); view.current = null}
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const editor = view.current; if (editor && editor.state.doc.toString() !== value) editor.dispatch({changes: {from: 0, to: editor.state.doc.length, insert: value}}) }, [value])
  return <div ref={parent} className="max-h-96 min-h-64 overflow-auto rounded-lg border border-border bg-white font-mono text-xs [&_.cm-content]:p-3" />
}
