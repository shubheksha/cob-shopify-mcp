# CLI Redesign: Natural Commands for cob-shopify-mcp

**Date:** 2026-03-14
**Status:** Approved
**Version:** 0.4.0

## Problem

The current CLI (`tools run list_products --params '{"limit":5}'`) works but is ugly and developer-hostile. Modern CLIs (gh, stripe, vercel) use natural `resource verb --flags` patterns. Additionally, the CLI exists to serve users who prefer composable shell commands over MCP's context-heavy approach — output must be token-efficient for AI agents.

## Command Structure

```
cob-shopify <domain> <action> [flags]
```

### Domain Mapping

Derived from `ToolDefinition.domain`. Each unique domain becomes a top-level subcommand grouping its tools as actions.

**Reserved domain names** (cannot be used by custom tools): `start`, `connect`, `config`, `tools`. Custom tools declaring these domains are rejected at registration with an error.

### Action Name Derivation

Strip domain name (singular and plural forms) from tool name, replace `_` with `-`:

| Tool Name | Domain | CLI Command |
|---|---|---|
| `list_products` | products | `products list` |
| `create_product` | products | `products create` |
| `fulfill_order` | orders | `orders fulfill` |
| `search_customers_by_email` | customers | `customers search-by-email` |
| `adjust_inventory` | inventory | `inventory adjust` |
| `get_order_risk` | orders | `orders get-risk` |

If stripping produces an empty string, use the full tool name as the action.

### Tool Flags

Derived automatically from the Zod `input` schema on each `ToolDefinition`:

| Zod Type | CLI Flag |
|---|---|
| `z.number().min(1).max(250).default(10)` | `--limit <number>` (default: 10) |
| `z.enum(["ACTIVE","DRAFT"])` | `--status <ACTIVE\|DRAFT>` |
| `z.string().optional()` | `--vendor <string>` |
| `z.boolean()` | `--flag` (boolean switch) |

### Global Flags

Available on every tool command:

| Flag | Type | Purpose |
|---|---|---|
| `--json` | boolean | Output as JSON instead of table |
| `--fields <f1,f2>` | string | Select specific response fields (implies `--json`) |
| `--jq <expr>` | string | Filter JSON output with jq expression (implies `--json`) |
| `--describe` | boolean | Print command schema as JSON, don't execute |
| `--dry-run` | boolean | Preview mutations without executing |
| `--yes` | boolean | Skip interactive confirmation prompts |
| `--help` | boolean | Show help with examples |

### Existing Commands

Unchanged:
- `cob-shopify start` — start MCP server
- `cob-shopify connect` — OAuth flow
- `cob-shopify config show` — show configuration

Deprecated (warning logged, removed in v1.0):
- `tools run <name>` → `cob-shopify <domain> <action>`
- `tools list` → top-level help or `cob-shopify <domain>`
- `tools info <name>` → `cob-shopify <domain> <action> --describe`

### Top-Level Help

```
$ cob-shopify

cob-shopify-mcp — Shopify CLI & MCP Server

Commands:
  <domain> <action>   Run a Shopify tool (see domains below)
  start               Start MCP server
  connect             OAuth connect to a store
  config show         Show current configuration
  tools list          List all available tools (deprecated)

Domains:
  products    (15 tools)  Manage products, variants, collections
  orders      (12 tools)  Manage orders, fulfillments, refunds
  customers    (9 tools)  Manage customers and segments
  inventory    (7 tools)  Track and adjust inventory
  analytics    (6 tools)  Sales reports and store analytics

Global flags:
  --json              JSON output
  --fields <f1,f2>    Select specific fields (implies --json)
  --jq <expr>         Filter JSON output (implies --json)
  --describe          Show command schema
  --dry-run           Preview mutations without executing
  --yes               Skip confirmation prompts
  --help              Show help

Run 'cob-shopify <domain>' to see available actions.
```

### Domain Help

```
$ cob-shopify products

Usage: cob-shopify products <action> [flags]

Actions:
  list              List products with optional filtering
  get               Get a single product by ID
  create            Create a new product
  update            Update an existing product
  delete            Delete a product
  search            Search products by query
  ...

Run 'cob-shopify products <action> --help' for details.
```

