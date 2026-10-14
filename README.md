# LaserStream commitment-level timing on devnet

A small script that measures how fast one Solana transaction shows up on
[Helius LaserStream](https://www.helius.dev/docs/laserstream) at `processed`,
`confirmed` and `finalized`, and cross-checks it against plain RPC polling.

I wrote it to see what Alpenglow changes for an app that reads Solana data.
Alpenglow has been live on devnet since late September 2026 and is scheduled
for mainnet on October 21, 2026 (per Anza's announcement; check the
[Solana Foundation page](https://solana.com/upgrades/alpenglow) for updates).

## What it does

1. Opens three LaserStream subscriptions on the same wallet, one per
   commitment level (a subscribe request carries a single commitment level).
2. Sends a 1,000 lamport self-transfer on devnet.
3. Records, for each level, the milliseconds from `sendRawTransaction` until
   the stream delivers that signature.
4. Polls `getSignatureStatuses` every 200 ms as an independent RPC reference.
5. Prints both tables, then the parsed transaction.

## Results so far (7 runs, devnet)

| Level | Median (ms) | Range (ms) |
| --- | --- | --- |
| processed | 589 | 531 to 729 |
| confirmed | 1,043 | 923 to 1,113 |
| finalized | 1,050 | 923 to 1,113 |
| RPC finalized (6 runs) | 1,066 | 1,009 to 1,129 |

Times are milliseconds from `sendRawTransaction` until the signature shows up.
Seven runs is a small sample, not a benchmark. I will extend it to 20.

What stands out: `confirmed` and `finalized` arrive together, about one
second after sending (identical to the millisecond in 4 of 7 runs and within 7 ms in all). On
TowerBFT, finalized took roughly 12.8 s.

## Setup

Requires Node 20+ and a Helius API key (a free key shows the devnet
LaserStream endpoint in the dashboard).

```bash
npm install
cp .env.example .env        # then put your key in .env
solana-keygen new --outfile devnet-wallet.json --no-bip39-passphrase
solana airdrop 1 $(solana-keygen pubkey devnet-wallet.json) --url devnet
npx tsx demo.ts
```

`.env`:

```
HELIUS_API_KEY=your-key-here
```

`devnet-wallet.json` must be a devnet-only throwaway keypair.

## Do not commit secrets

`.gitignore` must contain:

```
.env
node_modules
devnet-wallet.json
```

## Limits

- Devnet only. Mainnet LaserStream needs a Business or Professional plan.
- One transaction per run, one region (`ewr`), one wallet. Timings depend on
  network conditions and slot leader.
- Not verified: how LaserStream itself exposes Alpenglow's `bank_id` on
  events. The article describes the Geyser/gRPC behavior from Anza's
  documentation, not LaserStream specifics.

## More

Article: *Alpenglow goes live on October 21: what changes for apps that read
Solana data* (link to be added when published).

Built by [Biboux](https://biboux.com).
