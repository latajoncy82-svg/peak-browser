const fs = require('fs');
const path = require('path');

const MAX_HISTORY = 1000;
const MAX_DOWNLOADS = 100;
const VALID_THEMES = new Set(['alpine-light', 'alpine-royal', 'alpine-dark']);
const VALID_SEARCH_ENGINES = new Set(['google', 'duckduckgo', 'bing', 'brave']);

function createDefaultSpeedDial() {
  return [
    { id: 'sd-google', title: 'Google', url: 'https://www.google.com' },
    { id: 'sd-youtube', title: 'YouTube', url: 'https://www.youtube.com' },
    { id: 'sd-wikipedia', title: 'Wikipedia', url: 'https://pl.wikipedia.org' },
    { id: 'sd-github', title: 'GitHub', url: 'https://github.com' },
    { id: 'sd-reddit', title: 'Reddit', url: 'https://www.reddit.com' },
    { id: 'sd-chatgpt', title: 'ChatGPT', url: 'https://chatgpt.com' }
  ];
}

function createDefaultState() {
  return {
    settings: {
      theme: 'alpine-light',
      searchEngine: 'google',
      shieldEnabled: true,
      showBookmarksBar: false
    },
    bookmarks: [],
    speedDial: createDefaultSpeedDial(),
    history: [],
    downloads: [],
    shieldTotalBlocked: 0
  };
}

function makeId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

class PeakStore {
  constructor() {
    this.filePath = null;
    this.state = createDefaultState();
    this._saveTimer = null;
    this._dirty = false;
  }

