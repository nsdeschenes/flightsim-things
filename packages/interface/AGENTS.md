# Interface agent instructions

These rules apply to `packages/interface/` and its subdirectories.

## Components

- Use Base UI components whenever a suitable component exists. Prefer composing Base UI components over implementing equivalent interactions from scratch.

## Forms

- Use TanStack Form (`@tanstack/react-form`) for UI form state and validation.
- Follow the [Base UI TanStack Form integration](https://base-ui.com/react/handbook/forms#tanstack-form). Use native `<form noValidate>` with `form.handleSubmit`, forward field name and invalid/dirty/touched metadata to `Field.Root`, and wire controlled values with `onValueChange` and `onBlur`.
- Render TanStack validation errors with `Field.Error match`. Keep server state and mutation lifecycles in TanStack Query.

## Data fetching

- Use TanStack Query (`@tanstack/react-query`) for data fetching and server state, including loading, error, caching, and mutation handling.
- Define reusable query and mutation configuration with `queryOptions` and `mutationOptions`.
- Call TanStack Query hooks such as `useQuery` and `useMutation` directly with those options. Do not wrap them in reusable data fetching or mutation hooks.

## State ownership

- Keep form drafts and UI state in the component or route that owns their lifetime.
- Request server data directly in consuming components with TanStack Query. Share query options and cache entries instead of copying query results into context.
- Do not introduce app-wide state contexts, global mutable stores, or aggregate app-state hooks. Framework providers such as QueryClientProvider are allowed.

## Styling

- Use StyleX (`@stylexjs/stylex`) for all styling, including styles applied to Base UI components.
