# AAVE / Morpho Account Health Factor Check

Checks the current health factor of an AAVE wallet (`aave.js`) or of a Morpho Blue
position (`morpho.js`), and exits with an error when it drops below a threshold, so you
can hook it into monitoring.

## Requirements

- Node.js
- [@aave/core-v3](https://www.npmjs.com/package/@aave/core-v3)
- [ethers (^5.2.0)](https://www.npmjs.com/package/ethers)

Install with `npm install`.

# AAVE (aave.js)

The health factor comes straight from the [AAVE Pool contract](https://docs.aave.com/developers/core-contracts/pool),
which returns it for any account.

## Environment variables

- **userAddress**: the wallet address to check.
- **contractAddress**: address of the [AAVE V3 Pool contract](https://docs.aave.com/developers/deployed-contracts/deployed-contracts)
  on your network. Check that page, the addresses change between deployments. The script
  also works with spark.fi, an Aave fork: `0xC13e21B648A5Ee794902342038FF3aDAB66BE987`.
- **jsonRpcUrls**: semicolon-separated list of JSON RPC endpoints. For Ethereum mainnet
  nodes see [EthereumNodes.com](https://ethereumnodes.com/). On Avalanche you can use
  `https://api.avax.network/ext/bc/C/rpc`.
- **healthFactorThreshold**: the lowest acceptable health factor. Below it the script
  prints an error and exits with a non-zero code. Default: 1.5

Example list of nodes:

```bash
export jsonRpcUrls="https://ethereum-rpc.publicnode.com;https://eth-mainnet.public.blastapi.io;https://1rpc.io/eth;https://eth-pokt.nodies.app;https://eth.drpc.org"
```

# Morpho Blue (morpho.js)

Morpho Blue has no `getUserAccountData`, so `morpho.js` redoes the contract's own
`_isHealthy` math. It reads `position`, `market` and `idToMarketParams` from Morpho Blue,
accrues interest since `lastUpdate` through the market's IRM (`borrowRateView` +
`wTaylorCompounded`, same as `MorphoBalancesLib`), and divides by the oracle price. The
result matches app.morpho.org to four decimals.

Morpho markets are isolated, with one position per market, so the script takes a list of
market ids and checks each one. It exits with an error if *any* of them is below the
threshold.

## Environment variables

- **userAddress**: wallet address to check.
- **morphoMarketIds**: semicolon- (or comma-) separated list of Morpho market ids. You can
  read them off the URL on app.morpho.org.
- **jsonRpcUrls**: same as for AAVE, semicolon-separated, tried in random order with failover.
- **healthFactorThreshold**: same meaning as on AAVE. The health factor is a ratio, so it
  does not depend on the LLTV: 1.35 always means 26% of price drop left before
  liquidation, whether the market is at 86% LLTV or AAVE is at 78% liquidation threshold.
  Default: 1.5
- **morphoAddress**: Morpho Blue. Defaults to `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`,
  which is the address on every chain Morpho is deployed to. For Base, Arbitrum and so on
  you only change `requiredChainId` and `jsonRpcUrls`.
- **requiredChainId**: default 1 (Ethereum mainnet).
- **requiredMinBlockNumber**: sanity check against a node serving stale state.

```bash
export userAddress="0x..."
export morphoMarketIds="0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64"
export healthFactorThreshold="1.35"
export jsonRpcUrls="https://ethereum-rpc.publicnode.com;https://eth-pokt.nodies.app;https://eth.drpc.org"
node morpho.js
```

Besides the health factor it prints the collateral, the debt, the LTV, the oracle price,
the liquidation price and how far away it is, the current borrow APY and how much
liquidity is left in the market. For a made-up position of 2.5 cbBTC against 120k USDC:

```
cbBTC/USDC [0x64d65c9a] LLTV 86% | collateral 2.500000 cbBTC | debt 120,000.00 USDC | LTV 55.65% | health factor 1.5454
  oracle 86,255.24 USDC/cbBTC | liquidation at 55,813.95 USDC/cbBTC (-35.3%) | borrow APY 4.99% | market liquidity 33,607,188 USDC
```

# Integration with monitoring

I use my own [signal-monitoring](https://github.com/jooray/signal-monitoring) to get a
Signal message when the health factor drops. Set that up first, then see
`examples/check-aave.sh` and `examples/check-morpho.sh` for the wrappers.

## Author

Brandon Grant\
[Email](mailto:brandon.kevin.grant@gmail.com)\
with modifications by Juraj Bednar\
[Project Github](https://github.com/jooray/AAVE_Account_Health_Factor)
