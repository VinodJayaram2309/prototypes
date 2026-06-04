# High-Level Design - Product Configurator Component

## Next.js (Pages Router) + Sitecore Content SDK Implementation

---

## 1. Purpose and Scope

This document defines the implementation approach for a new Product Configurator panel that must follow patterns already used in this repository.

The configurator:
- Supports cascading variant selection (example: Torque Range -> Suspension Options -> Cord Type).
- Resolves to one final SKU when all required selections are complete.
- Works with the existing Product Info area on PDP pages.

In scope:
- Sitecore rendering wrapper.
- Frontend content component.
- API route, service, mapping, and types.
- Authoring templates/rendering registration.

Out of scope:
- Rebuilding existing Product Info component behavior.

---

## 2. Project Standards Applied

This HLD is aligned to established project patterns visible in current features such as Product Comparison and Product Info:

1. Sitecore wrapper layer and frontend component layer are separate.
- Sitecore wrapper: `src/sitecore/PageContent/*`
- Frontend component: `src/components/content/*`

2. Pages Router conventions are used.
- Data-loading is not based on App Router Server Components.
- Runtime feature APIs are implemented under `src/pages/api/*`.

3. Data/cache helpers are implemented in `src/lib/*` and use shared cache utilities.
- Use `createVercelCache` or `fetchWithCache` from `src/lib/cache/vercelDataCache.ts`.

4. Sitecore rendering registration follows generated component map and serialized item modules.
- Runtime registration: `.sitecore/component-map.ts`
- Authoring serialization: `authoring/items/<FeatureName>/*.module.json`

5. Edit-mode safety is required.
- Wrapper/component should provide an author-friendly message in Pages when required runtime data is unavailable.

---

## 3. Target Architecture

### 3.1 Layered Component Design

```text
Sitecore Rendering (componentName: ProductConfigurator)
    -> src/sitecore/PageContent/ProductConfigurator.tsx (wrapper)
        -> src/components/content/ProductConfigurator/ProductConfigurator.tsx (UI orchestrator)
            -> child UI parts (accordion, summary, toggle)
            -> useProductConfigurator hook
                -> /api/products/configurator
                    -> productConfiguratorService (Commerce API + cache)
                    -> mapper utils (internal model + resolver helpers)
```

### 3.2 Responsibilities

| Layer | Responsibility |
|---|---|
| Sitecore wrapper | Maps datasource fields to frontend props, handles edit-mode fallback messaging, passes site/page context when required. |
| Frontend configurator component | Owns interactive state: selections, expanded section, collapsed panel, copy state, quote CTA behavior. |
| Hook (`useProductConfigurator`) | Reads product code, calls internal API, controls loading/error states, exposes normalized model + selected variant. |
| API route (`/api/products/configurator`) | Validates query, calls service, maps Commerce payload, returns normalized response for UI. |
| Service layer | Calls Commerce API endpoint and applies cache strategy based on project standards. |
| Mapper utilities | Converts Commerce response into stable internal model and resolves available options/SKU. |

---

## 4. Recommended File Structure (Aligned to Repo)

```text
apps/website/src/
  components/
    content/
      ProductConfigurator/
        ProductConfigurator.tsx
        ProductConfiguratorHeader.tsx
        ProductConfiguratorAccordion.tsx
        ProductConfiguratorSection.tsx
        ProductConfiguratorOptionRow.tsx
        ProductConfiguratorSummary.tsx
        ProductConfiguratorCollapseToggle.tsx
        useProductConfigurator.ts
        productConfigurator.module.scss

  sitecore/
    PageContent/
      ProductConfigurator.tsx

  pages/
    api/
      products/
        configurator.ts

  lib/
    sitecoreQueries/
      ProductConfigurator/
        productConfiguratorService.ts
        mapper.ts
        types.ts
        quoteForm.ts
```

Notes:
- Keep style files as component-scoped SCSS modules in the component folder.
- Keep feature-specific service/mapper/types together under `lib/sitecoreQueries/ProductConfigurator` to match existing feature organization.

---

## 5. Sitecore Component Design (Wrapper + Rendering Item)

### 5.1 Wrapper Component

Create Sitecore wrapper:
- `src/sitecore/PageContent/ProductConfigurator.tsx`

Wrapper contract should follow existing conventions:
- Accept `rendering`, `params`, and `fields` from Sitecore Content SDK.
- Map author-configurable text/messages into frontend props.
- Pass product code and optional quote form URL from datasource fields.
- In edit mode, render informational placeholder when live API data is not available.

### 5.2 Frontend Component

Create frontend UI component:
- `src/components/content/ProductConfigurator/ProductConfigurator.tsx`

Expected behavior:
- Render the right panel UI.
- Maintain state for cascading option selection.
- Emit `onVariantResolved(variant | null)` when selection changes.
- Support summary state and quote CTA behavior.

### 5.3 Sitecore Rendering Registration

Required updates:
1. Add wrapper export so codegen includes it in `.sitecore/component-map.ts`.
2. Ensure `componentName` on rendering item is `ProductConfigurator`.
3. Add authoring serialization module similar to existing features:
- `authoring/items/ProductConfigurator/ProductConfigurator.module.json`

Rendering item should be under:
- `/sitecore/layout/Renderings/Feature/Ametek/Page Content/Product Configurator`

