# v4 launch acceptance

Technical release preparation and public mainnet launch are distinct gates. See DEPLOY_MAINNET.md.

## Code and local checks

- [x] Pin Raydium executable, config, fee receiver and all canonical pool/LP/vault accounts.
- [x] Remove custodial release, internal graduation and internal swap entrypoints.
- [x] Retain all-token floor backing through migration; expose untaxed post-migration redemption.
- [x] Require nonzero LP receipt and verify zero LP mint supply after burn.
- [x] Immutable Metaplex metadata before mint authority revocation; attribution bound to payer.
- [x] Share floor-capped quotes; validate amounts and nonzero protected min-out.
- [x] Separate production initialization from test fixtures and resumable coin actions.
- [x] Connected wallet signing; no funded browser-local keys on public clusters; mainnet guard defaults closed.
- [x] Real Raydium reserve reads after migration; explicit migration, market-swap link and redemption.
- [x] Metadata upload helper and deployment environment templates.
- [x] Final v4 release manifest/source snapshot and completed validation evidence: see RELEASE_STATUS.md.

## External/public launch gates

- [ ] Independent audit of this v4 source, including full-supply backing and migration CPI.
- [ ] Secure funded deployer, accessible ADMIN signer, configured reliable RPC.
- [ ] Permanent image/JSON hosting account and retained pins; verify a real metadata URI.
- [ ] Deploy the exact reviewed binary; initialize production globals; compare deployed bytecode.
- [ ] Real mainnet migration/redemption smoke proof on a separately reviewed test deployment/config.
- [ ] Independent source/build verification (Docker/solana-verify or matching isolated toolchain).
- [x] Owner chose retained upgrade authority for a temporary showcase; do not finalize.
- [ ] Secure and verify the upgrade-authority signer; settle positions before future program closure.
- [ ] Import v4 kit into actual Lovable app, verify wallet/quotes/metadata/migration/redemption there.
- [ ] Enable public mainnet guard last and publish program, source, artifact hash and audit status.

An indexer/DB is a scaling improvement, not required to keep this small initial client correct.
