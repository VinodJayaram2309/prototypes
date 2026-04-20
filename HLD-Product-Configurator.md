# High-Level Design — Product Configurator Component

## Next.js + Sitecore Implementation

---

## 1. Overview

This document describes the architecture for implementing the **Product Configurator** as a set of composable React components within an existing Next.js + Sitecore project. The configurator allows users to make cascading selections across multiple product dimensions (e.g., Torque Range → Suspension Options → Cord Type) and resolves to a unique SKU once all choices are made.

**Scope:** Right-side configurator panel only. The left-side Product Info component is already developed and out of scope. The configurator will be rendered alongside it and will communicate the final selected variant (SKU, URL, price) upward via callback props or shared context.

---

## 2. Component Architecture

### 2.1 Component Tree

```
<ProductPage>                          ← existing page (Sitecore rendering)
├── <ProductInfo />                    ← already developed (out of scope)
└── <ProductConfigurator>              ← new top-level configurator shell
    ├── <ConfiguratorHeader />         ← title bar + Reset button
    ├── <ConfiguratorAccordion>        ← accordion container managing open/close state
    │   └── <AccordionSection />       ← one per category (repeating)
    │       ├── <AccordionHeader />    ← step indicator + title + chevron
    │       └── <AccordionBody />      ← collapsible option list
    │           └── <OptionRow />      ← radio-style selectable row (repeating)
    ├── <ConfigurationSummary />       ← progress bar OR completed config result
    └── <CollapseToggle />             ← floating button to expand/collapse panel
```

### 2.2 Component Responsibilities

| Component | Responsibility |
|---|---|
| **ProductConfigurator** | Top-level orchestrator. Owns configurator state (selections, expanded section). Fetches data via service, maps it with utility, passes down props. Manages expand/collapse of the entire panel. |
| **ConfiguratorHeader** | Renders "Configure Your Product" title and the Reset button. Calls `onReset` callback. |
| **ConfiguratorAccordion** | Iterates over `model.categories`, renders one `AccordionSection` per category. Passes available options (derived from cascading filter logic) to each section. |
| **AccordionSection** | Single collapsible section. Composed of `AccordionHeader` + `AccordionBody`. Manages its own open/close animation via CSS `max-height` transition. |
| **AccordionHeader** | Renders step circle (numbered / active / done with checkmark), category name, selected-value preview, and chevron. Click toggles the section. |
| **AccordionBody** | Wraps the list of `OptionRow` items. Renders an empty-state message when no options are available (upstream not selected yet, or no valid combinations). |
| **OptionRow** | Single selectable radio-style row. Renders custom radio dot + option label. Fires `onSelect(qualifier, value)` on click. |
| **ConfigurationSummary** | When incomplete: shows progress bar (X of N selected). When complete: shows all selections, resolved SKU code with copy-to-clipboard, and "Request a Quote" CTA. |
| **CollapseToggle** | Fixed-position button on the panel edge. Toggles the right panel between expanded (440px) and collapsed (0px) states. |

---

## 3. Data Flow

### 3.1 API Integration

```
Sitecore CMS  →  Commerce API  →  Next.js API Route / Server Component
                                         │
                                    Vercel Cache
                                         │
                                 ProductConfigurator
```

**API Endpoint:** The product variant data (`variantOptions`, `variantMatrix`) is fetched from the existing Sitecore Commerce API (the same endpoint that serves the JSON structure seen in `get_product_response.json`).

**Fetching strategy:** Data is fetched at the **page level** (in a Server Component or `getServerSideProps` / RSC `fetch`) and passed down to `ProductConfigurator` as props. This allows Vercel's data cache to handle deduplication and revalidation.

### 3.2 Data Model

The API response is transformed into an internal model consumed by the UI:

