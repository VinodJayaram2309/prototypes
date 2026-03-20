/**
 * Product Configurator — Data Model & Mapper
 *
 * Transforms raw API product data (variantOptions + variantMatrix)
 * into a clean ProductConfiguratorModel for a cascading selection UI.
 *
 * ─── Output Model Shape ───────────────────────────────────────────────────────
 *
 * ProductConfiguratorModel {
 *   categories : ConfiguratorCategory[]   ordered selection dimensions
 *   variants   : ConfiguratorVariant[]    every valid SKU combination
 * }
 *
 * ConfiguratorCategory {
 *   name      : string                    "Torque Range"
 *   qualifier : string                    "torque-range"  ← key used in variant.selections
 *   order     : number                    0-based position in selection flow
 *   options   : ConfiguratorOptionValue[] sorted by sequence
 * }
 *
 * ConfiguratorOptionValue {
 *   label    : string   "United States"
 *   value    : string   same — used as the key in selections map
 *   sequence : number   display order within the category
 * }
 *
 * ConfiguratorVariant {
 *   code       : string               SKU code (send this to cart / quote)
 *   url        : string
 *   stock      : object
 *   selections : Record<string,string>  qualifier → value
 *                e.g. { "torque-range": "HA", "suspension-options": "Magnetic Coupling with Ball Bearing", "cord-type": "United States" }
 * }
 *
 * ─── Source notes ─────────────────────────────────────────────────────────────
 *
 *  variantOptions  — source of truth for all valid SKU combinations and qualifier keys
 *  variantMatrix   — used only to extract:
 *                    (a) category ORDER   (depth of first root→leaf path)
 *                    (b) option SEQUENCE  (variantValueCategory.sequence per node)
 */

// ─── mapToConfiguratorModel ───────────────────────────────────────────────────

/**
 * @param {Array} variantOptions - product.variantOptions from the API response
 * @param {Array} variantMatrix  - product.variantMatrix from the API response
 * @returns {ProductConfiguratorModel}
 */
function mapToConfiguratorModel(variantOptions, variantMatrix) {

  // ── Step 1: Extract category ORDER from the first root-to-leaf path ──────────
  // The first top-level node in variantMatrix is at depth 0 (first category to select),
  // its first child is depth 1, and so on.
  const categoryOrderMap = new Map(); // categoryName → depth

  function walkForOrder(node, depth) {
    const catName = node.parentVariantCategory.name;
    if (!categoryOrderMap.has(catName)) {
      categoryOrderMap.set(catName, depth);
    }
    if (node.elements.length > 0) {
      walkForOrder(node.elements[0], depth + 1); // follow only first child — one canonical path
    }
  }

  if (variantMatrix.length > 0) {
    walkForOrder(variantMatrix[0], 0);
  }

  // ── Step 2: Extract option value SEQUENCES from the full variantMatrix tree ──
  // variantMatrix nodes carry variantValueCategory.sequence (display order) which
  // is absent from variantOptions. Collect them all.
  // sequenceMap: categoryName → Map<optionValue, sequence>
  const sequenceMap = new Map();

  function walkForSequences(node) {
    const catName = node.parentVariantCategory.name;
    const optVal  = node.variantValueCategory.name;
    const seq     = node.variantValueCategory.sequence;

    if (!sequenceMap.has(catName)) {
      sequenceMap.set(catName, new Map());
    }
    sequenceMap.get(catName).set(optVal, seq);

    for (const child of node.elements) {
      walkForSequences(child);
    }
  }

  for (const rootNode of variantMatrix) {
    walkForSequences(rootNode);
  }

  // ── Step 3: Build categories — qualifiers and all possible values come from variantOptions ─
  // variantMatrix nodes do NOT carry qualifier keys (only human-readable name), so
  // variantOptions is the only reliable source for the machine key (e.g. "cord-type").
  const categoryByQualifier = new Map();

  for (const variant of variantOptions) {
    for (const q of variant.variantOptionQualifiers) {
      if (!q.qualifier) continue; // skip image-only entries that appear in matrix nodes

      if (!categoryByQualifier.has(q.qualifier)) {
        const order = categoryOrderMap.has(q.name)
          ? categoryOrderMap.get(q.name)
          : categoryByQualifier.size; // fallback: append at end if not found in matrix
        categoryByQualifier.set(q.qualifier, {
          name:      q.name,
          qualifier: q.qualifier,
          order,
          optionSet: new Map(), // value → sequence
        });
      }

      const cat = categoryByQualifier.get(q.qualifier);
      if (!cat.optionSet.has(q.value)) {
        const seqMap = sequenceMap.get(q.name);
        const seq    = (seqMap && seqMap.has(q.value)) ? seqMap.get(q.value) : cat.optionSet.size + 1;
        cat.optionSet.set(q.value, seq);
      }
    }
  }

  const categories = Array.from(categoryByQualifier.values())
    .sort((a, b) => a.order - b.order)
    .map(cat => ({
      name:      cat.name,
      qualifier: cat.qualifier,
      order:     cat.order,
      options:   Array.from(cat.optionSet.entries())
                   .map(([value, sequence]) => ({ label: value, value, sequence }))
                   .sort((a, b) => a.sequence - b.sequence),
    }));

  // ── Step 4: Flatten all variantOptions into ConfiguratorVariant ──────────────
  const variants = variantOptions.map(opt => {
    const selections = {};
    for (const q of opt.variantOptionQualifiers) {
      if (q.qualifier && q.value) {
        selections[q.qualifier] = q.value;
      }
    }
    return {
      code:       opt.code,
      url:        opt.url,
      stock:      opt.stock,
      selections,
    };
  });

  console.log('Mapped ProductConfiguratorModel:', { categories, variants });
  return { categories, variants };
}

