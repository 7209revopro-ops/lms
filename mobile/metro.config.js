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

// Never watch the native build output. A Gradle build writes tens of thousands
// of files under android/ (build, .cxx, .gradle); a Metro watching them
// re-hashes every one and stops serving bundles (seen 2026-10-23: 25 min of
// CPU, no bundle). No JavaScript lives there.
const escape = p => p.replace(/[/\\]/g, '[/\\\\]').replace(/\./g, '\\.')
const nativeBuild = ['android/app/build', 'android/build', 'android/.gradle', 'android/app/.cxx', 'ios/build', 'ios/Pods']
  .map(p => new RegExp(`^${escape(path.resolve(projectRoot, p))}[/\\\\].*`))
/* Gradle also builds each native package in place, under
   node_modules/<pkg>/android/{build,.cxx} — thousands more files Metro never needs. */
nativeBuild.push(/[/\\]node_modules[/\\].*[/\\]android[/\\](build|\.cxx|\.gradle)[/\\].*/)
const existing = config.resolver.blockList
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...nativeBuild]

module.exports = config
