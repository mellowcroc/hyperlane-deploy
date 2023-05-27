import { logger } from '../src/logger';
import { WarpRouteMultiCollateralDeployer } from '../src/warp/WarpRouteMultiCollateralDeployer';

import { run } from './run';

run('Warp route deployment', async () => {
  logger('Preparing Warp Route deployer');
  const deployer = await WarpRouteMultiCollateralDeployer.fromArgs();
  logger('Beginning warp route deployment');
  await deployer.deploy();
});
