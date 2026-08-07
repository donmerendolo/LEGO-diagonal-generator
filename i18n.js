// UI strings. English is the default. To add a language, copy the `en` block,
// translate the values, and add a flag button in index.html.

const STRINGS = {
  en: {
    parts: 'Parts',
    marks: 'Marks', join: 'Join', hold: 'Hold',
    open: '📂 Open .ldr or .io',
    leftOut: 'Left out, not in the palette: {n}.',
    strayPins: '{n} marker pins belong to no part that was loaded, and were ignored.',
    nothingKnown: 'Nothing in that file is a part this app knows.',
    tooMany: 'More than {n} joints: two of them share a colour, and the .ldr cannot tell ' +
             'them apart.',
    board: 'Board', angle: 'Angle', level: 'Level (vertical axis)', remove: 'Remove',
    selected: 'Selected part', result: 'Result',
    save: '💾 Save .ldr', reset: '🗑 Start over', undo: '↶ Undo', redo: '↷ Redo',
    snap: 'Snap', snapStud: 'Studs', snapHalf: 'Half studs', snapFree: 'Free',

    flex: 'Off by {n} mm. It will go together with a bit of flex.',
    fails: 'Off by {n} mm. That does not close — try another hole.',
    loose: 'Nothing is held, so the whole thing can slide.',
  },

  es: {
    parts: 'Piezas',
    marks: 'Marcas', join: 'Unir', hold: 'Fijar',
    open: '📂 Abrir .ldr o .io',
    leftOut: 'Se han quedado fuera, no están en la paleta: {n}.',
    strayPins: '{n} pines marcadores no pertenecen a ninguna pieza cargada; se han ignorado.',
    nothingKnown: 'En ese fichero no hay ninguna pieza que esta app conozca.',
    tooMany: 'Más de {n} uniones: dos comparten color y el .ldr no puede distinguirlas.',
    board: 'Tablero', angle: 'Ángulo', level: 'Nivel (eje vertical)', remove: 'Quitar',
    selected: 'Pieza seleccionada', result: 'Resultado',
    save: '💾 Guardar .ldr', reset: '🗑 Empezar de cero', undo: '↶ Deshacer', redo: '↷ Rehacer',
    snap: 'Rejilla', snapStud: 'Studs', snapHalf: 'Medios studs', snapFree: 'Libre',

    flex: 'Se queda a {n} mm. Entra forzando un poco.',
    fails: 'Se queda a {n} mm. Eso no cierra: prueba otro agujero.',
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
