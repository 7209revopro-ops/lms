import { useMemo, useState, type ReactNode } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Modal, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Ionicons from '@expo/vector-icons/Ionicons'
import RNDateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useTranslation } from 'react-i18next'
import { COUNTRIES, DOC_MAX_BYTES, isoDate } from '@shared'
import { preparePhoto, type PreparedFile } from '@/lib/register'
import { useTheme } from '@/theme'

/* Form controls for registration and the profile screens: every one shows its
   label, its value, and its error under it — the error text is the website's. */

export function FieldError({ text }: { text?: string }) {
  const { colors, fonts } = useTheme()
  if (!text) return null
  return <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.danger }}>{text}</Text>
}

function Label({ children }: { children: ReactNode }) {
  const { colors, fonts } = useTheme()
  return <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.textSecondary }}>{children}</Text>
}

function Box({ children, onPress, error, label }: { children: ReactNode; onPress: () => void; error?: boolean; label: string }) {
  const { colors, radius } = useTheme()
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 14, paddingVertical: 12,
        borderRadius: radius.md, borderWidth: 1, borderColor: error ? colors.danger : colors.border,
        backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
      })}>
      {children}
    </Pressable>
  )
}

export interface Option { value: string; label: string; hint?: string }

/** A choice from a list, in a full-screen sheet; searchable when long. */
export function Select({ label, value, options, onChange, error, placeholder, bare, display }: {
  label: string; value: string; options: readonly Option[]; onChange: (v: string) => void; error?: string; placeholder?: string
  /** No label or error line — inside another field (the phone's dial code). */
  bare?: boolean
  /** How the chosen option reads in the box (default: its label). */
  display?: (o: Option) => string
}) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const searchable = options.length > 12
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? options.filter(o => o.label.toLowerCase().includes(s) || o.hint?.includes(s)) : options
  }, [options, q])
  const current = options.find(o => o.value === value)
  const shownValue = current ? (display ? display(current) : current.label) : (placeholder ?? t('register.choose'))

  return (
    <View style={{ gap: 6 }}>
      {!bare && <Label>{label}</Label>}
      <Box onPress={() => { setQ(''); setOpen(true) }} error={!!error} label={`${label}: ${shownValue}`}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.body, fontSize: 16, color: current ? colors.textPrimary : colors.textMuted }}>
          {shownValue}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Box>
      {!bare && <FieldError text={error} />}
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgPage }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12 }}>
            <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 18, color: colors.textPrimary }}>{label}</Text>
            <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={10}>
              <Ionicons name="close" size={26} color={colors.textPrimary} />
            </Pressable>
          </View>
          {searchable && (
            <TextInput value={q} onChangeText={setQ} placeholder={t('register.search')} placeholderTextColor={colors.textMuted} autoFocus
              style={{ marginHorizontal: 16, marginBottom: 8, fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary,
                backgroundColor: colors.bgSurface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12 }} />
          )}
          <FlatList
            data={shown}
            keyExtractor={o => o.value}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable onPress={() => { onChange(item.value); setOpen(false) }} accessibilityRole="button" accessibilityState={{ selected: item.value === value }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: pressed ? colors.bgMuted : 'transparent' })}>
                <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary }}>{item.label}</Text>
                {item.hint && <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.textMuted }}>{item.hint}</Text>}
                {item.value === value && <Ionicons name="checkmark" size={20} color={colors.primary} />}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  )
}

export const COUNTRY_OPTIONS: Option[] = COUNTRIES.map(c => ({ value: c.name, label: `${c.flag}  ${c.name}` }))
const DIAL_OPTIONS: Option[] = COUNTRIES.map(c => ({ value: `${c.name}|${c.dial}`, label: `${c.flag}  ${c.name}`, hint: c.dial }))
/* Longest dial code first, so +1876 (Jamaica) is not read as +1. */
const BY_DIAL = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)

/** Phone with a country code: stored like the website, `+971501234567`. */
export function PhoneField({ label, value, onChange, error, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string
}) {
  const { colors, fonts, radius } = useTheme()
  const found = BY_DIAL.find(c => value.startsWith(c.dial))
  const [country, setCountry] = useState(found ?? COUNTRIES.find(c => c.name === 'United Arab Emirates')!)
  const local = found ? value.slice(found.dial.length) : value.replace(/^\+/, '')
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ width: 120 }}>
          <Select label={label} value={`${country.name}|${country.dial}`} options={DIAL_OPTIONS}
            onChange={v => {
              const c = COUNTRIES.find(x => `${x.name}|${x.dial}` === v)!
              setCountry(c)
              onChange(local ? c.dial + local : '')
            }}
            placeholder={`${country.flag} ${country.dial}`} bare
            display={o => `${o.label.split(' ')[0]} ${o.hint ?? ''}`} />
        </View>
        <TextInput
          value={local} keyboardType="phone-pad" placeholder={placeholder} placeholderTextColor={colors.textMuted}
          accessibilityLabel={label} textContentType="telephoneNumber" autoComplete="tel"
          onChangeText={raw => { const d = raw.replace(/\D/g, '').slice(0, 13); onChange(d ? country.dial + d : '') }}
          style={{
            flex: 1, alignSelf: 'flex-start', minHeight: 48, fontFamily: fonts.body, fontSize: 16, color: colors.textPrimary,
            backgroundColor: colors.bgSurface, borderRadius: radius.md, borderWidth: 1, borderColor: error ? colors.danger : colors.border, paddingHorizontal: 14,
          }} />
      </View>
      <FieldError text={error} />
    </View>
  )
}