```typescript
// Internal model used by the configurator components

interface ProductConfiguratorModel {
  categories: ConfiguratorCategory[];
  variants:   ConfiguratorVariant[];
}

interface ConfiguratorCategory {
  name:      string;                   // "Torque Range"
  qualifier: string;                   // "torque-range" (machine key)
  order:     number;                   // 0-based position in selection flow
  options:   ConfiguratorOptionValue[];
}

interface ConfiguratorOptionValue {
  label:    string;   // display text
  value:    string;   // selection key
  sequence: number;   // display order within category
}

interface ConfiguratorVariant {
  code:       string;                          // SKU code e.g. "XDV2TLVTJ00U00"
  url:        string;                          // PDP path
  stock:      StockInfo;
  price?:     PriceData;
  selections: Record<string, string>;          // qualifier → value
}
```

### 3.3 State Management

All configurator state is local to `ProductConfigurator` using React hooks — no global store needed.

```typescript
// State within ProductConfigurator

const [selections, setSelections]           = useState<Record<string, string>>({});
const [expandedQualifier, setExpandedQualifier] = useState<string | null>(firstCategoryQualifier);
const [isPanelCollapsed, setIsPanelCollapsed]   = useState(false);
```

**Derived state (computed on each render, not stored):**

| Derived Value | Source |
|---|---|
| `availableOptions` | `getAvailableOptions(model, selections)` — cascading filter |
| `selectedVariant`  | `getSelectedVariant(model, selections)` — resolved SKU or null |
| `completionCount`  | `Object.keys(selections).length` |
| `totalSteps`       | `model.categories.length` |

### 3.4 Selection Flow (Cascading Logic)

1. User selects a value in category at index `i`.
2. `selections[qualifier] = value` is set.
3. All downstream selections at index > `i` are **cleared**.
4. `expandedQualifier` auto-advances to category at index `i + 1`.
5. On next render, `getAvailableOptions()` filters all variants matching current selections and returns only valid values for each remaining category.
6. When all categories are selected, `getSelectedVariant()` resolves the matching SKU.

---

## 4. File Structure

```
src/
├── components/
│   └── product-configurator/
│       ├── ProductConfigurator.tsx           ← top-level orchestrator
│       ├── ConfiguratorHeader.tsx
│       ├── ConfiguratorAccordion.tsx
│       ├── AccordionSection.tsx
│       ├── AccordionHeader.tsx
│       ├── AccordionBody.tsx
│       ├── OptionRow.tsx
│       ├── ConfigurationSummary.tsx
│       ├── CollapseToggle.tsx
│       ├── ProductConfigurator.module.scss   ← scoped styles (CSS Modules)
│       └── index.ts                          ← barrel export
│
├── services/
│   └── product-configurator.service.ts      ← API fetch + Vercel cache config
│
├── utils/
│   └── product-configurator.mapper.ts       ← mapToConfiguratorModel + helpers
│
└── types/
    └── product-configurator.types.ts        ← all TypeScript interfaces
```

---

## 5. Service Layer — API Fetch + Vercel Caching

### 5.1 Service File

```
src/services/product-configurator.service.ts
```

```typescript
import { ProductApiResponse } from '@/types/product-configurator.types';

const PRODUCT_API_BASE = process.env.NEXT_PUBLIC_COMMERCE_API_URL;

/**
 * Fetches product data from Sitecore Commerce API.
 * Uses Next.js extended fetch with Vercel cache control.
 *
 * Called from a Server Component or page-level data fetching.
 */
export async function fetchProductData(productCode: string): Promise<ProductApiResponse> {
  const url = `${PRODUCT_API_BASE}/products/${productCode}`;

  const response = await fetch(url, {
    next: {
      revalidate: 3600,           // ISR — revalidate every 60 minutes
      tags: [`product-${productCode}`],  // on-demand revalidation tag
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch product data: ${response.status}`);
  }

  return response.json();
}
```

### 5.2 Caching Strategy (Vercel)

| Concern | Approach |
|---|---|
| **Cache layer** | Vercel Data Cache via Next.js `fetch` with `next.revalidate` |
| **Time-based revalidation** | `revalidate: 3600` — stale data served while revalidating in background every 60 min |
| **On-demand revalidation** | Tag-based: `revalidateTag('product-XDV2T')` called from a Sitecore webhook or admin action when product data changes in CMS |
| **Cache key** | Automatic — based on URL + headers. Each product code gets its own cache entry |
| **Client-side** | No client-side data fetching. Data is fetched server-side and passed as props. The configurator is a Client Component that receives pre-fetched, cached data. |

### 5.3 Server Component Integration

```typescript
// In the page or layout Server Component:

