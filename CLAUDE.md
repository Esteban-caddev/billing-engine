# Billing Engine — Developer Guide

## Overview

Moteur de calcul EN 16931 / BTP (pur, Decimal.js) — partagé front/back.

- **Scope**: Pure computation engine for BTP (construction) invoicing using EN 16931 standard
- **Dependencies**: Only `decimal.js` (monetary precision)
- **Target**: Shared library used by both frontend and backend

## Key Concepts

### EN 16931 Compliance
The billing engine implements the European Standard EN 16931 for electronic invoicing in the BTP (construction) sector. All calculations maintain the ±1ct precision guarantee across the pipeline.

### Decimal.js
All monetary calculations must use `Decimal.js` to avoid floating-point precision issues. Never use native JavaScript `number` type for financial calculations.

## Architecture

### Core Modules

- **adapter**: Transform serialized data to/from tree structures
- **breakdown**: Calculate line-by-line breakdown (quantities, VAT, totals)
- **costs**: Margin and cost calculations
- **display**: Format values for UI display
- **invariants**: EN 16931 validation rules (BR-CO-*, etc.)
- **model**: TypeScript types and interfaces
- **pipeline**: Main computation pipeline
- **tree**: Hierarchical business structure (sections, lines, etc.)

### Data Flow

```
Tree (hierarchical business structure)
  ↓
flattenTree → flatten to lines
  ↓
computeDocument → apply billing rules
  ↓
computeBreakdown → calculate costs
  ↓
treeToSerialized → export to API format
```

## Development Guidelines

### Code Style
- ESLint + Prettier with same rules as crm-back-end
- TypeScript strict mode enabled
- No `any` types without explicit `@ts-ignore`

### Scripts
- `npm run build` — Compile TypeScript
- `npm run build:watch` — Watch mode
- `npm run lint` — Fix linting issues
- `npm run format` — Format code
- `npm run test` — Run test suite

### Testing
Tests are in `__tests__/` directory with `.spec.ts` suffix. Key test fixtures in `fixtures.ts`.

### Publishing
The package is published to GitHub Packages. Update version in package.json and run `npm publish` after building.

## Integration with crm-back-end

The back-end imports from this package:
```typescript
import { computeDocument } from '@neven-crm/billing-engine'
```

The package is declared as a GitHub dependency in the back's package.json:
```json
"@neven-crm/billing-engine": "github:neven-crm/billing-engine"
```

## Git Workflow

Each change should:
1. Update version in package.json
2. Build: `npm run build`
3. Commit
4. Create a git tag matching the version
5. Push to GitHub

The back-end will resolve the latest main branch by default, or you can pin a specific version/tag.
