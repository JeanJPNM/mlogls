---
title: Usage
---

# VSCode

You can install the [vscode extension](https://marketplace.visualstudio.com/items?itemName=JeanJPNM.mlogls-vscode)
to use the language server.

# Neovim

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
