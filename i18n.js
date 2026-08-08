// UI strings. English is the default. To add a language, copy the `en` block,
// translate the values, and add a flag button in index.html.

const STRINGS = {
  en: {
    parts: 'Parts',
    marks: 'Marks', join: 'Join', fix: 'Fix',
    open: '📤 Solve .ldr or .io',
    howTo: 'How this works →',
    working: 'Reading the part library…',
    tooMany: 'More than {n} joints: two of them share a colour, and the .ldr cannot tell ' +
             'them apart.',
    board: 'Board', angle: 'Angle', level: 'Level (vertical axis)', remove: 'Remove',
    selected: 'Selected part', result: 'Result', tolerance: 'Red past (mm)',
    flip: 'Turned over',
    save: '💾 Save .ldr', reset: '🔄 Start over', undo: '↶ Undo', redo: '↷ Redo',
    snap: 'Snap', snapStud: 'Studs', snapHalf: 'Half studs', snapFree: 'Free',

    offBy: 'Off by {n} mm',
    loose: 'Nothing is fixed, so the whole thing can slide.',
  },

  es: {
    parts: 'Piezas',
    marks: 'Marcas', join: 'Unir', fix: 'Fijar',
    open: '📤 Resolver .ldr o .io',
    howTo: 'Cómo funciona →',
    working: 'Leyendo la librería de piezas…',
    tooMany: 'Más de {n} uniones: dos comparten color y el .ldr no puede distinguirlas.',
    board: 'Tablero', angle: 'Ángulo', level: 'Nivel (eje vertical)', remove: 'Quitar',
    selected: 'Pieza seleccionada', result: 'Resultado', tolerance: 'Rojo a partir de (mm)',
    flip: 'Del revés',
    save: '💾 Guardar .ldr', reset: '🔄 Empezar de cero', undo: '↶ Deshacer', redo: '↷ Rehacer',
    snap: 'Rejilla', snapStud: 'Studs', snapHalf: 'Medios studs', snapFree: 'Libre',

    offBy: 'Se queda a {n} mm',
    loose: 'No hay nada fijo, así que el conjunto entero puede deslizarse.',
  },
};

export let lang = (typeof localStorage !== 'undefined' && localStorage.getItem('lang')) || 'en';
export const setLang = (v) => { lang = v; localStorage.setItem('lang', v); };

export function t(key, vars) {
  const s = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k]) : s;
}

// Fills every element carrying data-i18n="key".
export function applyLanguage() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}
