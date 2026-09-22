#!/bin/bash

# Script to use with monitoring infrastructure like
# https://github.com/jooray/signal-monitoring

# To integrate with signal-monitoring, add
# check_script "morpho" /path/to/this/script/check-morpho.sh
# to your monitoring setup

# set your wallet address here
export userAddress="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

# Morpho Blue market ids, semicolon-separated. Find them in the URL on
# app.morpho.org, e.g. app.morpho.org/ethereum/market/<id>
# This one is cbBTC/USDC, LLTV 86%, the biggest regular market on Ethereum:
export morphoMarketIds="0x64d65c9a2d91c36d56fbc42d69e979335320169b3df63bf92789e2c8883fcc64"

# get notified if health factor is below 1.35
# note: health factor means the same thing as on AAVE (1 / how close you are to
# liquidation), so 1.35 is ~26% of price drop left, whatever the LLTV is
export healthFactorThreshold="1.35"

export jsonRpcUrls="https://ethereum-rpc.publicnode.com;https://eth-mainnet.public.blastapi.io;https://eth-pokt.nodies.app;https://eth.drpc.org"

# Morpho Blue is at the same address on every chain it is deployed to,
# so for Base/Arbitrum/... only requiredChainId and jsonRpcUrls change.
# export morphoAddress="0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb"
# export requiredChainId="1"

# change this to full path of AAVE_Account_Health_Factor
pushd ~/AAVE_Account_Health_Factor > /dev/null
node morpho.js
ERR=$?
popd > /dev/null

exit $ERR
