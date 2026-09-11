# onespec

> One JSON Schema generating client, server and database validation - with property-based tests proving all three agree.

`COMPACT` · **Full Stack Engineering** · Intermediate · ~4-5 days · Fintech onboarding

**Primary language:** TypeScript
**Tags:** `json-schema`, `codegen`, `property-testing`, `postgres`, `validation`

---

## The problem

A field is optional in the UI, required in the API, and NOT NULL in the database. Users hit a cryptic 500 on submit. The bug reaches production because the three definitions were written by three people at three different times, and nothing in the build could have noticed they disagreed.

## ⭐ The differentiator

A single JSON Schema generates the client validator, the server validator **and the PostgreSQL check constraints**, with **property-based tests proving parity**: the suite generates random inputs and asserts all three layers agree on accept/reject for every one. A generic project writes the schema once, hand-mirrors it into the other two layers, and then has no mechanism whatsoever for detecting divergence.

This is the sentence to lead with when someone asks you to walk through the
project. Everything else in this repo exists to make it true and to prove it.

## Data

Self-contained. Fixture schemas model realistic KYC forms - conditional fields, cross-field rules, IBAN and ISO-format constraints - which are exactly the cases where hand-mirrored validators diverge first.

> No paid API key is required to run or demo this project. Where a paid
> service would add value it is wired as an optional enhancement behind an
> interface with an offline mock as the default implementation.

## Stack

- TypeScript, JSON Schema + Ajv
- PostgreSQL (generated check constraints)
- fast-check for property-based testing
- Vitest

## Core capabilities

- Schema compiles to TypeScript types, a client validator, a server validator and migration SQL
- Conditional and cross-field rules that survive all three targets
- Parity test generator producing adversarial inputs per schema
- Drift detector failing CI when a hand-edit breaks parity
- Accessible form renderer driven by the same schema

## Repository layout

```
src/compile/
src/targets/
schemas/
test/parity/
```

## Build plan

1. Pick the hard fixture schema first (conditional + cross-field). Easy schemas hide the whole problem.
2. Emit all three targets, then write the parity property test.
3. Add the mutation test that deliberately breaks a generated artefact.

## Testing strategy

10,000 generated inputs per schema asserting **three-way agreement** on accept/reject. Plus a mutation test: deliberately edit the generated SQL and confirm CI catches the drift - proving the parity check has teeth rather than testing the generator against itself.

Tests assert **correctness**, not merely that the code runs. A green suite on
this repo is a claim about behaviour under adversarial conditions; treat any
test that would pass against a deliberately broken implementation as a bug in
the test.

## Measurable outcome

> 30,000 parity assertions pass on every build, and a deliberately introduced divergence is caught in CI rather than by a user hitting a 500.

State it in these terms — business units, not technical ones — in your CV
bullet and in the first thirty seconds of describing the project.

## Interview questions this project answers

- **Where should validation live?**
- **How do you test that two implementations agree without writing the same bug twice?**

## What this deliberately is *not*

- Not a form builder. The generated renderer is a demonstration that the schema is sufficient, not a product.


## Run it now

```bash
npm test        # runs the suite; no install step needed
npm run demo    # the 60-second artefact
```

Requires Node 22.6+ (24 recommended). TypeScript runs natively via
type stripping - there is no build step and no `node_modules`.

## Getting started

```bash
git clone <your-fork-url> onespec
cd onespec
docker compose up -d postgres
npm install
npm run compile               # schema -> types, validators, SQL
npm run db:migrate
npm run test:parity           # 30k three-way assertions
```

Docker is supported but optional — every path above works on a plain
Windows/macOS/Linux laptop without a cloud account.

## Definition of done

- [ ] The differentiator above is implemented, and a test proves it
- [ ] The measurable outcome is produced by a command anyone can run
- [ ] `README` explains the one decision a generic version gets wrong
- [ ] CI runs the full suite on every push and is green on `main`
- [ ] A recruiter can see the headline artefact in under 60 seconds

## Licence

MIT — see [LICENSE](LICENSE).
