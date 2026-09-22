#!/bin/bash

# Script to use with monitoring infrastructure like
# https://github.com/jooray/signal-monitoring

# To integrate with signal-monitoring, add
# check_script "AAVE-avax" /path/to/this/script/check-aave.sh
# to your monitoring setup

# set your wallet address here
export userAddress="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

# get notified if health factor is below 1.45
export healthFactorThreshold="1.45"

# aave on avalanche setup
export contractAddress="0x4F01AeD16D97E3aB5ab2B501154DC9bb0F1A5A2C"
export jsonRpcUrl="https://api.avax.network/ext/bc/C/rpc"

# change this to full path of AAVE_Account_Health_Factor
pushd ~/AAVE_Account_Health_Factor > /dev/null
node aave.js
ERR=$?
popd > /dev/null

exit $ERR
