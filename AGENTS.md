# pi-poolside

Pi extension package for the Poolside inference API.

## Stack

- TypeScript (strict mode), pnpm, Biome, Changesets

## Scripts

- `pnpm typecheck` - Type check
- `pnpm lint` - Lint
- `pnpm format` - Format
- `pnpm check:lockfile` - Verify lockfile is in sync with package.json
- `pnpm changeset` - Create changeset for versioning

## Structure

```
extensions/
  provider/          # Provider extension (registers poolside provider)
    index.ts         # Entry point
    models.ts        # Model definitions and refresh parsing
```

## Extension API Patterns

- `pi.registerProvider(name, config)` - Register a custom LLM provider
- `refreshModels` on provider config - Refresh authenticated model catalog through Pi
