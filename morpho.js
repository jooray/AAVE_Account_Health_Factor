const ethers = require('ethers');

// Environment Variables
const userAddress = process.env.userAddress;
const marketIdsRaw = process.env.morphoMarketIds || process.env.marketIds;
const morphoAddress = process.env.morphoAddress || '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';
const healthFactorThreshold = parseFloat(process.env.healthFactorThreshold) || 1.5;
const requiredChainId = parseInt(process.env.requiredChainId) || 1; // Mainnet
const requiredMinBlockNumber = parseInt(process.env.requiredMinBlockNumber) || 26000000;

// Morpho Blue Contract Config
const morphoAbi = [
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function idToMarketParams(bytes32 id) view returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv)',
];
const irmAbi = [
  'function borrowRateView(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, tuple(uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee) market) view returns (uint256)',
];
const oracleAbi = ['function price() view returns (uint256)'];
const erc20Abi = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];

const BN = ethers.BigNumber;
const WAD = BN.from(10).pow(18);
const ORACLE_PRICE_SCALE = BN.from(10).pow(36);
const VIRTUAL_SHARES = BN.from(10).pow(6);
const VIRTUAL_ASSETS = BN.from(1);

// Morpho MathLib / SharesMathLib, ported 1:1 so the numbers match the contract exactly
const mulDivDown = (x, y, d) => x.mul(y).div(d);
const mulDivUp = (x, y, d) => x.mul(y).add(d.sub(1)).div(d);
const wMulDown = (x, y) => mulDivDown(x, y, WAD);
const toAssetsUp = (shares, totalAssets, totalShares) =>
  mulDivUp(shares, totalAssets.add(VIRTUAL_ASSETS), totalShares.add(VIRTUAL_SHARES));
const toSharesDown = (assets, totalAssets, totalShares) =>
  mulDivDown(assets, totalShares.add(VIRTUAL_SHARES), totalAssets.add(VIRTUAL_ASSETS));

// MathLib.wTaylorCompounded: 3-term Taylor expansion of e^(x*n) - 1
function wTaylorCompounded(x, n) {
  const firstTerm = x.mul(n);
  const secondTerm = mulDivDown(firstTerm, firstTerm, WAD.mul(2));
  const thirdTerm = mulDivDown(secondTerm, firstTerm, WAD.mul(3));
  return firstTerm.add(secondTerm).add(thirdTerm);
}

function getRandomUrl(urls) {
  return urls[Math.floor(Math.random() * urls.length)];
}

async function tryConnection(urls) {
  while (urls.length > 0) {
    const url = getRandomUrl(urls);
    try {
      const provider = new ethers.providers.JsonRpcProvider(url);
      const blockNumber = await provider.getBlockNumber();
      const network = await provider.getNetwork();

      if (network.chainId !== requiredChainId || blockNumber < requiredMinBlockNumber) {
        console.log(`Chain ID or block number mismatch for ${url}, trying another...`);
        urls = urls.filter(u => u !== url);
        continue;
      }

      // Make sure the node actually serves Morpho state before we commit to it
      const morpho = new ethers.Contract(morphoAddress, morphoAbi, provider);
      const block = await provider.getBlock(blockNumber);

      return { provider, morpho, blockNumber, timestamp: block.timestamp };
    } catch (error) {
      console.log(`Node ${url} failed: ${error.message || error}, trying another...`);
      urls = urls.filter(u => u !== url);
    }
  }
  console.error('All connection attempts failed');
  process.exit(1);
}

// MorphoBalancesLib.expectedMarketBalances - accrue interest since lastUpdate
async function accrueInterest(provider, marketParams, market, timestamp) {
  const irm = new ethers.Contract(marketParams.irm, irmAbi, provider);
  const borrowRate = await irm.borrowRateView(
    [marketParams.loanToken, marketParams.collateralToken, marketParams.oracle, marketParams.irm, marketParams.lltv],
    [market.totalSupplyAssets, market.totalSupplyShares, market.totalBorrowAssets, market.totalBorrowShares, market.lastUpdate, market.fee]
  );

  // The market may already be up to date - a borrow in this very block, say -
  // but we still want the rate, so the rate is read before this early return.
  const elapsed = BN.from(timestamp).sub(market.lastUpdate);
  if (elapsed.lte(0) || market.totalBorrowAssets.isZero()) {
    return { ...market, borrowRate };
  }

  const interest = wMulDown(market.totalBorrowAssets, wTaylorCompounded(borrowRate, elapsed));
  let totalBorrowAssets = market.totalBorrowAssets.add(interest);
  let totalSupplyAssets = market.totalSupplyAssets.add(interest);
  let totalSupplyShares = market.totalSupplyShares;

  if (!market.fee.isZero()) {
    const feeAmount = wMulDown(interest, market.fee);
    const feeShares = toSharesDown(feeAmount, totalSupplyAssets.sub(feeAmount), totalSupplyShares);
    totalSupplyShares = totalSupplyShares.add(feeShares);
  }

  return {
    totalSupplyAssets,
    totalSupplyShares,
    totalBorrowAssets,
    totalBorrowShares: market.totalBorrowShares,
    lastUpdate: BN.from(timestamp),
    fee: market.fee,
    borrowRate,
  };
}

