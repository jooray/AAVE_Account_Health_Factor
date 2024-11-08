const LendingPoolV3Artifact = require('@aave/core-v3/artifacts/contracts/protocol/pool/Pool.sol/Pool.json');
var ethers = require('ethers');

// Environment Variables
const userAddress = process.env.userAddress;
const contractAddress = process.env.contractAddress || '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2';
const healthFactorThreshold = parseFloat(process.env.healthFactorThreshold) || 1.5;
const requiredChainId = parseInt(process.env.requiredChainId) || 1; // Mainnet
const requiredMinBlockNumber = parseInt(process.env.requiredMinBlockNumber) || 21145896;

// AAVE Contract Config
const abi = LendingPoolV3Artifact.abi;

function getRandomUrl(urls) {
  return urls[Math.floor(Math.random() * urls.length)];
}

async function tryConnection(urls) {
  while (urls.length > 0) {
    const url = getRandomUrl(urls);
    try {
      const provider = new ethers.providers.JsonRpcProvider(url);
      const aaveContract = new ethers.Contract(contractAddress, abi, provider);

      const blockNumber = await provider.getBlockNumber();
      const network = await provider.getNetwork();

      if (network.chainId !== requiredChainId || blockNumber < requiredMinBlockNumber) {
        console.log(`Chain ID or block number mismatch for ${url}, trying another...`);
        urls = urls.filter(u => u !== url);
        continue;
      }

      return { provider, aaveContract, blockNumber, network };
    } catch (error) {
      urls = urls.filter(u => u !== url);
    }
  }
  console.error('All connection attempts failed');
  process.exit(1);
}

async function main() {
  let jsonRpcUrls = process.env.jsonRpcUrls;
  if (!jsonRpcUrls) {
    if (process.env.jsonRpcUrl) {
      jsonRpcUrls = process.env.jsonRpcUrl;
    } else {
      console.error('Error: No JSON RPC URL provided');
      process.exit(1);
    }
  }

  const urls = jsonRpcUrls.split(';');
  let provider, aaveContract, blockNumber, network;

  try {
    ({ provider, aaveContract, blockNumber, network } = await tryConnection(urls));

    const userAccountData = await aaveContract.getUserAccountData(userAddress);
    const healthFactorHex = userAccountData.healthFactor._hex;
    const healthFactorWei = ethers.BigNumber.from(healthFactorHex);
    const healthFactor = healthFactorWei / ethers.constants.WeiPerEther;

    if (healthFactor < healthFactorThreshold) {
      console.error('Error: health factor ', healthFactor.toString(), ' is lower than threshold ', healthFactorThreshold);
      process.exit(1);
    }

    if (healthFactorHex == '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') {
      console.log("PLEASE NOTE: Your health factor is the maximum uint256 value because you have not borrowed any coins from AAVE.");
    }

  } catch (error) {
    console.error('An unexpected error occurred:', error);
    process.exit(1);
  }
}

main();
