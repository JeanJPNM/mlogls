import {
  indentNodeProp,
  LRLanguage,
  StreamLanguage,
} from "@codemirror/language";
import { parser } from "./syntax.grammar";
import { parseMixed } from "@lezer/common";
import { styleTags, tags as t } from "@lezer/highlight";
import { KeyBinding } from "@codemirror/view";

// use this https://lezer-playground.vercel.app/
// playground to test the grammar
const language = LRLanguage.define({
  name: "mlog",
  parser: parser.configure({
    wrap: parseMixed((node) => {
      if (node.name === "DocComment") {
        return { parser: docLanguage.parser };
      }
      return null;
    }),
    props: [
      indentNodeProp.add(() => {
        return (context) => {
          let parent = context.node;

          while (parent.parent) {
            parent = parent.parent;
          }

          const { doc } = context.state;

          const nextChild = parent.childAfter(context.pos);
          const posLine = doc.lineAt(context.pos).number;

          if (
            nextChild?.name === "LabelDeclaration" &&
            doc.lineAt(nextChild.from).number === posLine
          )
            return null;

          let previousChild = parent.childBefore(context.pos);

          if (!previousChild) return null;

          if (previousChild.type.name === "Comment") {
            const prev = previousChild.prevSibling;

            if (prev?.type.name !== "LabelDeclaration") return null;
            if (doc.lineAt(prev.from).number !== posLine) return null;
            previousChild = prev;
          }

          if (previousChild.type.name !== "LabelDeclaration") return null;

          return context.column(previousChild.from) + context.unit;
        };
      }),
      styleTags({
        Identifier: t.variableName,
        Comment: t.lineComment,
        DocComment: t.docComment,
        Boolean: t.bool,
        Color: t.number,
        LabelDeclaration: t.function(t.name),
        InstructionName: t.keyword,
        NullLiteral: t.null,
        NumberLiteral: t.number,
        String: t.string,
        ControlInstructionName: t.controlKeyword,
        StringFormatPlaceholder: t.tagName,
        StringEscapedBracket: t.escape,
        StringColorTag: t.tagName,
        StringNewLineSequence: t.escape,
        ";": t.punctuation,
      }),
    ],
  }),
  languageData: {
    commentTokens: { line: "#" },
  },
});

export function mlogLanguage() {
  return language;
}

const docLanguage = StreamLanguage.define({
  startState() {
    return { phase: 0 };
  },
  token(stream, state) {
    if (stream.eatSpace()) return null;

    if (state.phase === 0 && stream.match("##")) {
      state.phase = 1;
      return "docComment";
    }

    if (
      state.phase === 1 &&
      stream.match("@var") &&
      (stream.eol() || stream.match(/\s/, false))
    ) {
      state.phase = 2;
      return "keyword";
    }

    if (state.phase === 2 && stream.match(/[^\s#;]+/)) {
      state.phase = 3;
      return "variableName";
    }

    stream.skipToEnd();
    return "docComment";
  },
});

export const continueDocCommentKeymap: KeyBinding[] = [
  {
    key: "Enter",
    run(view) {
      const { state } = view;

      const selection = state.selection.main;
      const line = state.doc.lineAt(selection.head);
      const match = line.text.match(/^(\s*)##(\s)?/);
      if (!match) return false;

      const indent = match[1];
      const after = match[2] ? " " : "";
      const insertText = `\n${indent}##${after}`;

      view.dispatch({
        changes: {
          from: selection.head,
          to: selection.head,
          insert: insertText,
        },
        selection: { anchor: selection.head + insertText.length },
      });

      return true;
    },
  },
];