import { fetchProductData } from '@/services/product-configurator.service';
import { mapToConfiguratorModel } from '@/utils/product-configurator.mapper';
import { ProductConfigurator } from '@/components/product-configurator';

export default async function ProductPage({ params }: { params: { code: string } }) {
  const productData = await fetchProductData(params.code);
  const configuratorModel = mapToConfiguratorModel(
    productData.variantOptions,
    productData.variantMatrix,
  );

  return (
    <div className="product-page two-col">
      <ProductInfo data={productData} />
      <ProductConfigurator model={configuratorModel} productCode={productData.code} />
    </div>
  );
}
```

---

## 6. Mapper Utility

### 6.1 File

```
src/utils/product-configurator.mapper.ts
```

### 6.2 Functions

| Function | Signature | Purpose |
|---|---|---|
| `mapToConfiguratorModel` | `(variantOptions, variantMatrix) → ProductConfiguratorModel` | Transforms raw API arrays into the clean internal model. Extracts category order from variantMatrix tree depth, option sequences from tree nodes, and builds variant list from variantOptions. |
| `getAvailableOptions` | `(model, selections) → Record<string, string[]>` | Filters variants matching current selections; returns valid remaining values per category in sequence order. Drives the cascading dropdown logic. |
| `getSelectedVariant` | `(model, selections) → ConfiguratorVariant \| null` | Returns the single matching variant when all categories are selected; `null` otherwise. |

### 6.3 Mapping Logic Summary

```
API variantMatrix (tree)
  ├─ Walk first root→leaf path  → category ORDER (depth = selection position)
  └─ Walk all nodes             → option SEQUENCES (display sort order)

API variantOptions (flat array)
  ├─ Extract qualifiers + values → categories with machine keys
  └─ Flatten each variant        → { code, url, stock, selections: { qualifier→value } }

Merge order + sequence into categories → sort categories by order → sort options by sequence
```

---

## 7. Expand / Collapse Behaviour

### 7.1 Accordion Sections (Individual)

Each `AccordionSection` toggles between expanded and collapsed via `expandedQualifier` state.

| Trigger | Result |
|---|---|
| Click on `AccordionHeader` | Toggle: if already open, close it (`expandedQualifier = null`); otherwise open it and close others |
| User selects an option | Auto-advance: next category expands, current closes |
| Reset clicked | First category expands, all others collapse |

**CSS transition:** `max-height` from `0` to a sufficient value (e.g., `800px`) with `overflow: hidden` and `transition: max-height 0.28s ease`.

### 7.2 Entire Right Panel (Collapse Toggle)

The floating `CollapseToggle` button controls the entire right configurator panel.

| State | Panel Width | Button Position | Button Icon |
|---|---|---|---|
| Expanded (default) | `440px` | Fixed at right edge of panel | `◀` |
| Collapsed | `0px` | Fixed at right edge of viewport | `▶` |

**Implementation:**

- The parent `two-col` grid uses `grid-template-columns: 1fr 440px`.
- When collapsed, class `right-collapsed` changes it to `1fr 0px`.
- CSS transition on `grid-template-columns` with `0.35s ease`.
- The toggle button uses a CSS custom property `--toggle-right` transitioned between `440px` and `0px` to stay glued to the panel edge.
- On screens ≤ 860px (mobile), the toggle button is hidden; layout switches to single-column stack.

### 7.3 Responsive Behaviour

| Breakpoint | Layout |
|---|---|
| > 860px | Two-column grid. Panel toggle visible. |
| ≤ 860px | Single-column stack. Panel always visible (full width). Toggle hidden. |

---

## 8. TypeScript Interfaces

```
src/types/product-configurator.types.ts
```

```typescript
// ── API Response Types (raw from Sitecore Commerce) ──

