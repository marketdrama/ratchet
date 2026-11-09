# v4 audit handoff

This is a developer-prepared scope and evidence map, **not an independent audit report**. The complete
release input hashes are in release/manifest.json; canonical container/image/source hashes are in
release/isolated-build.json. No external auditor has reviewed or attested to this release.

## Contract and trust boundaries

Review onchain/programs/ratchet-curve/src/lib.rs and locked dependencies in onchain/Cargo.lock. The only
instructions are initialize, create, buy, sell, migrate_to_raydium, redeem_floor. Account layouts/IDL are
in lib/idl.json. Shared client math is lib/protocol.ts; lib/ratchet.ts is the reference simulation.

ADMIN authorizes one-time Global initialization. There is no parameter update, tax withdrawal, release,
internal swap or coin-account closure instruction. Runtime upgrade authority remains a separate privileged
trust boundary: it can replace program code. Owner explicitly retains it for a temporary showcase and
must secure the signer. Token mint authority is revoked; metadata is immutable. Freeze authority is absent.

External CPIs: SPL Token, Associated Token, System, pinned Metaplex and pinned Raydium CPMM mainnet
programs. External program upgrade authorities remain external trust assumptions; pinned addresses do not
make those programs immutable. Raydium config index0 and canonical pool/authority/LP/vault/observation
addresses are derived and checked. Token2022/custom executable substitutions are unsupported.

## Financial invariants to independently examine

- SOL vault holds recorded real reserves + floor vault + its rent; unsolicited transfers add surplus.
- Before migration, floor vault backs recorded circulating tokens at floorScaled / 1e18. Buy issuance
  is capped by the floor funding supplied in that buy. Existing floor cannot decrease.
- Ordinary sell pays max(net curve proceeds after sell tax, floor payout); floor payout burns tokens
  and is untaxed. Normal sells return tokens to the curve and retain tax in the floor vault.
- Migration requires completion and no prior migration. It rounds up backing for actual **entire mint
  supply**, including future pool tokens, retains max(required backing, existing floor vault), then
  funds pool creation and liquidity only from remaining real reserves. No holder floor funds enter LP.
- Migration receives nonzero LP, burns all received LP, then checks LP mint supply is zero. The whole
  migration is atomic. Anyone may crank; 0.3SOL reserve pays costs, with leftover retained by crank.
- After migration floor is fixed. Redemption burns actual holder tokens and pays integer floor value.
  External transfers/burns must not create additional liabilities. Direct external burns can strand
  surplus because recorded counters are conservative and v4 has no withdrawal/reconciliation authority.
- Raydium trades do not invoke Ratchet tax. Pool reserves/vault prices include AMM fees; current spot
  display is the raw vault reserve ratio, an estimate rather than a guaranteed execution quote.
- Bounded arithmetic, u128/u64 casts, dust, rounding, sold-out/zero-circulation cases and transaction
  rollback need adversarial review. Overflow checking remains enabled in the release profile.

## Evidence and limits

pnpm test covers deterministic integer math/property fuzzing, codec/SPL layouts, public wallet signing,
price availability/staleness, mint-supply market cap, RPC write rejection/u64 preservation, metadata API
validation and gateway hash matching. Network helpers use mocked responses for unit tests.

pnpm test:release exercises actual bytecode on a local validator against cloned mainnet programs and
production economics: metadata immutability, slippage, invalid substitution/legacy routes, migration,
LP burn, redemption, compute budget and CLI safeguards. The Agave4.4 pass also clones mainnet features
and performs a real local loader-v3 upgrade. See release/exact-bytecode-proof.json. Global is injected
at genesis for exact production bytecode; this cannot establish access to the real ADMIN signer.

The test-admin lifecycle validates initialization with a deterministic public fixture key in separate
bytecode; those feature constants must be absent from the production release. Source hash checks and
repeat isolated builds do not prove financial safety or replace a professional audit.

## Known operational limitations

Production seeded buys can be constrained sharply by floor solvency. The tested 1SOL seed +5SOL buy
sequence needs 780SOL follow-up to complete with no intervening sells; a universal ~86SOL graduation
claim is invalid. Size/test choices must not change production globals to make showcase funding cheap.

Future ProgramData closure disables redemption. Burned LP does not remove pool-held token liabilities.
A showcase shutdown needs explicit position settlement; closing the program alone is not a settlement.
v4 has no global/curve cleanup and cannot recover arbitrary coin-vault/LP balances for the owner.

Mainnet target remains undeployed. No real mainnet lifecycle is claimed. Public source hosting, audit,
production signing/funding, live metadata pins and actual Lovable integration remain external gates.