// ─── getAvailableOptions ──────────────────────────────────────────────────────

/**
 * Given a partial selection, returns the valid option values for every
 * category not yet selected. Drive all cascading dropdown logic with this.
 *
 * Algorithm: filter variants to those matching ALL current selections,
 * then collect remaining values for each un-selected dimension.
 *
 * @param {ProductConfiguratorModel} model
 * @param {Record<string,string>}    currentSelections  qualifier → value (only selected dims)
 * @returns {Record<string,string[]>}                   qualifier → valid values (sequence order)
 */
function getAvailableOptions(model, currentSelections) {
  // Keep only variants that satisfy every already-made selection
  console.log('Filtering variants with current selections:', currentSelections, model);
  const matchingVariants = model.variants.filter(variant =>
    Object.entries(currentSelections).every(
      ([qualifier, value]) => variant.selections[qualifier] === value
    )
  );

  const available = {};

  for (const category of model.categories) {
    if (currentSelections[category.qualifier] !== undefined) continue; // already selected — skip

    const validValues = new Set(
      matchingVariants.map(v => v.selections[category.qualifier]).filter(Boolean)
    );

    // Return values in their defined sequence order (not arbitrary Set order)
    available[category.qualifier] = category.options
      .map(o => o.value)
      .filter(v => validValues.has(v));
  }

  console.log('Available options for next selection step:', available);
  return available;
}

// ─── getSelectedVariant ───────────────────────────────────────────────────────

/**
 * Returns the single matching variant (SKU) once every category has a selection.
 * Returns null when the configuration is incomplete or no match is found.
 *
 * @param {ProductConfiguratorModel} model
 * @param {Record<string,string>}    currentSelections  must include ALL category qualifiers
 * @returns {ConfiguratorVariant|null}
 */
function getSelectedVariant(model, currentSelections) {
  const allQualifiers = model.categories.map(c => c.qualifier);

  // Guard: not all categories selected yet
  if (!allQualifiers.every(q => currentSelections[q])) {
    return null;
  }

  return model.variants.find(variant =>
    allQualifiers.every(q => variant.selections[q] === currentSelections[q])
  ) || null;
}