function fmt(bn, decimals, places = 4) {
  return parseFloat(ethers.utils.formatUnits(bn, decimals)).toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

async function checkMarket(provider, morpho, marketId, timestamp) {
  const marketParams = await morpho.idToMarketParams(marketId);
  if (marketParams.lltv.isZero()) {
    throw new Error(`Market ${marketId} does not exist on ${morphoAddress}`);
  }

  const [rawMarket, position] = await Promise.all([
    morpho.market(marketId),
    morpho.position(marketId, userAddress),
  ]);

  const market = await accrueInterest(provider, marketParams, rawMarket, timestamp);

  const loan = new ethers.Contract(marketParams.loanToken, erc20Abi, provider);
  const coll = new ethers.Contract(marketParams.collateralToken, erc20Abi, provider);
  const oracle = new ethers.Contract(marketParams.oracle, oracleAbi, provider);
  const [loanSymbol, loanDecimals, collSymbol, collDecimals, price] = await Promise.all([
    loan.symbol(), loan.decimals(), coll.symbol(), coll.decimals(), oracle.price(),
  ]);

  // Morpho._isHealthy
  const borrowed = toAssetsUp(position.borrowShares, market.totalBorrowAssets, market.totalBorrowShares);
  const collateralValue = mulDivDown(position.collateral, price, ORACLE_PRICE_SCALE);
  const maxBorrow = wMulDown(collateralValue, marketParams.lltv);

  // Human-readable oracle price: collateral quoted in loan token
  const priceScale = BN.from(10).pow(36 + loanDecimals - collDecimals);
  const priceHuman = parseFloat(ethers.utils.formatUnits(price.mul(WAD).div(priceScale), 18));

  const result = {
    marketId,
    pair: `${collSymbol}/${loanSymbol}`,
    lltv: parseFloat(ethers.utils.formatUnits(marketParams.lltv, 18)),
    collateral: position.collateral,
    collDecimals, collSymbol,
    borrowed, loanDecimals, loanSymbol,
    priceHuman,
    borrowApy: market.borrowRate
      ? Math.exp(parseFloat(ethers.utils.formatUnits(market.borrowRate, 18)) * 31536000) - 1
      : null,
    utilization: market.totalSupplyAssets.isZero()
      ? 0
      : parseFloat(ethers.utils.formatUnits(mulDivDown(market.totalBorrowAssets, WAD, market.totalSupplyAssets), 18)),
    liquidity: market.totalSupplyAssets.sub(market.totalBorrowAssets),
  };

  if (borrowed.isZero()) {
    result.healthFactor = Infinity;
    result.ltv = 0;
    result.liquidationPrice = 0;
    return result;
  }

  // HF = maxBorrow / borrowed, computed in WAD to keep precision on big numbers
  result.healthFactor = parseFloat(ethers.utils.formatUnits(mulDivDown(maxBorrow, WAD, borrowed), 18));
  result.ltv = parseFloat(ethers.utils.formatUnits(mulDivDown(borrowed, WAD, collateralValue), 18));

  // Collateral price at which maxBorrow == borrowed
  result.liquidationPrice = position.collateral.isZero()
    ? 0
    : (parseFloat(ethers.utils.formatUnits(borrowed, loanDecimals)) /
       parseFloat(ethers.utils.formatUnits(position.collateral, collDecimals)) /
       result.lltv);

  return result;
}

async function main() {
  if (!userAddress) {
    console.error('Error: userAddress is not set');
    process.exit(1);
  }
  if (!marketIdsRaw) {
    console.error('Error: morphoMarketIds is not set (semicolon-separated list of Morpho market ids)');
    process.exit(1);
  }

  let jsonRpcUrls = process.env.jsonRpcUrls;
  if (!jsonRpcUrls) {
    if (process.env.jsonRpcUrl) {
      jsonRpcUrls = process.env.jsonRpcUrl;
    } else {
      console.error('Error: No JSON RPC URL provided');
      process.exit(1);
    }
  }

  const urls = jsonRpcUrls.split(';').map(u => u.trim()).filter(Boolean);
  const marketIds = marketIdsRaw.split(/[;,\s]+/).map(m => m.trim()).filter(Boolean);

  try {
    const { provider, morpho, timestamp } = await tryConnection(urls);

    let failed = false;
    let anyDebt = false;

    for (const marketId of marketIds) {
      const r = await checkMarket(provider, morpho, marketId, timestamp);

      const hfStr = r.healthFactor === Infinity ? 'no debt' : r.healthFactor.toFixed(4);
      console.log(
        `${r.pair} [${r.marketId.slice(0, 10)}] LLTV ${(r.lltv * 100).toFixed(0)}% | ` +
        `collateral ${fmt(r.collateral, r.collDecimals, 6)} ${r.collSymbol} | ` +
        `debt ${fmt(r.borrowed, r.loanDecimals, 2)} ${r.loanSymbol} | ` +
        `LTV ${(r.ltv * 100).toFixed(2)}% | health factor ${hfStr}`
      );

      if (r.healthFactor !== Infinity) {
        anyDebt = true;
        console.log(
          `  oracle ${r.priceHuman.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${r.loanSymbol}/${r.collSymbol} | ` +
          `liquidation at ${r.liquidationPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${r.loanSymbol}/${r.collSymbol} ` +
          `(-${((1 - r.liquidationPrice / r.priceHuman) * 100).toFixed(1)}%) | ` +
          `borrow APY ${(r.borrowApy * 100).toFixed(2)}% | ` +
          `market liquidity ${fmt(r.liquidity, r.loanDecimals, 0)} ${r.loanSymbol}`
        );
      }

      if (r.healthFactor < healthFactorThreshold) {
        console.error(
          `Error: health factor ${r.healthFactor.toFixed(4)} on ${r.pair} [${r.marketId.slice(0, 10)}] ` +
          `is lower than threshold ${healthFactorThreshold}`
        );
        failed = true;
      }
    }

    if (!anyDebt) {
      console.log('PLEASE NOTE: no debt in any of the checked markets, so there is nothing to liquidate.');
    }

    if (failed) process.exit(1);
  } catch (error) {
    console.error('An unexpected error occurred:', error.message || error);
    process.exit(1);
  }
}

main();
