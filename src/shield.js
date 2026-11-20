const fs = require('fs');
const path = require('path');
const { FiltersEngine, Request } = require('@ghostery/adblocker');
const { parse: parseDomain } = require('tldts-experimental');

const FILTER_LISTS = [
  { id: 'easylist', name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
  { id: 'easyprivacy', name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
  {
    id: 'peter-lowe',
    name: 'Peter Lowe Ad & Tracking',
    url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext'
  },
  {
    id: 'ublock-filters',
    name: 'uBlock Origin Filters',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt'
  },
  {
    id: 'ublock-privacy',
    name: 'uBlock Origin Privacy',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt'
  },
  {
    id: 'polish-ads',
    name: 'Polskie filtry reklamowe (MajkiIT)',
    url: 'https://raw.githubusercontent.com/MajkiIT/polish-ads-filter/master/polish-adblock-filters/adblock.txt'
  }
];

const FALLBACK_BLOCKED_HOSTS = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adservice.google.com',
  'google-analytics.com',
  'googletagmanager.com',
  'pagead2.googlesyndication.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
  'amazon-adsystem.com',
  'adnxs.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'scorecardresearch.com',
  'quantserve.com',
  'hotjar.com',
  'mouseflow.com',
  'fullstory.com',
  'mixpanel.com',
  'segment.io',
  'adroll.com',
  'adsrvr.org',
  'moatads.com',
  'serving-sys.com',
  'zedo.com',
  'revcontent.com',
  'mgid.com',
  'popads.net',
  'propellerads.com',
  'gemius.pl',
  'hit.gemius.pl'
];

const AGGRESSIVE_EXTRA_HOSTS = [
  'coinhive.com',
  'coin-hive.com',
  'jsecoin.com',
  'cryptoloot.pro',
  'webminepool.com',
  'adcolony.com',
  'applovin.com',
  'chartboost.com',
  'inmobi.com',
  'unityads.unity3d.com',
  'vungle.com',
  'yandexadexchange.net',
  'mc.yandex.ru',
  'an.yandex.ru',
  'ads-twitter.com',
  'analytics.tiktok.com',
  'pixel.facebook.com',
  'connect.facebook.net'
];

const AGGRESSIVE_URL_PATTERNS = [
  /^https?:\/\/([^/]*\.)?youtube\.com\/(api\/stats\/ads|pagead\/|get_midroll_info|ptracking)/i,
  /^https?:\/\/([^/]*\.)?youtubei\.googleapis\.com\/youtubei\/v1\/player\/ad_break/i,
  /^https?:\/\/([^/]*\.)?doubleclick\.net\//i,
  /^https?:\/\/([^/]*\.)?googlesyndication\.com\//i
];

const TRACKING_EXACT_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'yclid',
  'wickedid',
  'oly_enc_id',
  'oly_anon_id',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
  'vero_id',
  'zanpid',
  'igshid',
  'si',
  'spm'
]);

const SAFE_PROTOCOLS = new Set(['peak:', 'file:', 'data:', 'blob:', 'about:', 'devtools:']);

const YOUTUBE_COSMETIC_CSS = `
ytd-ad-slot-renderer,
ytd-in-feed-ad-layout-renderer,
ytd-banner-promo-renderer,
ytd-promoted-sparkles-web-renderer,
ytd-promoted-sparkles-text-search-renderer,
ytd-display-ad-renderer,
ytd-companion-slot-renderer,
ytd-player-legacy-desktop-watch-ads-renderer,
#masthead-ad,
#player-ads,
.ytd-merch-shelf-renderer,
.ytp-ad-module,
.ytp-ad-overlay-container,
.ytp-ad-text-overlay,
.video-ads {
  display: none !important;
}
`;

let activeEngine = null;
let activeMeta = {
  loaded: false,
  ruleCount: 0,
  updatedAt: null,
  lists: FILTER_LISTS.map((l) => l.name)
};

function isLocalOrPrivateHost(hostname) {
  if (!hostname) return true;
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1' ||
    host.endsWith('.local')
  ) {
    return true;
  }
  if (/^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }
  const m172 = /^172\.(\d{1,3})\./.exec(host);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function hostMatchesList(hostname, list) {
  const host = (hostname || '').toLowerCase();
  for (const item of list) {
    if (host === item || host.endsWith(`.${item}`)) {
      return true;
    }
  }
  return false;
}

function getEngineRuleCount(engine) {
  if (!engine) return 0;
  try {
    const { networkFilters, cosmeticFilters } = engine.getFilters();
    return networkFilters.length + cosmeticFilters.length;
  } catch {
    return 0;
  }
}

