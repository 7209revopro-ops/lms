import { useColorScheme } from 'react-native'

/* The website's tokens (client/src/app/globals.css), light and dark, so the app
   and the site read as one product. Change a colour there, change it here. */
const light = {
  /** Text, icons, borders, tints. */
  primary:        '#0057b8',
  /** Solid fills that carry white text (buttons, bubbles, badges). */
  primaryFill:    '#0057b8',
  primaryPressed: '#003d80',
  primaryLight:   '#EEF5FF',
  onPrimary:      '#FFFFFF',
  success:        '#0ECC8E',
  /** Green as TEXT: the brand mint is ~2:1 on white, so light mode inks darker. */
  successInk:     '#047857',
  warning:        '#F59E0B',
  /** Amber as TEXT: #F59E0B is ~2:1 on white, so light mode inks darker. */
  warningInk:     '#B45309',
  danger:         '#EF4444',
  dangerLight:    '#FEF2F2',
  bgPage:         '#F4F5F8',
  bgSurface:      '#FFFFFF',
  bgMuted:        '#F0F1F5',
  border:         '#E4E7ED',
  borderStrong:   '#D1D5DB',
  textPrimary:    '#0D0F1A',
  textSecondary:  '#4B5563',
  textMuted:      '#6B7280',
  /** Brand: navy of the logo, and its teal-to-mint dot. */
  navy:           '#122B4F',
  accentFrom:     '#3EC4D6',
  accentTo:       '#8ED0A8',
}

const dark: typeof light = {
  /* Brand blue as text on navy is ~2.7:1 — lifted for text and icons
     (7:1 on bgPage); fills keep the brand blue under white text. */
  primary:        '#6EA8FE',
  primaryFill:    '#1565D8',
  primaryPressed: '#0057b8',
  primaryLight:   'rgba(77,148,255,0.16)',
  onPrimary:      '#FFFFFF',
  success:        '#2ee0a5',
  successInk:     '#2ee0a5',
  warning:        '#FBBF24',
  warningInk:     '#FBBF24',
  danger:         '#F87171',
  dangerLight:    'rgba(248,113,113,0.13)',
  bgPage:         '#0B0D14',
  bgSurface:      '#12151F',
  bgMuted:        '#1A1E2B',
  border:         '#262B3A',
  borderStrong:   '#333A4D',
  textPrimary:    '#E8EAF0',
  textSecondary:  '#A9B0C0',
  textMuted:      '#8A93A6',
  navy:           '#122B4F',
  accentFrom:     '#3EC4D6',
  accentTo:       '#8ED0A8',
}

export type Colors = typeof light

export const fonts = {
  display:  'BricolageGrotesque_700Bold',
  body:     'DMSans_400Regular',
  medium:   'DMSans_500Medium',
  semibold: 'DMSans_600SemiBold',
  bold:     'DMSans_700Bold',
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const

export function useTheme() {
  const scheme = useColorScheme()
  const colors = scheme === 'dark' ? dark : light
  return { colors, scheme: scheme === 'dark' ? 'dark' as const : 'light' as const, fonts, space, radius }
}
