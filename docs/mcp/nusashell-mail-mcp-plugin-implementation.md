# NusaShell Mail — Read-only Implementation

Status: Implemented first milestone  
Plugin: `plugins/mail`  
Target specification: `docs/mcp/nusashell-mail-mcp-plugin-spec.md`

## Scope

The first milestone deliberately stops at safe mailbox reading. It provides:

- multiple enabled or disabled IMAP/SMTP accounts;
- plugin-managed account credentials (base64-encoded store file);
- account creation, editing, deletion, inspection, and connection tests;
- mailbox and unified-inbox listing;
- message listing, search, MIME parsing, and reading;
- a full-screen three-pane Mail UI;
- the ten MCP tools `accounts`, `account_get`, `account_save`,
  `account_delete`, `account_test`, `mailboxes`, `inbox`, `messages`,
  `search`, and `read`.

Sending, drafts, flag changes, move/delete operations, attachment downloads,
background IDLE synchronization, OAuth, POP3, and JMAP are not implemented in
this milestone.

The Mail surface keeps the three-pane correspondence desk on wide windows. On
narrow windows it uses an account rail plus either the message list or reading
pane, with the reader taking the full width on very small screens. Account rows
expose a visible **Edit** action; the account editor also owns deletion. Gmail
presets and authentication failures state that Google App Passwords are
required instead of accepting a regular account password.

## Runtime and credential flow

```mermaid
flowchart LR
  subgraph credentials ["Credential write path"]
    MailUI["Mail UI"] --> CallTool["window.shell.callTool"]
    CallTool --> McpTools["account_save / account_delete MCP tools"]
    McpTools --> StoreFile["accounts.dat (base64-encoded)"]
  end

  subgraph runtime ["Plugin start"]
    Start["Plugin start"] --> Env["NUSASHELL_USER_DATA"]
    Env --> ReadStore["Mail MCP reads accounts.dat"]
    ReadStore --> Mcp["Mail MCP stdio server"]
  end
```

The Mail plugin is self-contained: it manages its own account credentials in
a base64-encoded store file at
`{NUSASHELL_USER_DATA}/plugins-data/nusashell.mail/accounts.dat`. The shell
does not handle mail credentials, does not provide a mail-specific IPC API,
and does not inject account data via environment variables. The shell's only
responsibility is passing `NUSASHELL_USER_DATA` to the plugin process — the
same generic mechanism used by all plugins (e.g., Kanban).

The public account shape (`accounts`, `account_get`) never includes the
password. Passwords and app passwords are not placed in the manifest,
renderer state, plugin metadata, WebSocket events, or tool results.

Account save/delete operations update the store file in-place and reload
connections within the running MCP process — no shell restart is needed.

### Migration from legacy safeStorage format

Existing users who configured mail accounts before this change have
credentials stored in `mail-settings.json` encrypted with Electron
`safeStorage`. On next shell startup, a one-time migration decrypts the
legacy file and writes the accounts to the new `accounts.dat` store, then
deletes the legacy file. The migration code in
`apps/desktop/src/main/migrate-mail-credentials.ts` is temporary and can be
removed after one release cycle.

## Upstream

The service separation and mail behavior were adapted from
[`codefuturist/email-mcp`](https://github.com/codefuturist/email-mcp) at
revision `99ce431aa81dd4cafc2879bd35b6ee3acd0f2d74`. The pinned source,
upstream license, and adaptation notes live in
`plugins/mail/UPSTREAM.md`, `LICENSE.upstream`, and
`THIRD_PARTY_NOTICES.md`.

NusaShell's UI, broker integration, MCP tool contracts, credential store,
bounded result shapes, and tests are project-specific.

## Development

The root development and build commands compile the standalone Mail MCP bundle
before starting or packaging Electron:

```bash
make dev
pnpm build
```

Focused verification:

```bash
pnpm --filter @nusashell/example-mail test
pnpm --filter @nusashell/example-mail typecheck
pnpm --filter @nusashell/example-mail build
```

The browser-only fixture at
`plugins/mail/tests/browser-harness.html` supplies non-secret fake
data for responsive and accessibility checks. It is not used by the packaged
plugin.

## Security boundaries

- TLS or STARTTLS is mandatory for configured IMAP and SMTP endpoints.
- Certificate verification defaults to enabled.
- Mail source reads are bounded before MIME parsing, and returned text is
  truncated to an explicit limit.
- Message content is untrusted input. Plain messages render as text. HTML
  alternatives render inside a dedicated sandboxed document with scripts,
  forms, connections, nested frames, plugins, and media disabled. HTTPS/data
  images and inline presentation styles are allowed inside that document with
  referrer information suppressed; the document receives no shell bridge.
- The MCP surface exposes no arbitrary protocol command or raw credential.
- Account credentials are stored in a base64-encoded file with 0600
  permissions. The encoding prevents casual reading but is not encryption;
  filesystem permissions are the primary access control.

Before adding send, delete, or mutation tools, define a visible approval
policy and audit events rather than extending this read-only contract in
place.
