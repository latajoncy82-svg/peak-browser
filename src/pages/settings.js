(() => {
  const LEVEL_DESCRIPTIONS = {
    off: 'Blokowanie reklam i trackerów wyłączone. Aktywne pozostają wybrane ustawienia prywatności.',
    standard: 'Blokuje sieci reklamowe i trackery z list EasyList, EasyPrivacy, Polskich filtrów i uBlock.',
    aggressive: 'Pełne blokowanie sieciowe + kryptokoparki, ukryte ramki reklamowe i reklamy na YouTube.'
  };

  const el = {
    railVersion: document.getElementById('rail-version'),
    searchInput: document.getElementById('settings-search'),
    railLinks: Array.from(document.querySelectorAll('.rail-link')),
    sections: Array.from(document.querySelectorAll('.settings-section')),

    themeCards: Array.from(document.querySelectorAll('.theme-preview-card')),
    optBookmarksBar: document.getElementById('opt-bookmarks-bar'),
    optDefaultZoom: document.getElementById('opt-default-zoom'),

    shieldStatusDot: document.getElementById('shield-status-dot'),
    shieldStatusTitle: document.getElementById('shield-status-title'),
    shieldListsSummary: document.getElementById('shield-lists-summary'),
    btnUpdateFilters: document.getElementById('btn-update-filters'),
    metricRules: document.getElementById('metric-rules'),
    metricBlocked: document.getElementById('metric-blocked'),
    metricUpdated: document.getElementById('metric-updated'),

    shieldLevelBtns: Array.from(document.querySelectorAll('[data-shield-level]')),
    shieldLevelDesc: document.getElementById('shield-level-desc'),
    optCosmetic: document.getElementById('opt-cosmetic'),
    optHttpsUpgrade: document.getElementById('opt-https-upgrade'),
    optStripParams: document.getElementById('opt-strip-params'),
    optPrivacyHeaders: document.getElementById('opt-privacy-headers'),
    optBlockNotifications: document.getElementById('opt-block-notifications'),

    allowlistForm: document.getElementById('allowlist-form'),
    allowlistInput: document.getElementById('allowlist-input'),
    allowlistItems: document.getElementById('allowlist-items'),

    engineCards: Array.from(document.querySelectorAll('.engine-card')),

    clearHistoryCb: document.getElementById('clear-history-cb'),
    clearCacheCb: document.getElementById('clear-cache-cb'),
    clearCookiesCb: document.getElementById('clear-cookies-cb'),
    btnClearSelected: document.getElementById('btn-clear-selected'),
    clearFeedback: document.getElementById('clear-feedback'),
    btnOpenIncognito: document.getElementById('btn-open-incognito'),

    importBrowserSelect: document.getElementById('import-browser-select'),
    btnRefreshBrowsers: document.getElementById('btn-refresh-browsers'),
    importBookmarksCb: document.getElementById('import-bookmarks-cb'),
    importHistoryCb: document.getElementById('import-history-cb'),
    importSpeedDialCb: document.getElementById('import-speeddial-cb'),
    btnRunImport: document.getElementById('btn-run-import'),
    btnImportHtml: document.getElementById('btn-import-html'),
    importFeedback: document.getElementById('import-feedback'),

    aboutTitle: document.getElementById('about-title'),
    aboutEngines: document.getElementById('about-engines'),
    btnOpenDevtools: document.getElementById('btn-open-devtools'),
    btnOpenWebsite: document.getElementById('btn-open-website'),
    btnOpenMobile: document.getElementById('btn-open-mobile'),
    btnOpenReleases: document.getElementById('btn-open-releases')
  };

  let state = null;
  let detectedBrowsers = [];

  function setImportFeedback(msg, isError = false) {
    if (!el.importFeedback) return;
    el.importFeedback.textContent = msg || '';
    el.importFeedback.classList.toggle('error', Boolean(isError));
  }

  async function loadDetectedBrowsers() {
    if (!window.peakSettings || !el.importBrowserSelect) return;
    try {
      const list = await window.peakSettings.detectBrowsers();
      detectedBrowsers = Array.isArray(list) ? list : [];
    } catch {
      detectedBrowsers = [];
    }

    el.importBrowserSelect.replaceChildren();
    if (detectedBrowsers.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Nie wykryto lokalnych profili — użyj pliku HTML zakładek';
      el.importBrowserSelect.appendChild(opt);
      el.btnRunImport.disabled = true;
      return;
    }

    for (const item of detectedBrowsers) {
      const opt = document.createElement('option');
      opt.value = item.id;
      const caps = [item.hasBookmarks ? 'zakładki' : null, item.hasHistory ? 'historia' : null]
        .filter(Boolean)
        .join(', ');
      opt.textContent = caps ? `${item.label} — ${caps}` : item.label;
      el.importBrowserSelect.appendChild(opt);
    }
    el.btnRunImport.disabled = false;
  }

  function formatImportResult(res) {
    if (!res || !res.ok) {
      setImportFeedback((res && res.error) || 'Nie udało się zaimportować danych.', true);
      return;
    }
    const parts = [];
    if (res.bookmarksAdded > 0 || res.bookmarksSkipped > 0) {
      parts.push(`zakładki: +${res.bookmarksAdded}`);
    }
    if (res.historyAdded > 0) {
      parts.push(`historia: +${res.historyAdded}`);
    }
    if (res.speedDialAdded > 0) {
      parts.push(`skróty Nowej karty: +${res.speedDialAdded}`);
    }
    if (parts.length === 0) {
      setImportFeedback(`Dane z ${res.sourceLabel} są już aktualne (brak nowych pozycji).`, false);
    } else {
      setImportFeedback(`Zaimportowano z ${res.sourceLabel} (${parts.join(' · ')}).`, false);
    }
  }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('pl-PL');
  }

  function formatDate(iso) {
    if (!iso) return 'Wbudowane';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Wbudowane';
    return d.toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  function render() {
    if (!state) return;
    const { settings, shieldStats, shieldInfo, appVersion, versions } = state;

    document.documentElement.dataset.theme = settings.theme || 'alpine-dark';
    for (const card of el.themeCards) {
      card.classList.toggle('active', card.dataset.themeChoice === settings.theme);
    }

    el.optBookmarksBar.checked = Boolean(settings.showBookmarksBar);
    el.optDefaultZoom.value = String(settings.defaultZoom || 1);

    const shieldLevel = settings.shieldEnabled ? settings.shieldLevel || 'aggressive' : 'off';
    const isOff = shieldLevel === 'off';
    el.shieldStatusDot.classList.toggle('off', isOff);
    el.shieldStatusTitle.textContent = isOff
      ? 'Peak Shield wyłączony'
      : shieldLevel === 'aggressive'
        ? 'Peak Shield — tryb agresywny'
        : 'Peak Shield — tryb standardowy';

    if (shieldInfo) {
      el.shieldListsSummary.textContent = (shieldInfo.lists || []).join(' · ');
      el.metricRules.textContent = formatNumber(shieldInfo.ruleCount || 0);
      el.metricUpdated.textContent = formatDate(shieldInfo.updatedAt);
    }
    el.metricBlocked.textContent = formatNumber((shieldStats && shieldStats.totalBlocked) || 0);

    for (const btn of el.shieldLevelBtns) {
      btn.classList.toggle('active', btn.dataset.shieldLevel === shieldLevel);
    }
    el.shieldLevelDesc.textContent = LEVEL_DESCRIPTIONS[shieldLevel] || LEVEL_DESCRIPTIONS.aggressive;

    el.optCosmetic.checked = Boolean(settings.cosmeticBlocking);
    el.optHttpsUpgrade.checked = Boolean(settings.httpsUpgrade);
    el.optStripParams.checked = Boolean(settings.stripTrackingParams);
    el.optPrivacyHeaders.checked = Boolean(settings.privacyHeaders);
    el.optBlockNotifications.checked = Boolean(settings.blockNotifications);

    const allowlist = Array.isArray(settings.allowlist) ? settings.allowlist : [];
    if (allowlist.length === 0) {
      el.allowlistItems.innerHTML = '<span class="allowlist-empty">Brak wyjątków — ochrona działa na wszystkich stronach.</span>';
    } else {
      const frag = document.createDocumentFragment();
      for (const host of allowlist) {
        const chip = document.createElement('span');
        chip.className = 'allowlist-chip';
        const label = document.createElement('span');
        label.textContent = host;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.title = `Usuń ${host}`;
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', async () => {
          state = await window.peakSettings.removeAllowlistHost(host);
          render();
        });
        chip.append(label, removeBtn);
        frag.appendChild(chip);
      }
      el.allowlistItems.replaceChildren(frag);
    }

    for (const card of el.engineCards) {
      card.classList.toggle('active', card.dataset.engine === settings.searchEngine);
    }

    if (appVersion) {
      el.railVersion.textContent = `Peak Browser ${appVersion}`;
      el.aboutTitle.textContent = `Peak Browser ${appVersion}`;
    }
    if (versions) {
      el.aboutEngines.textContent = `Chromium ${versions.chrome} · Electron ${versions.electron} · Windows x64`;
    }
  }

  function applySectionFromHash() {
    const targetId = (window.location.hash || '#wyglad').replace(/^#/, '');
    for (const link of el.railLinks) {
      link.classList.toggle('active', link.dataset.section === targetId);
    }
    const sec = document.getElementById(targetId);
    if (sec) {
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function applySearchFilter(query) {
    const q = (query || '').trim().toLowerCase();
    for (const sec of el.sections) {
      if (!q) {
        sec.classList.remove('hidden');
        continue;
      }
      const haystack = `${sec.dataset.search || ''} ${sec.textContent || ''}`.toLowerCase();
      sec.classList.toggle('hidden', !haystack.includes(q));
    }
  }

  async function updateSettings(partial) {
    state = await window.peakSettings.updateSettings(partial);
    render();
  }

  function bindEvents() {
    for (const link of el.railLinks) {
      link.addEventListener('click', () => {
        for (const item of el.railLinks) {
          item.classList.toggle('active', item === link);
        }
      });
    }

    window.addEventListener('hashchange', applySectionFromHash);
    el.searchInput.addEventListener('input', (e) => applySearchFilter(e.target.value));

    for (const card of el.themeCards) {
      card.addEventListener('click', () => updateSettings({ theme: card.dataset.themeChoice }));
    }

    el.optBookmarksBar.addEventListener('change', (e) => updateSettings({ showBookmarksBar: e.target.checked }));
    el.optDefaultZoom.addEventListener('change', (e) => updateSettings({ defaultZoom: Number(e.target.value) }));

    for (const btn of el.shieldLevelBtns) {
      btn.addEventListener('click', () => updateSettings({ shieldLevel: btn.dataset.shieldLevel }));
    }

    el.optCosmetic.addEventListener('change', (e) => updateSettings({ cosmeticBlocking: e.target.checked }));
    el.optHttpsUpgrade.addEventListener('change', (e) => updateSettings({ httpsUpgrade: e.target.checked }));
    el.optStripParams.addEventListener('change', (e) => updateSettings({ stripTrackingParams: e.target.checked }));
    el.optPrivacyHeaders.addEventListener('change', (e) => updateSettings({ privacyHeaders: e.target.checked }));
    el.optBlockNotifications.addEventListener('change', (e) => updateSettings({ blockNotifications: e.target.checked }));

    el.btnUpdateFilters.addEventListener('click', async () => {
      el.btnUpdateFilters.disabled = true;
      el.btnUpdateFilters.textContent = 'Aktualizowanie…';
      try {
        const info = await window.peakSettings.updateFilterLists();
        if (state) {
          state.shieldInfo = info;
          render();
        }
        el.btnUpdateFilters.textContent = 'Zaktualizowano';
      } catch {
        el.btnUpdateFilters.textContent = 'Błąd sieci';
      } finally {
        setTimeout(() => {
          el.btnUpdateFilters.disabled = false;
          el.btnUpdateFilters.textContent = 'Aktualizuj filtry';
        }, 2000);
      }
    });

    el.allowlistForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = el.allowlistInput.value.trim();
      if (!val) return;
      state = await window.peakSettings.addAllowlistHost(val);
      el.allowlistInput.value = '';
      render();
    });

    for (const card of el.engineCards) {
      card.addEventListener('click', () => updateSettings({ searchEngine: card.dataset.engine }));
    }

    el.btnClearSelected.addEventListener('click', async () => {
      const options = {
        history: el.clearHistoryCb.checked,
        cache: el.clearCacheCb.checked,
        cookies: el.clearCookiesCb.checked
      };
      if (!options.history && !options.cache && !options.cookies) return;
      await window.peakSettings.clearData(options);
      el.clearFeedback.textContent = 'Wybrane dane zostały wyczyszczone.';
      setTimeout(() => {
        el.clearFeedback.textContent = '';
      }, 2600);
    });

    el.btnOpenIncognito.addEventListener('click', () => window.peakSettings.openIncognito());

    el.btnRefreshBrowsers.addEventListener('click', () => {
      loadDetectedBrowsers();
      setImportFeedback('Odświeżono listę przeglądarek.', false);
    });

    el.btnRunImport.addEventListener('click', async () => {
      const sourceId = el.importBrowserSelect.value;
      const bookmarks = el.importBookmarksCb.checked;
      const history = el.importHistoryCb.checked;
      const speedDial = el.importSpeedDialCb.checked;
      if (!sourceId) {
        setImportFeedback('Wybierz profil źródłowej przeglądarki lub plik HTML.', true);
        return;
      }
      if (!bookmarks && !history) {
        setImportFeedback('Zaznacz przynajmniej zakładki lub historię do przeniesienia.', true);
        return;
      }
      el.btnRunImport.disabled = true;
      el.btnRunImport.textContent = 'Importowanie…';
      setImportFeedback('', false);
      try {
        const res = await window.peakSettings.importBrowser({
          sourceId,
          bookmarks,
          history,
          speedDial
        });
        formatImportResult(res);
      } catch {
        setImportFeedback('Wystąpił błąd podczas importu danych.', true);
      } finally {
        el.btnRunImport.disabled = false;
        el.btnRunImport.textContent = 'Importuj dane';
      }
    });

    el.btnImportHtml.addEventListener('click', async () => {
      el.btnImportHtml.disabled = true;
      try {
        const res = await window.peakSettings.importHtmlBookmarks();
        if (res && !res.canceled) {
          formatImportResult(res);
        }
      } catch {
        setImportFeedback('Nie udało się zaimportować pliku HTML.', true);
      } finally {
        el.btnImportHtml.disabled = false;
      }
    });

    el.btnOpenDevtools.addEventListener('click', () => window.peakSettings.openDevTools());
    el.btnOpenWebsite.addEventListener('click', () =>
      window.peakSettings.openExternal('https://peakbrowser.vercel.app/')
    );
    el.btnOpenMobile.addEventListener('click', () =>
      window.peakSettings.openExternal('https://peakbrowser.vercel.app/#telefon')
    );
    el.btnOpenReleases.addEventListener('click', () =>
      window.peakSettings.openExternal('https://github.com/latajoncy82-svg/peak-browser/releases')
    );
  }

  async function init() {
    bindEvents();
    if (window.peakSettings) {
      state = await window.peakSettings.getState();
      render();
      loadDetectedBrowsers();
      if (window.location.hash) {
        applySectionFromHash();
      }
      window.peakSettings.onStateUpdate((next) => {
        state = next;
        render();
      });
    }
  }

  init();
})();
