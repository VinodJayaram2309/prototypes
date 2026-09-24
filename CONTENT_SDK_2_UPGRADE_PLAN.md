# Sitecore Content SDK 2.x and Next.js 16 Upgrade Plan

## Purpose

This document plans the upgrade of the AMETEK XMC rendering application from Sitecore Content SDK 1.x to 2.x and the associated Next.js upgrade.

This is a planning document only. It does not authorize dependency or application changes.

The application will continue to use the **Next.js Pages Router**. Moving to the App Router is explicitly out of scope.

Planning baseline: **September 15, 2026**. Recheck all package versions and release notes immediately before implementation because the Content SDK packages are released independently.

## Executive Recommendation

Use a controlled in-place upgrade, with a newly generated Content SDK 2.x **Pages Router** application as the reference implementation.

Do not combine this work with an App Router migration, a component redesign, or an immediate Turbopack migration. Upgrade the runtime and framework contract first, preserve existing behavior, and modernize optional areas only after production parity is demonstrated.

The recommended sequence is:

1. Capture a reproducible 1.x baseline and representative page inventory.
2. Move every build and runtime environment to Node.js 24.
3. Generate a clean 2.x Pages Router reference app and compare its package, config, route, proxy/middleware, editing, and code-generation files with this repository.
4. Upgrade the coordinated dependency set: Content SDK, CLI, Next.js, React, React DOM, types, and framework-adjacent packages.
5. Keep Webpack for the first production-capable build while the custom loader/configuration is still required.
6. Adapt the small number of central Sitecore integration files before addressing component-level type errors.
7. Validate delivery, editing, multisite, localization, personalization, redirects, ISR, APIs, images, FEAAS/BYOC, and component rendering.
8. Release behind normal preview/staging gates with a tested rollback artifact.

## Confirmed Current State

| Area | Current repository state |
| --- | --- |
| Content SDK runtime | `@sitecore-content-sdk/nextjs ~1.1.0` |
| Content SDK CLI | `@sitecore-content-sdk/cli ~1.1.0` |
| Next.js | `15.3.8` |
| React / React DOM | `~19.1.4` |
| TypeScript | `~5.8.3` |
| Local Node.js observed during planning | `22.19.0` |
| Azure Pipelines Node.js | `20.x` |
| Package manager | pnpm with `pnpm-lock.yaml` |
| Routing | Pages Router, centered on `src/pages/[[...path]].tsx` |
| Rendering | SSG/ISR with blocking fallback; static path generation is currently disabled |
| Sitecore capabilities | Editing/preview, Design Library, multisite, localization, personalization, redirects, FEAAS/BYOC, generated component/import maps |
| Build customization | Custom Webpack component-props loader, SVGR, aliases, server externals, Sass alias importer |

The repository contains approximately 167 source files importing from `@sitecore-content-sdk/nextjs` or one of its subpaths. Most are field types and rendering components. The highest behavioral risk is concentrated in a much smaller set of central integration files listed below.

## Proposed Target Matrix

The versions below were verified from npm metadata on September 15, 2026. Pin exact versions in the upgrade branch and refresh the matrix before starting.

| Package/runtime | Planning target | Confirmed constraint or reason |
| --- | --- | --- |
| Node.js | Latest supported Node 24 LTS patch | Content SDK Next.js `2.4.0` and CLI `2.3.0` declare Node `>=24` |
| `@sitecore-content-sdk/nextjs` | `2.4.0` | Current 2.x Next.js package at planning time |
| `@sitecore-content-sdk/cli` | `2.3.0` | Current CLI at planning time; packages use independent versioning |
| Next.js | Latest reviewed `16.2.x` or later compatible 16.x patch | SDK `2.4.0` declares `next ^16.2.0` |
| React | Compatible `19.2.x` | SDK `2.4.0` declares `react ^19.2.1` |
| React DOM | Compatible `19.2.x` | SDK `2.4.0` declares `react-dom ^19.2.1` |
| TypeScript | Keep `5.8.x` initially unless the lockfile requires a later tested version | SDK requires `^5.4.0`; current `5.8.3` already satisfies it |
| `@types/react`, `@types/react-dom` | Match the selected React version | Prevent false compile failures from mismatched React types |
| `eslint-config-next`, `@next/*` packages | Match the selected Next.js patch | Avoid mixed framework internals |
| Sitecore peer packages | Versions required by the selected SDK package | For SDK `2.4.0`, peers include Content SDK events `^2.1.2`, personalize `^2.1.0`, and analytics-core `^2.1.2` |

