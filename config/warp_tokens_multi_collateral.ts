import { TokenType } from '@hyperlane-xyz/hyperlane-token';

import type { WarpRouteMultiCollateralConfig } from '../src/warp/config';

// A config for deploying Warp Routes to a set of chains
// Not required for Hyperlane core deployments
export const warpRouteConfig: WarpRouteMultiCollateralConfig = {
  bases: [
    {
      // Chain name must be in the Hyperlane SDK or in the chains.ts config
      chainName: 'goerli',
      type: TokenType.collateral, //  TokenType.native or TokenType.collateral
      // If type is collateral, a token address is required:
      address: '0x07865c6E87B9F70255377e024ace6630C1Eaa37F',

      // Optionally, specify owner, mailbox, and interchainGasPaymaster addresses
      // If not specified, the Permissionless Deployment artifacts or the SDK's defaults will be used
    },
    {
      // Chain name must be in the Hyperlane SDK or in the chains.ts config
      chainName: 'fuji',
      type: TokenType.collateral, //  TokenType.native or TokenType.collateral
      // If type is collateral, a token address is required:
      address: '0x5425890298aed601595a70AB815c96711a31Bc65',

      // Optionally, specify owner, mailbox, and interchainGasPaymaster addresses
      // If not specified, the Permissionless Deployment artifacts or the SDK's defaults will be used
    },
  ],
  synthetic: {
    chainName: 'alfajores',

    // Optionally specify a name, symbol, and totalSupply
    // If not specified, the base token's properties will be used

    // Optionally, specify owner, mailbox, and interchainGasPaymaster addresses
    // If not specified, the Permissionless Deployment artifacts or the SDK's defaults will be used
  },
};
