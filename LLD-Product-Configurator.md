# Low-Level Design - Product Configurator Component

## Detailed Implementation Specifications

---

## 1. TypeScript Interfaces and Types

**File**: `src/lib/sitecoreQueries/ProductConfigurator/types.ts`

### 1.1 Commerce API Response Types

```typescript
/**
 * Raw response from Commerce/Sitecore Commerce API.
 * This is the structure we receive before transformation.
 */
export interface CommerceProductResponse {
  code: string;
  name: string;
  description?: string;
  url: string;
  images?: Array<{
    url: string;
    altText?: string;
  }>;
  stock: {
    isValueRounded: boolean;
    stockLevel?: number;
    stockLevelStatus?: string; // e.g. "InStock", "OutOfStock"
  };
  price?: {
    currencyIso?: string;
    formattedValue?: string;
    value: number;
  };
  priceRange?: {
    minPrice?: {
      value: number;
      formattedValue?: string;
    };
    maxPrice?: {
      value: number;
      formattedValue?: string;
    };
  };
  // Variant configuration data
  variantOptions: Array<{
    code: string;
    url: string;
    stock: {
      isValueRounded: boolean;
      stockLevel?: number;
      stockLevelStatus?: string;
    };
    priceData?: {
      currencyIso?: string;
      formattedValue?: string;
      value: number;
    };
    variantOptionQualifiers: Array<{
      name?: string;
      qualifier?: string;
      value?: string;
      image?: Record<string, unknown>;
    }>;
  }>;
  variantMatrix: VariantMatrixNode[];
}

export interface VariantMatrixNode {
  elements: VariantMatrixNode[];
  isLeaf: boolean;
  parentVariantCategory: {
    name: string;
    hasImage: boolean;
    priority: number;
  };
  variantValueCategory: {
    name: string;
    sequence: number;
  };
  variantOption?: {
    code: string;
    url: string;
    stock: {
      isValueRounded: boolean;
      stockLevel?: number;
      stockLevelStatus?: string;
    };
    priceData?: {
      value: number;
      formattedValue?: string;
    };
    variantOptionQualifiers: Array<{
      qualifier?: string;
      value?: string;
    }>;
  };
}
```

### 1.2 Internal Configurator Model

```typescript
/**
 * Normalized internal model consumed by UI components.
 * Derived from CommerceProductResponse via mapper.
 */
export interface ProductConfiguratorModel {
  categories: ConfiguratorCategory[];
  variants: ConfiguratorVariant[];
}

export interface ConfiguratorCategory {
  // Display name: e.g. "Torque Range"
  name: string;
  
  // Machine key for selection: e.g. "torque-range"
  qualifier: string;
  
  // Zero-based position in selection flow (determines cascade order)
  order: number;
  
  // Display options for this category
  options: ConfiguratorOptionValue[];
}

export interface ConfiguratorOptionValue {
  // Display text shown to user
  label: string;
  
  // Selection key stored in state
  value: string;
  
  // Display order within category (0-based)
  sequence: number;
}

export interface ConfiguratorVariant {
  // SKU code: e.g. "XDV2TLVTJ00U00"
  code: string;
  
  // Product detail page URL path
  url: string;
  
  // Stock information
  stock: {
    isValueRounded: boolean;
    stockLevel?: number;
    stockLevelStatus?: string;
  };
  
  // Price (optional, may come from variant or base product)
  price?: {
    currencyIso?: string;
    formattedValue?: string;
    value: number;
  };
  
  // Qualifiers selected to reach this variant
  // Key: qualifier, Value: selected option value
  selections: Record<string, string>;
}
```

### 1.3 API Route Contract

```typescript
/**
 * GET /api/products/configurator?code={productCode}&sc_site={siteName}&locale={locale}
 */
export interface ProductConfiguratorRequest {
  code: string;           // Product code, required
  sc_site?: string;       // Sitecore site name, optional
  locale?: string;        // Language locale, optional (default: "en")
}

export interface ProductConfiguratorResponse {
  success: boolean;
  
  // Normalized model ready for UI
  model?: ProductConfiguratorModel;
  
  // Base product info for reference
  product?: {
    code: string;
    name: string;
    url: string;
  };
  
  // Error message if success=false
  error?: string;
}
```

### 1.4 Quote Form Integration

```typescript
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
```

### 1.5 Component Props

```typescript
/**
 * Props passed from Sitecore wrapper to ProductConfigurator component.
 */
export interface ProductConfiguratorProps {
  // Normalized model from API
  model: ProductConfiguratorModel;
  
  // Base product code
  productCode: string;
  
  // Product display name
  productName: string;
  
  // Base product URL
  productUrl: string;
  
  // Optional callback when variant resolves
  onVariantResolved?: (variant: ConfiguratorVariant | null) => void;
  
  // Optional URL for quote form
  quoteFormUrl?: string;
  
  // Messages/labels from Sitecore datasource
  labels?: {
    headerTitle?: string;
    resetButtonLabel?: string;
    summaryCompleteTitle?: string;
    quoteCtaLabel?: string;
    emptyStateMessage?: string;
    errorStateMessage?: string;
  };
}

export interface ConfiguratorHeaderProps {
  title: string;
  onReset: () => void;
  resetLabel: string;
}

export interface ConfiguratorAccordionProps {
  categories: ConfiguratorCategory[];
  selections: Record<string, string>;
  expandedQualifier: string | null;
  availableOptions: Record<string, string[]>;
  onSelectOption: (qualifier: string, value: string) => void;
  onToggleSection: (qualifier: string) => void;
}

export interface ConfiguratorSectionProps {
  category: ConfiguratorCategory;
  stepIndex: number;
  stepState: "default" | "active" | "done";
  isOpen: boolean;
  selectedValue?: string;
  availableValues: string[];
  onToggle: () => void;
  onSelect: (value: string) => void;
}

export interface ConfiguratorOptionRowProps {
  value: string;
  label: string;
  isChecked: boolean;
  onSelect: () => void;
}

export interface ConfiguratorSummaryProps {
  model: ProductConfiguratorModel;
  selections: Record<string, string>;
  selectedVariant: ConfiguratorVariant | null;
  totalSteps: number;
  completedSteps: number;
  onQuoteCta?: () => void;
  quoteCtaLabel: string;
}
```

