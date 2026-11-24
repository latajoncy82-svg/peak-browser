const fs = require('fs');
const path = require('path');
const os = require('os');
const { DatabaseSync } = require('node:sqlite');

const WEBKIT_EPOCH_OFFSET_MS = 11644473600000;

function isHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeHtmlEntities(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16) || 32));
}

function webkitMicrosToUnixMs(webkitMicros) {
  const num = Number(webkitMicros);
  if (!Number.isFinite(num) || num <= 0) return Date.now();
  const ms = Math.floor(num / 1000 - WEBKIT_EPOCH_OFFSET_MS);
  if (ms < 0 || ms > Date.now() + 86400000 * 365) return Date.now();
  return ms;
}

function getChromiumProfileDisplayName(userDataDir, folderName, localStateCache) {
  if (localStateCache && localStateCache[folderName] && localStateCache[folderName].name) {
    return String(localStateCache[folderName].name).trim();
  }
  const prefsPath = path.join(userDataDir, folderName, 'Preferences');
  if (fs.existsSync(prefsPath)) {
    try {
      const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
      const name = prefs && prefs.profile && prefs.profile.name;
      if (name && typeof name === 'string') return name.trim();
    } catch {
      // Ignore unreadable Preferences
    }
  }
  return folderName === 'Default' ? 'Domyślny' : folderName;
}

function readLocalStateCache(userDataDir) {
  const localStatePath = path.join(userDataDir, 'Local State');
  if (!fs.existsSync(localStatePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    return parsed && parsed.profile && parsed.profile.info_cache ? parsed.profile.info_cache : null;
  } catch {
    return null;
  }
}

function safeFileHasBytes(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function detectBrowsers() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

  const chromiumRoots = [
    { browserId: 'chrome', browserName: 'Google Chrome', userDataDir: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
    { browserId: 'edge', browserName: 'Microsoft Edge', userDataDir: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
    { browserId: 'brave', browserName: 'Brave', userDataDir: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    { browserId: 'vivaldi', browserName: 'Vivaldi', userDataDir: path.join(localAppData, 'Vivaldi', 'User Data') },
    { browserId: 'opera-gx', browserName: 'Opera GX', userDataDir: path.join(appData, 'Opera Software', 'Opera GX Stable'), singleRoot: true },
    { browserId: 'opera', browserName: 'Opera', userDataDir: path.join(appData, 'Opera Software', 'Opera Stable'), singleRoot: true }
  ];

  const detected = [];

  for (const spec of chromiumRoots) {
    if (!fs.existsSync(spec.userDataDir)) continue;
    const localStateCache = readLocalStateCache(spec.userDataDir);

    if (spec.singleRoot) {
      const candidates = [spec.userDataDir, path.join(spec.userDataDir, 'Default')];
      for (const dir of candidates) {
        const hasBookmarks = safeFileHasBytes(path.join(dir, 'Bookmarks'));
        const hasHistory = safeFileHasBytes(path.join(dir, 'History'));
        if (!hasBookmarks && !hasHistory) continue;
        const folder = path.basename(dir) === 'Default' ? 'Domyślny' : 'Główny profil';
        detected.push({
          id: `${spec.browserId}:${dir}`,
          browserId: spec.browserId,
          browserName: spec.browserName,
          profileName: folder,
          label: `${spec.browserName} (${folder})`,
          type: 'chromium',
          profileDir: dir,
          hasBookmarks,
          hasHistory
        });
        break;
      }
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(spec.userDataDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const profileFolders = entries
      .filter((entry) => entry.isDirectory() && (entry.name === 'Default' || /^Profile \d+$/i.test(entry.name)))
      .map((entry) => entry.name)
      .sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b)));

    for (const folderName of profileFolders) {
      const profileDir = path.join(spec.userDataDir, folderName);
      const hasBookmarks = safeFileHasBytes(path.join(profileDir, 'Bookmarks'));
      const hasHistory = safeFileHasBytes(path.join(profileDir, 'History'));
      if (!hasBookmarks && !hasHistory) continue;
      const profileName = getChromiumProfileDisplayName(spec.userDataDir, folderName, localStateCache);
      detected.push({
        id: `${spec.browserId}:${profileDir}`,
        browserId: spec.browserId,
        browserName: spec.browserName,
        profileName,
        label: `${spec.browserName} (${profileName})`,
        type: 'chromium',
        profileDir,
        hasBookmarks,
        hasHistory
      });
    }
  }

  const firefoxRoot = path.join(appData, 'Mozilla', 'Firefox', 'Profiles');
  if (fs.existsSync(firefoxRoot)) {
    let entries = [];
    try {
      entries = fs.readdirSync(firefoxRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const profileDir = path.join(firefoxRoot, entry.name);
      const placesPath = path.join(profileDir, 'places.sqlite');
      if (!safeFileHasBytes(placesPath)) continue;
      const dotIdx = entry.name.indexOf('.');
      const friendly = dotIdx >= 0 ? entry.name.slice(dotIdx + 1) : entry.name;
      detected.push({
        id: `firefox:${profileDir}`,
        browserId: 'firefox',
        browserName: 'Mozilla Firefox',
        profileName: friendly || entry.name,
        label: `Mozilla Firefox (${friendly || entry.name})`,
        type: 'firefox',
        profileDir,
        hasBookmarks: true,
        hasHistory: true
      });
    }
  }

  return detected;
}

function parseChromiumBookmarksFile(filePath) {
  if (!safeFileHasBytes(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);
  const roots = (data && data.roots) || {};
  const results = [];
  const seen = new Set();

  const walk = (node, fromBar) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'url' && isHttpUrl(node.url)) {
      const url = node.url.trim();
      if (!seen.has(url)) {
        seen.add(url);
        results.push({
          title: typeof node.name === 'string' ? node.name.trim() : '',
          url,
          createdAt: webkitMicrosToUnixMs(node.date_added),
          fromBar
        });
      }
      return;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child, fromBar);
      }
    }
  };

  if (roots.bookmark_bar) walk(roots.bookmark_bar, true);
  if (roots.other) walk(roots.other, false);
  if (roots.synced) walk(roots.synced, false);

  return results;
}

function withTempSqliteCopy(dbPath, fn) {
  if (!safeFileHasBytes(dbPath)) {
    return null;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'peak-import-'));
  const baseName = path.basename(dbPath);
  const tempDbPath = path.join(tmpDir, baseName);
  let db = null;

  try {
    fs.copyFileSync(dbPath, tempDbPath);
    for (const suffix of ['-wal', '-shm']) {
      const sidePath = `${dbPath}${suffix}`;
      if (fs.existsSync(sidePath)) {
        try {
          fs.copyFileSync(sidePath, `${tempDbPath}${suffix}`);
        } catch {
          // Ignore sidecar lock errors; main sqlite copy usually remains readable
        }
      }
    }
    db = new DatabaseSync(tempDbPath);
    return fn(db);
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup errors
    }
  }
}