## Output System

### TTY Detection

| Condition | Output Format |
|---|---|
| stdout is TTY (terminal) | Human-readable table with colors and alignment |
| stdout is piped | JSON automatically |
| `--json` flag | JSON always (overrides TTY detection) |
| `--fields` flag | JSON with selected fields only (implies `--json`) |
| `--jq` flag | Filtered JSON output (implies `--json`) |

### Human Output (TTY)

```
$ cob-shopify products list --limit 3
ID                              Title           Status    Vendor      Inventory
gid://shopify/Product/123       Widget Pro      ACTIVE    Acme        42
gid://shopify/Product/456       Gadget X        DRAFT     WidgetCo    0
gid://shopify/Product/789       Thingamajig     ACTIVE    Acme        15

Cost: 12 points | Budget: 988/1000 | Session: 1 call
```

### JSON Output

```bash
# Full output
$ cob-shopify products list --limit 3 --json
{"products": [{"id": "...", "title": "...", ...}], "pageInfo": {"hasNextPage": true, "endCursor": "..."}}

# Field selection — token-efficient for AI agents
$ cob-shopify products list --limit 3 --fields id,title,status
[{"id": "gid://shopify/Product/123", "title": "Widget Pro", "status": "ACTIVE"}, ...]

# jq filtering
$ cob-shopify products list --json --jq '.products[].title'
"Widget Pro"
"Gadget X"
"Thingamajig"
```

The JSON output shape matches the tool handler's return value — NOT the MCP content block envelope. AI agents calling via CLI or MCP get the same data, different wrappers.

### Field Selection

When `--fields` is used, output is filtered post-execution: the tool runs normally, then only the selected keys are extracted from each object in the response. This works generically on any tool without per-tool configuration.

### Cost Metadata

Always printed to stderr, never pollutes stdout:

```
Cost: 12 points | Budget: 988/1000 | Session: 3 calls, 28 points total
```

### Error Output

Consistent JSON to stderr:

```json
{"error": {"code": "NOT_FOUND", "message": "Product gid://shopify/Product/999 not found"}}
```

Exit codes: 0 = success, 1 = tool error, 2 = invalid input/flags.

## Auto-Registration Architecture

### Core Converter

One function does all the work:

```typescript
toolToCommand(tool: ToolDefinition): CittyCommand
```

This function:
1. Converts Zod `input` schema → citty argument definitions
2. Attaches the tool's description as command help text
3. Wires the command handler to call `ToolEngine.execute()`
4. Adds all global flags (`--json`, `--fields`, `--jq`, `--describe`, `--dry-run`, `--yes`)
5. Derives the action name by stripping domain prefix from tool name

### Hybrid Registration (Build Time + Runtime)

**Built-in tools (build time):**
- `tsup` build step runs `toolToCommand()` for all barrel-exported tools
- Generated command definitions are bundled — zero startup cost for 49+ built-in tools
- Deterministic, type-safe, errors caught at build time

**Custom YAML tools (runtime):**
- On startup, loads YAML tools from `config.tools.custom_paths`
- Runs same `toolToCommand()` for each custom tool
- Registers into the citty command tree under the tool's declared domain
- If domain doesn't exist yet, creates it dynamically

**Same function, different timing.** No divergent code paths.

### Domain Grouping

- `toolToCommand()` produces per-action commands
- A domain command (e.g., `products`) is a citty parent that groups all its action subcommands
- Domains are created from the set of unique `tool.domain` values across all registered tools
- Each domain's help lists its available actions with descriptions

### Custom Tool Auto-Discovery Flow

1. User creates `complete-draft.yaml` with `domain: "orders"` in a custom tools directory
2. Config has `custom_paths: ["./my-tools"]`
3. Startup: YAML loader produces `ToolDefinition` with `name: "complete_draft_order"`, `domain: "orders"`
4. `toolToCommand()` strips `_order` → action name `complete-draft`
5. Registered under existing `orders` domain → `cob-shopify orders complete-draft`
6. **Zero code changes required**

