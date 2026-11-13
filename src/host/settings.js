/** Settings persistence: JSON file plus the v5 merge/patch/public helpers. */
import { SETTINGS_VERSION, applySettingsPatch, mergeSettings, publicSettings } from '../shared/contract.js'

export const SETTINGS_FILE = 'settings.json'

/**
 * Settings store. `get()` holds the live normalized object (and it is what the
 * lock controller reads); `getPublic()` strips the DingTalk token.
 */
export function createSettingsStore({ storage = null } = {}) {
  let current = mergeSettings(null)

  function persist() {
    if (storage === null || typeof storage.writeJson !== 'function') return Promise.resolve()
    return storage.writeJson(SETTINGS_FILE, current).catch(() => {})
  }

  return {
    async load() {
      const raw = await (storage?.readJson?.(SETTINGS_FILE, null) ?? Promise.resolve(null))
      current = mergeSettings(raw)
      // Rewrite at boot so a legacy document becomes a clean v5 file.
      if (raw === null || raw === undefined || raw.version !== SETTINGS_VERSION) await persist()
      return current
    },

    get() {
      return current
    },

    getPublic() {
      return publicSettings(current)
    },

    /** Apply a browser patch (`applySettingsPatch` keeps/clears the token per contract). */
    async update(patch) {
      current = applySettingsPatch(current, patch)
      await persist()
      return current
    },
  }
}