**Important:** starting with Content SDK 2.2, packages are versioned independently. Do not force every `@sitecore-content-sdk/*` package to the same numeric version. Use the selected package's peer/dependency metadata and the official release notes.

## Scope

### In scope

- Node.js 24 alignment in local development, CI, containers, XM Cloud/Vercel settings, and documentation.
- Content SDK 1.1 to a reviewed Content SDK 2.x release.
- Next.js 15.3 to the compatible Next.js 16 release.
- React and React DOM alignment required by the SDK.
- Pages Router preservation.
- Sitecore routing, data fetching, editing, generated files, middleware/proxy behavior, and component compatibility.
- Build, lint, Storybook, integration, visual, accessibility, and deployment validation.
- Lockfile regeneration and transitive dependency/security review.

### Out of scope

- App Router migration.
- React Server Component adoption.
- Cache Components/PPR adoption.
- Broad rendering-component rewrites or visual redesign.
- A simultaneous Sitecore Search SDK migration unless peer conflicts make it necessary.
- Turbopack adoption in the first release unless the Content SDK 2.x reference template proves all custom build behavior is supported.

## Most Affected Areas

### **HIGH IMPACT 1: Node.js and deployment infrastructure**

Content SDK 2.4 requires Node 24, while the observed local runtime is Node 22 and Azure Pipelines explicitly selects Node 20.

Affected locations include:

- `dev-ops/azure-pipelines.yml`
- `dev-ops/azure-pipelines-pull-request.yml`
- `local-containers/docker/build/nodejs/Dockerfile` and the value supplied through `NODEJS_VERSION`
- XM Cloud build configuration and base images
- Vercel project runtime settings
- Developer workstations and any undocumented build agents

Required checks:

- Confirm every platform supports the selected Node 24 patch before package installation.
- Add or update a repository runtime declaration such as `.nvmrc`, `.node-version`, or `package.json#engines` during implementation.
- Pin a compatible pnpm version through Corepack or `packageManager` instead of globally installing an unspecified latest pnpm in CI.
- Verify native packages, especially `sharp`, under Node 24 on Windows and Linux hosts.

### **HIGH IMPACT 2: Next.js middleware to proxy transition**

The current `src/middleware.ts` composes Sitecore multisite, redirects, personalization, a default-locale extension, CSP, and an Edge Config redirect extension. Next.js 16 deprecates the `middleware.ts` convention in favor of `proxy.ts`; proxy runs on the Node.js runtime, while legacy middleware remains the path for Edge-runtime behavior.

This is not a blind file rename for this repository. The implementation spike must compare the Content SDK 2.x Pages Router starter and determine:

- Whether SDK 2.x exports proxy-specific APIs/subpaths or compatibility middleware APIs.
- Whether each custom class extending `MiddlewareBase` or `RedirectsMiddleware` remains source-compatible.
- Whether personalization, geo data, cookie site resolution, and request headers behave identically in the Node runtime.
- Whether the order remains `multisite -> redirects -> default locale -> personalization -> CSP`.
- Whether the matcher still excludes API, Next internals, health, Sitecore API, media, and root public files.
- Whether skipping Sitecore middleware when the Edge context ID is absent remains valid.

Do not accept a build-only result here. Exercise requests through every middleware branch and inspect response status, location, rewrite URL, cookies, CSP headers, and personalization headers.

### **HIGH IMPACT 3: Custom Webpack configuration**

Next.js 16 uses Turbopack by default. This project has a custom `webpack` function that:

- Applies the Content SDK `component-props-loader` to Sitecore components.
- Excludes Storybook stories from the Next build.
- Forces CommonJS externals for FEAAS/BYOC on the server.
- Prevents selected packages from entering client bundles.
- Applies `@svgr/webpack` to SVG files.

It also uses a legacy Sass importer through `sass-alias`.

For the first upgrade release, set the Next development/build scripts to use `--webpack` if required by Next 16 and the 2.x Pages Router starter. A later, separate spike may translate these behaviors to Turbopack after equivalent output is proven. The production build will fail in Next 16 if a custom Webpack configuration is detected while the default Turbopack build is used without an explicit decision.

