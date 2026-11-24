(() => {
  const state = {
    tabs: [],
    activeTabId: null,
    settings: {
      theme: 'alpine-dark',
      searchEngine: 'google',
      shieldEnabled: true,
      shieldLevel: 'aggressive',
      allowlist: [],
      showBookmarksBar: false
    },
    bookmarks: [],
    history: [],
    downloads: [],
    shieldStats: { enabled: true, level: 'aggressive', totalBlocked: 0 },
    shieldInfo: { loaded: true, ruleCount: 0 },
    drawerPanel: null,
    findOpen: false,
    omniboxOpen: false,
    omniboxItems: [],
    omniboxActiveIndex: 0
  };

  let omniboxBlurTimer = null;
  let copyTimer = null;
  let draggedTabId = null;

  const el = {
    tabbar: document.getElementById('tabbar'),
    brandHome: document.getElementById('brand-home'),
    tabsStrip: document.getElementById('tabs-strip'),
    btnNewTab: document.getElementById('btn-new-tab'),
    winMin: document.getElementById('win-min'),
    winMax: document.getElementById('win-max'),
    winMaxIcon: document.getElementById('win-max-icon'),
    winClose: document.getElementById('win-close'),

    btnBack: document.getElementById('btn-back'),
    btnForward: document.getElementById('btn-forward'),
    btnReload: document.getElementById('btn-reload'),
    reloadIcon: document.getElementById('reload-icon'),

    omnibox: document.getElementById('omnibox'),
    incognitoPill: document.getElementById('incognito-pill'),
    omniboxDisplay: document.getElementById('omnibox-display'),
    omniboxInput: document.getElementById('omnibox-input'),
    omniboxSecurity: document.getElementById('omnibox-security'),
    secPeak: document.getElementById('security-icon-peak'),
    secLock: document.getElementById('security-icon-lock'),
    secWarn: document.getElementById('security-icon-warn'),
    btnCopyUrl: document.getElementById('btn-copy-url'),
    copyIconDefault: document.getElementById('copy-icon-default'),
    copyIconDone: document.getElementById('copy-icon-done'),
    btnZoomPill: document.getElementById('btn-zoom-pill'),
    btnBookmark: document.getElementById('btn-bookmark'),

    btnShield: document.getElementById('btn-shield'),
    btnIncognito: document.getElementById('btn-incognito'),
    shieldBadge: document.getElementById('shield-badge'),
    btnDownloads: document.getElementById('btn-downloads'),
    downloadsDot: document.getElementById('downloads-dot'),
    btnLibrary: document.getElementById('btn-library'),
    btnSettings: document.getElementById('btn-settings'),
    loadingBar: document.getElementById('loading-bar'),

    bookmarksBar: document.getElementById('bookmarks-bar'),
    bookmarksBarList: document.getElementById('bookmarks-bar-list'),
    findBar: document.getElementById('find-bar'),
    findInput: document.getElementById('find-input'),
    findCount: document.getElementById('find-count'),
    findPrev: document.getElementById('find-prev'),
    findNext: document.getElementById('find-next'),
    findClose: document.getElementById('find-close'),

    drawer: document.getElementById('drawer'),
    drawerClose: document.getElementById('drawer-close'),
    drawerTabs: Array.from(document.querySelectorAll('.drawer-tab')),
    panels: {
      shield: document.getElementById('panel-shield'),
      bookmarks: document.getElementById('panel-bookmarks'),
      history: document.getElementById('panel-history'),
      downloads: document.getElementById('panel-downloads')
    },

    shieldSiteHost: document.getElementById('shield-site-host'),
    shieldSiteSub: document.getElementById('shield-site-sub'),
    toggleSiteShield: document.getElementById('toggle-site-shield'),
    shieldTabCount: document.getElementById('shield-tab-count'),
    shieldTotalCount: document.getElementById('shield-total-count'),
    shieldSegBtns: Array.from(document.querySelectorAll('.shield-seg-btn')),
    shieldRulesBadge: document.getElementById('shield-rules-badge'),
    shieldDomainsList: document.getElementById('shield-domains-list'),
    btnOpenFullShield: document.getElementById('btn-open-full-shield'),

    bookmarksFilter: document.getElementById('bookmarks-filter'),
    bookmarksList: document.getElementById('bookmarks-list'),
    toggleBookmarksBarInline: document.getElementById('toggle-bookmarks-bar-inline'),
    btnImportBookmarksDrawer: document.getElementById('btn-import-bookmarks-drawer'),

    historyFilter: document.getElementById('history-filter'),
    historyList: document.getElementById('history-list'),
    btnClearHistory: document.getElementById('btn-clear-history'),

    downloadsList: document.getElementById('downloads-list'),
    btnClearDownloads: document.getElementById('btn-clear-downloads')
  };

  function getActiveTab() {
    return state.tabs.find((t) => t.id === state.activeTabId) || null;
  }

  function formatHost(rawUrl) {
    try {
      return new URL(rawUrl).hostname.replace(/^www\./, '') || rawUrl;
    } catch {
      return rawUrl;
    }
  }

  function isHostAllowlisted(host) {
    if (!host) return false;
    const clean = host.toLowerCase().replace(/^www\./, '');
    return Array.isArray(state.settings.allowlist) && state.settings.allowlist.includes(clean);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  }

  function renderFormattedOmnibox(displayUrl) {
    if (!displayUrl || (!displayUrl.startsWith('https://') && !displayUrl.startsWith('http://'))) {
      el.omnibox.classList.remove('has-formatted');
      el.omniboxDisplay.classList.add('hidden');
      el.omniboxDisplay.replaceChildren();
      return;
    }

    try {
      const parsed = new URL(displayUrl);
      const protoSpan = document.createElement('span');
      protoSpan.className = 'url-proto';
      protoSpan.textContent = `${parsed.protocol}//`;

      const hostSpan = document.createElement('span');
      hostSpan.className = 'url-host';
      hostSpan.textContent = parsed.host;

      const rest = `${parsed.pathname === '/' && !parsed.search && !parsed.hash ? '' : parsed.pathname}${parsed.search}${parsed.hash}`;
      el.omniboxDisplay.replaceChildren(protoSpan, hostSpan);
      if (rest) {
        const pathSpan = document.createElement('span');
        pathSpan.className = 'url-path';
        pathSpan.textContent = rest;
        el.omniboxDisplay.appendChild(pathSpan);
      }

      el.omniboxDisplay.classList.remove('hidden');
      el.omnibox.classList.add('has-formatted');
    } catch {
      el.omnibox.classList.remove('has-formatted');
      el.omniboxDisplay.classList.add('hidden');
      el.omniboxDisplay.replaceChildren();
    }
  }

  function syncLayout() {
    const showBookmarks = Boolean(state.settings.showBookmarksBar);
    el.bookmarksBar.classList.toggle('hidden', !showBookmarks);
    el.findBar.classList.toggle('hidden', !state.findOpen);
    el.drawer.classList.toggle('hidden', !state.drawerPanel);

    const topHeight = 36 + 42 + (showBookmarks ? 32 : 0) + (state.findOpen ? 38 : 0);
    const rightPanelWidth = state.drawerPanel ? 324 : 0;

    document.documentElement.style.setProperty('--top-height', `${topHeight}px`);
    window.peak.setLayout({ topHeight, rightPanelWidth });
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme || 'alpine-dark';
  }

  function clearTabDragIndicators() {
    for (const node of el.tabsStrip.querySelectorAll('.tab')) {
      node.classList.remove('drag-over-before', 'drag-over-after');
    }
  }

  function renderTabs() {
    const fragment = document.createDocumentFragment();
    state.tabs.forEach((tab, index) => {
      const btn = document.createElement('div');
      btn.className = `tab${tab.id === state.activeTabId ? ' active' : ''}${tab.isIncognito ? ' incognito' : ''}`;
      btn.setAttribute('role', 'tab');
      btn.draggable = true;
      btn.dataset.tabId = tab.id;
      btn.title = tab.title || 'Nowa karta';

      btn.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close-btn') || e.target.closest('.tab-audio-btn')) return;
        window.peak.activateTab(tab.id);
      });
      btn.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          window.peak.closeTab(tab.id);
        }
      });

      btn.addEventListener('dragstart', (e) => {
        draggedTabId = tab.id;
        btn.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', tab.id);
        }
      });

      btn.addEventListener('dragover', (e) => {
        if (!draggedTabId || draggedTabId === tab.id) return;
        e.preventDefault();
        clearTabDragIndicators();
        const fromIdx = state.tabs.findIndex((t) => t.id === draggedTabId);
        btn.classList.add(fromIdx < index ? 'drag-over-after' : 'drag-over-before');
      });

      btn.addEventListener('dragleave', () => {
        btn.classList.remove('drag-over-before', 'drag-over-after');
      });

      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        clearTabDragIndicators();
        if (draggedTabId && draggedTabId !== tab.id) {
          window.peak.reorderTabs(draggedTabId, tab.id);
        }
      });

      btn.addEventListener('dragend', () => {
        draggedTabId = null;
        btn.classList.remove('dragging');
        clearTabDragIndicators();
      });

      const iconWrap = document.createElement('span');
      iconWrap.className = 'tab-icon-wrap';
      if (tab.isLoading) {
        const spin = document.createElement('span');
        spin.className = 'tab-spinner';
        iconWrap.appendChild(spin);
      } else if (tab.url && tab.url.startsWith('peak://incognito')) {
        iconWrap.innerHTML =
          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M2.2 7.2h11.6M4 7.2l1.1-3.3a1 1 0 0 1 .95-.7h3.9a1 1 0 0 1 .95.7L12 7.2"/><circle cx="5.4" cy="10.8" r="1.9"/><circle cx="10.6" cy="10.8" r="1.9"/></svg>';
      } else if (tab.url && tab.url.startsWith('peak://')) {
        const img = document.createElement('img');
        img.className = 'tab-favicon';
        img.src = '../../assets/icon-64.png';
        img.alt = '';
        iconWrap.appendChild(img);
      } else if (tab.favicon) {
        const img = document.createElement('img');
        img.className = 'tab-favicon';
        img.src = tab.favicon;
        img.alt = '';
        img.onerror = () => {
          iconWrap.innerHTML =
            '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" style="width:13px;height:13px;opacity:0.7"><circle cx="8" cy="8" r="5.3"/><path d="M2.8 8h10.4"/></svg>';
        };
        iconWrap.appendChild(img);
      } else if (tab.isIncognito) {
        iconWrap.innerHTML =
          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M2.2 7.2h11.6M4 7.2l1.1-3.3a1 1 0 0 1 .95-.7h3.9a1 1 0 0 1 .95.7L12 7.2"/><circle cx="5.4" cy="10.8" r="1.9"/><circle cx="10.6" cy="10.8" r="1.9"/></svg>';
      } else {
        iconWrap.innerHTML =
          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" style="width:13px;height:13px;opacity:0.7"><circle cx="8" cy="8" r="5.3"/><path d="M2.8 8h10.4"/></svg>';
      }
      btn.appendChild(iconWrap);

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.title || 'Nowa karta';
      btn.appendChild(titleSpan);

      if (tab.audible || tab.isMuted) {
        const audioBtn = document.createElement('button');
        audioBtn.className = 'tab-audio-btn';
        audioBtn.title = tab.isMuted ? 'Włącz dźwięk' : 'Wycisz kartę';
        audioBtn.innerHTML = tab.isMuted
          ? '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 6.2h2.6l3.4-2.8v9.2L5.1 9.8H2.5z"/><path d="M11 6l3 4M14 6l-3 4"/></svg>'
          : '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 6.2h2.6l3.4-2.8v9.2L5.1 9.8H2.5z"/><path d="M11 5.6a3.4 3.4 0 0 1 0 4.8"/></svg>';
        audioBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          window.peak.toggleMuteTab(tab.id);
        });
        btn.appendChild(audioBtn);
      }

      const closeBtn = document.createElement('button');
      closeBtn.className = 'tab-close-btn';
      closeBtn.title = 'Zamknij kartę (Ctrl+W)';
      closeBtn.innerHTML =
        '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.peak.closeTab(tab.id);
      });
      btn.appendChild(closeBtn);

      fragment.appendChild(btn);
    });

    el.tabsStrip.replaceChildren(fragment);
  }

  function renderToolbar() {
    const tab = getActiveTab();
    if (!tab) return;

    const incognito = Boolean(tab.isIncognito);
    document.documentElement.dataset.incognito = incognito ? 'true' : 'false';
    el.incognitoPill.classList.toggle('hidden', !incognito);
    el.btnIncognito.classList.toggle('active', incognito);

    el.btnBack.disabled = !tab.canGoBack;
    el.btnForward.disabled = !tab.canGoForward;

    el.loadingBar.classList.toggle('active', Boolean(tab.isLoading));
    if (tab.isLoading) {
      el.btnReload.title = 'Zatrzymaj (Esc)';
      el.reloadIcon.innerHTML = '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />';
    } else {
      el.btnReload.title = 'Odśwież (Ctrl+R)';
      el.reloadIcon.innerHTML =
        '<path d="M13 8a5 5 0 1 1-1.35-3.42" /><path d="M13.2 2.8v2.6h-2.6" />';
    }

    if (document.activeElement !== el.omniboxInput) {
      el.omniboxInput.value = tab.displayUrl || '';
      renderFormattedOmnibox(tab.displayUrl || '');
    }

    const isPeak = tab.url && tab.url.startsWith('peak://');
    el.secPeak.classList.toggle('hidden', !isPeak);
    el.secLock.classList.toggle('hidden', isPeak || !tab.isSecure);
    el.secWarn.classList.toggle('hidden', isPeak || tab.isSecure);
    el.omniboxSecurity.classList.toggle('insecure', !isPeak && !tab.isSecure);

    el.btnCopyUrl.classList.toggle('hidden', isPeak || !tab.displayUrl);

    const zoomPct = Math.round((tab.zoomFactor || 1) * 100);
    el.btnZoomPill.classList.toggle('hidden', zoomPct === 100);
    el.btnZoomPill.textContent = `${zoomPct}%`;

    const bookmarked = !isPeak && state.bookmarks.some((b) => b.url === tab.url);
    el.btnBookmark.classList.toggle('bookmarked', bookmarked);
    el.btnBookmark.disabled = isPeak;

    const host = isPeak ? '' : formatHost(tab.url);
    const shieldOn = Boolean(state.settings.shieldEnabled) && state.settings.shieldLevel !== 'off' && !isHostAllowlisted(host);
    el.btnShield.classList.toggle('shield-off', !shieldOn);
    const blocked = tab.blockedCount || 0;
    el.shieldBadge.classList.toggle('hidden', !shieldOn || blocked === 0);
    el.shieldBadge.textContent = blocked > 99 ? '99+' : String(blocked);

    const hasActiveDl = state.downloads.some((d) => d.state === 'progressing');
    el.downloadsDot.classList.toggle('hidden', !hasActiveDl);
  }

  function renderShieldPanel() {
    const tab = getActiveTab();
    const isPeak = !tab || !tab.url || tab.url.startsWith('peak://');
    const host = isPeak ? '' : formatHost(tab.url);
    const globalEnabled = Boolean(state.settings.shieldEnabled) && state.settings.shieldLevel !== 'off';
    const siteAllowlisted = !isPeak && isHostAllowlisted(host);

    el.shieldSiteHost.textContent = isPeak ? 'Strona wewnętrzna Peak' : host;
    if (isPeak) {
      el.shieldSiteSub.textContent = globalEnabled ? 'Peak Shield gotowy do ochrony' : 'Ochrona wyłączona globalnie';
      el.toggleSiteShield.disabled = true;
      el.toggleSiteShield.checked = globalEnabled;
    } else if (!globalEnabled) {
      el.shieldSiteSub.textContent = 'Ochrona wyłączona globalnie';
      el.toggleSiteShield.disabled = true;
      el.toggleSiteShield.checked = false;
    } else {
      el.toggleSiteShield.disabled = false;
      el.toggleSiteShield.checked = !siteAllowlisted;
      el.shieldSiteSub.textContent = siteAllowlisted
        ? 'Wyjątek: ochrona wstrzymana na tej stronie'
        : `Poziom: ${state.settings.shieldLevel === 'aggressive' ? 'Agresywny' : 'Standardowy'}`;
    }

    el.shieldTabCount.textContent = String((tab && tab.blockedCount) || 0);
    el.shieldTotalCount.textContent = Number(state.shieldStats.totalBlocked || 0).toLocaleString('pl-PL');

    const level = globalEnabled ? state.settings.shieldLevel || 'aggressive' : 'off';
    for (const btn of el.shieldSegBtns) {
      btn.classList.toggle('active', btn.dataset.shieldLevel === level);
    }

    const ruleCount = (state.shieldInfo && state.shieldInfo.ruleCount) || 0;
    el.shieldRulesBadge.textContent = ruleCount > 0 ? `${ruleCount.toLocaleString('pl-PL')} reguł` : '';

    const domains = (tab && Array.isArray(tab.blockedDomains) && tab.blockedDomains) || [];
    if (domains.length === 0) {
      el.shieldDomainsList.innerHTML = '<div class="empty-state">Nie zablokowano jeszcze żadnych domen na tej karcie</div>';
    } else {
      const frag = document.createDocumentFragment();
      for (const entry of domains) {
        const row = document.createElement('div');
        row.className = 'domain-row';
        const hostSpan = document.createElement('span');
        hostSpan.className = 'domain-host';
        hostSpan.textContent = entry.host;
        const countSpan = document.createElement('span');
        countSpan.className = 'domain-count';
        countSpan.textContent = String(entry.count);
        row.append(hostSpan, countSpan);
        frag.appendChild(row);
      }
      el.shieldDomainsList.replaceChildren(frag);
    }
  }

  function renderBookmarksBar() {
    if (!state.settings.showBookmarksBar) return;
    if (state.bookmarks.length === 0) {
      el.bookmarksBarList.innerHTML =
        '<span class="bm-empty-hint">Brak zakładek — kliknij gwiazdkę ★ na pasku adresu.</span>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const bm of state.bookmarks) {
      const btn = document.createElement('button');
      btn.className = 'bm-bar-item';
      btn.title = bm.url;
      if (bm.favicon) {
        const img = document.createElement('img');
        img.src = bm.favicon;
        img.alt = '';
        btn.appendChild(img);
      }
      const span = document.createElement('span');
      span.textContent = bm.title || formatHost(bm.url);
      btn.appendChild(span);
      btn.addEventListener('click', () => window.peak.navigate(bm.url));
      frag.appendChild(btn);
    }
    el.bookmarksBarList.replaceChildren(frag);
  }

  function renderBookmarksPanel() {
    el.toggleBookmarksBarInline.checked = Boolean(state.settings.showBookmarksBar);
    const q = (el.bookmarksFilter.value || '').trim().toLowerCase();
    const items = state.bookmarks.filter(
      (b) => !q || (b.title || '').toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
    );

    if (items.length === 0) {
      el.bookmarksList.innerHTML = '<div class="empty-state">Brak zapisanych zakładek</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const bm of items) {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <div class="list-row-icon">${
          bm.favicon
            ? `<img src="${bm.favicon}" alt="" />`
            : (bm.title || formatHost(bm.url)).slice(0, 1).toUpperCase()
        }</div>
        <div class="list-row-body">
          <div class="list-row-title"></div>
          <div class="list-row-sub"></div>
        </div>
        <div class="row-actions">
          <button class="row-icon-btn row-open-btn" title="Otwórz w nowej karcie">↗</button>
          <button class="row-icon-btn row-delete-btn" title="Usuń zakładkę">✕</button>
        </div>
      `;
      row.querySelector('.list-row-title').textContent = bm.title || formatHost(bm.url);
      row.querySelector('.list-row-sub').textContent = formatHost(bm.url);
      row.addEventListener('click', (e) => {
        if (e.target.closest('.row-actions')) return;
        window.peak.navigate(bm.url);
      });
      row.querySelector('.row-open-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        window.peak.newTab(bm.url);
      });
      row.querySelector('.row-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        window.peak.removeBookmark(bm.id || bm.url);
      });
      frag.appendChild(row);
    }
    el.bookmarksList.replaceChildren(frag);
  }

  function renderHistoryPanel() {
    const q = (el.historyFilter.value || '').trim().toLowerCase();
    const items = state.history
      .filter((h) => !q || (h.title || '').toLowerCase().includes(q) || h.url.toLowerCase().includes(q))
      .slice(0, 120);

    if (items.length === 0) {
      el.historyList.innerHTML = '<div class="empty-state">Historia przeglądania jest pusta</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const h of items) {
      const row = document.createElement('div');
      row.className = 'list-row';
      const timeStr = new Date(h.visitedAt).toLocaleTimeString('pl-PL', {
        hour: '2-digit',
        minute: '2-digit'
      });
      row.innerHTML = `
        <div class="list-row-icon">${formatHost(h.url).slice(0, 1).toUpperCase()}</div>
        <div class="list-row-body">
          <div class="list-row-title"></div>
          <div class="list-row-sub"></div>
        </div>
        <div class="row-actions">
          <button class="row-icon-btn row-open-btn" title="Otwórz w nowej karcie">↗</button>
        </div>
      `;
      row.querySelector('.list-row-title').textContent = h.title || formatHost(h.url);
      row.querySelector('.list-row-sub').textContent = `${timeStr} · ${formatHost(h.url)}`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.row-actions')) return;
        window.peak.navigate(h.url);
      });
      row.querySelector('.row-open-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        window.peak.newTab(h.url);
      });
      frag.appendChild(row);
    }
    el.historyList.replaceChildren(frag);
  }

  function renderDownloadsPanel() {
    if (state.downloads.length === 0) {
      el.downloadsList.innerHTML = '<div class="empty-state">Brak pobranych plików</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const dl of state.downloads) {
      const row = document.createElement('div');
      row.className = 'list-row download-row';

      const pct = dl.totalBytes > 0 ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : 0;
      const statusMap = {
        progressing: `Pobieranie… ${pct}% (${formatBytes(dl.receivedBytes)})`,
        completed: `Ukończono · ${formatBytes(dl.totalBytes || dl.receivedBytes)}`,
        cancelled: 'Anulowano',
        interrupted: 'Przerwano'
      };

      const header = document.createElement('div');
      header.className = 'list-row-body';
      header.innerHTML = `<div class="list-row-title"></div><div class="list-row-sub"></div>`;
      header.querySelector('.list-row-title').textContent = dl.filename || 'Plik';
      header.querySelector('.list-row-sub').textContent = statusMap[dl.state] || dl.state;
      row.appendChild(header);

      if (dl.state === 'progressing') {
        const track = document.createElement('div');
        track.className = 'download-progress-track';
        const fill = document.createElement('div');
        fill.className = 'download-progress-fill';
        fill.style.width = `${pct}%`;
        track.appendChild(fill);
        row.appendChild(track);
      }

      const actions = document.createElement('div');
      actions.className = 'download-actions';
      if (dl.state === 'progressing') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'mini-btn';
        cancelBtn.textContent = 'Anuluj';
        cancelBtn.addEventListener('click', () => window.peak.cancelDownload(dl.id));
        actions.appendChild(cancelBtn);
      } else if (dl.state === 'completed') {
        const openBtn = document.createElement('button');
        openBtn.className = 'mini-btn';
        openBtn.textContent = 'Otwórz';
        openBtn.addEventListener('click', () => window.peak.openDownload(dl.id));
        const folderBtn = document.createElement('button');
        folderBtn.className = 'mini-btn';
        folderBtn.textContent = 'Pokaż w folderze';
        folderBtn.addEventListener('click', () => window.peak.showDownloadInFolder(dl.id));
        actions.append(openBtn, folderBtn);
      }
      if (actions.childNodes.length > 0) {
        row.appendChild(actions);
      }

      frag.appendChild(row);
    }
    el.downloadsList.replaceChildren(frag);
  }

  function renderDrawer() {
    for (const tabBtn of el.drawerTabs) {
      tabBtn.classList.toggle('active', tabBtn.dataset.panel === state.drawerPanel);
    }
    for (const [name, panelEl] of Object.entries(el.panels)) {
      panelEl.classList.toggle('hidden', name !== state.drawerPanel);
    }
    el.btnShield.classList.toggle('active', state.drawerPanel === 'shield');
    el.btnDownloads.classList.toggle('active', state.drawerPanel === 'downloads');
    el.btnLibrary.classList.toggle(
      'active',
      state.drawerPanel === 'bookmarks' || state.drawerPanel === 'history'
    );

    if (state.drawerPanel === 'shield') renderShieldPanel();
    else if (state.drawerPanel === 'bookmarks') renderBookmarksPanel();
    else if (state.drawerPanel === 'history') renderHistoryPanel();
    else if (state.drawerPanel === 'downloads') renderDownloadsPanel();
  }

  function openDrawer(panelName) {
    state.drawerPanel = state.drawerPanel === panelName ? null : panelName;
    renderDrawer();
    syncLayout();
  }

  function buildOmniboxSuggestions(query) {
    const q = (query || '').trim();
    if (!q) return [];
    const lower = q.toLowerCase();
    const items = [];
    const seenUrls = new Set();

    const looksLikeUrl = !/\s/.test(q) && /\./.test(q);
    items.push({
      kind: looksLikeUrl ? 'url' : 'search',
      title: looksLikeUrl ? q : `Szukaj „${q}”`,
      subtitle: looksLikeUrl ? 'Otwórz adres' : 'Wyszukaj',
      query: q,
      url: looksLikeUrl ? (q.startsWith('http') ? q : `https://${q}`) : ''
    });

    for (const bm of state.bookmarks) {
      if (items.length >= 6) break;
      if ((bm.title || '').toLowerCase().includes(lower) || bm.url.toLowerCase().includes(lower)) {
        if (!seenUrls.has(bm.url)) {
          seenUrls.add(bm.url);
          items.push({ kind: 'bookmark', title: bm.title || bm.url, subtitle: formatHost(bm.url), url: bm.url });
        }
      }
    }

    for (const hi of state.history) {
      if (items.length >= 6) break;
      if ((hi.title || '').toLowerCase().includes(lower) || hi.url.toLowerCase().includes(lower)) {
        if (!seenUrls.has(hi.url)) {
          seenUrls.add(hi.url);
          items.push({ kind: 'history', title: hi.title || hi.url, subtitle: formatHost(hi.url), url: hi.url });
        }
      }
    }

    return items.slice(0, 6);
  }

  function updateOmniboxSuggestions() {
    const q = el.omniboxInput.value;
    const items = buildOmniboxSuggestions(q);
    state.omniboxItems = items;
    state.omniboxActiveIndex = 0;

    if (items.length === 0 || document.activeElement !== el.omniboxInput) {
      closeOmniboxSuggestions();
      return;
    }

    const r = el.omnibox.getBoundingClientRect();
    const payload = {
      rect: { x: Math.round(r.left), y: Math.round(r.bottom + 4), width: Math.round(r.width) },
      items,
      activeIndex: state.omniboxActiveIndex,
      theme: state.settings.theme
    };

    if (!state.omniboxOpen) {
      state.omniboxOpen = true;
      window.peak.showOmniboxOverlay(payload);
    } else {
      window.peak.updateOmniboxOverlay(payload);
    }
  }

  function closeOmniboxSuggestions() {
    if (state.omniboxOpen) {
      state.omniboxOpen = false;
      state.omniboxItems = [];
      window.peak.hideOmniboxOverlay();
    }
  }

  function openFindBar() {
    state.findOpen = true;
    syncLayout();
    el.findInput.focus();
    el.findInput.select();
  }

  function closeFindBar() {
    state.findOpen = false;
    el.findCount.textContent = '0/0';
    window.peak.stopFindInPage();
    syncLayout();
  }

  function bindEvents() {
    el.brandHome.addEventListener('click', () => window.peak.goHome());
    el.btnNewTab.addEventListener('click', () => window.peak.newTab());
    el.tabbar.addEventListener('dblclick', (e) => {
      if (e.target.closest('.tab') || e.target.closest('button')) return;
      window.peak.toggleMaximizeWindow();
    });

    el.winMin.addEventListener('click', () => window.peak.minimizeWindow());
    el.winMax.addEventListener('click', () => window.peak.toggleMaximizeWindow());
    el.winClose.addEventListener('click', () => window.peak.closeWindow());

    el.btnBack.addEventListener('click', () => window.peak.goBack());
    el.btnForward.addEventListener('click', () => window.peak.goForward());
    el.btnReload.addEventListener('click', () => {
      const tab = getActiveTab();
      if (tab && tab.isLoading) window.peak.stop();
      else window.peak.reload(false);
    });
    el.btnZoomPill.addEventListener('click', () => window.peak.zoom('reset'));
    el.btnBookmark.addEventListener('click', () => window.peak.toggleCurrentBookmark());

    el.btnCopyUrl.addEventListener('click', async () => {
      const tab = getActiveTab();
      const targetUrl = (tab && tab.displayUrl) || el.omniboxInput.value;
      if (!targetUrl) return;
      try {
        await navigator.clipboard.writeText(targetUrl);
        el.btnCopyUrl.classList.add('copied');
        el.copyIconDefault.classList.add('hidden');
        el.copyIconDone.classList.remove('hidden');
        if (copyTimer) clearTimeout(copyTimer);
        copyTimer = setTimeout(() => {
          el.btnCopyUrl.classList.remove('copied');
          el.copyIconDone.classList.add('hidden');
          el.copyIconDefault.classList.remove('hidden');
        }, 1200);
      } catch {
        // Ignore clipboard failure
      }
    });

    el.btnIncognito.addEventListener('click', () => window.peak.newIncognitoTab());
    el.btnShield.addEventListener('click', () => openDrawer('shield'));
    el.btnDownloads.addEventListener('click', () => openDrawer('downloads'));
    el.btnLibrary.addEventListener('click', () => openDrawer('bookmarks'));
    el.btnImportBookmarksDrawer.addEventListener('click', () => {
      state.drawerPanel = null;
      renderDrawer();
      syncLayout();
      window.peak.openSettings('#import');
    });
    el.btnSettings.addEventListener('click', () => {
      if (state.drawerPanel) {
        state.drawerPanel = null;
        renderDrawer();
        syncLayout();
      }
      window.peak.openSettings('');
    });
    el.drawerClose.addEventListener('click', () => {
      state.drawerPanel = null;
      renderDrawer();
      syncLayout();
    });

    for (const tabBtn of el.drawerTabs) {
      tabBtn.addEventListener('click', () => {
        state.drawerPanel = tabBtn.dataset.panel;
        renderDrawer();
      });
    }

    el.toggleSiteShield.addEventListener('change', () => {
      const tab = getActiveTab();
      if (!tab || !tab.url || tab.url.startsWith('peak://')) return;
      const host = formatHost(tab.url);
      if (host) {
        window.peak.toggleSiteShield(host);
      }
    });

    for (const btn of el.shieldSegBtns) {
      btn.addEventListener('click', () => {
        window.peak.updateSettings({ shieldLevel: btn.dataset.shieldLevel });
      });
    }

    el.btnOpenFullShield.addEventListener('click', () => {
      state.drawerPanel = null;
      renderDrawer();
      syncLayout();
      window.peak.openSettings('#ochrona');
    });

    el.bookmarksFilter.addEventListener('input', renderBookmarksPanel);
    el.historyFilter.addEventListener('input', renderHistoryPanel);
    el.btnClearHistory.addEventListener('click', () => window.peak.clearHistory());
    el.btnClearDownloads.addEventListener('click', () => window.peak.clearDownloads());

    el.toggleBookmarksBarInline.addEventListener('change', (e) => {
      window.peak.updateSettings({ showBookmarksBar: e.target.checked });
    });

    // Omnibox
    el.omniboxInput.addEventListener('focus', () => {
      if (omniboxBlurTimer) {
        clearTimeout(omniboxBlurTimer);
        omniboxBlurTimer = null;
      }
      el.omniboxInput.select();
      if (el.omniboxInput.value.trim()) {
        updateOmniboxSuggestions();
      }
    });

    el.omniboxInput.addEventListener('blur', () => {
      omniboxBlurTimer = setTimeout(() => {
        omniboxBlurTimer = null;
        closeOmniboxSuggestions();
        const tab = getActiveTab();
        if (tab) {
          el.omniboxInput.value = tab.displayUrl || '';
          renderFormattedOmnibox(tab.displayUrl || '');
        }
      }, 180);
    });

    el.omniboxInput.addEventListener('input', () => {
      updateOmniboxSuggestions();
    });

    el.omniboxInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && state.omniboxItems.length > 0) {
        e.preventDefault();
        state.omniboxActiveIndex = (state.omniboxActiveIndex + 1) % state.omniboxItems.length;
        window.peak.updateOmniboxOverlay({
          items: state.omniboxItems,
          activeIndex: state.omniboxActiveIndex,
          theme: state.settings.theme
        });
      } else if (e.key === 'ArrowUp' && state.omniboxItems.length > 0) {
        e.preventDefault();
        state.omniboxActiveIndex =
          (state.omniboxActiveIndex - 1 + state.omniboxItems.length) % state.omniboxItems.length;
        window.peak.updateOmniboxOverlay({
          items: state.omniboxItems,
          activeIndex: state.omniboxActiveIndex,
          theme: state.settings.theme
        });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = state.omniboxItems[state.omniboxActiveIndex];
        const target = chosen && chosen.url ? chosen.url : el.omniboxInput.value;
        closeOmniboxSuggestions();
        el.omniboxInput.blur();
        window.peak.navigate(target);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeOmniboxSuggestions();
        el.omniboxInput.blur();
      }
    });

    // Find bar
    el.findInput.addEventListener('input', () => {
      window.peak.findInPage({ text: el.findInput.value, forward: true, findNext: false });
    });
    el.findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        window.peak.findInPage({ text: el.findInput.value, forward: !e.shiftKey, findNext: true });
      } else if (e.key === 'Escape') {
        closeFindBar();
      }
    });
    el.findNext.addEventListener('click', () => {
      window.peak.findInPage({ text: el.findInput.value, forward: true, findNext: true });
    });
    el.findPrev.addEventListener('click', () => {
      window.peak.findInPage({ text: el.findInput.value, forward: false, findNext: true });
    });
    el.findClose.addEventListener('click', closeFindBar);

    // IPC Subscriptions
    window.peak.onTabsUpdated(({ tabs, activeTabId }) => {
      state.tabs = tabs;
      state.activeTabId = activeTabId;
      renderTabs();
      renderToolbar();
      if (state.drawerPanel === 'shield') {
        renderShieldPanel();
      }
    });

    window.peak.onDataUpdated((data) => {
      state.settings = data.settings;
      state.bookmarks = data.bookmarks;
      state.history = data.history;
      state.downloads = data.downloads;
      state.shieldStats = data.shieldStats;
      if (data.shieldInfo) state.shieldInfo = data.shieldInfo;
      applyTheme(state.settings.theme);
      renderToolbar();
      renderBookmarksBar();
      if (state.drawerPanel) renderDrawer();
      syncLayout();
    });

    window.peak.onWindowState(({ isMaximized }) => {
      el.winMaxIcon.innerHTML = isMaximized
        ? '<rect x="2" y="3.5" width="6.5" height="6.5" rx="0.8"/><path d="M3.8 3.5V2.3a.8.8 0 0 1 .8-.8h5.1a.8.8 0 0 1 .8.8v5.1a.8.8 0 0 1-.8.8H8.5"/>'
        : '<rect x="2" y="2" width="8" height="8" rx="1"/>';
      el.winMax.title = isMaximized ? 'Przywróć' : 'Maksymalizuj';
    });

    window.peak.onShortcut(({ action }) => {
      if (action === 'focus-omnibox') {
        el.omniboxInput.focus();
        el.omniboxInput.select();
      } else if (action === 'open-find') {
        openFindBar();
      } else if (action === 'open-history') {
        openDrawer('history');
      } else if (action === 'open-downloads') {
        openDrawer('downloads');
      } else if (action === 'open-settings') {
        window.peak.openSettings('');
      } else if (action === 'toggle-bookmarks-bar') {
        window.peak.updateSettings({ showBookmarksBar: !state.settings.showBookmarksBar });
      }
    });

    window.peak.onFindResult(({ activeMatchOrdinal, matches }) => {
      el.findCount.textContent = `${activeMatchOrdinal}/${matches}`;
    });

    window.peak.onOmniboxHover((idx) => {
      state.omniboxActiveIndex = idx;
    });

    window.peak.onOmniboxClosed(() => {
      state.omniboxOpen = false;
      state.omniboxItems = [];
    });
  }

  async function init() {
    bindEvents();
    const initial = await window.peak.getInitialState();
    state.tabs = initial.tabs || [];
    state.activeTabId = initial.activeTabId || null;
    state.settings = initial.settings || state.settings;
    state.bookmarks = initial.bookmarks || [];
    state.history = initial.history || [];
    state.downloads = initial.downloads || [];
    state.shieldStats = initial.shieldStats || state.shieldStats;
    if (initial.shieldInfo) state.shieldInfo = initial.shieldInfo;

    applyTheme(state.settings.theme);
    renderTabs();
    renderToolbar();
    renderBookmarksBar();
    syncLayout();
  }

  init();
})();
