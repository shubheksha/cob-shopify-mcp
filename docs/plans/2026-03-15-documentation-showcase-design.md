# Documentation & Showcase Upgrade v0.6.0

## Goal

Maximize GitHub star appeal and provide a lean wiki as a docs site. Keep all existing README content, enhance it with badges/structure/updated numbers, and create a 5-page GitHub Wiki.

## Section 1: README Star Appeal

### Hero Section (top of file)
- 5-6 shields.io badges: npm version, build status, license, node version, tools count, TypeScript
- Fix all tool counts: 59 built-in + 5 custom = 64 total
- Punchy tagline below title

### New: "Why cob-shopify-mcp" Section
- 3-4 differentiators: dual-mode CLI+MCP, 64 tools across 5 domains, ShopifyQL analytics platform (16 tools), Advertise-and-Activate (82% token reduction)
- Position right after the one-liner description, before features list

### Updated Sections
- All "49 tools" references → "59 built-in + 5 custom (64 total)"
- Analytics domain expanded: 16 ShopifyQL tools, single API call, period-over-period comparison
- Advertise-and-Activate numbers updated (59 tools, not 49)
- Competitor comparison table updated with current numbers
- Domain tool counts: Products (15), Orders (17), Customers (9), Inventory (7), Analytics (16)

### Install Section
- One-liner install more prominent near the top

## Section 2: GitHub Wiki (5 pages + sidebar)

### _Sidebar.md
Persistent navigation on every wiki page.

### Pages

1. **Home** — Project overview, feature highlights, navigation links, badges
2. **Getting Started** — Install (npm/Docker), get Shopify credentials, first CLI command, first MCP connection
3. **Tool Reference** — All 64 tools by domain with params, CLI + MCP examples
4. **Configuration & Auth** — Full YAML config, env vars, 3 auth methods, config precedence, read_only mode
5. **Roadmap & FAQ** — Version history, roadmap v0.7→v2.0, common questions

## Section 3: Roadmap

| Version | Theme | Features |
|---|---|---|
| v0.7.0 | Smart Caching & Cost Optimization | Write-through cache invalidation, request batching, cost budget CLI dashboard |
| v0.8.0 | Metafields & Discounts | Metafields CRUD, discount management, tier 2 tools |
| v0.9.0 | Webhooks & Real-time | Webhook subscriptions, event receiver, automation recipes |
| v1.0.0 | Production Hardening | Multi-store, full API coverage, plugin system, 100% critical path tests |
| v2.0.0 | Hosted MCP-as-a-Service | Multi-tenant hosting, browser OAuth, admin dashboard, billing |

## Section 4: Architecture Diagram

- Update architecture.mmd and architecture.html with 59 tools, analytics platform, corrected domain counts

## Out of Scope
- No logo/branding
- No CONTRIBUTING.md, CODE_OF_CONDUCT (future)
- No code changes — documentation only