const fromIso = (v: string) => { const [y, m, d] = v.split('-').map(Number); return new Date(y!, m! - 1, d!) }
const show = (v: string) => fromIso(v).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })

/** A calendar date, YYYY-MM-DD, with the platform's own date picker. */
export function DateField({ label, value, onChange, error, min, max }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; min?: Date; max?: Date
}) {
  const { t } = useTranslation()
  const { colors, fonts } = useTheme()
  const [iosOpen, setIosOpen] = useState(false)
  const initial = value ? fromIso(value) : (max && max < new Date() ? max : new Date())
  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: initial, mode: 'date', minimumDate: min, maximumDate: max,
        onValueChange: (_e, d) => onChange(isoDate(d)),
      })
    } else setIosOpen(true)
  }
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <Box onPress={open} error={!!error} label={`${label}: ${value ? show(value) : t('register.choose')}`}>
        <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 16, color: value ? colors.textPrimary : colors.textMuted }}>
          {value ? show(value) : t('register.choose')}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
      </Box>
      <FieldError text={error} />
      {iosOpen && (
        <Modal transparent animationType="fade" onRequestClose={() => setIosOpen(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }} onPress={() => setIosOpen(false)}>
            <View style={{ backgroundColor: colors.bgSurface, paddingBottom: 32 }}>
              <RNDateTimePicker value={initial} mode="date" display="inline" minimumDate={min} maximumDate={max}
                onValueChange={(_e, d) => { onChange(isoDate(d)); setIosOpen(false) }} />
            </View>
          </Pressable>
        </Modal>
      )}
    </View>
  )
}

export function Checkbox({ checked, onChange, children, error }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; error?: string }) {
  const { colors } = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }}
        style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={24} color={error && !checked ? colors.danger : colors.primary} />
        <View style={{ flex: 1 }}>{children}</View>
      </Pressable>
      <FieldError text={error} />
    </View>
  )
}

/** A photo or document: camera, photo library, or (documents) a PDF. Photos
 *  are shrunk and re-encoded as JPEG before they are shown as chosen. */
export function FileField({ label, kind, value, onChange, error, hint }: {
  label: string; kind: 'avatar' | 'doc'; value: PreparedFile | null; onChange: (f: PreparedFile | null) => void; error?: string; hint?: string
}) {
  const { t } = useTranslation()
  const { colors, fonts, radius } = useTheme()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const takePhoto = async (source: 'camera' | 'library') => {
    setProblem(null)
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync()
      if (!perm.granted) { setProblem(t('register.cameraDenied')); return }
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: kind === 'avatar', aspect: [1, 1] }
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
    if (res.canceled || !res.assets[0]) return
    setBusy(true)
    try {
      const f = await preparePhoto(res.assets[0].uri, kind, res.assets[0].fileName ?? `${kind}.jpg`)
      if (f.size > DOC_MAX_BYTES) setProblem(t('register.tooBig', { label }))
      else onChange(f)
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const pickFile = async () => {
    setProblem(null)
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true })
    if (res.canceled || !res.assets[0]) return
    const a = res.assets[0]
    if (a.mimeType?.startsWith('image/')) {
      setBusy(true)
      try { onChange(await preparePhoto(a.uri, 'doc', a.name)) } catch (e) { setProblem((e as Error).message) } finally { setBusy(false) }
      return
    }
    if ((a.size ?? 0) > DOC_MAX_BYTES) { setProblem(t('register.tooBig', { label })); return }
    onChange({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? 'application/pdf', size: a.size ?? 0 })
  }

  const choose = () => {
    const buttons: { text: string; onPress?: () => void; style?: 'cancel' }[] = [
      { text: t('register.takePhoto'), onPress: () => void takePhoto('camera') },
      { text: t('register.fromLibrary'), onPress: () => void takePhoto('library') },
    ]
    if (kind === 'doc') buttons.push({ text: t('register.fromFiles'), onPress: () => void pickFile() })
    buttons.push({ text: t('common.back'), style: 'cancel' })
    Alert.alert(label, undefined, buttons)
  }

  const isImage = value?.mimeType.startsWith('image/')
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <Pressable onPress={choose} disabled={busy} accessibilityRole="button" accessibilityLabel={`${label}${value ? `, ${value.name}` : ''}`}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1, borderStyle: value ? 'solid' : 'dashed',
          borderColor: error || problem ? colors.danger : colors.borderStrong, backgroundColor: pressed ? colors.bgMuted : colors.bgSurface,
        })}>
        {busy ? <ActivityIndicator color={colors.primary} />
          : value && isImage ? <Image source={{ uri: value.uri }} style={{ width: 52, height: 52, borderRadius: kind === 'avatar' ? 26 : 8 }} />
          : <Ionicons name={value ? 'document-text' : kind === 'avatar' ? 'person-circle-outline' : 'cloud-upload-outline'} size={34} color={colors.primary} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textPrimary }}>
            {busy ? t('register.optimizing') : value ? value.name : t('register.choose')}
          </Text>
          {!!hint && !value && <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{hint}</Text>}
          {value && <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.textMuted }}>{`${Math.max(1, Math.round(value.size / 1024))} KB · ${t('register.replace')}`}</Text>}
        </View>
      </Pressable>
      <FieldError text={problem ?? error} />
    </View>
  )
}
