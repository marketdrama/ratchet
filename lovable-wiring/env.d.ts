interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_SOLANA_CLUSTER?: string;
  readonly VITE_ENABLE_MAINNET_TRADING?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv; }
