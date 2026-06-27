/**
 * Piana UI Utilities — Navigation, modals, toasts, loading
 */
const UI = (() => {
  let currentPage = 'dashboard';
  let loadingEl = null;

  /** Switch to a page */
  function switchPage(pageName) {
    // Deactivate all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // Activate target
    const target = document.getElementById(`page-${pageName}`);
    if (target) {
      target.classList.add('active');
      target.querySelector('.page-scroll')?.scrollTo(0, 0);
      currentPage = pageName;
    }

    // Update tab bar
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === pageName);
    });
  }

  /** Get current page name */
  function getCurrentPage() {
    return currentPage;
  }

  // ─── Toast notifications ──────────────────────────

  /** Show a toast message */
  function toast(message, type = 'info', duration = 2500) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('toast-out');
      el.addEventListener('animationend', () => el.remove());
    }, duration);
  }

  // ─── Loading overlay ───────────────────────────────

  /** Show loading overlay */
  function showLoading(message = '加载中...') {
    if (loadingEl) hideLoading();
    loadingEl = document.createElement('div');
    loadingEl.className = 'loading-overlay';
    loadingEl.innerHTML = `
      <div class="loading-box">
        <div class="spinner"></div>
        <p>${message}</p>
      </div>
    `;
    document.body.appendChild(loadingEl);
  }

  /** Hide loading overlay */
  function hideLoading() {
    if (loadingEl) {
      loadingEl.remove();
      loadingEl = null;
    }
  }

  // ─── Modal ─────────────────────────────────────────

  /** Show a modal with custom content */
  function showModal(title, contentHtml, onClose) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');

    content.innerHTML = `
      <h2>${title}</h2>
      ${contentHtml}
    `;

    // Close button
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        hideModal();
        if (onClose) onClose();
      }
    };

    overlay.classList.remove('hidden');
  }

  /** Hide modal */
  function hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  // ─── Celebration effect ────────────────────────────

  /** Show celebration particles */
  function celebrate() {
    const emojis = ['🎉', '⭐', '✨', '💪', '🔥', '👏', '🏆', '💯'];
    for (let i = 0; i < 12; i++) {
      setTimeout(() => {
        const particle = document.createElement('span');
        particle.className = 'celebrate-particle';
        particle.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        particle.style.left = Math.random() * 80 + 10 + '%';
        particle.style.top = Math.random() * 60 + 20 + '%';
        document.body.appendChild(particle);
        setTimeout(() => particle.remove(), 1100);
      }, i * 80);
    }
  }

  // ─── Formatting helpers ────────────────────────────

  /** Format seconds to mm:ss */
  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /** Format date string */
  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  // ─── Debounce ──────────────────────────────────────

  function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  return {
    switchPage, getCurrentPage,
    toast, showLoading, hideLoading,
    showModal, hideModal,
    celebrate, formatTime, formatDate, debounce
  };
})();