---

## 2. Mapper Utility Functions

**File**: `src/lib/sitecoreQueries/ProductConfigurator/mapper.ts`

### 2.1 Main Mapping Function

```typescript
/**
 * Transforms raw Commerce response into internal configurator model.
 * 
 * Algorithm:
 * 1. Walk variantMatrix to determine category ORDER (depth = selection position).
 * 2. Extract all qualifiers and options from variantMatrix and variantOptions.
 * 3. Assign sequence numbers from tree traversal order.
 * 4. Build variant list from variantOptions with selections map.
 * 5. Sort categories by order, options by sequence.
 * 
 * @param raw - Raw Commerce API response
 * @returns Normalized model ready for UI
 */
export function mapToConfiguratorModel(
  raw: CommerceProductResponse
): ProductConfiguratorModel {
  // Step 1: Extract category metadata from variantMatrix
  const categoryMetadata = extractCategoryMetadata(raw.variantMatrix);
  
  // Step 2: Build category definitions
  const categories = buildCategories(raw.variantMatrix, categoryMetadata);
  
  // Step 3: Build variant list from variantOptions
  const variants = buildVariants(raw.variantOptions, categories);
  
  // Step 4: Sort by order and return
  return {
    categories: categories.sort((a, b) => a.order - b.order),
    variants,
  };
}

/**
 * Extract category order and metadata by walking variantMatrix.
 * First leaf path determines category order (depth = position).
 * All nodes contribute option sequences.
 */
function extractCategoryMetadata(matrix: VariantMatrixNode[]): Map<string, CategoryMeta> {
  const meta = new Map<string, CategoryMeta>();
  
  // Walk tree to first leaf, recording depths
  function walkToFirstLeaf(node: VariantMatrixNode, depth: number) {
    const categoryName = node.parentVariantCategory.name;
    const qualifier = getQualifierFromNode(node);
    
    if (!meta.has(qualifier)) {
      meta.set(qualifier, {
        name: categoryName,
        qualifier,
        order: depth,
        options: new Map(),
      });
    }
    
    // Record this node as an option with sequence
    const optionMeta = meta.get(qualifier)!;
    const optionValue = node.variantValueCategory.name;
    optionMeta.options.set(
      optionValue,
      node.variantValueCategory.sequence
    );
    
    if (!node.isLeaf && node.elements.length > 0) {
      walkToFirstLeaf(node.elements[0], depth + 1);
    }
  }
  
  matrix.forEach(root => walkToFirstLeaf(root, 0));
  return meta;
}

/**
 * Build normalized category array from metadata.
 */
function buildCategories(
  matrix: VariantMatrixNode[],
  metadata: Map<string, CategoryMeta>
): ConfiguratorCategory[] {
  const categories: ConfiguratorCategory[] = [];
  
  metadata.forEach(meta => {
    const options = Array.from(meta.options.entries())
      .map(([label, sequence]) => ({
        label,
        value: label, // Use label as selection key for now
        sequence,
      }))
      .sort((a, b) => a.sequence - b.sequence);
    
    categories.push({
      name: meta.name,
      qualifier: meta.qualifier,
      order: meta.order,
      options,
    });
  });
  
  return categories;
}

/**
 * Build variant list from variantOptions.
 * Each variant maps its qualifiers to a selections record.
 */
function buildVariants(
  options: CommerceProductResponse["variantOptions"],
  categories: ConfiguratorCategory[]
): ConfiguratorVariant[] {
  return options.map(option => {
    const selections: Record<string, string> = {};
    
    // Map option qualifiers to selections
    option.variantOptionQualifiers.forEach(q => {
      if (q.qualifier && q.value) {
        selections[q.qualifier] = q.value;
      }
    });
    
    return {
      code: option.code,
      url: option.url,
      stock: option.stock,
      price: option.priceData,
      selections,
    };
  });
}

interface CategoryMeta {
  name: string;
  qualifier: string;
  order: number;
  options: Map<string, number>; // option label -> sequence
}

function getQualifierFromNode(node: VariantMatrixNode): string {
  // Extract qualifier from variantOption qualifiers or fallback to sanitized name
  if (node.variantOption?.variantOptionQualifiers?.length) {
    const q = node.variantOption.variantOptionQualifiers[0];
    return q.qualifier || sanitizeToQualifier(q.name || "");
  }
  return sanitizeToQualifier(node.parentVariantCategory.name);
}

function sanitizeToQualifier(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
```

### 2.2 Cascading Filter Logic