export interface ProductApiResponse {
  code:           string;
  name:           string;
  description?:   string;
  url:            string;
  categories?:    { code: string; name?: string }[];
  images?:        { url: string; altText?: string }[];
  stock:          StockInfo;
  price?:         PriceData;
  priceRange?:    PriceRange;
  variantOptions: ApiVariantOption[];
  variantMatrix:  ApiVariantMatrixNode[];
}

export interface ApiVariantOption {
  code:  string;
  url:   string;
  stock: StockInfo;
  priceData?: PriceData;
  variantOptionQualifiers: ApiQualifier[];
}

export interface ApiQualifier {
  name?:      string;
  qualifier?: string;
  value?:     string;
  image?:     Record<string, unknown>;
}

export interface ApiVariantMatrixNode {
  elements:              ApiVariantMatrixNode[];
  isLeaf:                boolean;
  parentVariantCategory: { name: string; hasImage: boolean; priority: number };
  variantValueCategory:  { name: string; sequence: number };
  variantOption?:        ApiVariantOption;
}

export interface StockInfo {
  isValueRounded: boolean;
  stockLevel?:    number;
  stockLevelStatus?: string;
}

export interface PriceData {
  currencyIso?: string;
  formattedValue?: string;
  value: number;
}

export interface PriceRange {
  minPrice?: PriceData;
  maxPrice?: PriceData;
}

// ── Internal Configurator Model ──

export interface ProductConfiguratorModel {
  categories: ConfiguratorCategory[];
  variants:   ConfiguratorVariant[];
}

export interface ConfiguratorCategory {
  name:      string;
  qualifier: string;
  order:     number;
  options:   ConfiguratorOptionValue[];
}

export interface ConfiguratorOptionValue {
  label:    string;
  value:    string;
  sequence: number;
}

export interface ConfiguratorVariant {
  code:       string;
  url:        string;
  stock:      StockInfo;
  price?:     PriceData;
  selections: Record<string, string>;
}

// ── Component Props ──

export interface ProductConfiguratorProps {
  model:       ProductConfiguratorModel;
  productCode: string;
  onVariantResolved?: (variant: ConfiguratorVariant | null) => void;
}

export interface ConfiguratorHeaderProps {
  onReset: () => void;
}

export interface AccordionSectionProps {
  category:     ConfiguratorCategory;
  stepIndex:    number;
  stepState:    'default' | 'active' | 'done';
  isOpen:       boolean;
  selectedValue?: string;
  availableValues: string[];
  emptyMessage: string;
  onToggle:     () => void;
  onSelect:     (qualifier: string, value: string) => void;
}

export interface OptionRowProps {
  value:      string;
  isChecked:  boolean;
  onSelect:   () => void;
}

export interface ConfigurationSummaryProps {
  model:        ProductConfiguratorModel;
  selections:   Record<string, string>;
  variant:      ConfiguratorVariant | null;
  totalSteps:   number;
  completedSteps: number;
}
```

---

## 9. Sequence Diagram — User Selection Flow

```
User            AccordionSection       ProductConfigurator        mapper utility
 │                   │                        │                        │
 │── click option ──►│                        │                        │
 │                   │── onSelect(q, val) ───►│                        │
 │                   │                        │── setSelections(...)   │
 │                   │                        │── clear downstream     │
 │                   │                        │── setExpandedQualifier │
 │                   │                        │                        │
 │                   │                        │── getAvailableOptions()─►│
 │                   │                        │◄── filtered options ─────│
 │                   │                        │                        │
 │                   │                        │── getSelectedVariant()──►│
 │                   │                        │◄── variant | null ──────│
 │                   │                        │                        │
 │                   │◄── re-render ──────────│                        │
 │◄── updated UI ───│                        │                        │
