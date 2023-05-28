import { ethers } from 'ethers';
import yargs from 'yargs';

import {
  ERC20__factory,
  HypERC20Deployer,
  HypERC20Factories,
  TokenConfig,
  TokenType,
} from '@hyperlane-xyz/hyperlane-token';
import {
  ChainMap,
  ChainName,
  HyperlaneContractsMap,
  MultiProvider,
  RouterConfig,
  chainMetadata,
  objMap,
} from '@hyperlane-xyz/sdk';
import { types } from '@hyperlane-xyz/utils';

import { warpRouteConfig } from '../../config/warp_tokens_multi_collateral';
import {
  assertBalances,
  assertBytes32,
  getMultiProvider,
  mergedContractAddresses,
} from '../config';
import { mergeJSON } from '../json';
import { createLogger } from '../logger';

import {
  getWarpMultiCollateralConfigChains,
  validateWarpTokenMultiCollateralConfig,
} from './config';
import { TokenMetadata } from './types';

export async function getArgs(multiProvider: MultiProvider) {
  const args = await yargs(process.argv.slice(2))
    .describe('key', 'A hexadecimal private key for transaction signing')
    .string('key')
    .coerce('key', assertBytes32)
    .demandOption('key')
    .middleware(
      assertBalances(multiProvider, () =>
        getWarpMultiCollateralConfigChains(warpRouteConfig),
      ),
    );
  return args.argv;
}

export type WarpRouteArtifacts = {
  router: types.Address;
  tokenType: TokenType;
};

export class WarpRouteMultiCollateralDeployer {
  constructor(
    public readonly multiProvider: MultiProvider,
    public readonly signer: ethers.Signer,
    protected readonly logger = createLogger(
      'WarpRouteMultiCollateralDeployer',
    ),
  ) {}

  static async fromArgs(): Promise<WarpRouteMultiCollateralDeployer> {
    const multiProvider = getMultiProvider();
    const { key } = await getArgs(multiProvider);
    const signer = new ethers.Wallet(key);
    multiProvider.setSharedSigner(signer);
    return new WarpRouteMultiCollateralDeployer(multiProvider, signer);
  }

  async deploy(): Promise<void> {
    const { configMap, baseTokens } = await this.buildHypERC20Config();

    this.logger('Initiating HypERC20 deployments');
    this.logger('config map: ', configMap);
    const deployer = new HypERC20Deployer(this.multiProvider);
    await deployer.deploy(configMap);
    this.logger('HypERC20 deployments complete');

    this.writeDeploymentResult(
      deployer.deployedContracts,
      configMap,
      baseTokens,
    );
  }

  async buildHypERC20Config() {
    validateWarpTokenMultiCollateralConfig(warpRouteConfig);
    const { bases, synthetic } = warpRouteConfig;

    const baseTokenMetadataArray: any[] = [];
    for (let i = 0; i < bases.length; i++) {
      const { type: baseType, chainName: baseChainName } = bases[i];

      const baseTokenAddr =
        baseType === TokenType.collateral
          ? bases[i].address
          : ethers.constants.AddressZero;

      const baseTokenMetadata = await this.getTokenMetadata(
        baseChainName,
        baseType,
        baseTokenAddr,
      );
      baseTokenMetadataArray.push({
        type: baseType,
        chainName: baseChainName,
        address: baseTokenAddr,
        metadata: baseTokenMetadata,
      });

      this.logger(
        `Using base token metadata: Name: ${baseTokenMetadata.name}, Symbol: ${baseTokenMetadata.symbol}, Decimals: ${baseTokenMetadata.decimals} `,
      );
    }
    // Check if all collateral tokens have the same name and symbol
    // assertEqual(
    //   baseTokenMetadataArray.map((baseTokenMetadata) => baseTokenMetadata.name),
    //   'name of collateral tokens should be equal',
    // );
    // assertEqual(
    //   baseTokenMetadataArray.map(
    //     (baseTokenMetadata) => baseTokenMetadata.symbol,
    //   ),
    //   'symbol of collateral tokens should be equal',
    // );

    const owner = await this.signer.getAddress();

    const configMap: ChainMap<TokenConfig & RouterConfig> = {};
    for (let i = 0; i < bases.length; i++) {
      const {
        type: baseType,
        chainName: baseChainName,
        address: baseTokenAddr,
      } = baseTokenMetadataArray[i];
      configMap[baseChainName] = {
        type: baseType,
        token: baseTokenAddr,
        owner,
        mailbox:
          bases[i].mailbox || mergedContractAddresses[baseChainName].mailbox,
        interchainSecurityModule:
          bases[i].interchainSecurityModule ||
          mergedContractAddresses[baseChainName].multisigIsm,
        interchainGasPaymaster:
          bases[i].interchainGasPaymaster ||
          mergedContractAddresses[baseChainName]
            .defaultIsmInterchainGasPaymaster,
      };
      this.logger(
        `HypERC20Config config on base chain ${baseChainName}:`,
        JSON.stringify(configMap[baseChainName]),
      );
    }

    const sChainName = synthetic.chainName;
    configMap[sChainName] = {
      type: TokenType.synthetic,
      name: synthetic.name || baseTokenMetadataArray[0].metadata.name,
      symbol: synthetic.symbol || baseTokenMetadataArray[0].metadata.symbol,
      totalSupply: synthetic.totalSupply || 0,
      owner,
      mailbox: synthetic.mailbox || mergedContractAddresses[sChainName].mailbox,
      interchainSecurityModule:
        synthetic.interchainSecurityModule ||
        mergedContractAddresses[sChainName].multisigIsm,
      interchainGasPaymaster:
        synthetic.interchainGasPaymaster ||
        mergedContractAddresses[sChainName].defaultIsmInterchainGasPaymaster,
    };
    this.logger(
      `HypERC20Config config on synthetic chain ${sChainName}:`,
      JSON.stringify(configMap[sChainName]),
    );
    return {
      configMap,
      baseTokens: baseTokenMetadataArray,
    };
  }