```typescript
/**
 * Returns available options for each remaining category,
 * filtered by current selections using cascading logic.
 * 
 * Algorithm:
 * 1. Start with all variants.
 * 2. Filter to variants matching current selections.
 * 3. For each category, collect distinct values from filtered variants.
 * 4. Return values in sequence order.
 * 
 * @param model - Configurator model
 * @param selections - Current selections: { qualifier -> value }
 * @returns Available values per category: { qualifier -> [values] }
 */
export function getAvailableOptions(
  model: ProductConfiguratorModel,
  selections: Record<string, string>
): Record<string, string[]> {
  const available: Record<string, string[]> = {};
  
  // Filter variants to those matching all current selections
  const matchingVariants = model.variants.filter(v =>
    Object.entries(selections).every(
      ([qualifier, value]) => v.selections[qualifier] === value
    )
  );
  
  // For each category, collect available values from matching variants
  model.categories.forEach(category => {
    const values = new Set<string>();
    
    matchingVariants.forEach(variant => {
      const value = variant.selections[category.qualifier];
      if (value) {
        values.add(value);
      }
    });
    
    // Map back to sequence order
    const orderedValues = category.options
      .filter(opt => values.has(opt.value))
      .map(opt => opt.value);
    
    available[category.qualifier] = orderedValues;
  });
  
  return available;
}

/**
 * Resolve selected variant when all categories are selected.
 * 
 * @param model - Configurator model
 * @param selections - Current selections
 * @returns Matching variant or null if incomplete or no match
 */
export function getSelectedVariant(
  model: ProductConfiguratorModel,
  selections: Record<string, string>
): ConfiguratorVariant | null {
  const requiredQualifiers = new Set(
    model.categories.map(c => c.qualifier)
  );
  
  // Check completeness
  if (requiredQualifiers.size !== Object.keys(selections).length) {
    return null;
  }
  
  for (const qualifier of requiredQualifiers) {
    if (!selections[qualifier]) {
      return null;
    }
  }
  
  // Find exact match
  return (
    model.variants.find(v =>
      Object.entries(selections).every(
        ([q, val]) => v.selections[q] === val
      )
    ) || null
  );
}

/**
 * Clear downstream selections when a category is selected.
 * If user selects at category index i, clear all selections at i+1, i+2, etc.
 * 
 * @param selections - Current selections
 * @param categories - All categories
 * @param selectedQualifier - Qualifier that was just selected
 * @returns New selections with downstream entries removed
 */
export function clearDownstreamSelections(
  selections: Record<string, string>,
  categories: ConfiguratorCategory[],
  selectedQualifier: string
): Record<string, string> {
  const selectedOrder = categories.find(c => c.qualifier === selectedQualifier)?.order;
  if (selectedOrder === undefined) {
    return selections;
  }
  
  const newSelections = { ...selections };
  
  categories.forEach(cat => {
    if (cat.order > selectedOrder) {
      delete newSelections[cat.qualifier];
    }
  });
  
  return newSelections;
}
```

---

## 3. Service Layer

**File**: `src/lib/sitecoreQueries/ProductConfigurator/productConfiguratorService.ts`

```typescript
import { createVercelCache, generateCacheKey } from "@/lib/cache/vercelDataCache";

const COMMERCE_API_BASE = process.env.NEXT_PUBLIC_COMMERCE_API_URL || "";

/**
 * Fetch and cache product configurator data from Commerce API.
 * Wrapped with Vercel cache for deterministic retrieval.
 */
const cachedGetProductConfiguratorData = createVercelCache(
  async (productCode: string, language: string = "en") => {
    if (!COMMERCE_API_BASE) {
      throw new Error("COMMERCE_API_BASE not configured");
    }
    
    const url = `${COMMERCE_API_BASE}/products/${productCode}?language=${language}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    
    if (!response.ok) {
      throw new Error(
        `Commerce API returned ${response.status} for product ${productCode}`
      );
    }
    
    return response.json() as Promise<CommerceProductResponse>;
  },
  (productCode: string, language: string = "en") => [
    "product-configurator",
    generateCacheKey("product-configurator", {
      productCode,
      language,
    }),
  ],
  {
    revalidate: 3600, // 1 hour
    tags: ["product-configurator"],
  }
);

/**
 * Public API: Fetch and normalize product configurator data.
 */
export async function getProductConfiguratorData(
  productCode: string,
  language: string = "en"
): Promise<{
  raw: CommerceProductResponse;
  model: ProductConfiguratorModel;
}> {
  const raw = await cachedGetProductConfiguratorData(productCode, language);
  const model = mapToConfiguratorModel(raw);
  
  return { raw, model };
}
```

---

## 4. API Route Implementation

**File**: `src/pages/api/products/configurator.ts`

```typescript
import { NextApiRequest, NextApiResponse } from "next";
import { getProductConfiguratorData } from "@/lib/sitecoreQueries/ProductConfigurator/productConfiguratorService";
import { mapToConfiguratorModel } from "@/lib/sitecoreQueries/ProductConfigurator/mapper";
import {
  ProductConfiguratorResponse,
  CommerceProductResponse,
} from "@/lib/sitecoreQueries/ProductConfigurator/types";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProductConfiguratorResponse>
) {
  // Only GET allowed
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }
  
  try {
    const { code, locale = "en" } = req.query;
    
    // Validate required params
    if (!code || typeof code !== "string") {
      return res.status(400).json({
        success: false,
        error: "Product code is required",
      });
    }
    
    // Fetch and transform
    const { raw, model } = await getProductConfiguratorData(code, locale);
    
    return res.status(200).json({
      success: true,
      model,
      product: {
        code: raw.code,
        name: raw.name,
        url: raw.url,
      },
    });
  } catch (error) {
    console.error("Configurator API error:", error);
    
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load product configurator",
    });
  }
}
```

---

## 5. Frontend Hook

**File**: `src/components/content/ProductConfigurator/useProductConfigurator.ts`

```typescript
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import {
  ProductConfiguratorModel,
  ConfiguratorVariant,
} from "@/lib/sitecoreQueries/ProductConfigurator/types";
import {
  getAvailableOptions,
  getSelectedVariant,
  clearDownstreamSelections,
} from "@/lib/sitecoreQueries/ProductConfigurator/mapper";

