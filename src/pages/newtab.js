(() => {
  const THEME_ORDER = ['alpine-light', 'alpine-royal', 'alpine-dark'];

  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const clockEl = document.getElementById('clock');
  const dateLineEl = document.getElementById('date-line');
  const grid = document.getElementById('speed-dial-grid');
  const themeCycleBtn = document.getElementById('theme-cycle-btn');

  const modalBackdrop = document.getElementById('modal-backdrop');
  const shortcutForm = document.getElementById('shortcut-form');
  const shortcutTitle = document.getElementById('shortcut-title');
  const shortcutUrl = document.getElementById('shortcut-url');
  const modalCancel = document.getElementById('modal-cancel');

  let state = {
    settings: { theme: 'alpine-light', searchEngine: 'google', shieldEnabled: true },
    speedDial: []
  };

  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('pl-PL', {
      hour: '2-digit',
      minute: '2-digit'
    });
    dateLineEl.textContent = now.toLocaleDateString('pl-PL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
  }

  function extractHost(rawUrl) {
    try {
      return new URL(rawUrl).hostname;
    } catch {
      return '';
    }
  }

  function hostInitial(item) {
    const label = (item.title || '').trim();
    if (label) return label.slice(0, 1).toUpperCase();
    const host = extractHost(item.url).replace(/^www\./, '');
    return (host || 'P').slice(0, 1).toUpperCase();
  }

  function render() {
    const theme = state.settings.theme || 'alpine-light';
    document.documentElement.dataset.theme = theme;

    const frag = document.createDocumentFragment();
    for (const item of state.speedDial) {
      const tile = document.createElement('div');
      tile.className = 'shortcut-tile';
      tile.title = item.url;

      const well = document.createElement('div');
      well.className = 'shortcut-well';

      const host = extractHost(item.url);
      if (host) {
        const img = document.createElement('img');
        img.className = 'shortcut-favicon';
        img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
        img.alt = '';
        img.onerror = () => {
          well.textContent = hostInitial(item);
        };
        well.appendChild(img);
      } else {
        well.textContent = hostInitial(item);
      }

      const label = document.createElement('div');
      label.className = 'shortcut-label';
      label.textContent = item.title || host || item.url;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'shortcut-remove';
      removeBtn.type = 'button';
      removeBtn.title = 'Usuń skrót';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        state.speedDial = await window.peakNewTab.removeSpeedDial(item.id);
        render();
      });

      tile.addEventListener('click', () => {
        window.peakNewTab.navigate(item.url);
      });

      tile.append(well, label, removeBtn);
      frag.appendChild(tile);
    }

    if (state.speedDial.length < 8) {
      const addTile = document.createElement('button');
      addTile.type = 'button';
      addTile.className = 'shortcut-tile shortcut-add';
      addTile.title = 'Dodaj skrót';
      addTile.innerHTML = '<div class="shortcut-well">+</div><div class="shortcut-label">Dodaj</div>';
      addTile.addEventListener('click', () => {
        shortcutTitle.value = '';
        shortcutUrl.value = '';
        modalBackdrop.classList.remove('hidden');
        shortcutTitle.focus();
      });
      frag.appendChild(addTile);
    }

    grid.replaceChildren(frag);
  }

  searchInput.addEventListener('input', () => {
    searchForm.classList.toggle('has-text', Boolean(searchInput.value.trim()));
  });

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = searchInput.value.trim();
    if (!val) return;
    window.peakNewTab.navigate(val);
  });

  themeCycleBtn.addEventListener('click', async () => {
    const current = state.settings.theme || 'alpine-light';
    const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
    state.settings = await window.peakNewTab.setTheme(next);
    render();
  });

  modalCancel.addEventListener('click', () => {
    modalBackdrop.classList.add('hidden');
  });

  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) {
      modalBackdrop.classList.add('hidden');
    }
  });

  shortcutForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = shortcutUrl.value.trim();
    if (!url) return;
    state.speedDial = await window.peakNewTab.addSpeedDial({
      title: shortcutTitle.value.trim(),
      url
    });
    modalBackdrop.classList.add('hidden');
    render();
  });

  async function init() {
    updateClock();
    setInterval(updateClock, 15000);

    if (window.peakNewTab) {
      state = await window.peakNewTab.getInitialData();
      render();
      window.peakNewTab.onStateUpdate((next) => {
        state = next;
        render();
      });
    }
  }

  init();
})();