### **HIGH IMPACT 4: Catch-all page and Sitecore client contract**

`src/pages/[[...path]].tsx` owns the core request flow:

- `extractPath(context)`
- `client.getPagePaths(...)`
- preview and Design Library detection
- `client.getPreview(...)`, `getPage(...)`, and `getDesignLibraryData(...)`
- dictionary loading
- component-props loading
- plugin execution
- ISR revalidation and 404 behavior

Compare this file line-by-line with the generated 2.x Pages Router starter. Preserve Pages Router APIs (`getStaticPaths` and `getStaticProps`) and existing business plugins, but adopt any changed SDK page, preview, locale, or component-data contract.

Validate normal delivery, preview, editing, Design Library, non-default locales, Unicode routes, root routes, missing routes, and ISR regeneration.

### **HIGH IMPACT 5: SDK configuration, CLI, and generated artifacts**

Review these files as a unit:

- `sitecore.config.ts`
- `sitecore.cli.config.ts`
- `src/lib/sitecore-client.ts`
- `.sitecore/component-map.ts`
- `.sitecore/import-map.ts`
- `.sitecore/sites.json`
- `.sitecore/metadata.json`

Regenerate `.sitecore` output with the upgraded CLI. Do not manually preserve generated output if the new CLI changes its shape. Compare component names and import paths before committing because a syntactically valid map can still cause runtime “component not found” failures.

The current CLI runs metadata generation, site generation, file extraction, import-map writing, and component-map generation. Confirm each command and option against the 2.x starter, particularly exclusions under `src/sitecore/Utils`.

### **HIGH IMPACT 6: Editing, preview, Design Library, FEAAS, and BYOC**

Affected code includes:

- `src/pages/api/editing/config.ts`
- `src/pages/api/editing/render.ts`
- `src/pages/api/editing/feaas/render.ts`
- `src/pages/feaas/render.tsx`
- `src/byoc/index.tsx`
- `src/Scripts.tsx`
- `src/Layout.tsx`
- `src/Providers.tsx`

The editor must be tested against an actual non-production Sitecore environment. Mock-only validation cannot prove editor handshakes, preview data, editing secrets, component chrome, FEAAS rendering, or fast refresh.

### **MEDIUM-HIGH IMPACT 7: Component API and type imports**

Most SDK imports are common field/component APIs such as `Field`, `Text`, `RichText`, `Link`, `NextImage`, `Placeholder`, `useSitecore`, `withDatasourceCheck`, `ComponentRendering`, and `ComponentParams`. Compile errors will identify many changes, but runtime rendering still needs a representative component matrix.

Prioritize:

- Deep imports such as `@sitecore-content-sdk/nextjs/types/components/RichText`; replace with public exports if 2.x no longer exposes the path.
- `useSitecore` context shape and page mode checks.
- `NextImage` behavior under Next.js 16 image changes.
- Empty datasource behavior. Content SDK 2.4 treats `rendering.isContentResolved === false` as a missing datasource in `withDatasourceCheck`.
- Nested and dynamic placeholders.
- Rendering variants and generated component names.
- Components using `getComponentServerProps`, because the custom loader strips them from client bundles.

### **MEDIUM-HIGH IMPACT 8: Next.js 16 image behavior**

Next.js 16 changes image defaults and restrictions. This repository has a substantial custom `images` configuration and many `NextImage` consumers.

Review and test:

- Sitecore media, Content Hub, FEAAS, Vercel, and local XM Cloud image hosts.
- Local image URLs containing query strings, which now require `images.localPatterns`.
- Optimized local/private-host images; local IP optimization is blocked by default.
- Redirecting image URLs; the default maximum is now three redirects.
- Requested quality values; the default allowed quality list is now `[75]`.
- Cache behavior; default minimum cache TTL is now four hours.
- Existing 16px and custom 640/1920 image sizes.
- SVG behavior with both `dangerouslyAllowSVG` and SVGR.

Do not enable `dangerouslyAllowLocalIP` broadly to make tests pass. Confirm the network requirement and SSRF exposure first.

### **MEDIUM IMPACT 9: Cache invalidation and webhook behavior**

`src/pages/api/admin/revalidateCacheTags/index.ts` calls `revalidateTag(tag)` with one argument. Next.js 16 deprecates this signature in favor of a second cache-life profile, although Pages Router behavior and the project's `unstable_cache` wrapper must be validated before changing semantics.

