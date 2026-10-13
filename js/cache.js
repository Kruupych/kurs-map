const PREFIX = 'kurs-map:';

export function readCache(key) {
  const raw = localStorage.getItem(PREFIX + key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem(PREFIX + key);
    return null;
  }
}

export function writeCache(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch (error) {
    console.warn(`Кэш «${key}» не сохранён: ${error.message}`);
  }
}

export function removeCache(key) {
  localStorage.removeItem(PREFIX + key);
}
