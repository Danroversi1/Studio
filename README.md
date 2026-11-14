# STUDIO

A cloud-hosted creative workspace for developing animated films: WRITE, DEVELOP, ANIMATE, EDIT, SCORE over one shared project. The director is the creative authority. Software may propose; only the director approves.

**Milestone 1:** a connected, AI-free workflow. Sign in → private project → story → characters and locations → artwork and references → revisions → explicit approval.

| Doc | |
|---|---|
| [docs/product-scope.md](docs/product-scope.md) | What's in milestone 1, and what's deferred |
| [docs/architecture.md](docs/architecture.md) | Architecture decisions |
| [docs/permissions.md](docs/permissions.md) | Permission matrix and enforcement |
| [docs/schema-review.md](docs/schema-review.md) | Verified review of the supplied 0001 schema |
| [docs/setup.md](docs/setup.md) | Local setup, migrations, verification, unverified integrations |

```
supabase/migrations/   baseline (supplied 0001, unchanged) + hardening
db/test/               auth shim for plain Postgres + security test suite
lib/                   data access, validation, storage adapters
app/, components/      Next.js 16 UI and route handlers
tests/unit/            node:test unit tests
```

Quick checks: `npm run test:unit` and `npm run test:db` (see setup.md).
