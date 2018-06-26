// Node modules
const Bundler = require('parcel-bundler');
const path = require('path');
const fs = require('fs-extra');
const inquirer = require('inquirer');

// Local requires
const cliOptions = require('../options');
const Project = require('../project/Project');
const logger = require('../logger');
const getRootDir = require('../utils/getRootDir');

async function postProcessBundles({ project, parcelBundle, requestHandlerBundle }) {
  logger.updateSpinner('Processing bundles...');

  try {
    await project.updateRequestHandlerBundles(requestHandlerBundle);
    await project.postProcessParcelBundle(parcelBundle);
    await project.snapshotPages();
  } catch(e) {
    logger.stopSpinner();

    logger.error(`An error occured while post-processing the bundles.`);
    logger.error(e);
    
    let prompt = inquirer.createPromptModule();
    let promptResponse = await prompt([
      {
        type: 'confirm',
        message: 'Do you want to ignore this and continue deploying (probably not a good idea)?',
        name: 'continue'
      }
    ]);

    if (!promptResponse.continue) {
      logger.persistSpinner(logger.emoji.error, 'Deploy cancelled.', 'red');
      process.exit();
    }

    logger.startSpinner();
  }

  logger.persistSpinner(logger.emoji.success, 'Bundles processed!', 'green');
}

async function build(inputDir, buildOptions = { production: false }) {
  logger.updateSpinner('Bundling render-code...');

  // Gather files that need bundling
  let outDir = buildOptions.outDir || path.join(cliOptions.tempFolder, 'dist');
  let cacheDir = buildOptions.cacheDir || path.join(cliOptions.tempFolder, '.parcel-cache');

  try {
    await fs.remove(outDir);
  } catch(e) {
    // Do nothing...
  }

  await fs.mkdirp(outDir);
  await fs.mkdirp(cacheDir);

  let project = new Project(inputDir, {
    outDir
  });
  await project.getGlobalCSS();
  await project.getPages();

  let entrypoints = project.getAllEntrypointPaths();
  let entryRootDir = getRootDir(entrypoints);

  let bundler = new Bundler(entrypoints, {
    outDir: path.join(outDir, path.relative(inputDir, entryRootDir)),
    cacheDir: cacheDir,
    publicUrl: path.join('/', path.relative(inputDir, entryRootDir)),
    watch: buildOptions.watch,
    cache: buildOptions.cache === undefined ? true : buildOptions.cache,
    logLevel: 2,
    target: 'browser',
    sourceMaps: buildOptions.sourceMaps || buildOptions.production ? false : true,
    production: buildOptions.production,
    minify: buildOptions.production,
    contentHash: buildOptions.production,
    autoinstall: false
  });

  let parcelBundle = await bundler.bundle();

  logger.persistSpinner(logger.emoji.success, 'Bundled render-code!', 'green');

  logger.updateSpinner('Bundling request handlers...');

  let requestHandlers = (await project.getAllRequestHandlers())
    .map(requestHandler => requestHandler.entry);

  entryRootDir = getRootDir(requestHandlers);

  let requestHandlerBundler = new Bundler(requestHandlers, {
    outDir: path.join(outDir, path.relative(inputDir, entryRootDir)),
    cacheDir: cacheDir,
    publicUrl: path.join('/', path.relative(inputDir, entryRootDir)),
    watch: buildOptions.watch,
    cache: buildOptions.cache === undefined ? true : buildOptions.cache,
    logLevel: 2,
    target: 'node',
    sourceMaps: buildOptions.sourceMaps || buildOptions.production ? false : true,
    production: buildOptions.production,
    minify: buildOptions.production,
    contentHash: buildOptions.production,
    autoinstall: false
  });
  let requestHandlerBundle = await requestHandlerBundler.bundle();

  logger.persistSpinner(logger.emoji.success, 'Request handlers bundled!', 'green');

  await postProcessBundles({ project, parcelBundle, requestHandlerBundle });

  if (buildOptions.watch) {
    const rebuildHandler = async () => {
      await postProcessBundles({ project, parcelBundle, requestHandlerBundle });
      if (buildOptions.rebuildTrigger && typeof buildOptions.rebuildTrigger === 'function') {
        buildOptions.rebuildTrigger();
      }
    }

    bundler.on('bundled', bundle => {
      parcelBundle = bundle;
      rebuildHandler();
    });

    requestHandlerBundler.on('bundled', bundle => {
      requestHandlerBundle = bundle;
      rebuildHandler();
    });
  }
  
  return outDir;
}

module.exports = build;