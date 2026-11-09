# Contributing

Ratchet is an MIT-licensed, unaudited Solana release candidate. Read README.md, AUDIT_SCOPE.md and
MAINNET_CHECKLIST.md before changing financial behavior. This repository does not imply mainnet deployment.

Use Node24 and pnpm10.33.0. Run pnpm install --frozen-lockfile, pnpm test, pnpm typecheck and pnpm build.
Changes to the contract or integer quote math also require the relevant local validator lifecycle proof;
see OPERATIONS.md for the pinned container build and matching-runtime command. Mainnet writes are not a
routine test step. Use the isolated deterministic test fixture, never production wallets.

Keep source and generated Vite wiring synchronized with node scripts/sync-lovable.mjs. Preserve overflow
checks, protected min-out, floor solvency, canonical external accounts and full-supply migration backing.
Do not introduce owner withdrawals, weaken the issuance cap, change production economics to cheap test
parameters or silently enable mainnet trading. Explain any protocol/account/IDL change and compatibility.

Never commit RPC authentication URLs, private keys, .env files or upload signers. The committed .env.example
files contain configuration examples only. Report security issues according to SECURITY.md.

Keep pull requests focused. Include the changed behavior, why it matters and relevant verification.