function parseChromiumHistoryDb(dbPath, limit = 500) {
  const rows = withTempSqliteCopy(dbPath, (db) => {
    const stmt = db.prepare(
      "SELECT url, title, CAST(last_visit_time / 1000 AS INTEGER) AS last_visit_ms FROM urls WHERE url LIKE 'http%' ORDER BY last_visit_time DESC LIMIT ?"
    );
    return stmt.all(limit);
  });
  if (!Array.isArray(rows)) return [];
  const results = [];
  for (const row of rows) {
    if (!row || !isHttpUrl(row.url)) continue;
    const msNum = Number(row.last_visit_ms);
    const visitedAt =
      Number.isFinite(msNum) && msNum > WEBKIT_EPOCH_OFFSET_MS
        ? msNum - WEBKIT_EPOCH_OFFSET_MS
        : Date.now();
    results.push({
      url: row.url.trim(),
      title: typeof row.title === 'string' ? row.title.trim() : '',
      visitedAt: visitedAt <= Date.now() + 86400000 * 365 ? visitedAt : Date.now()
    });
  }
  return results;
}

function parseFirefoxPlacesDb(dbPath, options = {}) {
  const { includeBookmarks = true, includeHistory = true, historyLimit = 500 } = options;
  const output = { bookmarks: [], history: [] };

  withTempSqliteCopy(dbPath, (db) => {
    if (includeBookmarks) {
      const bRows = db
        .prepare(
          "SELECT p.url AS url, COALESCE(NULLIF(b.title, ''), p.title, '') AS title, CAST(b.dateAdded / 1000 AS INTEGER) AS addedMs, b.parent AS parent FROM moz_bookmarks b JOIN moz_places p ON b.fk = p.id WHERE b.type = 1 AND p.url LIKE 'http%' ORDER BY b.dateAdded DESC"
        )
        .all();
      const seen = new Set();
      for (const row of bRows) {
        if (!row || !isHttpUrl(row.url)) continue;
        const url = row.url.trim();
        if (seen.has(url)) continue;
        seen.add(url);
        const addedNum = Number(row.addedMs);
        output.bookmarks.push({
          title: typeof row.title === 'string' ? row.title.trim() : '',
          url,
          createdAt: Number.isFinite(addedNum) && addedNum > 0 ? addedNum : Date.now(),
          fromBar: Number(row.parent) === 3
        });
      }
    }

    if (includeHistory) {
      const hRows = db
        .prepare(
          "SELECT url, title, CAST(last_visit_date / 1000 AS INTEGER) AS visitMs FROM moz_places WHERE url LIKE 'http%' AND last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT ?"
        )
        .all(historyLimit);
      for (const row of hRows) {
        if (!row || !isHttpUrl(row.url)) continue;
        const visitNum = Number(row.visitMs);
        output.history.push({
          url: row.url.trim(),
          title: typeof row.title === 'string' ? row.title.trim() : '',
          visitedAt: Number.isFinite(visitNum) && visitNum > 0 ? visitNum : Date.now()
        });
      }
    }
  });

  return output;
}

