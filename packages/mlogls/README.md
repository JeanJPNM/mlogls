# mlogls

A [language server protocol](https://microsoft.github.io/language-server-protocol/) implementation
for the [Mindustry](https://github.com/Anuken/Mindustry)'s logic programming language, also known as [mlog](https://mindustrygame.github.io/wiki/logic/0-introduction/).

## What is a language server?

From https://microsoft.github.io/language-server-protocol/overview

> The idea behind a Language Server is to provide the language-specific smarts inside a server that can communicate with development tooling over a protocol that enables inter-process communication.

In simpler terms, this allows editor and addon devs to add support for mlog specific 'smarts' (e.g. diagnostics, autocomplete, etc) to any editor without reinventing the wheel.

## Features

Currently Supported:

- Diagnostic messages
- Formatting
- Autocompletions
- Symbols in Outline panel
- Color highlighting and color picker
- Go to definition
- Code Actions

## How can I use it?

Install a plugin for your editor:

### VS Code

mlogls has a VS Code extension ([mlogls-vscode](../mlogls-vscode))

### Neovim

First install mlogls globally with a package manager:

```sh
npm i -g mlogls
```

Then, you can have a simple setup using [lspconfig](https://github.com/neovim/nvim-lspconfig).

```lua
local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")

vim.filetype.add {
  extension = {
    mlog = "mlog"
  }
}

configs.mlogls = {
  default_config = {
    cmd = { "mlogls", "--stdio" },
    filetypes = { "mlog" },
    single_file_support = true
  }
}

configs.mlogls.setup {}
```