interface UseProductConfiguratorState {
  model: ProductConfiguratorModel | null;
  selections: Record<string, string>;
  expandedQualifier: string | null;
  selectedVariant: ConfiguratorVariant | null;
  availableOptions: Record<string, string[]>;
  loading: boolean;
  error: string | null;
}

/**
 * Hook managing configurator state and API interaction.
 */
export function useProductConfigurator(productCode: string) {
  const [state, setState] = useState<UseProductConfiguratorState>({
    model: null,
    selections: {},
    expandedQualifier: null,
    selectedVariant: null,
    availableOptions: {},
    loading: true,
    error: null,
  });
  
  const { locale } = useRouter();
  
  // Fetch model on mount
  useEffect(() => {
    (async () => {
      try {
        setState(prev => ({ ...prev, loading: true, error: null }));
        
        const response = await fetch(
          `/api/products/configurator?code=${productCode}&locale=${locale || "en"}`
        );
        
        if (!response.ok) {
          throw new Error("Failed to load product configurator");
        }
        
        const data = await response.json();
        
        if (!data.success || !data.model) {
          throw new Error(data.error || "Invalid response");
        }
        
        const firstQualifier = data.model.categories[0]?.qualifier || null;
        
        setState(prev => ({
          ...prev,
          model: data.model,
          expandedQualifier: firstQualifier,
          loading: false,
        }));
      } catch (err) {
        setState(prev => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : "Unknown error",
        }));
      }
    })();
  }, [productCode, locale]);
  
  // Recalculate available options whenever model or selections change
  useEffect(() => {
    if (state.model) {
      const available = getAvailableOptions(state.model, state.selections);
      const variant = getSelectedVariant(state.model, state.selections);
      
      setState(prev => ({
        ...prev,
        availableOptions: available,
        selectedVariant: variant,
      }));
    }
  }, [state.model, state.selections]);
  
  // Handle option selection with cascading clear
  const selectOption = useCallback(
    (qualifier: string, value: string) => {
      setState(prev => {
        if (!prev.model) return prev;
        
        const newSelections = {
          ...prev.selections,
          [qualifier]: value,
        };
        
        // Clear downstream selections
        const cleared = clearDownstreamSelections(
          newSelections,
          prev.model.categories,
          qualifier
        );
        
        // Auto-advance to next category
        const selectedOrder = prev.model.categories.find(
          c => c.qualifier === qualifier
        )?.order;
        
        let nextQualifier = null;
        if (selectedOrder !== undefined) {
          nextQualifier = prev.model.categories.find(
            c => c.order === selectedOrder + 1
          )?.qualifier || null;
        }
        
        return {
          ...prev,
          selections: cleared,
          expandedQualifier: nextQualifier,
        };
      });
    },
    []
  );
  
  // Handle section toggle
  const toggleSection = useCallback((qualifier: string) => {
    setState(prev => ({
      ...prev,
      expandedQualifier: prev.expandedQualifier === qualifier ? null : qualifier,
    }));
  }, []);
  
  // Handle reset
  const reset = useCallback(() => {
    setState(prev => ({
      ...prev,
      selections: {},
      expandedQualifier: prev.model?.categories[0]?.qualifier || null,
    }));
  }, []);
  
  return {
    ...state,
    selectOption,
    toggleSection,
    reset,
  };
}
```

---

## 6. Component Implementations

### 6.1 Main Orchestrator Component

**File**: `src/components/content/ProductConfigurator/ProductConfigurator.tsx`

```typescript
"use client"; // Client component - requires state and interactivity

import React, { useState } from "react";
import styles from "./productConfigurator.module.scss";
import { ProductConfiguratorProps } from "@/lib/sitecoreQueries/ProductConfigurator/types";
import { useProductConfigurator } from "./useProductConfigurator";
import ProductConfiguratorHeader from "./ProductConfiguratorHeader";
import ProductConfiguratorAccordion from "./ProductConfiguratorAccordion";
import ProductConfiguratorSummary from "./ProductConfiguratorSummary";
import ProductConfiguratorCollapseToggle from "./ProductConfiguratorCollapseToggle";

