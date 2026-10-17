import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getLocales } from 'expo-localization'
import { en } from './en'

/* English only in v1; the device language is read now so adding a locale is
   a resources entry and nothing else. A dedicated instance, not i18next's
   global one, so tests and the app never share state. */
const deviceLanguage = getLocales()[0]?.languageCode ?? 'en'

const i18n = createInstance()
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: deviceLanguage in { en: 1 } ? deviceLanguage : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },   // React Native renders text, never HTML
  returnNull: false,
})

export default i18n