  async getTokenMetadata(
    chain: ChainName,
    type: TokenType,
    address: types.Address,
  ): Promise<TokenMetadata> {
    if (type === TokenType.native) {
      return (
        this.multiProvider.getChainMetadata(chain).nativeToken ||
        chainMetadata.ethereum.nativeToken!
      );
    } else if (type === TokenType.collateral || type === TokenType.synthetic) {
      this.logger(`Fetching token metadata for ${address} on ${chain}}`);
      const provider = this.multiProvider.getProvider(chain);
      const erc20Contract = ERC20__factory.connect(address, provider);
      const [name, symbol, decimals] = await Promise.all([
        erc20Contract.name(),
        erc20Contract.symbol(),
        erc20Contract.decimals(),
      ]);
      return { name, symbol, decimals };
    } else {
      throw new Error(`Unsupported token type: ${type}`);
    }
  }

  writeDeploymentResult(
    contracts: HyperlaneContractsMap<HypERC20Factories>,
    configMap: ChainMap<TokenConfig & RouterConfig>,
    baseToken: Awaited<
      ReturnType<typeof this.buildHypERC20Config>
    >['baseTokens'],
  ) {
    this.writeTokenDeploymentArtifacts(contracts, configMap);
    this.writeWarpUiTokenList(contracts, baseToken);
  }

  writeTokenDeploymentArtifacts(
    contracts: HyperlaneContractsMap<HypERC20Factories>,
    configMap: ChainMap<TokenConfig & RouterConfig>,
  ) {
    this.logger(
      'Writing token deployment addresses to artifacts/warp-token-addresses.json',
    );
    const artifacts: ChainMap<WarpRouteArtifacts> = objMap(
      contracts,
      (chain, contract) => {
        return {
          router: contract.router.address,
          tokenType: configMap[chain].type,
        };
      },
    );
    mergeJSON('./artifacts/', 'warp-token-addresses.json', artifacts);
  }

  writeWarpUiTokenList(
    contracts: HyperlaneContractsMap<HypERC20Factories>,
    baseToken: Awaited<
      ReturnType<typeof this.buildHypERC20Config>
    >['baseTokens'],
  ) {
    // this.logger(
    //   'Writing warp ui token list to artifacts/warp-ui-token-list.json and artifacts/warp-ui-token-list.ts',
    // );
    // const currentTokenList: WarpUITokenConfig[] =
    //   tryReadJSON('./artifacts/', 'warp-ui-token-list.json') || [];
    // const { type, address, chainName, metadata } = baseToken;
    // const { name, symbol, decimals } = metadata;
    // const hypTokenAddr = contracts[chainName].router.address;
    // const commonFields = {
    //   chainId: this.multiProvider.getChainId(chainName),
    //   name,
    //   symbol,
    //   decimals,
    // };
    // let newToken: WarpUITokenConfig;
    // if (type === TokenType.collateral) {
    //   newToken = {
    //     ...commonFields,
    //     type: TokenType.collateral,
    //     address,
    //     hypCollateralAddress: hypTokenAddr,
    //   };
    // } else if (type === TokenType.native) {
    //   newToken = {
    //     ...commonFields,
    //     type: TokenType.native,
    //     hypNativeAddress: hypTokenAddr,
    //   };
    // } else {
    //   throw new Error(`Unsupported token type: ${type}`);
    // }
    // currentTokenList.push(newToken);
    // // Write list as JSON
    // writeJSON('./artifacts/', 'warp-ui-token-list.json', currentTokenList);
    // // Also write list as TS
    // const serializedTokens = currentTokenList
    //   .map((t) => JSON.stringify(t))
    //   .join(',\n');
    // writeFileAtPath(
    //   './artifacts/',
    //   'warp-ui-token-list.ts',
    //   `export const tokenList = [\n${serializedTokens}\n];`,
    // );
  }
}