function readEngineFiles(binPath, metaPath) {
  if (!fs.existsSync(binPath)) return null;
  const buf = fs.readFileSync(binPath);
  const engine = FiltersEngine.deserialize(new Uint8Array(buf));
  let meta = null;
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
      meta = null;
    }
  }
  const ruleCount = (meta && typeof meta.ruleCount === 'number' && meta.ruleCount) || getEngineRuleCount(engine);
  return {
    engine,
    meta: {
      loaded: true,
      ruleCount,
      updatedAt: (meta && meta.updatedAt) || fs.statSync(binPath).mtime.toISOString(),
      lists: (meta && Array.isArray(meta.lists) && meta.lists) || FILTER_LISTS.map((l) => l.name)
    }
  };
}

function initShield(userDataDir, bundledAssetsDir) {
  const userBin = userDataDir ? path.join(userDataDir, 'shield-engine.bin') : null;
  const userMeta = userDataDir ? path.join(userDataDir, 'shield-meta.json') : null;
  const bundledBin = bundledAssetsDir ? path.join(bundledAssetsDir, 'shield-engine.bin') : null;
  const bundledMeta = bundledAssetsDir ? path.join(bundledAssetsDir, 'shield-meta.json') : null;

  const candidates = [];
  if (userBin && fs.existsSync(userBin)) {
    candidates.push({ bin: userBin, meta: userMeta, mtime: fs.statSync(userBin).mtimeMs });
  }
  if (bundledBin && fs.existsSync(bundledBin)) {
    candidates.push({ bin: bundledBin, meta: bundledMeta, mtime: fs.statSync(bundledBin).mtimeMs });
  }
  candidates.sort((a, b) => b.mtime - a.mtime);

  for (const candidate of candidates) {
    try {
      const loaded = readEngineFiles(candidate.bin, candidate.meta);
      if (loaded) {
        activeEngine = loaded.engine;
        activeMeta = loaded.meta;
        return getShieldInfo();
      }
    } catch {
      // Try next candidate
    }
  }

  activeEngine = null;
  activeMeta = {
    loaded: false,
    ruleCount: FALLBACK_BLOCKED_HOSTS.length,
    updatedAt: null,
    lists: ['Wbudowana lista podstawowa']
  };
  return getShieldInfo();
}

async function fetchTextWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PeakBrowser-FilterUpdater/1.2' },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function buildAndSaveEngine(outputDir, { activate = true } = {}) {
  const downloadedLists = [];
  const chunks = [];

  for (const list of FILTER_LISTS) {
    try {
      const text = await fetchTextWithTimeout(list.url);
      if (text && text.trim()) {
        chunks.push(`! === ${list.name} ===\n${text}`);
        downloadedLists.push(list.name);
      }
    } catch {
      // Keep building from other reachable lists if one upstream mirror blips
    }
  }

  if (chunks.length === 0) {
    throw new Error('Nie udało się pobrać żadnej listy filtrów.');
  }

  const combined = chunks.join('\n\n');
  const engine = FiltersEngine.parse(combined, {
    loadNetworkFilters: true,
    loadCosmeticFilters: true,
    loadExceptionFilters: true,
    loadGenericCosmeticsFilters: true,
    loadExtendedSelectors: false,
    enableCompression: true
  });

  const serialized = engine.serialize();
  const ruleCount = getEngineRuleCount(engine);
  const meta = {
    updatedAt: new Date().toISOString(),
    ruleCount,
    lists: downloadedLists
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const binPath = path.join(outputDir, 'shield-engine.bin');
  const metaPath = path.join(outputDir, 'shield-meta.json');
  fs.writeFileSync(binPath, Buffer.from(serialized));
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  if (activate) {
    activeEngine = engine;
    activeMeta = { loaded: true, ...meta };
  }

  return {
    loaded: true,
    sizeBytes: serialized.byteLength,
    ...meta
  };
}

async function updateFilterLists(userDataDir) {
  return buildAndSaveEngine(userDataDir, { activate: true });
}

function getShieldInfo() {
  return {
    loaded: activeMeta.loaded,
    ruleCount: activeMeta.ruleCount,
    updatedAt: activeMeta.updatedAt,
    lists: [...activeMeta.lists]
  };
}

function mapElectronResourceType(resourceType) {
  switch (resourceType) {
    case 'mainFrame':
    case 'subFrame':
    case 'stylesheet':
    case 'script':
    case 'image':
    case 'font':
    case 'object':
    case 'xhr':
    case 'ping':
    case 'cspReport':
    case 'media':
    case 'webSocket':
      return resourceType;
    default:
      return 'other';
  }
}

