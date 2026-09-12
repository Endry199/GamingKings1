const PREFERENCE_KEY = 'niunx-remember-session';

export function rememberSessionEnabled() {
  return localStorage.getItem(PREFERENCE_KEY) === 'true';
}

export function setRememberSession(enabled) {
  const previousStorage = enabled ? sessionStorage : localStorage;
  const nextStorage = enabled ? localStorage : sessionStorage;
  const authKeyPrefix = 'sb-';

  const keys = Array.from({ length: previousStorage.length }, (_, index) => previousStorage.key(index));
  keys.forEach(key => {
    if (key?.startsWith(authKeyPrefix) && key.endsWith('-auth-token')) {
      const value = previousStorage.getItem(key);
      if (value) nextStorage.setItem(key, value);
      previousStorage.removeItem(key);
    }
  });
  localStorage.setItem(PREFERENCE_KEY, String(enabled));
}

export function authStorage() {
  const storage = rememberSessionEnabled() ? localStorage : sessionStorage;
  return {
    getItem: key => storage.getItem(key),
    setItem: (key, value) => storage.setItem(key, value),
    removeItem: key => storage.removeItem(key)
  };
}
