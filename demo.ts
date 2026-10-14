import 'dotenv/config'
import { readFileSync } from 'fs'
import bs58 from 'bs58'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { subscribe, CommitmentLevel, LaserstreamConfig, SubscribeRequest } from 'helius-laserstream'

// create a wallet using the solana CLI
// solana-keygen new -o devnet-wallet.json

const API_KEY = process.env.HELIUS_API_KEY!
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync('devnet-wallet.json', 'utf8')))
)
const connection = new Connection(`https://devnet.helius-rpc.com/?api-key=${API_KEY}`, 'confirmed')

const config: LaserstreamConfig = {
  apiKey: API_KEY,
  endpoint: 'https://laserstream-devnet-ewr.helius-rpc.com',
}

const levels = [
  ['processed', CommitmentLevel.PROCESSED],
  ['confirmed', CommitmentLevel.CONFIRMED],
  ['finalized', CommitmentLevel.FINALIZED],
] as const

let sentAt = 0
let targetSig = ''
const seen: Record<string, { ms: number; slot: string }> = {}
const rpcSeen: Record<string, number> = {}

function request(commitment: CommitmentLevel): SubscribeRequest {
  return {
    transactions: {
      mine: {
        accountInclude: [wallet.publicKey.toBase58()],
        accountExclude: [],
        accountRequired: [],
        vote: false,
        failed: false,
      },
    },
    commitment,
    accounts: {}, slots: {}, transactionsStatus: {},
    blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [],
  }
}

async function main() {
  // 1. One LaserStream subscription per commitment level
  for (const [name, level] of levels) {
    subscribe(config, request(level), async (data: any) => {
      const t = data?.transaction
      if (!t?.transaction?.signature) return
      const sig = bs58.encode(t.transaction.signature)
      if (sig !== targetSig || seen[name]) return
      seen[name] = { ms: Math.round(performance.now() - sentAt), slot: String(t.slot) }
      console.log(`STREAM ${name.padEnd(10)} slot ${t.slot}  +${seen[name].ms} ms`)
    }, async (err) => console.error(name, err)).catch(console.error)
  }
  await new Promise((r) => setTimeout(r, 3000)) // let the streams connect

  // 2. Build and sign a tiny self-transfer, so the signature is known before sending
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 1000 })
  )
  const { blockhash } = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = blockhash
  tx.feePayer = wallet.publicKey
  tx.sign(wallet)
  targetSig = bs58.encode(tx.signature!)

  // 3. Send, start the clock, and poll the RPC as ground truth
  sentAt = performance.now()
  await connection.sendRawTransaction(tx.serialize())
  console.log('sent', targetSig)

  const poll = setInterval(async () => {
    try {
      const { value } = await connection.getSignatureStatuses([targetSig])
      const s = value[0]?.confirmationStatus
      if (s && !rpcSeen[s]) {
        rpcSeen[s] = Math.round(performance.now() - sentAt)
        console.log(`RPC    ${s.padEnd(10)}             +${rpcSeen[s]} ms`)
      }
      if (s === 'finalized') clearInterval(poll)
    } catch (e) {
      console.error('poll error', e)
    }
  }, 200)

  // 4. Wait until both sources report finalized, give up after 60 seconds
  const deadline = Date.now() + 60_000
  while ((!seen.finalized || !rpcSeen.finalized) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250))
  }
  clearInterval(poll)

  console.log('\nLaserStream:')
  console.table(seen)
  console.log('RPC getSignatureStatuses (ms from send):')
  console.table(rpcSeen)

  // 5. Same transaction, parsed by the RPC
  const parsed = await connection.getParsedTransaction(targetSig, {
    commitment: 'finalized',
    maxSupportedTransactionVersion: 0,
  })
  console.log(JSON.stringify(parsed?.transaction.message.instructions, null, 2))
  process.exit(0)
}

main().catch(console.error)