Test:

- Item update/delete webhook invalidation.
- Path and tag invalidation.
- ISR expiry and on-demand regeneration.
- Cache key isolation by site, language, route, and query.
- Vercel and non-Vercel behavior.

Treat any cache semantic change as a separate reviewed change within the upgrade branch.

### **MEDIUM IMPACT 10: Storybook, tests, and framework-adjacent packages**

Review compatibility for Storybook's Next.js adapter, Vercel analytics/speed insights, `next-localization`, `nextjs-progressbar`, SVG tooling, Sass tooling, and `@next/third-parties`.

The PR pipeline references `pnpm run test`, Cypress, and Storybook test commands that are not visible in the current `package.json` script list/dependencies. Before using the pipeline as an upgrade gate, reconcile whether these are injected elsewhere, stale, or currently failing. Do not classify unrelated pre-existing failures as upgrade regressions.

## Detailed Implementation Plan

### Phase 0: Baseline and decision record

1. Create a dedicated upgrade branch and prevent unrelated feature changes from entering it.
2. Record the exact production dependency tree, Node/pnpm versions, environment variables by name, and deployment runtime settings. Do not record secrets.
3. Run and archive baseline results for install, generated maps, lint, production build, Storybook build, existing tests, and bundle size.
4. Capture screenshots and HTTP behavior for a representative route matrix.
5. Record current Core Web Vitals, key API response times, redirect behavior, and cache headers from a production-like environment.
6. Select and pin the exact Content SDK/Next.js/React versions only after reviewing releases published after this document's date.
7. Confirm that the chosen Content SDK release still includes a supported Pages Router template.

Exit gate: the current application can be rebuilt and its known failures are documented.

### Phase 1: Runtime and toolchain alignment

1. Update developer runtime declarations to Node 24.
2. Update every Azure `UseNode@1` task from Node 20 to the selected Node 24 patch/line.
3. Update local container build arguments/base images and verify Windows container support.
4. Configure Node 24 in Vercel and XM Cloud build/runtime settings.
5. Pin pnpm using Corepack/`packageManager`; validate the existing lockfile with that pnpm release.
6. Run the unchanged 1.x application on Node 24 where possible. This separates runtime failures from SDK failures.

Exit gate: baseline install/build/tests run on Node 24, or each 1.x incompatibility is explicitly recorded as requiring the coordinated dependency step.

### Phase 2: Create a 2.x Pages Router reference

1. Generate a temporary clean app with the exact selected `create-content-sdk-app` release and choose the Pages Router template.
2. Keep this app outside production source control or in a short-lived comparison folder.
3. Compare at minimum:
   - `package.json` and lockfile package families
   - `next.config.*`
   - `sitecore.config.ts`
   - `sitecore.cli.config.ts`
   - catch-all page, `_app`, `_document`, and error pages
   - proxy/middleware implementation and matcher
   - Sitecore client creation
   - editing and health endpoints
   - FEAAS/BYOC setup
   - generated `.sitecore` files
   - environment variable example and deployment files
4. Create a checklist of intentional differences. Preserve AMETEK customizations only when their purpose is understood.

Exit gate: every central integration file has a known 2.x reference equivalent or a documented project-specific reason not to have one.

### Phase 3: Upgrade the dependency set

1. Use pnpm for all dependency changes; do not mix npm lockfiles into the repository.
2. Upgrade the selected versions of Content SDK Next.js and CLI, Next.js, React, React DOM, React types, `eslint-config-next`, and matching `@next/*` packages together.
3. Add or align the Sitecore peer packages required by npm metadata. Do not confuse `@sitecore-content-sdk/events` with the currently used `@sitecore-cloudsdk/events`; verify whether both are required and what owns browser event initialization.
4. Update framework-adjacent packages only where their peer ranges require it.
5. Regenerate `pnpm-lock.yaml` using the pinned pnpm version.
6. Review peer warnings individually; do not use broad overrides to suppress incompatible peers.
7. Run a vulnerability/license review and inspect duplicate React, Next.js, GraphQL, and Sitecore package versions.

First validation: clean install followed by SDK code generation and TypeScript/Next production compilation.

### Phase 4: Make Next.js 16 behavior explicit

