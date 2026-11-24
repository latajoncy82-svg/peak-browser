(() => {
  const form = document.getElementById('incognito-search-form');
  const input = document.getElementById('incognito-search-input');

  if (form && input) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const val = input.value.trim();
      if (!val || !window.peakNewTab) return;
      window.peakNewTab.navigate(val);
    });
  }
})();
