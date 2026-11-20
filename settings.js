/* ZENURA IGNITE — persistent, accessible website preferences */
(() => {
  'use strict';
  const root = document.documentElement;
  const panel = document.getElementById('site-settings-panel');
  const toggle = document.getElementById('site-settings-toggle');
  if (!panel || !toggle) return;

  const controls = {
    dark: document.getElementById('dark-mode-toggle'),
    night: document.getElementById('night-mode-toggle'),
    font: document.getElementById('font-size-setting'),
    contrast: document.getElementById('contrast-setting'),
    motion: document.getElementById('motion-setting'),
    compact: document.getElementById('compact-setting')
  };
  const defaults = { dark: true, night: false, font: 'normal', contrast: false, motion: false, compact: false };
  const storageKey = 'zenura-website-settings-v2';
  let settings = { ...defaults };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    settings = { ...defaults, ...saved };
    if (!['normal', 'large', 'small'].includes(settings.font)) settings.font = 'normal';
  } catch (_) { settings = { ...defaults }; }

  const apply = (persist = true) => {
    root.classList.toggle('zenura-light-mode', !settings.dark);
    root.classList.toggle('zenura-night-mode', settings.night);
    root.classList.toggle('zenura-large-text', settings.font === 'large');
    root.classList.toggle('zenura-small-text', settings.font === 'small');
    root.classList.toggle('zenura-high-contrast', settings.contrast);
    root.classList.toggle('zenura-reduced-motion', settings.motion);
    root.classList.toggle('zenura-compact-layout', settings.compact);
    controls.dark.checked = settings.dark;
    controls.night.checked = settings.night;
    controls.font.value = settings.font;
    controls.contrast.checked = settings.contrast;
    controls.motion.checked = settings.motion;
    controls.compact.checked = settings.compact;
    if (persist) {
      try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch (_) {}
    }
  };

  const close = () => {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  };
  toggle.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    toggle.setAttribute('aria-expanded', String(opening));
    if (opening) panel.querySelector('input,select,button')?.focus();
  });
  document.getElementById('site-settings-close')?.addEventListener('click', close);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { close(); toggle.focus(); }
  });
  controls.dark.addEventListener('change', () => { settings.dark = controls.dark.checked; apply(); });
  controls.night.addEventListener('change', () => { settings.night = controls.night.checked; apply(); });
  controls.font.addEventListener('change', () => { settings.font = controls.font.value; apply(); });
  controls.contrast.addEventListener('change', () => { settings.contrast = controls.contrast.checked; apply(); });
  controls.motion.addEventListener('change', () => { settings.motion = controls.motion.checked; apply(); });
  controls.compact.addEventListener('change', () => { settings.compact = controls.compact.checked; apply(); });
  document.getElementById('settings-reset')?.addEventListener('click', () => {
    settings = { ...defaults };
    apply();
  });
  apply(false);
})();