1. Run the official Next.js upgrade codemod in dry-run/print mode first and review its proposal.
2. Apply only relevant transformations. Pages Router stays in place.
3. Resolve middleware/proxy using the selected Content SDK starter as the authority; validate runtime changes rather than only accepting the codemod rename.
4. Retain Webpack explicitly for dev and production at first if custom configuration remains.
5. Update image configuration only for confirmed application requirements.
6. Verify ESLint flat-config compatibility. The project already invokes ESLint directly, so `next lint` removal should not require a script migration, but the Next.js ESLint package/config still needs alignment.
7. Search for removed/deprecated Next APIs, synchronous request APIs, runtime config, legacy images, and one-argument `revalidateTag` calls.
8. Keep Cache Components and React Compiler disabled unless separately approved and tested.

Exit gate: `next build --webpack` (if retained), lint, and type checking pass with no unexplained Next.js warnings.

### Phase 5: Adapt Content SDK integration code

1. Update SDK configuration against the 2.x reference and validate all environment variable names.
2. Update Sitecore client construction and GraphQL request client wrappers.
3. Adapt the catch-all Pages Router route while preserving ISR/fallback and plugin behavior.
4. Update proxy/middleware composition and all custom middleware subclasses.
5. Update editing, Design Library, preview, health, sitemap, robots, error-page, and FEAAS endpoints.
6. Update CLI tools/config and regenerate all `.sitecore` outputs.
7. Resolve removed exports and deep imports using public 2.x exports.
8. Address component type/API changes in groups: shared types/helpers first, shell/layout second, rendering wrappers third, leaf components last.
9. Rebuild Storybook mocks for any changed provider/context shape.

Exit gate: clean generation, lint, type check, Next build, and Storybook build pass.

### Phase 6: Functional and integration validation

Run the test matrix below in local connected mode and a deployed non-production environment. Compare results to the Phase 0 baseline.

Fix central contract issues before editing many components. A failure across unrelated renderings usually points to providers, generated maps, page props, SDK fields, image configuration, or editor mode rather than dozens of independent component defects.

### Phase 7: Performance, security, and release

1. Compare JS bundle size, image payloads, page data size, build duration, and Core Web Vitals with baseline.
2. Confirm secrets are server-only and no config change exposes Sitecore API keys, editing secrets, tokens, or context values unintentionally.
3. Validate CSP, cookies, redirects, image host restrictions, and cache invalidation.
4. Deploy to preview, then QA/staging, then production using immutable artifacts where possible.
5. Use a canary or limited-site rollout if the hosting model permits it.
6. Monitor 404/500 rates, middleware/proxy errors, editor failures, GraphQL errors, image optimizer errors, cache hit ratio, and Core Web Vitals.

Exit gate: agreed observation window passes with no material regression.

## Test Strategy

### Automated build gates

Run from a clean checkout with Node 24 and the pinned pnpm version:

```powershell
pnpm install --frozen-lockfile
pnpm run sitecore-tools:generate-map
pnpm run sitecore-tools:build
pnpm run lint
pnpm run next:build
pnpm run storybook:build
```

During implementation, update `next:build` to include `--webpack` if that is the approved bundler decision for Next.js 16. Add a dedicated `typecheck` script (`tsc --noEmit`) if the Next build does not provide a sufficiently isolated type-check gate.

Only run `pnpm run test` or Cypress commands after confirming those scripts/packages exist and have a valid baseline.

### Route and rendering matrix

Test at least one route for every row:

| Scenario | Assertions |
| --- | --- |
| Root route | Correct site, locale, status, canonical metadata, header/footer |
| Nested content route | Correct layout, fields, placeholders, links, images |
| Unknown route | Correct 404 status and custom not-found rendering |
| Error path | Custom 500/error behavior does not leak details |
| Non-default locale | Correct dictionary, content, URL, alternate links, no fallback to wrong language |
| Unicode route | Resolves and renders without encoding-related 404 |
| Multisite host | Correct site resolution for each representative hostname |
| Preview host/cookie | Correct preview site and unpublished content |
| ISR route | Cache headers and revalidation behavior match policy |
| Redirect source | Correct status, target, query preservation, locale, and no loop |
| Personalized page | Correct variant and stable fallback when personalization is unavailable |
| Secured page | Existing authentication/authorization behavior remains intact |

### Component matrix

Select pages that collectively exercise:

