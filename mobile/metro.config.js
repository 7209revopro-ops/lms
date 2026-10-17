// Metro, extended to see ../shared (plan.md §13.2 M8). Everything else is
// Expo's default; the @shared alias itself comes from tsconfig.json paths,
// which Expo's resolver reads.
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const sharedRoot = path.resolve(projectRoot, '../shared')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [...(config.watchFolders ?? []), sharedRoot]
// shared/ has no node_modules of its own: resolve its imports from here.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')]

module.exports = config
