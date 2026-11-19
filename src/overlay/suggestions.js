(() => {
  const listEl = document.getElementById('suggestion-list');

  const ICONS = {
    search:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7.2" cy="7.2" r="4.3"/><path d="M10.5 10.5L13.4 13.4"/></svg>',
    url:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.3"/><path d="M2.8 8h10.4M8 2.7c1.6 1.7 1.6 8.9 0 10.6M8 2.7c-1.6 1.7-1.6 8.9 0 10.6"/></svg>',
    bookmark:
      '<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"><path d="M8 2.4l1.7 3.45 3.8.55-2.75 2.68.65 3.78L8 11.08l-3.4 1.78.65-3.78L2.5 6.4l3.8-.55L8 2.4z"/></svg>',
    history:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"><circle cx="8" cy="8" r="5.3"/><path d="M8 5.1V8l2.1 1.3"/></svg>'
  };

  function render({ items = [], activeIndex = 0, theme = 'alpine-light' }) {
    document.documentElement.dataset.theme = theme || 'alpine-light';
    const frag = document.createDocumentFragment();

    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = `suggestion-item${index === activeIndex ? ' active' : ''}`;
      li.setAttribute('role', 'option');

      const iconDiv = document.createElement('div');
      iconDiv.className = 'suggestion-icon';
      iconDiv.innerHTML = ICONS[item.kind] || ICONS.search;

      const textDiv = document.createElement('div');
      textDiv.className = 'suggestion-text';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'suggestion-title';
      titleSpan.textContent = item.title || item.query || item.url || '';

      const subSpan = document.createElement('span');
      subSpan.className = 'suggestion-sub';
      subSpan.textContent = item.subtitle || '';

      textDiv.append(titleSpan, subSpan);
      li.append(iconDiv, textDiv);

      li.addEventListener('mouseenter', () => {
        window.peakOverlay.hoverItem(index);
      });
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        window.peakOverlay.selectItem(item);
      });

      frag.appendChild(li);
    });

    listEl.replaceChildren(frag);
  }

  window.peakOverlay.onUpdate(render);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.peakOverlay.dismiss();
    }
  });
})();