Use conventions already present in this repo:
- `Datasource Template` set to the feature template.
- `Datasource Location` typically `query:./Data`.

---

## 6. Data Flow and API Strategy

### 6.1 Runtime Flow (Pages Router)

```text
Browser -> ProductConfigurator component -> /api/products/configurator?code={productCode}
       -> productConfiguratorService -> Commerce API
       -> mapper -> normalized response -> component state
```

### 6.2 Why Internal API Route

Using internal API route matches existing project patterns and provides:
- Centralized validation and error handling.
- Better control of caching and transformation.
- No Commerce credentials or implementation details exposed to browser code.

### 6.3 API Response Shape (Internal)

```ts
interface ProductConfiguratorApiResult {
  success: boolean;
  model?: ProductConfiguratorModel;
  product?: {
    code: string;
    name: string;
    url: string;
  };
  error?: string;
}
```

---

## 7. Caching Strategy (Aligned to Current Project)

Use project cache helpers from `src/lib/cache/vercelDataCache.ts`.

Recommended approach:
1. In service layer, wrap Commerce fetch in `createVercelCache` for deterministic keys and tags.
2. Use feature tag naming convention, for example:
- `product-configurator`
- `product-configurator-{productCode}`
3. Use moderate revalidation window (example: 3600 seconds) unless business requires faster freshness.
4. Revalidate by tag via existing admin endpoint:
- `/api/admin/revalidateCacheTags`

This aligns better with current repo patterns than relying only on ad hoc page-level fetch caching.

---

## 8. Internal Model and Selection Logic

### 8.1 Types

Keep all feature types in:
- `src/lib/sitecoreQueries/ProductConfigurator/types.ts`

Core types:
- Raw Commerce response types.
- Internal UI model (`ProductConfiguratorModel`, `ConfiguratorCategory`, `ConfiguratorVariant`).
- API route result contract.
- Quote payload contract.

### 8.2 Mapper Functions

Implement in:
- `src/lib/sitecoreQueries/ProductConfigurator/mapper.ts`

Functions:
- `mapToConfiguratorModel(raw)`
- `getAvailableOptions(model, selections)`
- `getSelectedVariant(model, selections)`

Rules:
1. Upstream selections constrain downstream options.
2. Selecting step `i` clears steps `i + 1 ... n`.
3. Variant resolves only when all required categories are selected.

---

## 9. UI Behavior Requirements

### 9.1 Accordion and Step Flow

- Single expanded section at a time.
- On selection, auto-open next section.
- Reset returns to initial state and first section expanded.

### 9.2 Panel Collapse

- Desktop/tablet: configurable right panel can collapse.
- Mobile: panel remains visible and stacked; collapse toggle hidden.

### 9.3 Accessibility

Required:
- Header buttons with `aria-expanded` and `aria-controls`.
- Section body with `role="region"`.
- Semantic radio inputs for options.
- Keyboard support for option selection and section navigation.
- Clear labels for copy and quote actions.

---

## 10. Third-Party Quote Integration

Implement quote helper under:
- `src/lib/sitecoreQueries/ProductConfigurator/quoteForm.ts`

Contract:

```ts
export interface QuoteFormPayload {
  skuId: string;
  productCode: string;
  productName: string;
  productUrl: string;
  selectedOptions: Array<{
    qualifier: string;
    categoryName: string;
    value: string;
  }>;
}

export function openQuoteForm(payload: QuoteFormPayload): void;
```

Behavior:
- Only enabled when resolved variant exists.
- Preserve both machine keys and human labels.
- Provide fallback notification when quote endpoint is unavailable.

---

## 11. Authoring and Serialization Requirements

To be implementation-ready in XM Cloud, include all of the following:

1. Feature template branch under:
- `/sitecore/templates/Feature/Ametek/Product Configurator`

2. Datasource template containing at minimum:
- Product code source field (or explicit product code field).
- UI labels/messages (title, reset label, empty-state text, error text, quote CTA label).
- Optional quote-form endpoint field.

3. Rendering item under Page Content with:
- `componentName = ProductConfigurator`
- `Datasource Template`
- `Datasource Location = query:./Data`

4. Authoring module file:
- `authoring/items/ProductConfigurator/ProductConfigurator.module.json`

5. Add module references in aggregate module manifests if required by current deployment workflow.

---

## 12. Integration with Existing Product Components

Product Configurator must coexist with existing product feature components:
- Product Info remains the left-side presentation component.
- Product Configurator is an independent Sitecore rendering that can be placed in a two-column layout.
- Optional callback/event can be used so Product Info area updates price/stock display from resolved variant.

Recommended integration pattern:
- Keep Product Info and Product Configurator loosely coupled.
- Share only normalized `variant` output and avoid direct cross-component state mutation.

---

## 13. Implementation Checklist

1. Create frontend component folder and SCSS module under `components/content/ProductConfigurator`.
2. Create Sitecore wrapper under `sitecore/PageContent/ProductConfigurator.tsx`.
3. Add API route `pages/api/products/configurator.ts`.
4. Add service, mapper, types, and quote helper under `lib/sitecoreQueries/ProductConfigurator`.
5. Register rendering in Sitecore authoring items and ensure codegen includes it in `.sitecore/component-map.ts`.
6. Add edit-mode fallback behavior for Pages editor.
7. Validate keyboard and screen-reader behavior.
8. Verify cache tagging and revalidation behavior through existing admin revalidation API.

---

