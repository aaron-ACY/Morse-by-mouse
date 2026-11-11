'use strict';

importScripts('morse-bindings.js');

const { cloneDefaultBindings, migrateLegacySettingsToBindings } = self.MorseBindings;

const DEFAULT_SETTINGS = {
  enabled: false,
  scope: 'always', // 'always' | 'inputs-only'
  dashThresholdMs: 200,
  letterGapMs: 600,
  wordGapMs: 1400,
  autoSpace: false,
  letterCase: 'lower', // 'lower' | 'upper'
  soundEnabled: true,
  soundVolume: 80,
  showHud: true,
  bindings: cloneDefaultBindings(),
  settingsVersion: 5
};

async function ensureDefaults() {
  const keys = [
    ...Object.keys(DEFAULT_SETTINGS),
    'leftClickSpace',
    'deleteMacro',
    'deleteCustomButton'
  ];
  const current = await chrome.storage.local.get(keys);
  const patch = {};
  let hasPatch = false;

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) {
      patch[key] = value;
      hasPatch = true;
    }
  }

  if ((current.settingsVersion || 1) < 2) {
    patch.autoSpace = false;
  }

  if ((current.settingsVersion || 1) < 4) {
    patch.bindings = migrateLegacySettingsToBindings(current);
    hasPatch = true;
  }

  if ((current.settingsVersion || 1) < 5) {
    patch.enabled = false;
    patch.settingsVersion = 5;
    hasPatch = true;
  }

  if (hasPatch) {
    await chrome.storage.local.set(patch);
  }
  const enabled =
    patch.enabled !== undefined
      ? patch.enabled
      : current.enabled !== undefined
      ? current.enabled
      : DEFAULT_SETTINGS.enabled;
  await updateBadge(enabled);
}

async function updateBadge(enabled) {
  try {
    await chrome.action.setBadgeText({ text: enabled ? 'ON' : 'OFF' });
    await chrome.action.setBadgeBackgroundColor({
      color: enabled ? '#06b6d4' : '#64748b'
    });
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  } catch (_err) {
    // Ignore if action API is unavailable during teardown
  }
}

chrome.runtime.onInstalled.addListener(() => ensureDefaults());

chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.local.set({ enabled: false });
  await updateBadge(false);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.enabled) {
    updateBadge(Boolean(changes.enabled.newValue));
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-morse') return;
  const { enabled, showHud } = await chrome.storage.local.get({
    enabled: DEFAULT_SETTINGS.enabled,
    showHud: DEFAULT_SETTINGS.showHud
  });
  if (!enabled) return;
  await chrome.storage.local.set({ showHud: !showHud });
});