- Text, RichText (including math/token wrappers), Link, Image, file, date, and empty fields.
- Missing and unresolved datasources, including `withDatasourceCheck` behavior.
- Nested/dynamic placeholders and container components.
- Header, footer, navigation, breadcrumbs, and language selector.
- Search widgets and result cards.
- Forms/FormStack and gated download flows.
- FEAAS, BYOC, and Design Library components.
- Components with component-level server props.
- SVGs, Sitecore media, Content Hub images, responsive images, and image error states.
- Interactive carousels, tabs, accordions, maps, video, and modals.

Use visual regression screenshots at desktop and mobile widths for representative pages. Add keyboard navigation and automated accessibility checks for shell, navigation, forms, dialogs, and interactive components.

### Sitecore editing tests

Against a non-production Sitecore environment:

1. Open Pages and load a page in editing mode.
2. Verify editing chrome and field editing for text, rich text, links, and images.
3. Add, remove, reorder, and configure renderings.
4. Test empty fields and missing datasources.
5. Switch language and site.
6. Preview unpublished content and a scheduled/time-sensitive state if used.
7. Test Design Library preview and component variants.
8. Test FEAAS/BYOC rendering and styling.
9. Save, publish, and verify delivery plus cache invalidation.
10. Confirm editor fast refresh does not loop or lose state.

### Proxy/middleware tests

Automate request-level tests where practical:

- Hostname to site resolution.
- Preview cookie site resolution.
- Default locale and explicit locale paths.
- Sitecore redirects, Edge Config redirects, malformed redirect rules, query strings, and loop prevention.
- Personalization cookies/headers and fallback behavior.
- CSP headers in normal delivery and editing routes.
- Excluded paths: `/api`, `/_next`, `/healthz`, `/sitecore/api`, `/-`, and public root files.
- Operation without an Edge context ID for local-only mode.

### API and operational tests

- `/api/healthz`
- `/robots.txt` and localized variants if applicable
- Sitemap routes and large sitemap behavior
- `/llms.txt` and localized variants
- Editing config/render/FEAAS endpoints
- Error-page API
- Search and product APIs
- Email endpoint without sending unintended external mail
- Item update/delete webhooks
- Cache tag administration endpoint, including authorization and Next.js 16 semantics

### Non-functional gates

- No duplicate React runtime.
- No Sitecore build tools or Node-only modules in browser bundles.
- No meaningful increase in first-load JS or page-data size without approval.
- No regression in LCP, INP, CLS, accessibility, or SEO metadata on representative pages.
- No new high/critical dependency vulnerability without documented acceptance.
- Build and server logs contain no secrets or raw malicious request data.
- Windows local containers and the Linux/cloud deployment path both pass.

## Suggested Commit/PR Breakdown

Keep each step independently reviewable and validated:

1. Runtime declarations and Node 24 CI/container/hosting alignment.
2. Coordinated dependency and lockfile update.
3. Next.js 16 configuration, explicit Webpack decision, and proxy/middleware foundation.
4. Content SDK config, client, CLI, and generated artifacts.
5. Catch-all page, providers, editing/API routes, FEAAS/BYOC.
6. Shared SDK imports/types and component compatibility.
7. Tests, Storybook mocks, documentation, and deployment verification.

If repository policy requires one final PR, preserve these as separate commits so failures can be bisected and reviewed by ownership area.

## Rollback Plan

- Keep the last known-good production artifact and deployment configuration available.
- Do not publish irreversible Sitecore content/schema changes as part of this framework upgrade.
- Preserve the old Node/runtime settings long enough to redeploy the 1.x artifact.
- Ensure cache/schema changes remain backward compatible with the old application.
- Define rollback triggers before release: elevated 5xx/404 rate, editor outage, incorrect site/locale resolution, redirect loops, failed personalization, or material Core Web Vitals regression.
- Roll back the deployment as a unit. Do not attempt to run the 1.x SDK against the new dependency lockfile.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Node 24 unavailable on a build/runtime platform | Prove support in Phase 1 before dependency work |
| SDK packages incorrectly forced to one version | Use independent package release notes and npm peer metadata |
| Pages Router accidentally replaced | Generate/select the Pages Router reference and reject `src/app` migration changes |
| Proxy runtime changes personalization or multisite behavior | Request-level integration suite across hosts, locales, cookies, geo, and redirects |
| Turbopack bypasses custom loaders/config | Retain explicit Webpack scripts for the first release |
| Generated component map silently changes names | Diff generated maps and smoke-test every rendering family |
| Broad component compile failures lead to churn | Repair shared types/providers first and group errors by missing export |
| Editing works in delivery but fails in Pages | Mandatory live editing test suite in non-production Sitecore |
| Image security/default changes break media | Test every image source and configure only required patterns/qualities |
| Cache API change serves stale content | Webhook, tag, ISR, and multi-site/language cache tests |
| Stale CI tests give false confidence | Reconcile missing test/Cypress scripts and establish baseline before upgrade |

