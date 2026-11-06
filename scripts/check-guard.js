// Replica EXACTA del guard parcheado en agent.js, corrida contra datos reales.
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const ROOT = 'C:\\Users\\petra\\museo-weird-scraper';
const stash = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy', 'huaca', '.upload_stash.json'), 'utf-8'));
const log = (m) => console.log(m);

(async () => {
  const provider = new ethers.JsonRpcProvider(stash.mainnet_rpc);
  const wallet = new ethers.Wallet(stash.mainnet_private_key, provider);
  const bal = await provider.getBalance(wallet.address);
  const ethBal = Number(ethers.formatEther(bal));
  const MIN_CYCLOS = Number(process.env.HUACA_MIN_CYCLOS || 3);
  const GAS_POR_CICLO = Number(process.env.HUACA_GAS_POR_CICLO || 285000);
  let gasGwei = 1;
  try {
    const fd = await provider.getFeeData();
    gasGwei = Number(fd.gasPrice || fd.maxFeePerGas || 1000000000n) / 1e9;
    if (!(gasGwei > 0)) gasGwei = 1;
  } catch (e) {
    log(`   (no pude leer el gas actual: ${e.message.slice(0, 60)} — uso 1 gwei de referencia)`);
  }
  const costoPorCiclo = GAS_POR_CICLO * gasGwei * 1e-9;
  const ciclosPagables = costoPorCiclo > 0 ? ethBal / costoPorCiclo : 0;
  log(`   Balance: ${ethBal.toFixed(6)} ETH | gas ${gasGwei.toFixed(4)} gwei | costo/ciclo ~${costoPorCiclo.toFixed(6)} ETH | alcanza para ${ciclosPagables.toFixed(1)} ciclos`);
  if (ethBal <= 0 || ciclosPagables < MIN_CYCLOS) {
    log(`❌ Insufficient ETH (${ethBal.toFixed(6)} ETH = ${ciclosPagables.toFixed(1)} ciclos) — necesito >= ${MIN_CYCLOS} ciclos a ${gasGwei.toFixed(4)} gwei. Abort cycle.`);
    return { ok: false, step: 'balance' };
  }
  log('✅ GUARD PASA — el ciclo procede a mintear');
  log(`   (umbral viejo 0.0015 ETH habria abortado: ${ethBal < 0.0015 ? 'SI, abortaba' : 'no'})`);
  return { ok: true, step: 'balance' };
})().catch(e => console.log('ERROR:', e.message));