function shouldBlockRequest(rawUrl, resourceType, sourceUrl = '', options = {}) {
  const level = options.level || 'aggressive';
  if (!rawUrl || resourceType === 'mainFrame' || level === 'off') {
    return { blocked: false, host: '' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { blocked: false, host: '' };
  }

  const host = (parsed.hostname || '').toLowerCase();
  if (SAFE_PROTOCOLS.has(parsed.protocol) || isLocalOrPrivateHost(host)) {
    return { blocked: false, host };
  }

  if (level === 'aggressive') {
    if (hostMatchesList(host, AGGRESSIVE_EXTRA_HOSTS)) {
      return { blocked: true, host };
    }
    for (const pattern of AGGRESSIVE_URL_PATTERNS) {
      if (pattern.test(rawUrl)) {
        return { blocked: true, host };
      }
    }
  }

  if (activeEngine) {
    try {
      const req = Request.fromRawDetails({
        url: rawUrl,
        sourceUrl: sourceUrl || rawUrl,
        type: mapElectronResourceType(resourceType)
      });
      const result = activeEngine.match(req);
      if (result && result.match) {
        return { blocked: true, host };
      }
      return { blocked: false, host };
    } catch {
      // Fall through to fallback host list if request parsing throws
    }
  }

  if (hostMatchesList(host, FALLBACK_BLOCKED_HOSTS)) {
    return { blocked: true, host };
  }

  return { blocked: false, host };
}

function getCosmeticCssForUrl(rawUrl, level = 'aggressive') {
  if (!rawUrl || level === 'off') return '';

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return '';
  }

  if (SAFE_PROTOCOLS.has(parsed.protocol) || isLocalOrPrivateHost(parsed.hostname)) {
    return '';
  }

  const hostname = parsed.hostname.toLowerCase();
  const domainInfo = parseDomain(hostname);
  const domain = (domainInfo && domainInfo.domain) || hostname;

  const chunks = [];
  if (activeEngine) {
    try {
      const res = activeEngine.getCosmeticsFilters({
        url: rawUrl,
        hostname,
        domain,
        getBaseRules: true,
        getRulesFromHostname: true,
        getInjectionRules: false,
        getExtendedRules: false,
        getRulesFromDOM: false
      });
      if (res && res.styles) {
        chunks.push(res.styles);
      }
    } catch {
      // Ignore cosmetic lookup error
    }
  }

  if (level === 'aggressive' && (hostname === 'youtube.com' || hostname.endsWith('.youtube.com'))) {
    chunks.push(YOUTUBE_COSMETIC_CSS);
  }

  return chunks.join('\n');
}

function getYoutubeAdSkipScript() {
  return `(() => {
    try {
      if (window.__peakYtShieldActive) return;
      window.__peakYtShieldActive = true;

      const clickSkip = () => {
        const btns = document.querySelectorAll('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-ad-overlay-close-button');
        for (const btn of btns) {
          if (btn && typeof btn.click === 'function') btn.click();
        }
      };

      let savedMuted = null;
      let savedRate = null;

      const tick = () => {
        clickSkip();
        const player = document.querySelector('.html5-video-player');
        const video = document.querySelector('video.html5-main-video');
        if (!player || !video) return;

        const adShowing = player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
        if (adShowing) {
          if (savedMuted === null) savedMuted = video.muted;
          if (savedRate === null) savedRate = video.playbackRate;
          video.muted = true;
          if (Number.isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.15) {
            video.currentTime = video.duration - 0.1;
          } else {
            video.playbackRate = 16;
          }
        } else if (savedMuted !== null || savedRate !== null) {
          if (savedMuted !== null) video.muted = savedMuted;
          if (savedRate !== null) video.playbackRate = savedRate;
          savedMuted = null;
          savedRate = null;
        }
      };

      setInterval(tick, 350);
    } catch {}
  })();`;
}

function stripTrackingParams(rawUrl) {
  if (!rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  let changed = false;
  const keys = Array.from(parsed.searchParams.keys());
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (lower.startsWith('utm_') || TRACKING_EXACT_PARAMS.has(lower)) {
      parsed.searchParams.delete(key);
      changed = true;
    }
  }

  return changed ? parsed.toString() : null;
}

function shouldUpgradeToHttps(rawUrl, failedHttpsHosts) {
  if (!rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:') return null;
  const host = (parsed.hostname || '').toLowerCase();
  if (isLocalOrPrivateHost(host)) return null;
  if (failedHttpsHosts && failedHttpsHosts.has(host)) return null;

  parsed.protocol = 'https:';
  return parsed.toString();
}

module.exports = {
  FILTER_LISTS,
  FALLBACK_BLOCKED_HOSTS,
  initShield,
  buildAndSaveEngine,
  updateFilterLists,
  getShieldInfo,
  shouldBlockRequest,
  getCosmeticCssForUrl,
  getYoutubeAdSkipScript,
  stripTrackingParams,
  shouldUpgradeToHttps,
  isLocalOrPrivateHost
};