## Definition of Done

- Node 24 is explicitly configured and verified in all development, CI, container, and hosting environments.
- Exact reviewed versions are pinned and the pnpm lockfile is reproducible.
- The application remains on the Pages Router.
- SDK generation, lint, type checking, production build, Storybook build, and valid automated tests pass.
- Delivery and editing test matrices pass for representative sites, languages, routes, and components.
- Multisite, localization, personalization, redirects, CSP, FEAAS/BYOC, APIs, images, ISR, and cache invalidation are verified in a deployed environment.
- Performance, accessibility, SEO, security, and bundle comparisons have no unapproved material regression.
- Monitoring and rollback have been exercised or documented with named owners.
- The existing JSS-to-Content-SDK-1.x history remains in `CONTENT_SDK_MIGRATION.md`; this document is updated with final versions, deviations, and test evidence after completion.

## External References

Prefer official documentation and package metadata over undated examples. These links were reviewed during planning:

- [Sitecore Content SDK 2.x documentation](https://doc.sitecore.com/sai/en/developers/content-sdk/20/sitecore-content-sdk-for-sitecoreai.html)
- [Sitecore Content SDK 2.x prerequisites](https://doc.sitecore.com/sai/en/developers/content-sdk/20/prerequisites.html)
- [Sitecore Content SDK release notes and independent package versioning](https://doc.sitecore.com/sai/en/developers/content-sdk/20/release-notes.html)
- [Sitecore recommended migration approach](https://doc.sitecore.com/sai/en/developers/content-sdk/20/upgrade-jss-next-js-apps-to-content-sdk.html)
- [Sitecore Content SDK GitHub releases](https://github.com/Sitecore/content-sdk/releases)
- [Content SDK Next.js 2.4.0 release](https://github.com/Sitecore/content-sdk/releases/tag/%40sitecore-content-sdk%2Fnextjs%402.4.0)
- [Content SDK source and current starter templates](https://github.com/Sitecore/content-sdk)
- [Next.js 16 announcement/blog](https://nextjs.org/blog/next-16)
- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [Next.js codemods](https://nextjs.org/docs/pages/guides/upgrading/codemods)
- [Next.js Pages Router upgrade index](https://nextjs.org/docs/pages/guides/upgrading)

Before implementation, also run read-only metadata checks for the exact selected releases:

```powershell
npm view @sitecore-content-sdk/nextjs@<version> version engines peerDependencies --json
npm view @sitecore-content-sdk/cli@<version> version engines peerDependencies --json
npm view next@<version> version engines peerDependencies --json
```

## Implementation Checklist

- [ ] Freeze exact target versions after a fresh release-note review.
- [ ] Capture clean 1.x build/test/visual/performance baseline.
- [ ] Confirm Node 24 support in local, CI, containers, XM Cloud, and Vercel.
- [ ] Pin Node and pnpm versions in repository/tooling configuration.
- [ ] Generate and compare a clean 2.x Pages Router starter.
- [ ] Upgrade the coordinated dependency set and regenerate the lockfile.
- [ ] Make the Webpack/Turbopack choice explicit; default to Webpack for first release.
- [ ] Adapt middleware/proxy and custom middleware extensions.
- [ ] Adapt Sitecore config, client, catch-all route, providers, and editing APIs.
- [ ] Regenerate and diff `.sitecore` artifacts.
- [ ] Resolve public/deep SDK imports and shared component types.
- [ ] Validate image, cache, ISR, redirect, multisite, locale, and personalization behavior.
- [ ] Validate Sitecore Pages editing, preview, Design Library, FEAAS, and BYOC.
- [ ] Pass automated, visual, accessibility, performance, security, and deployment gates.
- [ ] Complete canary/staging observation and verify rollback readiness.
- [ ] Update this document with actual versions, owners, evidence, and approved deviations.