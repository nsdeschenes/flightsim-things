# Interface agent instructions

These rules apply to `packages/interface/` and its subdirectories.

- Use Base UI components whenever a suitable component exists. Prefer composing Base UI components over implementing equivalent interactions from scratch.
- Use TanStack Query (`@tanstack/react-query`) for data fetching and server state, including loading, error, caching, and mutation handling.
- Use StyleX (`@stylexjs/stylex`) for all styling, including styles applied to Base UI components.
