/* =========================================================
   app.js — navigation, settings/backup screen, bootstrap
   ========================================================= */

const App = (() => {
  let stack = ['screen-backlog'];
  const TITLES = {
    'screen-speedrun-home': ['runlog', 'Speedrun'],
    'screen-speedrun-form': ['runlog', 'Categoria'],
    'screen-speedrun-timer': ['runlog', 'Corrida'],
    'screen-speedrun-history': ['runlog', 'Histórico'],
    'screen-backlog': ['runlog', 'Backlog'],
    'screen-media-form': ['runlog', 'Mídia'],
    'screen-settings': ['runlog', 'Dados'],
  };

  function render(screenId, titleOverride) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('is-active'));
    const target = document.getElementById(screenId);
    target.classList.add('is-active');

    const [eyebrow, title] = TITLES[screenId] || ['runlog', ''];
    document.getElementById('topbar-eyebrow').textContent = eyebrow;
    document.getElementById('topbar-heading').textContent = titleOverride || title;
    document.getElementById('btn-back').hidden = stack.length <= 1;

    const ctxBtn = document.getElementById('btn-context');
    if (screenId !== 'screen-speedrun-timer') {
      ctxBtn.hidden = true;
      ctxBtn.onclick = null;
    }

    const rootNav = target.dataset.nav;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('is-active', b.dataset.nav === rootNav));

    document.getElementById('main').scrollTop = 0;
  }

  function go(screenId, titleOverride) {
    stack.push(screenId);
    render(screenId, titleOverride);
  }

  function replaceRoot(screenId) {
    stack = [screenId];
    render(screenId);
  }

  function back() {
    if (stack.length <= 1) return;
    stack.pop();
    render(stack[stack.length - 1]);
  }

  return { go, back, replaceRoot };
})();

// =========================================================
// Settings / backup / stats
// =========================================================
const Settings = (() => {

  async function renderStats() {
    const games = await DB.getAll('games');
    const runs = await DB.getAll('runs');
    const media = await DB.getAll('media');
    const totalHours = media.reduce((s, m) => s + (m.hours > 0 ? m.hours : 0), 0);
    const totalSpent = media.reduce((s, m) => s + (m.price > 0 ? m.price : 0), 0);
    const avgVph = totalHours > 0 ? totalSpent / totalHours : null;

    const stats = [
      [games.length, 'categorias de speedrun'],
      [runs.length, 'corridas registradas'],
      [media.length, 'itens no backlog'],
      [(Math.round(totalHours * 10) / 10) + 'h', 'horas registradas'],
      [formatBRL(totalSpent), 'total investido'],
      [avgVph != null ? formatBRL(avgVph) + '/h' : '—', 'valor médio da hora'],
    ];
    document.getElementById('stats-grid').innerHTML = stats.map(([v, l]) => `
      <div class="stat-box">
        <div class="stat-value">${v}</div>
        <div class="stat-label">${l}</div>
      </div>`).join('');
  }

  function wire() {
    document.getElementById('btn-export').addEventListener('click', async () => {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `runlog-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Backup exportado');
    });

    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('file-import').click();
    });

    document.getElementById('file-import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;

      let data;
      try {
        data = JSON.parse(await file.text());
      } catch (err) {
        toast('Esse arquivo não é um backup válido');
        return;
      }
      const g = Array.isArray(data.games) ? data.games.length : 0;
      const r = Array.isArray(data.runs) ? data.runs.length : 0;
      const m = Array.isArray(data.media) ? data.media.length : 0;
      if (g + r + m === 0) { toast('Nenhum dado reconhecido nesse arquivo'); return; }

      if (!confirm(`Backup encontrado: ${g} categorias, ${r} corridas, ${m} itens de mídia.\n\nImportar agora?`)) return;
      const replace = confirm(
        'OK = substituir todos os dados atuais pelo backup.\n' +
        'Cancelar = mesclar (mantém o que já existe e só adiciona o que for novo).'
      );
      await DB.importAll(data, replace ? 'replace' : 'merge');
      toast('Backup importado');
      await Speedrun.renderHome();
      await Media.renderList();
      await renderStats();
    });

    document.getElementById('btn-clear-all').addEventListener('click', async () => {
      if (!confirm('Isso apaga TUDO (categorias, corridas e backlog) permanentemente. Exportou um backup antes?')) return;
      if (!confirm('Tem certeza mesmo? Essa ação não pode ser desfeita.')) return;
      await DB.clearAll();
      toast('Todos os dados foram apagados');
      await Speedrun.renderHome();
      await Media.renderList();
      await renderStats();
    });
  }

  return { renderStats, wire };
})();

// =========================================================
// Bootstrap
// =========================================================
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('btn-back').addEventListener('click', () => App.back());

  document.getElementById('bottomnav').addEventListener('click', async (e) => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    const map = { speedrun: 'screen-speedrun-home', backlog: 'screen-backlog', settings: 'screen-settings' };
    const screenId = map[btn.dataset.nav];
    App.replaceRoot(screenId);
    if (btn.dataset.nav === 'settings') await Settings.renderStats();
  });

  // Optional keyboard shortcuts while the live timer screen is open
  // (handy when testing on a desktop browser): space = start/split, backspace = undo.
  document.addEventListener('keydown', (e) => {
    const timerActive = document.getElementById('screen-speedrun-timer').classList.contains('is-active');
    if (!timerActive) return;
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); Speedrun.startOrSplit(); }
    else if (e.key === 'Backspace') { e.preventDefault(); Speedrun.undoLastSplit(); }
  });

  Settings.wire();
  await Speedrun.init();
  await Media.init();
  App.replaceRoot('screen-backlog');
});