export default function ProductConfigurator({
  model,
  productCode,
  productName,
  productUrl,
  onVariantResolved,
  quoteFormUrl,
  labels = {},
}: ProductConfiguratorProps) {
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);
  
  const {
    selections,
    expandedQualifier,
    selectedVariant,
    availableOptions,
    loading,
    error,
    selectOption,
    toggleSection,
    reset,
  } = useProductConfigurator(productCode);
  
  // Notify parent when variant resolves
  React.useEffect(() => {
    onVariantResolved?.(selectedVariant);
  }, [selectedVariant, onVariantResolved]);
  
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingState}>Loading options...</div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          {labels.errorStateMessage || "Failed to load product options"}
        </div>
      </div>
    );
  }
  
  const completedSteps = Object.keys(selections).length;
  const totalSteps = model.categories.length;
  
  return (
    <div
      className={`${styles.container} ${
        isPanelCollapsed ? styles.collapsed : ""
      }`}
    >
      <ProductConfiguratorHeader
        title={labels.headerTitle || "Configure Your Product"}
        onReset={reset}
        resetLabel={labels.resetButtonLabel || "Reset"}
      />
      
      <ProductConfiguratorAccordion
        categories={model.categories}
        selections={selections}
        expandedQualifier={expandedQualifier}
        availableOptions={availableOptions}
        onSelectOption={selectOption}
        onToggleSection={toggleSection}
      />
      
      <ProductConfiguratorSummary
        model={model}
        selections={selections}
        selectedVariant={selectedVariant}
        totalSteps={totalSteps}
        completedSteps={completedSteps}
        quoteCtaLabel={labels.quoteCtaLabel || "Request a Quote"}
        quoteFormUrl={quoteFormUrl}
        productCode={productCode}
        productName={productName}
        productUrl={productUrl}
      />
      
      <ProductConfiguratorCollapseToggle
        isCollapsed={isPanelCollapsed}
        onToggle={() => setIsPanelCollapsed(!isPanelCollapsed)}
      />
    </div>
  );
}
```

### 6.2 Header Component

**File**: `src/components/content/ProductConfigurator/ProductConfiguratorHeader.tsx`

```typescript
import React from "react";
import styles from "./productConfigurator.module.scss";
import { ConfiguratorHeaderProps } from "@/lib/sitecoreQueries/ProductConfigurator/types";

export default function ProductConfiguratorHeader({
  title,
  onReset,
  resetLabel,
}: ConfiguratorHeaderProps) {
  return (
    <div className={styles.header}>
      <h2 className={styles.headerTitle}>{title}</h2>
      <button
        className={styles.resetButton}
        onClick={onReset}
        aria-label={`${resetLabel}: start configuration over`}
      >
        {resetLabel}
      </button>
    </div>
  );
}
```

### 6.3 Accordion Component

**File**: `src/components/content/ProductConfigurator/ProductConfiguratorAccordion.tsx`

```typescript
import React from "react";
import styles from "./productConfigurator.module.scss";
import { ConfiguratorAccordionProps } from "@/lib/sitecoreQueries/ProductConfigurator/types";
import ProductConfiguratorSection from "./ProductConfiguratorSection";

export default function ProductConfiguratorAccordion({
  categories,
  selections,
  expandedQualifier,
  availableOptions,
  onSelectOption,
  onToggleSection,
}: ConfiguratorAccordionProps) {
  return (
    <div className={styles.accordion} role="region" aria-label="Configuration steps">
      {categories.map((category, index) => {
        const isOpen = expandedQualifier === category.qualifier;
        const selected = selections[category.qualifier];
        
        let stepState: "default" | "active" | "done" = "default";
        if (selected) stepState = "done";
        else if (isOpen) stepState = "active";
        
        return (
          <ProductConfiguratorSection
            key={category.qualifier}
            category={category}
            stepIndex={index}
            stepState={stepState}
            isOpen={isOpen}
            selectedValue={selected}
            availableValues={availableOptions[category.qualifier] || []}
            onToggle={() => onToggleSection(category.qualifier)}
            onSelect={(value) => onSelectOption(category.qualifier, value)}
          />
        );
      })}
    </div>
  );
}
```

### 6.4 Section Component

**File**: `src/components/content/ProductConfigurator/ProductConfiguratorSection.tsx`

```typescript
import React from "react";
import styles from "./productConfigurator.module.scss";
import { ConfiguratorSectionProps } from "@/lib/sitecoreQueries/ProductConfigurator/types";
import ProductConfiguratorOptionRow from "./ProductConfiguratorOptionRow";