function parseHtmlBookmarks(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') return [];
  const results = [];
  const seen = new Set();
  const linkRegex = /<A\b([^>]*)>([\s\S]*?)<\/A>/gi;
  let match;

  while ((match = linkRegex.exec(htmlContent)) !== null) {
    const attrs = match[1] || '';
    const rawTitle = match[2] || '';
    const hrefMatch = /HREF\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!hrefMatch) continue;
    const url = decodeHtmlEntities(hrefMatch[1]).trim();
    if (!isHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);

    let createdAt = Date.now();
    const dateMatch = /ADD_DATE\s*=\s*["']?(\d+)["']?/i.exec(attrs);
    if (dateMatch) {
      const sec = Number(dateMatch[1]);
      if (Number.isFinite(sec) && sec > 0) {
        createdAt = sec > 1e12 ? sec : sec * 1000;
      }
    }

    const title = decodeHtmlEntities(rawTitle.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    results.push({
      title,
      url,
      createdAt,
      fromBar: true
    });
  }

  return results;
}

function importFromSource(sourceOrId, options = {}, targetStore) {
  const { bookmarks = true, history = true, speedDial = false, historyLimit = 500 } = options;
  const source =
    typeof sourceOrId === 'string'
      ? detectBrowsers().find((item) => item.id === sourceOrId)
      : sourceOrId;

  if (!source) {
    return { ok: false, error: 'Nie znaleziono wybranego profilu przeglądarki.' };
  }
  if (!targetStore) {
    return { ok: false, error: 'Brak docelowej bazy danych Peak Browser.' };
  }

  const warnings = [];
  let extractedBookmarks = [];
  let extractedHistory = [];

  if (source.type === 'chromium') {
    if (bookmarks) {
      const bmPath = path.join(source.profileDir, 'Bookmarks');
      try {
        extractedBookmarks = parseChromiumBookmarksFile(bmPath);
      } catch (err) {
        warnings.push(`Nie udało się odczytać zakładek (${err.message}).`);
      }
    }
    if (history) {
      const histPath = path.join(source.profileDir, 'History');
      try {
        extractedHistory = parseChromiumHistoryDb(histPath, historyLimit);
      } catch (err) {
        warnings.push(`Nie udało się odczytać bazy historii (${err.message}).`);
      }
    }
  } else if (source.type === 'firefox') {
    const placesPath = path.join(source.profileDir, 'places.sqlite');
    try {
      const parsed = parseFirefoxPlacesDb(placesPath, {
        includeBookmarks: Boolean(bookmarks),
        includeHistory: Boolean(history),
        historyLimit
      });
      extractedBookmarks = parsed.bookmarks;
      extractedHistory = parsed.history;
    } catch (err) {
      warnings.push(`Nie udało się odczytać bazy Firefox (${err.message}).`);
    }
  } else {
    return { ok: false, error: 'Nieobsługiwany typ profilu przeglądarki.' };
  }

  const bmRes = bookmarks ? targetStore.importBookmarks(extractedBookmarks) : { added: 0, skipped: 0 };
  const histRes = history ? targetStore.importHistory(extractedHistory) : { added: 0, skipped: 0 };
  let speedDialAdded = 0;
  if (speedDial && extractedBookmarks.length > 0) {
    const barFirst = [
      ...extractedBookmarks.filter((b) => b.fromBar),
      ...extractedBookmarks.filter((b) => !b.fromBar)
    ];
    speedDialAdded = targetStore.importSpeedDial(barFirst, 4).added;
  }

  targetStore.flushSync();

  return {
    ok: true,
    sourceLabel: source.label || source.browserName || 'Przeglądarka',
    bookmarksAdded: bmRes.added,
    bookmarksSkipped: bmRes.skipped,
    historyAdded: histRes.added,
    historySkipped: histRes.skipped,
    speedDialAdded,
    warnings
  };
}

function importFromHtmlFile(filePath, targetStore, options = {}) {
  if (!filePath || !safeFileHasBytes(filePath)) {
    return { ok: false, error: 'Wybrany plik HTML jest pusty lub nie istnieje.' };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseHtmlBookmarks(content);
  if (parsed.length === 0) {
    return { ok: false, error: 'W wybranym pliku nie znaleziono żadnych zakładek HTTP/HTTPS.' };
  }
  const bmRes = targetStore.importBookmarks(parsed);
  let speedDialAdded = 0;
  if (options.speedDial) {
    speedDialAdded = targetStore.importSpeedDial(parsed, 4).added;
  }
  targetStore.flushSync();

  return {
    ok: true,
    sourceLabel: path.basename(filePath),
    bookmarksAdded: bmRes.added,
    bookmarksSkipped: bmRes.skipped,
    historyAdded: 0,
    historySkipped: 0,
    speedDialAdded,
    warnings: []
  };
}

module.exports = {
  detectBrowsers,
  parseChromiumBookmarksFile,
  parseChromiumHistoryDb,
  parseFirefoxPlacesDb,
  parseHtmlBookmarks,
  importFromSource,
  importFromHtmlFile,
  webkitMicrosToUnixMs
};
