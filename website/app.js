(() => {
  const DEFAULT_RELEASES_URL = 'https://github.com/latajoncy82-svg/peak-browser/releases';

  const el = {
    themeToggle: document.getElementById('site-theme-toggle'),
    sunIcon: document.getElementById('theme-icon-sun'),
    moonIcon: document.getElementById('theme-icon-moon'),

    heroMetaKicker: document.getElementById('hero-meta-kicker'),
    primaryDownloadBtn: document.getElementById('primary-download-btn'),
    primaryDownloadMeta: document.getElementById('primary-download-meta'),
    downloadMenuWrap: document.getElementById('download-menu-wrap'),
    downloadMenuToggle: document.getElementById('download-menu-toggle'),
    downloadDropdown: document.getElementById('download-dropdown'),
    menuInstallerLink: document.getElementById('menu-installer-link'),
    menuInstallerSize: document.getElementById('menu-installer-size'),
    menuPortableLink: document.getElementById('menu-portable-link'),
    menuPortableSize: document.getElementById('menu-portable-size'),
    menuGithubReleases: document.getElementById('menu-github-releases'),

    previewTabs: Array.from(document.querySelectorAll('.preview-tab')),
    previewLight: document.getElementById('preview-img-light'),
    previewDark: document.getElementById('preview-img-dark'),

    releasesList: document.getElementById('releases-list'),
    releasesSourceNote: document.getElementById('releases-source-note')
  };

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return 'Windows x64';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  function setSiteTheme(theme) {
    document.documentElement.dataset.theme = theme;
    el.sunIcon.classList.toggle('hidden', theme !== 'dark');
    el.moonIcon.classList.toggle('hidden', theme === 'dark');
    try {
      localStorage.setItem('peak-site-theme', theme);
    } catch {
      // Ignore storage failures
    }
  }

  function setPreviewTheme(mode) {
    for (const tab of el.previewTabs) {
      tab.classList.toggle('active', tab.dataset.preview === mode);
    }
    el.previewLight.classList.toggle('hidden', mode !== 'light');
    el.previewDark.classList.toggle('hidden', mode !== 'dark');
  }

  function appendFormattedInline(parent, text) {
    const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const token = match[0];
      if (token.startsWith('**') && token.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = token.slice(2, -2);
        parent.appendChild(strong);
      } else if (token.startsWith('`') && token.endsWith('`')) {
        const code = document.createElement('code');
        code.textContent = token.slice(1, -1);
        parent.appendChild(code);
      }
      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function renderMarkdownNotes(container, markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    let currentList = null;

    const flushList = () => {
      if (currentList) {
        container.appendChild(currentList);
        currentList = null;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        flushList();
        continue;
      }

      if (/^#{1,4}\s+/.test(line)) {
        flushList();
        const heading = document.createElement('h4');
        heading.textContent = line.replace(/^#{1,4}\s+/, '');
        container.appendChild(heading);
        continue;
      }

      if (/^[-*•]\s+/.test(line)) {
        if (!currentList) {
          currentList = document.createElement('ul');
        }
        const li = document.createElement('li');
        appendFormattedInline(li, line.replace(/^[-*•]\s+/, ''));
        currentList.appendChild(li);
        continue;
      }

      flushList();
      const p = document.createElement('p');
      appendFormattedInline(p, line);
      container.appendChild(p);
    }

    flushList();
  }

  function populateHeroDownload(latest) {
    if (!latest) return;
    const tag = latest.tag || 'v1.0.0';
    const installer = latest.assets && latest.assets.installer;
    const portable = latest.assets && latest.assets.portable;

    const primaryUrl = (installer && installer.downloadUrl) || (portable && portable.downloadUrl) || latest.htmlUrl || DEFAULT_RELEASES_URL;
    const primarySize = installer && installer.size ? formatSize(installer.size) : '';

    el.heroMetaKicker.textContent = `Windows 10 / 11 (64-bit) · Wersja ${tag}`;
    el.primaryDownloadBtn.href = primaryUrl;
    el.primaryDownloadMeta.textContent = primarySize ? `${tag} · ${primarySize}` : tag;

    el.menuInstallerLink.href = (installer && installer.downloadUrl) || latest.htmlUrl || DEFAULT_RELEASES_URL;
    el.menuInstallerSize.textContent = formatSize(installer && installer.size);

    el.menuPortableLink.href = (portable && portable.downloadUrl) || latest.htmlUrl || DEFAULT_RELEASES_URL;
    el.menuPortableSize.textContent = formatSize(portable && portable.size);

    el.menuGithubReleases.href = DEFAULT_RELEASES_URL;
  }

  function renderReleasesList(releases, source) {
    if (!Array.isArray(releases) || releases.length === 0) {
      el.releasesList.innerHTML = '<div class="release-card"><p>Brak opublikowanych wydań.</p></div>';
      return;
    }

    el.releasesSourceNote.textContent =
      source === 'github' ? 'Zsynchronizowano z GitHub Releases' : 'Katalog wydań Peak Browser';

    const frag = document.createDocumentFragment();
    releases.forEach((rel, index) => {
      const card = document.createElement('article');
      card.className = 'release-card';

      const header = document.createElement('div');
      header.className = 'release-header';

      const titleGroup = document.createElement('div');
      titleGroup.className = 'release-title-group';

      const tagSpan = document.createElement('span');
      tagSpan.className = 'release-tag';
      tagSpan.textContent = rel.tag || 'v1.0.0';
      titleGroup.appendChild(tagSpan);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'release-name';
      nameSpan.textContent = rel.name || rel.tag;
      titleGroup.appendChild(nameSpan);

      if (index === 0) {
        const badge = document.createElement('span');
        badge.className = 'release-badge';
        badge.textContent = 'Najnowsza';
        titleGroup.appendChild(badge);
      }

      const dateSpan = document.createElement('span');
      dateSpan.className = 'release-date';
      dateSpan.textContent = formatDate(rel.publishedAt);

      header.append(titleGroup, dateSpan);
      card.appendChild(header);

      const notesDiv = document.createElement('div');
      notesDiv.className = 'release-notes';
      renderMarkdownNotes(notesDiv, rel.body || 'Brak dodatkowego opisu zmian.');
      card.appendChild(notesDiv);

      const downloadsRow = document.createElement('div');
      downloadsRow.className = 'release-downloads';

      const installer = rel.assets && rel.assets.installer;
      const portable = rel.assets && rel.assets.portable;

      if (installer && installer.downloadUrl) {
        const link = document.createElement('a');
        link.className = 'dl-chip primary';
        link.href = installer.downloadUrl;
        const label = document.createElement('span');
        label.textContent = 'Instalator (.exe)';
        const size = document.createElement('span');
        size.className = 'dl-chip-size';
        size.textContent = formatSize(installer.size);
        link.append(label, size);
        downloadsRow.appendChild(link);
      }

      if (portable && portable.downloadUrl) {
        const link = document.createElement('a');
        link.className = 'dl-chip';
        link.href = portable.downloadUrl;
        const label = document.createElement('span');
        label.textContent = 'Portable (.exe)';
        const size = document.createElement('span');
        size.className = 'dl-chip-size';
        size.textContent = formatSize(portable.size);
        link.append(label, size);
        downloadsRow.appendChild(link);
      }

      const ghLink = document.createElement('a');
      ghLink.className = 'dl-chip';
      ghLink.href = rel.htmlUrl || DEFAULT_RELEASES_URL;
      ghLink.target = '_blank';
      ghLink.rel = 'noopener noreferrer';
      ghLink.textContent = 'Zobacz na GitHubie ↗';
      downloadsRow.appendChild(ghLink);

      card.appendChild(downloadsRow);
      frag.appendChild(card);
    });

    el.releasesList.replaceChildren(frag);
  }

  async function loadReleases() {
    let payload = null;
    try {
      const res = await fetch('/api/releases');
      if (res.ok) {
        payload = await res.json();
      }
    } catch {
      // Static local preview fallback
    }

    if (!payload) {
      try {
        const localRes = await fetch('./data/releases.json');
        if (localRes.ok) {
          const list = await localRes.json();
          payload = { source: 'fallback', releases: list };
        }
      } catch {
        payload = { source: 'fallback', releases: [] };
      }
    }

    const releases = Array.isArray(payload.releases) ? payload.releases : [];
    populateHeroDownload(releases[0]);
    renderReleasesList(releases, payload.source);
  }

  function bindEvents() {
    el.themeToggle.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      setSiteTheme(next);
    });

    for (const tab of el.previewTabs) {
      tab.addEventListener('click', () => {
        setPreviewTheme(tab.dataset.preview);
      });
    }

    el.downloadMenuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = el.downloadDropdown.classList.contains('hidden');
      el.downloadDropdown.classList.toggle('hidden', !willOpen);
      el.downloadMenuToggle.setAttribute('aria-expanded', String(willOpen));
    });

    document.addEventListener('click', (e) => {
      if (!el.downloadMenuWrap.contains(e.target)) {
        el.downloadDropdown.classList.add('hidden');
        el.downloadMenuToggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        el.downloadDropdown.classList.add('hidden');
        el.downloadMenuToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function init() {
    try {
      const saved = localStorage.getItem('peak-site-theme');
      if (saved === 'dark' || saved === 'light') {
        setSiteTheme(saved);
      }
    } catch {
      // Ignore
    }
    bindEvents();
    loadReleases();
  }

  init();
})();
