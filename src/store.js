const fs = require('fs');
const path = require('path');

const MAX_HISTORY = 1000;
const MAX_DOWNLOADS = 100;
const VALID_THEMES = new Set(['alpine-light', 'alpine-royal', 'alpine-dark']);
const VALID_SEARCH_ENGINES = new Set(['google', 'duckduckgo', 'bing', 'brave']);
const VALID_SHIELD_LEVELS = new Set(['off', 'standard', 'aggressive']);

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

function normalizeHost(rawHost) {
  if (!rawHost || typeof rawHost !== 'string') return '';
  let text = rawHost.trim().toLowerCase();
  if (!text) return '';
  if (text.includes('://')) {
    try {
      text = new URL(text).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
  text = text.replace(/:\d+$/, '').replace(/^www\./, '');
  if (!/^[a-z0-9.-]+$/.test(text) || !text.includes('.')) {
    return '';
  }
  return text;
}

function clampZoom(val) {
  const num = Number(val);
  if (!Number.isFinite(num)) return 1;
  return Math.min(2, Math.max(0.5, Math.round(num * 100) / 100));
}

function createDefaultState() {
  return {
    uiVersion: 2,
    settings: {
      theme: 'alpine-dark',
      searchEngine: 'google',
      defaultZoom: 1,
      shieldEnabled: true,
      shieldLevel: 'aggressive',
      cosmeticBlocking: true,
      httpsUpgrade: true,
      stripTrackingParams: true,
      privacyHeaders: true,
      blockNotifications: true,
      allowlist: [],
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
    const { state, migrated } = this._loadFromDisk();
    this.state = state;
    if (migrated) {
      this._scheduleSave();
    }
    return this;
  }

  _loadFromDisk() {
    const defaults = createDefaultState();
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      return { state: defaults, migrated: false };
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return { state: defaults, migrated: false };
      }
      const rawSettings = parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {};
      const loadedUiVersion = typeof parsed.uiVersion === 'number' ? parsed.uiVersion : 1;
      let theme = VALID_THEMES.has(rawSettings.theme) ? rawSettings.theme : defaults.settings.theme;
      const migrated = loadedUiVersion < 2;
      if (loadedUiVersion < 2 && theme === 'alpine-light') {
        theme = 'alpine-dark';
      }

      const rawShieldEnabled =
        typeof rawSettings.shieldEnabled === 'boolean'
          ? rawSettings.shieldEnabled
          : defaults.settings.shieldEnabled;

      let shieldLevel = VALID_SHIELD_LEVELS.has(rawSettings.shieldLevel)
        ? rawSettings.shieldLevel
        : rawShieldEnabled
          ? defaults.settings.shieldLevel
          : 'off';
      const shieldEnabled = shieldLevel !== 'off';

      const allowlist = Array.isArray(rawSettings.allowlist)
        ? Array.from(new Set(rawSettings.allowlist.map(normalizeHost).filter(Boolean)))
        : [];

      return {
        migrated,
        state: {
          uiVersion: 2,
          settings: {
            theme,
            searchEngine: VALID_SEARCH_ENGINES.has(rawSettings.searchEngine)
              ? rawSettings.searchEngine
              : defaults.settings.searchEngine,
            defaultZoom:
              typeof rawSettings.defaultZoom === 'number'
                ? clampZoom(rawSettings.defaultZoom)
                : defaults.settings.defaultZoom,
            shieldEnabled,
            shieldLevel,
            cosmeticBlocking:
              typeof rawSettings.cosmeticBlocking === 'boolean'
                ? rawSettings.cosmeticBlocking
                : defaults.settings.cosmeticBlocking,
            httpsUpgrade:
              typeof rawSettings.httpsUpgrade === 'boolean'
                ? rawSettings.httpsUpgrade
                : defaults.settings.httpsUpgrade,
            stripTrackingParams:
              typeof rawSettings.stripTrackingParams === 'boolean'
                ? rawSettings.stripTrackingParams
                : defaults.settings.stripTrackingParams,
            privacyHeaders:
              typeof rawSettings.privacyHeaders === 'boolean'
                ? rawSettings.privacyHeaders
                : defaults.settings.privacyHeaders,
            blockNotifications:
              typeof rawSettings.blockNotifications === 'boolean'
                ? rawSettings.blockNotifications
                : defaults.settings.blockNotifications,
            allowlist,
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
        }
      };
    } catch {
      return { state: defaults, migrated: false };
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
    return {
      ...this.state.settings,
      allowlist: [...this.state.settings.allowlist]
    };
  }

  updateSettings(partial) {
    if (!partial || typeof partial !== 'object') return this.getSettings();
    const next = {
      ...this.state.settings,
      allowlist: [...this.state.settings.allowlist]
    };
    if (VALID_THEMES.has(partial.theme)) {
      next.theme = partial.theme;
    }
    if (VALID_SEARCH_ENGINES.has(partial.searchEngine)) {
      next.searchEngine = partial.searchEngine;
    }
    if (typeof partial.defaultZoom === 'number') {
      next.defaultZoom = clampZoom(partial.defaultZoom);
    }
    if (VALID_SHIELD_LEVELS.has(partial.shieldLevel)) {
      next.shieldLevel = partial.shieldLevel;
      next.shieldEnabled = partial.shieldLevel !== 'off';
    } else if (typeof partial.shieldEnabled === 'boolean') {
      next.shieldEnabled = partial.shieldEnabled;
      if (!partial.shieldEnabled) {
        next.shieldLevel = 'off';
      } else if (next.shieldLevel === 'off') {
        next.shieldLevel = 'aggressive';
      }
    }
    if (typeof partial.cosmeticBlocking === 'boolean') {
      next.cosmeticBlocking = partial.cosmeticBlocking;
    }
    if (typeof partial.httpsUpgrade === 'boolean') {
      next.httpsUpgrade = partial.httpsUpgrade;
    }
    if (typeof partial.stripTrackingParams === 'boolean') {
      next.stripTrackingParams = partial.stripTrackingParams;
    }
    if (typeof partial.privacyHeaders === 'boolean') {
      next.privacyHeaders = partial.privacyHeaders;
    }
    if (typeof partial.blockNotifications === 'boolean') {
      next.blockNotifications = partial.blockNotifications;
    }
    if (Array.isArray(partial.allowlist)) {
      next.allowlist = Array.from(new Set(partial.allowlist.map(normalizeHost).filter(Boolean)));
    }
    if (typeof partial.showBookmarksBar === 'boolean') {
      next.showBookmarksBar = partial.showBookmarksBar;
    }
    this.state.settings = next;
    this._scheduleSave();
    return this.getSettings();
  }

  isHostAllowlisted(rawHost) {
    const host = normalizeHost(rawHost);
    if (!host) return false;
    return this.state.settings.allowlist.includes(host);
  }

  addAllowlistHost(rawHost) {
    const host = normalizeHost(rawHost);
    if (!host) return this.getSettings().allowlist;
    if (!this.state.settings.allowlist.includes(host)) {
      this.state.settings.allowlist = [host, ...this.state.settings.allowlist];
      this._scheduleSave();
    }
    return [...this.state.settings.allowlist];
  }

  removeAllowlistHost(rawHost) {
    const host = normalizeHost(rawHost);
    if (!host) return this.getSettings().allowlist;
    const before = this.state.settings.allowlist.length;
    this.state.settings.allowlist = this.state.settings.allowlist.filter((h) => h !== host);
    if (this.state.settings.allowlist.length !== before) {
      this._scheduleSave();
    }
    return [...this.state.settings.allowlist];
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

  importBookmarks(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return { added: 0, skipped: 0, total: this.state.bookmarks.length };
    }
    const existingUrls = new Set(this.state.bookmarks.map((b) => b.url));
    const newlyAdded = [];
    let skipped = 0;

    for (const raw of items) {
      if (!raw || typeof raw.url !== 'string') continue;
      const url = raw.url.trim();
      if (!/^https?:\/\//i.test(url)) continue;
      if (existingUrls.has(url)) {
        skipped += 1;
        continue;
      }
      existingUrls.add(url);
      let cleanTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
      if (!cleanTitle) {
        try {
          cleanTitle = new URL(url).hostname || url;
        } catch {
          cleanTitle = url;
        }
      }
      newlyAdded.push({
        id: makeId('bm'),
        title: cleanTitle,
        url,
        favicon: typeof raw.favicon === 'string' ? raw.favicon : '',
        createdAt:
          typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) && raw.createdAt > 0
            ? raw.createdAt
            : Date.now()
      });
    }

    if (newlyAdded.length > 0) {
      this.state.bookmarks = [...newlyAdded, ...this.state.bookmarks];
      this._scheduleSave();
    }
    return {
      added: newlyAdded.length,
      skipped,
      total: this.state.bookmarks.length
    };
  }

  importHistory(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return { added: 0, skipped: 0, total: this.state.history.length };
    }
    const byUrl = new Map();
    for (const existing of this.state.history) {
      if (existing && existing.url && !byUrl.has(existing.url)) {
        byUrl.set(existing.url, { ...existing });
      }
    }

    let added = 0;
    let skipped = 0;
    let changed = false;

    for (const raw of items) {
      if (!raw || typeof raw.url !== 'string') continue;
      const url = raw.url.trim();
      if (!/^https?:\/\//i.test(url)) continue;

      let cleanTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
      if (!cleanTitle) {
        try {
          cleanTitle = new URL(url).hostname || url;
        } catch {
          cleanTitle = url;
        }
      }
      const visitedAt =
        typeof raw.visitedAt === 'number' && Number.isFinite(raw.visitedAt) && raw.visitedAt > 0
          ? raw.visitedAt
          : Date.now();

      const existing = byUrl.get(url);
      if (existing) {
        skipped += 1;
        if (visitedAt > (existing.visitedAt || 0)) {
          existing.visitedAt = visitedAt;
          if (cleanTitle) existing.title = cleanTitle;
          changed = true;
        } else if ((!existing.title || existing.title === existing.url) && cleanTitle) {
          existing.title = cleanTitle;
          changed = true;
        }
      } else {
        added += 1;
        changed = true;
        byUrl.set(url, {
          id: makeId('hi'),
          url,
          title: cleanTitle,
          visitedAt
        });
      }
    }

    if (changed) {
      const merged = Array.from(byUrl.values()).sort((a, b) => (b.visitedAt || 0) - (a.visitedAt || 0));
      if (merged.length > MAX_HISTORY) {
        merged.length = MAX_HISTORY;
      }
      this.state.history = merged;
      this._scheduleSave();
    }

    return {
      added,
      skipped,
      total: this.state.history.length
    };
  }

  importSpeedDial(items = [], maxAdd = 4) {
    if (!Array.isArray(items) || items.length === 0) {
      return { added: 0, total: this.state.speedDial.length };
    }
    const maxSlots = 10;
    const existingUrls = new Set(this.state.speedDial.map((item) => item.url));
    let added = 0;

    for (const raw of items) {
      if (added >= maxAdd || this.state.speedDial.length >= maxSlots) break;
      if (!raw || typeof raw.url !== 'string') continue;
      const url = raw.url.trim();
      if (!/^https?:\/\//i.test(url) || existingUrls.has(url)) continue;

      let cleanTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
      if (!cleanTitle) {
        try {
          cleanTitle = new URL(url).hostname.replace(/^www\./, '') || url;
        } catch {
          cleanTitle = url;
        }
      }
      if (cleanTitle.length > 32) {
        cleanTitle = cleanTitle.slice(0, 32).trim();
      }
      existingUrls.add(url);
      this.state.speedDial.push({
        id: makeId('sd'),
        title: cleanTitle,
        url
      });
      added += 1;
    }

    if (added > 0) {
      this._scheduleSave();
    }
    return {
      added,
      total: this.state.speedDial.length
    };
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
      level: this.state.settings.shieldLevel,
      totalBlocked: this.state.shieldTotalBlocked
    };
  }
}

module.exports = new PeakStore();
module.exports.PeakStore = PeakStore;
module.exports.normalizeHost = normalizeHost;