```

---

## 10. Sequence Diagram — Data Fetch + Caching

```
Browser             Next.js Server           Vercel Cache          Sitecore API
  │                      │                       │                      │
  │── page request ─────►│                       │                      │
  │                      │── fetch(product) ────►│                      │
  │                      │                       │── MISS ─────────────►│
  │                      │                       │◄── API response ─────│
  │                      │                       │── store (TTL=3600s)  │
  │                      │◄── cached response ──│                      │
  │                      │── mapToConfiguratorModel()                   │
  │                      │── render SSR ─────────                      │
  │◄── HTML + hydrate ──│                       │                      │
  │                      │                       │                      │
  │── next request ─────►│                       │                      │
  │                      │── fetch(product) ────►│                      │
  │                      │                       │── HIT (stale) ──────►│ (background)
  │                      │◄── cached response ──│                      │
```

---

## 11. Key Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **Mapper runs server-side** | Raw API data is transformed in the Server Component before being passed to the client. This keeps the Client Component bundle lean and avoids shipping mapper logic to the browser. |
| 2 | **`ProductConfigurator` is a Client Component** (`"use client"`) | Selection state, accordion toggling, and clipboard API require browser interactivity. |
| 3 | **No global state store** | Configurator state is self-contained. Local `useState` hooks suffice. The optional `onVariantResolved` callback allows the parent (Product Page) to react to SKU resolution if needed (e.g., updating price display on the left panel). |
| 4 | **Cascading filter computed on render (not memoized in state)** | `getAvailableOptions()` is a pure function of `model` + `selections`. Deriving it on render avoids stale-state bugs. For large variant sets, wrap in `useMemo`. |
| 5 | **Vercel Data Cache with ISR** | Product data changes infrequently. A 60-minute revalidation window provides freshness with minimal API load. On-demand revalidation via tags handles CMS publish events. |
| 6 | **CSS Modules (SCSS)** | Scoped styles aligned with typical Next.js + Sitecore project conventions. No runtime CSS-in-JS overhead. |
| 7 | **Panel collapse via CSS grid transition** | Pure CSS approach — no JS layout measurement. `grid-template-columns` transition provides smooth expand/collapse without reflow jank. |

---

## 12. Integration Points

| Integration | Details |
|---|---|
| **Product Info ← → Configurator** | Parent page passes `onVariantResolved(variant)` to `ProductConfigurator`. When a full SKU is resolved, the callback fires with the variant object (code, price, stock, URL). Product Info can use this to update displayed price or stock status. |
| **Sitecore Rendering** | `ProductConfigurator` is registered as a Sitecore component rendering. It receives the product code from the Sitecore route/context and fetches variant data via the service layer. |
| **Quote / Cart** | The "Request a Quote" button in `ConfigurationSummary` constructs the product URL from `variant.url` and navigates to the quote page (or triggers an add-to-cart action via existing commerce hooks). |
| **Clipboard** | "Copy" button uses `navigator.clipboard.writeText()` with a brief "Copied!" feedback state managed locally. |
| **On-demand cache invalidation** | A Sitecore publish webhook calls a Next.js API route that runs `revalidateTag('product-{code}')` to bust the Vercel cache for updated products. |

---

## 13. Accessibility Considerations

| Area | Implementation |
|---|---|
| Accordion | `aria-expanded` on each header button. `role="region"` on body. `aria-controls` linking header to body `id`. |
| Radio options | Semantic `<input type="radio">` (visually hidden) with `<label>` wrappers. Custom dot is decorative. Keyboard navigation (arrow keys within group). |
| Focus management | After selecting an option and auto-advancing, focus moves to the newly expanded section header. |
| Collapse toggle | `aria-label` describing current state ("Collapse configurator panel" / "Expand configurator panel"). |

---

## 14. Summary

The Product Configurator is decomposed into **8 focused components** that follow a unidirectional data flow:

1. **Server-side:** Fetch product data → cache via Vercel → transform with mapper utility.
2. **Client-side:** `ProductConfigurator` receives the model as props → manages selection state → derived cascading logic filters options → resolves SKU on completion.
3. **Expand/Collapse:** Individual accordion sections via `max-height` CSS transition; entire panel via CSS grid column transition with a floating toggle button.

All interactions are local. No external state management is required. The Vercel data cache ensures fast, fresh responses without overloading the Sitecore Commerce API.
