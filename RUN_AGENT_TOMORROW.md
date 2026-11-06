# 🚀 Cómo correr el agente — instrucciones para mañana

## ✅ Estado verificado (todo listo, no toques nada)

- **Contrato v4 activo:** `0x87E57042C8a4cd95D3aF635940294802aabfFc85` (NFT), `0x54dEdeBC156044E3de51f54264Db26eC393bbB0D` (Auction)
- **0 NFTs minteados** aún (`totalSupply = 0` verificado on-chain)
- **Balance deployer:** 0.0535 SepoliaETH (≈ 10 mints disponibles)
- **art-queue.json:** 0 items (limpio, listo para que el agente lo llene)
- **scraper-candidates.json:** 106 candidatos (96 viejos + 10 scrapeados hoy)
- **deploy/huaca/:** vacío (sin index.html — lo construye el agente en Step 5)
- **.env:** todas las API keys presentes (BLUESKY, GROQ, NVIDIA, PINATA, PRIVATE_KEY, SEPOLIA_RPC)

## 🏃 Comando para correr el agente

Abre una terminal en `C:\Users\petra\museo-weird-scraper` y ejecuta:

```bash
node scripts/agent.js --once --limit=3
```

Eso corre el ciclo completo (5 pasos) UNA vez, procesando solo 3 items:

1. **Step 1**: Scrapea Bluesky (12 queries sobre Medellín clima/anomalías)
2. **Step 2**: LLM filtra/valida con Groq
3. **Step 3**: Genera voxel HTML (Three.js)
4. **Step 4**: Sube a Pinata IPFS
5. **Step 5**: Mintea 3 NFTs en Sepolia + sube galería a petrasynthetic.com/huaca/

## ⏱️ Tiempo estimado

- Step 1: 1-2 min (12 queries Bluesky)
- Step 2: 30 seg (LLM filter)
- Step 3: 30-60 seg × 3 (voxel generation)
- Step 4: 30 seg × 3 (Pinata upload)
- Step 5: 30-60 seg × 3 (Sepolia mint + FTP upload)

**Total: 5-10 minutos.**

## ⚠️ Antes de correr — verifica que Groq ya no esté rate-limited

El rate limit de Groq es **100,000 tokens/día**. Hoy lo quemamos al 99.6%. Mañana a primera hora debería estar reseteado, pero puedes verificarlo:

```bash
# Esperar unos segundos para ver headers de rate limit
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $GROQ_API_KEY" \
  https://api.groq.com/openai/v1/models
```

O simplemente corre el agente y si Groq sigue rate-limited, te avisará.

## 🔄 Flags útiles

| Flag | Qué hace |
|---|---|
| `--once` | Solo 1 ciclo (sin loop infinito) |
| `--limit=3` | Solo procesa 3 items |
| `--skip-scrape` | No scrapea, usa candidatos existentes |
| `--dry-run` | No mintea, no sube (pero SÍ scrapea/genera) |
| `--no-mint` | Construye galería pero no mintea on-chain |

Si quieres testear sin gastar API real, primero corre:

```bash
node scripts/agent.js --once --dry-run --skip-scrape --limit=0
```

Eso verifica que el código corre sin error pero no hace nada visible.

## 📊 Después de correr — cómo verificar

### 1. On-chain
```bash
curl -X POST https://ethereum-sepolia-rpc.publicnode.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x87E57042C8a4cd95D3aF635940294802aabfFc85","data":"0x18160ddd"},"latest"],"id":1}'
```

Si devuelve `0x...03` (o número >0), se mintearon NFTs.

### 2. Galería en producción
Abre https://petrasynthetic.com/huaca/ en el navegador. Debería mostrar 3 NFTs nuevos.

### 3. Art-queue actualizado
```bash
cat data/art-queue.json | head -50
```

Debería tener 3 items con `status: "done"`, `tokenId`, `mintedAt`, `htmlPath`.

### 4. Tests
```bash
node test-agent.js
```

Debería decir `37 passed, 1 failed` (la que falla es `deploy/huaca/index.html not found`, hasta que Step 5 corra).

## 🐛 Si algo falla

### Groq rate-limited otra vez
Espera 1-2 horas y vuelve a intentar. O cambia de provider en `.env` (de `GROQ_API_KEY` a `OPENAI_API_KEY` y adapta `scripts/llm-client.ts`).

### "Step 5 skipped" en el log
Eso significa que el Step 5 (mint + upload) no se ejecutó. Revisa `logs/` para más detalle.

### NFTs minteados pero galería no se actualiza
El FTP upload puede fallar por credenciales 2FA. Revisa `deploy/huaca/.ftp_stash.json` y `deploy/huaca/.upload_stash.json`.

### Balance SepoliaETH bajo
Pide faucet: https://www.alchemy.com/faucets/ethereum-sepolia

## 📁 Archivos de backup por si algo sale mal

- `data/art-queue.json.backup-2026-08-10` — queue con 30 items v3
- `smart-contracts/deployments/sepolia.v3.json` — contrato v3
- `smart-contracts/deployments/sepolia.json.backup-2026-08-10` — contrato v2
- `deploy/huaca/.upload_stash.json.v3-backup` — credenciales v3
- `deploy/huaca/index.html.v3-backup` — galería v3 con 2 NFTs Medellín

## 🔗 Direcciones importantes

| Recurso | URL / Address |
|---|---|
| Galería | https://petrasynthetic.com/huaca/ |
| NFT v4 | `0x87E57042C8a4cd95D3aF635940294802aabfFc85` |
| Auction v4 | `0x54dEdeBC156044E3de51f54264Db26eC393bbB0D` |
| Etherscan NFT | https://sepolia.etherscan.io/address/0x87E57042C8a4cd95D3aF635940294802aabfFc85 |
| Etherscan Auction | https://sepolia.etherscan.io/address/0x54dEdeBC156044E3de51f54264Db26eC393bbB0D |

## 💡 Resumen en 1 línea

```bash
cd /c/Users/petra/museo-weird-scraper && node scripts/agent.js --once --limit=3
```

Corre eso mañana y avísame qué pasa.