### Collision Handling

**Custom tool overrides built-in (same name):**
- Custom tool wins — replaces the built-in tool's command
- Warning logged to stderr: `⚠ Custom tool "list_products" overrides built-in tool`
- Applies to both MCP and CLI (same ToolRegistry)

**Custom tool uses reserved domain name:**
- Rejected at registration with error: `✗ Domain "config" is reserved. Use a different domain for custom tool "my_config_tool"`
- Server continues without the conflicting tool

## Schema Introspection (`--describe`)

Every command supports `--describe` which serializes the tool's metadata without executing:

```bash
$ cob-shopify products list --describe
{
  "command": "products list",
  "tool": "list_products",
  "domain": "products",
  "tier": 1,
  "description": "List products with optional filtering",
  "scopes": ["read_products"],
  "inputs": {
    "limit": {"type": "number", "min": 1, "max": 250, "default": 10, "required": false},
    "status": {"type": "enum", "values": ["ACTIVE", "DRAFT", "ARCHIVED"], "required": false},
    "vendor": {"type": "string", "required": false},
    "cursor": {"type": "string", "required": false}
  },
  "outputFields": ["id", "title", "handle", "status", "vendor", "productType", "totalInventory", "variants"]
}
```

**`outputFields`:** Optional field on `ToolDefinition`. Tools that declare `outputFields?: string[]` get field names in `--describe` output. Tools that don't declare it omit the `outputFields` key. No magic introspection — explicit declaration.

This enables AI agents to discover command schemas on-demand without loading all 49+ tool definitions into context.

## Mutation Safety

### `--dry-run`

Available on all write operations (tools with `write_*` scopes):

```bash
$ cob-shopify products create --title "New Widget" --dry-run
{
  "action": "create_product",
  "domain": "products",
  "input": {"title": "New Widget"},
  "confirmed": false,
  "message": "Would create product with title 'New Widget'. Run without --dry-run to execute."
}
```

Dry-run validates input against the Zod schema and shows the validated parameters and intent. It does NOT call the handler or Shopify API.

For `graphql`-based tools, it can additionally show the GraphQL query and variables that would execute.

### Interactive Confirmation

Write operations prompt for confirmation by default when stdout is a TTY:

```bash
$ cob-shopify products delete --id gid://shopify/Product/123
⚠ This will delete product gid://shopify/Product/123. Continue? [y/N]
```

Skipped with `--yes` flag (for CI/CD and AI agents) or when stdout is not a TTY (piped/automated).

## Deprecation Plan

### v0.4.0 (This Release)

- New natural commands available
- Old commands still work with deprecation warnings to stderr:
  ```
  ⚠ Deprecated: 'tools run list_products' → use 'cob-shopify products list' instead
  ⚠ Deprecated: 'tools list' → use 'cob-shopify --help' or 'cob-shopify <domain>'
  ⚠ Deprecated: 'tools info list_products' → use 'cob-shopify products list --describe'
  ```
- Tool still executes normally after warning

### v1.0.0

- `tools run`, `tools list`, `tools info` removed
- Only `tools` as a reserved domain name remains blocked

## Key Design Decisions Summary

| Decision | Choice | Rationale |
|---|---|---|
| Command pattern | `<domain> <action>` | Matches gh/stripe/vercel, scales to 200+ tools |
| Action naming | Auto-strip domain prefix | Zero per-tool config, predictable |
| Output format | TTY=table, pipe=JSON | Industry standard (gh pattern) |
| Field selection | `--fields f1,f2` | 40-80% token reduction for AI agents |
| jq support | `--jq` built-in | No external dependency needed for agents |
| Schema introspection | `--describe` | Agents discover commands on-demand |
| Registration | Hybrid (build + runtime) | Fast startup for built-ins, dynamic for custom |
| Collision handling | Custom overrides built-in + warning | Power users can replace behavior |
| Mutation safety | `--dry-run` + interactive confirm + `--yes` | Covers humans, agents, and CI |
| Deprecation | Warn in v0.4, remove in v1.0 | Clean migration, no breakage |
