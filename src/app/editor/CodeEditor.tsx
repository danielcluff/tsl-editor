import { onSettled } from "solid-js";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";

/** CodeMirror 6 wrapper. `value` is read once on mount. */
export function CodeEditor(props: { value: string; onChange?: (v: string) => void; readonly?: boolean; language?: "js" | "wgsl" }) {
  let host!: HTMLDivElement;
  onSettled(() => {
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          ...(props.language === "wgsl" ? [] : [javascript()]),
          oneDark,
          EditorView.editable.of(!props.readonly),
          EditorState.readOnly.of(!!props.readonly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) props.onChange?.(u.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            keydown: (e) => {
              // keep editor shortcuts from reaching the graph
              e.stopPropagation();
              return false;
            },
          }),
        ],
      }),
    });
    return () => view.destroy();
  });
  return <div ref={host} class="h-full w-full overflow-auto" />;
}
