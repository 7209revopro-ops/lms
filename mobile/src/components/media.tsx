import type { ReactNode } from 'react'
import { Image as RNImage, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { useTheme } from '@/theme'

/* Images and gradients through one door. expo-image (disk cache, placeholder,
   fade-in) and expo-linear-gradient are native modules: a build made before
   they were added has neither, and importing them there throws. So they load
   only when the build has them, with plain React Native standing in. */

const hasExpoImage = !!requireOptionalNativeModule('ExpoImage')
const hasGradient = !!requireOptionalNativeModule('ExpoLinearGradient')

type ImgProps = {
  uri?: string | null
  style?: StyleProp<ImageStyle>
  /** How the picture fills its box — 'cover' crops, 'contain' letterboxes. */
  fit?: 'cover' | 'contain'
  /** Shown while loading and when there is no picture. */
  placeholderColor?: string
  accessibilityLabel?: string
}

export function Img({ uri, style, fit = 'cover', placeholderColor, accessibilityLabel, cover }: ImgProps & {
  /** No picture: draw the brand cover (navy gradient, the logo's dot) instead of a flat block. */
  cover?: boolean
}) {
  const a11y = accessibilityLabel ? { accessible: true, accessibilityLabel } : { accessible: false }
  if (!uri && cover) return <CoverArt style={style as StyleProp<ViewStyle>} {...a11y} />
  if (!uri) return <View style={[style as StyleProp<ViewStyle>, { backgroundColor: placeholderColor }]} {...a11y} />
  if (hasExpoImage) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- only once this build is known to have the native module
    const { Image } = require('expo-image') as typeof import('expo-image')
    return <Image source={{ uri }} style={[style, { backgroundColor: placeholderColor }]} contentFit={fit} transition={180}
      cachePolicy="memory-disk" recyclingKey={uri} {...a11y} />
  }
  return <RNImage source={{ uri }} style={[style, { backgroundColor: placeholderColor }]} resizeMode={fit} {...a11y} />
}

/** The brand's cover: navy into blue, a large faint "d" ring and the teal dot. */
function CoverArt({ style, ...a11y }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme()
  return (
    <Gradient colors={[colors.navy, colors.primaryFill]} style={[style, { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }]}>
      <View {...a11y} style={{ width: '42%', aspectRatio: 1, borderRadius: 999, borderWidth: 10, borderColor: 'rgba(255,255,255,0.14)' }} />
      <Gradient colors={[colors.accentFrom, colors.accentTo]}
        style={{ position: 'absolute', width: '14%', aspectRatio: 1, borderRadius: 999, left: '24%', top: '46%' }} />
    </Gradient>
  )
}

type GradientProps ={ colors: readonly [string, string, ...string[]]; style?: StyleProp<ViewStyle>; children?: ReactNode }

/** A diagonal gradient; a flat fill of its first colour on builds without the module. */
export function Gradient({ colors, style, children }: GradientProps) {
  if (hasGradient) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- only once this build is known to have the native module
    const { LinearGradient } = require('expo-linear-gradient') as typeof import('expo-linear-gradient')
    return <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>{children}</LinearGradient>
  }
  return <View style={[style, { backgroundColor: colors[0] }]}>{children}</View>
}
