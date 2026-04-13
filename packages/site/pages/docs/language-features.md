---
title: Language Features
---

# Language Features

`mlogls` introduces advanced language features on top of standard Mindustry Logic (mlog) to help you structure your code and manage diagnostics effectively.

## Logical Label Scopes

Although standard mlog lacks block structures (like `{}` blocks in C-like languages), `mlogls` creates **Logical Label Scopes** based on code indentation.

- **Indentation Hierarchy**: Labels with deeper indentation than the previous label are considered "children" of that block.
- **Block Boundaries**: A block continues until a new label with an equal or lesser level of indentation is declared.
- All instructions following a label belong to that label's logical scope.

This hierarchical tree of label blocks allows `mlogls` to enforce rules and track state (like diagnostic suppressions) in a scoped, predictable manner.

### Label visibility

Logical scopes are also used to know which labels should be suggested on completion requests for jumps.

To help you avoid accidentally using labels that aren't supposed to be accessed by other parts of your code, `mlogls` won't suggest labels that are not considered _visible_ to the `jump` instruction. However you can still write any declared label name by hand without receiving any warning or error messages.

A label is visible if it is a direct child of the current scopes or one of its parents.

```mlog
label1:
   set count 0
   jump
   #    ^ only label1, label2, mid1 and mid2 are suggested
   mid1:
      # pretend there is more code between the rest of these labels
      low1:
   mid2:
      low2:

label2:
   mid3:
      low3:
```

## Diagnostic Suppression comments

You can suppress specific language server warnings and errors using special comment directives, similar to ESLint or TypeScript. Directives take a space-separated list of **one or more** diagnostic codes.

### Available Directives

1. **Scope Directives** (`# mlogls-disable <codes>`, `# mlogls-enable <codes>`)
   - Applies to the remainder of the current **logical label scope**.
   - Must be placed on a separate line before the code it applies to.

2. **Next-Line Directives** (`# mlogls-disable-next-line <codes>`, `# mlogls-enable-next-line <codes>`)
   - Applies exclusively to the immediately following line of code.
   - Cannot have empty lines between the comment and the code.

3. **Current-Line Directives** (`# mlogls-disable-line <codes>`, `# mlogls-enable-line <codes>`)
   - Applies exclusively to the line it is placed on.
   - Must be placed at the end of an instruction line (as a trailing comment).

After specifying the diagnostic codes, you may use `--` to write a short description or explanation for why a directive is being used.

```mlog
# mlogls-disable-next-line unused-variable -- This is an explanation
set count 0
```

### Scope Interaction

Suppression rules defined by scope directives interact directly with the **Logical Label Scopes**:

- Any suppression rules active at the start of a block are naturally passed down to child blocks.
- You can enable or disable specific rules in a child scope without permanently affecting the parent scope.
- Once a logical block ends, any modifications made to the diagnostic state within that block are discarded. The suppression state safely reverts to the parent's state.

```mlog
# mlogls-disable unusedVariable
label1:
    set x 1

    # mlogls-enable unusedVariable
    label2:
        # unusedVariable is reported here because it
        # was re-enabled in this child scope
        set y 1

# The state reverts! unusedVariable is ignored again here.
label3:
    set z 1
```
