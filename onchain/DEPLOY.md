> Historical v2/v3 reference. The v4 release candidate supersedes these instructions. See the root README.md, DEPLOY_MAINNET.md and RELEASE_STATUS.md for current behavior and commands.

# ratchet-curve — deploy & authority hardening runbook

The program is a loader-v4 program (`solana program-v4`). Two authorities matter:

1. **Program upgrade authority** — the key that can replace the program bytecode. By default
   this is the deployer (`~/.config/solana/id.json`). A single key here is the centralization
   risk flagged as finding #3 in [SECURITY.md](SECURITY.md): whoever holds it can swap the
   rules out from under every coin.
2. **`ADMIN`** (hardcoded in `src/lib.rs`) — the key allowed to call `initialize` (one-time
   global config). Separate concern; see SECURITY.md finding #1.

## Deploy (devnet / mainnet)

```sh
solana config set --url <devnet|mainnet-beta>
# fund the deployer, then:
solana program-v4 deploy ./target/deploy/ratchet_curve.so --program-keypair program-keypair.json
# initialize global ONCE, signed by ADMIN (the hardcoded deployer):
node app/seed.mjs            # or a minimal init-only script on mainnet
```

Check state at any time:

```sh
solana program-v4 show 2KYq5Za1PctA7p6XzaSnXAjCe2ARMCE5iWtMViHDaqmn
```

## Harden the upgrade authority

> **Loader note (important).** On the local `solana-test-validator` we deploy with **loader-v4**
> (`solana program-v4 deploy`) because the validator genesis gates the upgradeable BPF loader
> ("No new programs can be deployed on loader-v3"). Loader-v4's authority tooling is still immature
> in solana-cli 2.2.1 — `program-v4 finalize` requires the `--next-version` to be an *already
> loader-owned program* (you cannot finalize to a fresh/self address), and `program-v4
> transfer-authority` fails "not enough signers" on this build. **Do not harden on localnet.**
> On **devnet / mainnet**, deploy with the mature **upgradeable BPF loader** (`solana program
> deploy`) and use its reliable authority commands below. (Both were verified present in the CLI;
> they cannot be exercised on this test-validator because it gates that loader.)

Deploy for real with the upgradeable loader, then pick ONE (with the current authority = deployer):

### Option A — Immutable (recommended for this launchpad) — do after audit

Makes the bytecode permanent: nobody, including the deployer, can ever change the rules — the
trustless endgame that matches the "floor that only clicks up" promise. No patch path afterward.

```sh
solana program deploy ./target/deploy/ratchet_curve.so \
  --program-id program-keypair.json --url mainnet-beta        # upgradeable-loader deploy
solana program set-upgrade-authority <program-id> --final --url mainnet-beta
solana program show <program-id>    # "Authority: none" == immutable
```

### Option B — Multisig (keep upgradability, remove the single hot key)

Move the upgrade authority to an M-of-N multisig (e.g. a Squads vault). Upgrades then need M
signers. The multisig authority is a PDA that can't sign the hand-off, so skip the signer check:

```sh
solana program set-upgrade-authority <program-id> \
  --new-upgrade-authority <SQUADS_VAULT_AUTHORITY> \
  --skip-new-upgrade-authority-signer-check \
  --url mainnet-beta
solana program show <program-id>    # Authority: <SQUADS_VAULT_AUTHORITY>
```

## Notes

- `ADMIN` in `src/lib.rs` is cluster-specific. Rotate it to the real deployer and rebuild
  before deploying to a new cluster, or `initialize` will be un-callable.
- On localnet the whole ledger is ephemeral — any authority change persists only until the next
  `--reset`, so hardening there is pointless. Harden at the devnet/mainnet deploy instead.
- Current localnet program state (for reference): loader-v4, `Authority: <deployer>`, `deployed`
  (verified with `solana program-v4 show`).
