# 5. Click a path in the terminal to open it in the right VS Code window

Date: 2026-09-18
Status: accepted
Verified against: Ghostty 1.3.1, tmux 3.6, Plasma 6.6.6 Wayland.

## Context

`vscode src/app.ts:42` (ADR 0003) works but has to be typed. What you actually
want is to click the `src/app.ts:42:8` that tsc, eslint, pytest or a stack trace
just printed, and land in the right window at that line.

The obvious place for this is the terminal emulator, and Ghostty is the wrong
place for it:

- `link`, the option that would add a click pattern, is documented in Ghostty
  1.3.1 as `TODO: This can't currently be set!`, and `ghostty +validate-config
  --link='…,open'` exits 1. Only the built-in URL matcher and OSC 8 hyperlinks
  are clickable.
- Even if it could be set, its only action is "hand the text to the system
  opener", which knows nothing about relative paths, the pane's directory, or
  which of several VS Code windows should receive the file.

tmux, however, draws every cell in that pane. Since 3.1 it exposes what is under
the pointer to a mouse binding: `#{mouse_word}`, `#{mouse_line}` and (3.4+)
`#{mouse_hyperlink}`, alongside `#{pane_current_path}` and `#{session_name}`.

## Decision

Bind the click in `config/tmux.conf`, resolve it in the daemon CLI:

```
bind -n C-MouseDown1Pane run-shell -b 'vscode-tmux click --session=#{q:session_name} \
  --cwd=#{q:pane_current_path} --word=#{q:mouse_word} --link=#{q:mouse_hyperlink}'
```

`vscode-tmux click` prefers the OSC 8 destination when the program emitted one
(ripgrep with `--hyperlink-format`, `ls --hyperlink`, delta), otherwise takes the
word, strips the punctuation that output glues onto paths (`(foo.ts:1:2)`,
`"foo.ts",`), expands `~`, resolves against the pane's directory and **checks the
file exists**. Anything else is dropped without a sound: clicking prose must do
nothing. What survives goes to the existing opener — same path as the `vscode`
CLI, so the window is raised too — and then the dropdown hides itself, because it
would otherwise cover the editor it just raised.

Two supporting changes:

- `word-separators ' '` for this tmux server, so `#{mouse_word}` yields
  `src/foo.ts:42:8` instead of a fragment (tmux's default separators include `/`,
  `.` and `:`).
- `open` messages may carry `sessionName` instead of `workspaceId`, and the
  registry can look a workspace up by session. A mouse binding is executed by the
  tmux server, not by the shell, so it never sees `VSCODE_TMUX_WORKSPACE_ID`; the
  session name is the only identity it has.

Both ctrl+click and alt+click are bound: Ghostty claims ctrl+click when its own
URL matcher finds a URL under the pointer, and alt+click is never intercepted.

## Consequences

- Any tool that prints `path:line:col` becomes clickable, with no integration on
  its side and no shell wrapper.
- The window raiser (ADR 0003) earns its keep: clicking a path is exactly when
  you want the editor in front of you.
- A click costs one `vscode-tmux` process and one socket round-trip. It is
  silent on failure, so a misparse looks like "nothing happened" — the daemon log
  is where a successful open is recorded.
- `#{mouse_word}` is a single whitespace-delimited word, so paths containing
  spaces are only clickable through an OSC 8 link.
- The bindings only exist on this tmux server (`-L vscode-tmux`, own config), so
  a user's own tmux is untouched.