export default function ProductConfiguratorSection({
  category,
  stepIndex,
  stepState,
  isOpen,
  selectedValue,
  availableValues,
  onToggle,
  onSelect,
}: ConfiguratorSectionProps) {
  const sectionId = `section-${category.qualifier}`;
  const bodyId = `body-${category.qualifier}`;
  
  return (
    <div className={`${styles.section} ${styles[`state-${stepState}`]}`}>
      <button
        id={sectionId}
        className={styles.sectionHeader}
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={bodyId}
      >
        <span className={styles.stepIndicator}>
          {stepState === "done" ? (
            <span className={styles.checkmark}>✓</span>
          ) : (
            <span className={styles.stepNumber}>{stepIndex + 1}</span>
          )}
        </span>
        
        <span className={styles.categoryName}>{category.name}</span>
        
        {selectedValue && (
          <span className={styles.selectedValue}>{selectedValue}</span>
        )}
        
        <span className={styles.chevron}>
          {isOpen ? "▼" : "▶"}
        </span>
      </button>
      
      {isOpen && (
        <div id={bodyId} className={styles.sectionBody} role="region">
          {availableValues.length > 0 ? (
            <div className={styles.optionsList}>
              {availableValues.map(value => (
                <ProductConfiguratorOptionRow
                  key={value}
                  value={value}
                  label={value}
                  isChecked={selectedValue === value}
                  onSelect={() => onSelect(value)}
                />
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              Select options above to see choices
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### 6.5 Option Row Component

**File**: `src/components/content/ProductConfigurator/ProductConfiguratorOptionRow.tsx`

```typescript
import React from "react";
import styles from "./productConfigurator.module.scss";
import { ConfiguratorOptionRowProps } from "@/lib/sitecoreQueries/ProductConfigurator/types";

export default function ProductConfiguratorOptionRow({
  value,
  label,
  isChecked,
  onSelect,
}: ConfiguratorOptionRowProps) {
  return (
    <label className={`${styles.optionRow} ${isChecked ? styles.checked : ""}`}>
      <input
        type="radio"
        value={value}
        checked={isChecked}
        onChange={onSelect}
        className={styles.radioInput}
      />
      <span className={styles.customRadio}></span>
      <span className={styles.optionLabel}>{label}</span>
    </label>
  );
}
```

### 6.6 Summary Component

**File**: `src/components/content/ProductConfigurator/ProductConfiguratorSummary.tsx`

```typescript
import React, { useState } from "react";
import styles from "./productConfigurator.module.scss";
import { ConfiguratorSummaryProps } from "@/lib/sitecoreQueries/ProductConfigurator/types";
import { buildQuoteFormPayload, openQuoteForm } from "@/lib/sitecoreQueries/ProductConfigurator/quoteForm";

export default function ProductConfiguratorSummary({
  model,
  selections,
  selectedVariant,
  totalSteps,
  completedSteps,
  quoteCtaLabel,
  quoteFormUrl,
  productCode,
  productName,
  productUrl,
}: ConfiguratorSummaryProps & {
  quoteFormUrl?: string;
  productCode: string;
  productName: string;
  productUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  
  if (completedSteps < totalSteps) {
    // Show progress
    return (
      <div className={styles.summary}>
        <div className={styles.progressBar}>
          <div
            className={styles.progress}
            style={{ width: `${(completedSteps / totalSteps) * 100}%` }}
          ></div>
        </div>
        <p className={styles.progressText}>
          {completedSteps} of {totalSteps} selected
        </p>
      </div>
    );
  }
  
  if (!selectedVariant) {
    return null;
  }
  
  // Show completed configuration
  const handleCopySku = async () => {
    await navigator.clipboard.writeText(selectedVariant.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const handleQuoteCta = () => {
    if (quoteFormUrl) {
      const payload = buildQuoteFormPayload(
        model,
        selections,
        selectedVariant,
        {
          code: productCode,
          name: productName,
          url: productUrl,
        }
      );
      
      openQuoteForm(payload, quoteFormUrl);
    }
  };
  
  return (
    <div className={styles.summary}>
      <div className={styles.completedContainer}>
        <h3 className={styles.completedTitle}>Your Configuration</h3>
        
        <div className={styles.skuDisplay}>
          <span className={styles.skuLabel}>SKU:</span>
          <code className={styles.skuCode}>{selectedVariant.code}</code>
          <button
            className={styles.copyButton}
            onClick={handleCopySku}
            title="Copy SKU"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        
        {selectedVariant.price && (
          <div className={styles.priceDisplay}>
            <span className={styles.label}>Price:</span>
            <span className={styles.value}>
              {selectedVariant.price.formattedValue ||
                `$${selectedVariant.price.value}`}
            </span>
          </div>
        )}
        
        {quoteFormUrl && (
          <button
            className={styles.quoteButton}
            onClick={handleQuoteCta}
            aria-label={quoteCtaLabel}
          >
            {quoteCtaLabel}
          </button>
        )}
      </div>
    </div>
  );
}
```

### 6.7 Collapse Toggle Component

**File**: `src/components/content/ProductConfigurator/ProductConfiguratorCollapseToggle.tsx`

```typescript
import React from "react";
import styles from "./productConfigurator.module.scss";

interface Props {
  isCollapsed: boolean;
  onToggle: () => void;
}

export default function ProductConfiguratorCollapseToggle({
  isCollapsed,
  onToggle,
}: Props) {
  // Hidden on mobile, visible on desktop
  return (
    <button
      className={`${styles.collapseToggle} ${
        isCollapsed ? styles.expanded : ""
      }`}
      onClick={onToggle}
      aria-label={
        isCollapsed
          ? "Expand configurator panel"
          : "Collapse configurator panel"
      }
      aria-pressed={!isCollapsed}
    >
      <span className={styles.icon}>{isCollapsed ? "▶" : "◀"}</span>
    </button>
  );
}
```

---

## 7. SCSS Styles

**File**: `src/components/content/ProductConfigurator/productConfigurator.module.scss`

```scss
@use "src/sass/abstracts" as *;

.container {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100%;
  width: 100%;
  background-color: #fff;
  border-left: 1px solid #ddd;
  transition: width 0.35s ease;
  
  &.collapsed {
    width: 0;
    overflow: hidden;
  }
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #ddd;
  
  .headerTitle {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0;
  }
  
  .resetButton {
    padding: 0.5rem 1rem;
    background: none;
    border: 1px solid #ccc;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s ease;
    
    &:hover {
      background-color: #f5f5f5;
      border-color: #999;
    }
  }
}

.accordion {
  flex: 1;
  overflow-y: auto;
}

.section {
  border-bottom: 1px solid #eee;
  
  .sectionHeader {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
    padding: 1rem;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.2s ease;
    
    &:hover {
      background-color: #f9f9f9;
    }
  }
  
  .stepIndicator {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 32px;
    border-radius: 50%;
    background-color: #f0f0f0;
    font-weight: 600;
    font-size: 0.875rem;
    flex-shrink: 0;
  }
  
  &.state-done .stepIndicator {
    background-color: #4caf50;
    color: white;
  }
  
  &.state-active .stepIndicator {
    background-color: #2196f3;
    color: white;
  }
  
  .categoryName {
    flex: 1;
    font-weight: 500;
    color: #333;
  }
  
  .selectedValue {
    font-size: 0.875rem;
    color: #666;
    margin: 0 0.5rem;
  }
  
  .chevron {
    font-size: 0.75rem;
    color: #999;
  }
  
  .sectionBody {
    padding: 0 1rem 1rem 4.5rem;
    animation: expandDown 0.28s ease;
    max-height: 800px;
    overflow: hidden;
  }
}

@keyframes expandDown {
  from {
    max-height: 0;
    opacity: 0;
  }
  to {
    max-height: 800px;
    opacity: 1;
  }
}

.optionsList {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.optionRow {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  
  &:hover {
    background-color: #f5f5f5;
  }
  
  &.checked {
    background-color: #e3f2fd;
  }
  
  .radioInput {
    appearance: none;
    width: 0;
    height: 0;
    margin: 0;
    padding: 0;
  }
  
  .customRadio {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    width: 20px;
    height: 20px;
    border: 2px solid #ccc;
    border-radius: 50%;
    flex-shrink: 0;
  }
  
  &.checked .customRadio {
    border-color: #2196f3;
    background-color: #2196f3;
    
    &::after {
      content: "✓";
      color: white;
      font-size: 0.75rem;
    }
  }
  
  .optionLabel {
    font-size: 0.9375rem;
    color: #333;
  }
}

.emptyState {
  padding: 1rem;
  font-size: 0.875rem;
  color: #999;
  font-style: italic;
  text-align: center;
}

.summary {
  padding: 1rem;
  border-top: 1px solid #ddd;
  background-color: #fafafa;
  
  .progressBar {
    width: 100%;
    height: 4px;
    background-color: #e0e0e0;
    border-radius: 2px;
    overflow: hidden;
  }
  
  .progress {
    height: 100%;
    background-color: #2196f3;
    transition: width 0.3s ease;
  }
  
  .progressText {
    margin: 0.5rem 0 0 0;
    font-size: 0.8125rem;
    color: #666;
  }
  
  .completedContainer {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  
  .completedTitle {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }
  
  .skuDisplay {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background-color: white;
    border: 1px solid #ddd;
    border-radius: 4px;
    
    .skuLabel {
      font-size: 0.8125rem;
      font-weight: 500;
      color: #666;
    }
    
    .skuCode {
      flex: 1;
      font-family: monospace;
      font-size: 0.875rem;
      word-break: break-all;
    }
    
    .copyButton {
      padding: 0.4rem 0.75rem;
      background-color: white;
      border: 1px solid #ccc;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.75rem;
      white-space: nowrap;
      transition: all 0.2s ease;
      
      &:hover {
        border-color: #999;
        background-color: #f5f5f5;
      }
    }
  }
  
  .priceDisplay {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    
    .label {
      font-size: 0.875rem;
      font-weight: 500;
      color: #666;
    }
    
    .value {
      font-size: 1rem;
      font-weight: 600;
      color: #333;
    }
  }
  
  .quoteButton {
    padding: 0.75rem 1rem;
    background-color: #2196f3;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
    transition: background-color 0.2s ease;
    
    &:hover {
      background-color: #1976d2;
    }
  }
}

.collapseToggle {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  padding: 0.5rem;
  background-color: white;
  border: 1px solid #ddd;
  border-right: none;
  border-radius: 4px 0 0 4px;
  cursor: pointer;
  font-size: 0.75rem;
  color: #666;
  transition: all 0.2s ease;
  z-index: 10;
  
  &:hover {
    background-color: #f5f5f5;
    border-color: #999;
  }
  
  @media (max-width: $bp-lg) {
    display: none;
  }
}

.loadingState,
.errorState {
  padding: 2rem;
  text-align: center;
  color: #666;
  font-size: 0.9375rem;
}

.errorState {
  color: #d32f2f;
}
```

---

## 8. Sitecore Wrapper Component

**File**: `src/sitecore/PageContent/ProductConfigurator.tsx`

```typescript
import { ComponentParams, ComponentRendering, Field } from "@sitecore-content-sdk/nextjs";
import ProductConfiguratorComponent from "@/components/content/ProductConfigurator/ProductConfigurator";
import InfoMessageWrapper from "@/components/content/InfoMessageWrapper/InfoMessageWrapper";
import useIsEditing from "@/hooks/useIsEditing";

interface ProductConfiguratorFields {
  Title?: Field<string>;
  ProductCode?: Field<string>;
  QuoteFormUrl?: Field<string>;
  ResetButtonLabel?: Field<string>;
  HeaderTitle?: Field<string>;
  QuoteCtaLabel?: Field<string>;
}

export type ProductConfiguratorProps = {
  rendering: ComponentRendering;
  params: ComponentParams;
  fields: ProductConfiguratorFields;
};

export default function ProductConfigurator(
  props: ProductConfiguratorProps
): JSX.Element {
  const isPageEditing = useIsEditing();
  
  if (isPageEditing) {
    return (
      <InfoMessageWrapper
        message="Product Configurator component requires product context. This component displays variant selection options for a product detail page."
        isEdit={true}
      />
    );
  }
  
  const productCode = props.fields?.ProductCode?.value;
  const productName = props.fields?.Title?.value || "Product";
  
  if (!productCode) {
    return (
      <InfoMessageWrapper
        message="Product Configurator: Product code not configured"
        isEdit={false}
      />
    );
  }
  
  return (
    <ProductConfiguratorComponent
      model={{
        categories: [],
        variants: [],
      }}
      productCode={productCode}
      productName={productName}
      productUrl={`/products/${productCode}`}
      labels={{
        headerTitle: props.fields?.HeaderTitle?.value || "Configure Your Product",
        resetButtonLabel: props.fields?.ResetButtonLabel?.value || "Reset",
        quoteCtaLabel: props.fields?.QuoteCtaLabel?.value || "Request a Quote",
      }}
      quoteFormUrl={props.fields?.QuoteFormUrl?.value}
    />
  );
}
```

---

## 9. Quote Form Helper

**File**: `src/lib/sitecoreQueries/ProductConfigurator/quoteForm.ts`

```typescript
import { QuoteFormPayload, ProductConfiguratorModel, ConfiguratorVariant } from "./types";

/**
 * Build normalized quote payload from configurator state.
 */
export function buildQuoteFormPayload(
  model: ProductConfiguratorModel,
  selections: Record<string, string>,
  selectedVariant: ConfiguratorVariant,
  product: { code: string; name: string; url: string }
): QuoteFormPayload {
  return {
    skuId: selectedVariant.code,
    productCode: product.code,
    productName: product.name,
    productUrl: new URL(selectedVariant.url, product.url).toString(),
    selectedOptions: model.categories
      .filter(cat => selections[cat.qualifier])
      .map(cat => ({
        qualifier: cat.qualifier,
        categoryName: cat.name,
        value: selections[cat.qualifier],
      })),
  };
}

/**
 * Open third-party quote form with pre-filled configurator data.
 * 
 * Strategies (choose based on vendor capability):
 * 1. Query-string prefill: append params to URL
 * 2. POST bridge: submit to Next.js route that proxies to vendor
 * 3. Script API: call vendor-provided window method
 */
export function openQuoteForm(
  payload: QuoteFormPayload,
  quoteFormUrl: string
): void {
  try {
    // Strategy 1: Query-string prefill (if supported by vendor)
    const params = new URLSearchParams({
      skuId: payload.skuId,
      productCode: payload.productCode,
      productName: payload.productName,
      productUrl: payload.productUrl,
      selectedOptions: JSON.stringify(payload.selectedOptions),
    });
    
    const url = `${quoteFormUrl}?${params.toString()}`;
    window.open(url, "_blank", "noopener,noreferrer");
    
    // Emit analytics event
    if (window.gtag) {
      window.gtag("event", "quote_form_opened", {
        sku: payload.skuId,
        productCode: payload.productCode,
      });
    }
  } catch (error) {
    console.error("Failed to open quote form:", error);
    
    // Fallback: show notification
    alert("Unable to open quote form. Please try again.");
  }
}
```

---

## 10. Environment Variables

Required in `.env.local` or deployment:

```bash
# Commerce API endpoint
NEXT_PUBLIC_COMMERCE_API_URL=https://api.commerce.example.com

# Quote form endpoint (if needed)
NEXT_PUBLIC_QUOTE_FORM_URL=https://quotes.example.com/form
```

---

## 11. Testing Considerations

### Unit Tests

- **Mapper functions**: Test cascading filter, variant resolution, downstream clear logic
- **Hook logic**: Test state transitions, API call handling
- **Utilities**: Test payload building, quote form preparation

### Integration Tests

- **API route**: Test query validation, error handling, cache behavior
- **Component flow**: Test selection, reset, section toggle, quote CTA

### E2E Tests

- **Full user journey**: Load product → select options → resolve variant → open quote form
- **Accessibility**: Keyboard navigation, screen reader announcements

---

## 12. Performance Considerations

1. **Caching**: Leverage Vercel cache for Commerce API calls (1-hour TTL).
2. **Memoization**: Use `useMemo` in hook for `getAvailableOptions` if variant count is large (>1000).
3. **Code-splitting**: Consider lazy-loading summary component if bundle size increases.
4. **Image optimization**: Avoid image rendering in option rows; use icons if needed.

---

## 13. Accessibility Checklist

- ✓ Keyboard navigation: Tab through sections, Enter/Space to select, Arrow keys within radio group
- ✓ ARIA labels and roles: `aria-expanded`, `aria-controls`, `role="region"`
- ✓ Form semantics: Semantic `<input type="radio">` + `<label>`
- ✓ Color contrast: Ensure step indicator and selected states meet WCAG AA
- ✓ Focus management: Focus trap in expanded section
- ✓ Screen reader testing: Verify announcements with NVDA, JAWS

---

## 14. Deployment Checklist

- [ ] Feature templates and rendering registered in Sitecore authoring
- [ ] `.sitecore/component-map.ts` includes `ProductConfigurator`
- [ ] `ProductConfigurator.module.json` added to `authoring/items/`
- [ ] Environment variables configured
- [ ] Cache tags documented for on-demand revalidation
- [ ] Datasource locations and default values set
- [ ] Edit-mode fallback messaging tested
- [ ] Keyboard and screen reader testing completed
