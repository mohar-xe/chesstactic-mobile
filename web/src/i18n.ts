import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

// English only. The app ships one language; adding another is a matter of
// dropping a JSON file in here (see CONTRIBUTING).
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