  init(dataDir) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'peak-state.json');
    this.state = this._loadFromDisk();
    return this;
  }

  _loadFromDisk() {
    const defaults = createDefaultState();
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return defaults;
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return defaults;
      }
      const rawSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
      return {
        settings: {
          theme: VALID_THEMES.has(rawSettings.theme) ? rawSettings.theme : defaults.settings.theme,
          searchEngine: VALID_SEARCH_ENGINES.has(rawSettings.searchEngine)
            ? rawSettings.searchEngine
            : defaults.settings.searchEngine,
          shieldEnabled:
            typeof rawSettings.shieldEnabled === 'boolean'
              ? rawSettings.shieldEnabled
              : defaults.settings.shieldEnabled,
          showBookmarksBar:
            typeof rawSettings.showBookmarksBar === 'boolean'
              ? rawSettings.showBookmarksBar
              : defaults.settings.showBookmarksBar
        },
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks.filter((b) => b && b.url) : [],
        speedDial: Array.isArray(parsed.speedDial)
          ? parsed.speedDial.filter((item) => item && item.url)
          : defaults.speedDial,
        history: Array.isArray(parsed.history)
          ? parsed.history.filter((h) => h && h.url).slice(0, MAX_HISTORY)
          : [],
        downloads: Array.isArray(parsed.downloads)
          ? parsed.downloads.filter((d) => d && d.id).slice(0, MAX_DOWNLOADS)
          : [],
        shieldTotalBlocked:
          typeof parsed.shieldTotalBlocked === 'number' && Number.isFinite(parsed.shieldTotalBlocked)
            ? Math.max(0, Math.floor(parsed.shieldTotalBlocked))
            : 0
      };
    } catch {
      return defaults;
    }
  }

  _scheduleSave() {
    if (!this.filePath) return;
    this._dirty = true;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
    }
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flushSync();
    }, 250);
  }

  flushSync() {
    if (!this.filePath || !this._dirty) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    const payload = JSON.stringify(this.state, null, 2);
    const tmpPath = `${this.filePath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(tmpPath, payload, 'utf8');
      try {
        fs.renameSync(tmpPath, this.filePath);
      } catch {
        // Fallback when Windows locks target during quick updates
        fs.writeFileSync(this.filePath, payload, 'utf8');
        if (fs.existsSync(tmpPath)) {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // Ignore cleanup failure
          }
        }
      }
      this._dirty = false;
    } catch {
      // Avoid crashing main process on transient disk write error
    }
  }

  getSettings() {
    return { ...this.state.settings };
  }

  updateSettings(partial) {
    if (!partial || typeof partial !== 'object') return this.getSettings();
    const next = { ...this.state.settings };
    if (VALID_THEMES.has(partial.theme)) {
      next.theme = partial.theme;
    }
    if (VALID_SEARCH_ENGINES.has(partial.searchEngine)) {
      next.searchEngine = partial.searchEngine;
    }
    if (typeof partial.shieldEnabled === 'boolean') {
      next.shieldEnabled = partial.shieldEnabled;
    }
    if (typeof partial.showBookmarksBar === 'boolean') {
      next.showBookmarksBar = partial.showBookmarksBar;
    }
    this.state.settings = next;
    this._scheduleSave();
    return { ...next };
  }

  getBookmarks() {
    return this.state.bookmarks.map((b) => ({ ...b }));
  }

  isBookmarked(url) {
    if (!url) return false;
    return this.state.bookmarks.some((b) => b.url === url);
  }

  addBookmark({ title, url, favicon = '' }) {
    if (!url || url.startsWith('peak://')) return this.getBookmarks();
    const existing = this.state.bookmarks.find((b) => b.url === url);
    if (existing) {
      if (title) existing.title = title;
      if (favicon) existing.favicon = favicon;
      this._scheduleSave();
      return this.getBookmarks();
    }
    let cleanTitle = (title || '').trim();
    if (!cleanTitle) {
      try {
        cleanTitle = new URL(url).hostname || url;
      } catch {
        cleanTitle = url;
      }
    }
    this.state.bookmarks.unshift({
      id: makeId('bm'),
      title: cleanTitle,
      url,
      favicon,
      createdAt: Date.now()
    });
    this._scheduleSave();
    return this.getBookmarks();
  }

  removeBookmark(urlOrId) {
    if (!urlOrId) return this.getBookmarks();
    const before = this.state.bookmarks.length;
    this.state.bookmarks = this.state.bookmarks.filter((b) => b.id !== urlOrId && b.url !== urlOrId);
    if (this.state.bookmarks.length !== before) {
      this._scheduleSave();
    }
    return this.getBookmarks();
  }

  getHistory() {
    return this.state.history.map((h) => ({ ...h }));
  }

  recordHistory({ url, title = '' }) {
    if (!url || url.startsWith('peak://') || url.startsWith('about:') || url.startsWith('data:')) {
      return;
    }
    const now = Date.now();
    const latest = this.state.history[0];
    if (latest && latest.url === url) {
      if (title && title !== url) {
        latest.title = title;
      }
      if (now - latest.visitedAt < 10000) {
        this._scheduleSave();
        return;
      }
      latest.visitedAt = now;
      this._scheduleSave();
      return;
    }

    let cleanTitle = (title || '').trim();
    if (!cleanTitle) {
      try {
        cleanTitle = new URL(url).hostname || url;
      } catch {
        cleanTitle = url;
      }
    }

    this.state.history.unshift({
      id: makeId('hi'),
      url,
      title: cleanTitle,
      visitedAt: now
    });

    if (this.state.history.length > MAX_HISTORY) {
      this.state.history.length = MAX_HISTORY;
    }
    this._scheduleSave();
  }

  clearHistory() {
    this.state.history = [];
    this._scheduleSave();
    return [];
  }

  getSpeedDial() {
    return this.state.speedDial.map((item) => ({ ...item }));
  }

  addSpeedDial({ title, url }) {
    if (!url) return this.getSpeedDial();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return this.getSpeedDial();
    const existing = this.state.speedDial.find((item) => item.url === trimmedUrl);
    if (existing) {
      if (title && title.trim()) existing.title = title.trim();
      this._scheduleSave();
      return this.getSpeedDial();
    }

    let cleanTitle = (title || '').trim();
    if (!cleanTitle) {
      try {
        cleanTitle = new URL(trimmedUrl).hostname.replace(/^www\./, '') || trimmedUrl;
      } catch {
        cleanTitle = trimmedUrl;
      }
    }
    this.state.speedDial.push({
      id: makeId('sd'),
      title: cleanTitle,
      url: trimmedUrl
    });
    this._scheduleSave();
    return this.getSpeedDial();
  }

  removeSpeedDial(id) {
    const before = this.state.speedDial.length;
    this.state.speedDial = this.state.speedDial.filter((item) => item.id !== id);
    if (this.state.speedDial.length !== before) {
      this._scheduleSave();
    }
    return this.getSpeedDial();
  }

  getDownloads() {
    return this.state.downloads.map((d) => ({ ...d }));
  }

  saveDownloads(list) {
    if (!Array.isArray(list)) return;
    this.state.downloads = list.slice(0, MAX_DOWNLOADS).map((d) => ({ ...d }));
    this._scheduleSave();
  }

  incrementShieldBlocked() {
    this.state.shieldTotalBlocked += 1;
    this._scheduleSave();
    return this.state.shieldTotalBlocked;
  }

  getShieldStats() {
    return {
      enabled: this.state.settings.shieldEnabled,
      totalBlocked: this.state.shieldTotalBlocked
    };
  }
}

module.exports = new PeakStore();
module.exports.PeakStore = PeakStore;
