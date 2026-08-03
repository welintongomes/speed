/* =========================================================
   media.js — games/movies/books backlog with cost-per-hour
   ========================================================= */
const Media = (() => {

  let currentFilter = 'all';
  let currentSort = 'recent';
  let currentSearch = '';
  let editingId = null;
  let editingRecordCache = null;
  let formType = 'game';

  const TYPE_EMOJI = { game: '🎮', movie: '🎬', book: '📖' };
  const TYPE_LABEL = { game: 'Jogo', movie: 'Filme', book: 'Livro' };
  const STATUS_LABEL = { queue: 'Na fila', doing: 'Em andamento', done: 'Completo', dropped: 'Abandonado' };

  function valuePerHour(price, hours) {
    if (!hours || hours <= 0) return null;
    return (price || 0) / hours;
  }

  // --- Escala de crítico de cinema ---
  function getCriticLabel(rating) {
    if (!rating || rating === 0) return 'Sem nota';
    if (rating <= 2.0) return 'Péssimo';
    if (rating <= 4.5) return 'Fraco';
    if (rating <= 6.5) return 'Regular';
    if (rating <= 8.5) return 'Muito Bom';
    if (rating < 10) return 'Excelente';
    return 'Obra-Prima';
  }

  // =========================================================
  // List
  // =========================================================
  function sortItems(items, sort) {
    const arr = [...items];
    const vph = (m) => valuePerHour(m.price, m.hours);
    if (sort === 'rating') return arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    if (sort === 'title') return arr.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    if (sort === 'value-asc' || sort === 'value-desc') {
      return arr.sort((a, b) => {
        const va = vph(a), vb = vph(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return sort === 'value-asc' ? va - vb : vb - va;
      });
    }
    return arr.sort((a, b) => new Date(b.updatedAt || b.dateAdded || 0) - new Date(a.updatedAt || a.dateAdded || 0));
  }

function cardHTML(m) {
    const criticText = getCriticLabel(m.rating);
    const ratingBadge = m.rating > 0
      ? `<span class="badge badge-gold">★ ${Number(m.rating).toFixed(1).replace(/\.0$/, '')} — ${criticText}</span>`
      : `<span class="badge badge-neutral">Sem nota</span>`;
      
    const vph = valuePerHour(m.price, m.hours);
    let valueBadge = '';
    if (vph !== null) {
      const cls = vph <= 3 ? 'badge-teal' : (vph <= 8 ? 'badge-neutral' : 'badge-coral');
      valueBadge = `<span class="badge ${cls}">${formatBRL(vph)}/h</span>`;
    }
    
    const meta = [TYPE_LABEL[m.type]];
    if (m.hours > 0) meta.push(`${m.hours}h`);
    if (m.price > 0) meta.push(formatBRL(m.price));

    const dateFormatted = m.dateFinished ? m.dateFinished.split('-').reverse().join('/') : '';

    // LÓGICA DE CORES DINÂMICAS!
    let ratingClass = '';
    if (m.rating > 0) {
      if (m.rating <= 3.5) ratingClass = 'card-rating-terrible';      // Vermelho
      else if (m.rating <= 6.0) ratingClass = 'card-rating-bad';      // Amarelado
      else if (m.rating <= 8.5) ratingClass = 'card-rating-good';     // Esmeralda/Teal
      else if (m.rating >= 9.0) ratingClass = 'card-rating-masterpiece'; // Dourado
    }

    return `
      <div class="card card-expandable ${ratingClass}" data-id="${m.id}">
        <div class="card-header">
          <div class="card-top">
            <div style="flex: 1; min-width: 0;">
              <div class="card-title">${TYPE_EMOJI[m.type]} ${escapeHtml(m.title)}</div>
              <div class="card-sub">${meta.join(' · ')}</div>
            </div>
            <button class="icon-btn btn-edit-media" data-action="edit" aria-label="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
            </button>
          </div>
          <div class="card-badges">
            ${ratingBadge}
            ${valueBadge}
          </div>
        </div>

        <div class="card-details" hidden>
          <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span class="detail-value">${STATUS_LABEL[m.status]}</span>
          </div>
          ${dateFormatted ? `
          <div class="detail-row">
            <span class="detail-label">Concluído em:</span>
            <span class="detail-value">${dateFormatted}</span>
          </div>` : ''}
          ${m.review ? `
          <div class="detail-row review-box">
            <span class="detail-label">Análise / Anotações:</span>
            <p class="review-text">${escapeHtml(m.review).replace(/\n/g, '<br>')}</p>
          </div>` : ''}
        </div>
      </div>`;
  }

async function renderList() {
    let items = await DB.getAll('media');
    
    // 1. Aplica o filtro de tipo (Jogo, Filme, Livro)
    if (currentFilter !== 'all') items = items.filter(m => m.type === currentFilter);
    
    // 2. Aplica a barra de pesquisa!
    if (currentSearch) {
      const term = currentSearch.toLowerCase();
      items = items.filter(m => m.title.toLowerCase().includes(term));
    }
    
    // 3. Aplica a ordenação
    items = sortItems(items, currentSort);

    const wrap = document.getElementById('media-list');
    const empty = document.getElementById('media-empty');
    if (!items.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
      // Se não achou nada na pesquisa, muda o texto de vazio para fazer sentido
      if (currentSearch) {
        empty.innerHTML = `<p class="empty-title">Nada encontrado</p><p class="empty-sub">Nenhum resultado para "${escapeHtml(currentSearch)}"</p>`;
      } else {
        empty.innerHTML = `<p class="empty-title">Nada por aqui ainda</p><p class="empty-sub">Adicione um jogo, filme ou livro para começar.</p>`;
      }
      return;
    }
    empty.hidden = true;
    wrap.innerHTML = items.map(cardHTML).join('');
  }

function wireList() {
    // Liga a Pesquisa
    const searchInput = document.getElementById('search-media');
    const searchClear = document.getElementById('search-clear');

    searchInput.oninput = (e) => {
      currentSearch = e.target.value.trim();
      searchClear.hidden = currentSearch.length === 0;
      renderList();
    };

    searchClear.onclick = () => {
      searchInput.value = '';
      currentSearch = '';
      searchClear.hidden = true;
      renderList();
      searchInput.focus();
    };

    // Filtros e Ordenação
    document.getElementById('type-filter').onclick = (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      document.querySelectorAll('#type-filter .chip').forEach(c => c.classList.remove('is-active'));
      btn.classList.add('is-active');
      currentFilter = btn.dataset.type;
      renderList();
    };
    
    document.getElementById('sort-select').onchange = (e) => {
      currentSort = e.target.value;
      renderList();
    };
    
    // Liga a expansão dos cards
    document.getElementById('media-list').onclick = (e) => {
      const card = e.target.closest('.card');
      if (!card) return;

      if (e.target.closest('[data-action="edit"]')) {
        openForm(card.dataset.id);
        return; 
      }

      const details = card.querySelector('.card-details');
      if (details) {
        document.querySelectorAll('.card-details').forEach(d => {
           if (d !== details) d.hidden = true;
        });
        details.hidden = !details.hidden;
      }
    };
    
    document.getElementById('btn-new-media').onclick = () => openForm(null);
  }

  // =========================================================
  // Form
  // =========================================================
  function setSegmented(type) {
    document.querySelectorAll('#media-type-segmented .seg-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.type === type);
    });
  }

  function updateValueBox() {
    const price = parseFloat(document.getElementById('media-price').value) || 0;
    const hours = parseFloat(document.getElementById('media-hours').value) || 0;
    const box = document.getElementById('value-per-hour-box');
    const amountEl = document.getElementById('value-per-hour-amount');
    const labelEl = document.getElementById('value-per-hour-label');
    if (hours > 0) {
      const vph = price / hours;
      box.hidden = false;
      amountEl.textContent = formatBRL(vph) + '/h';
      box.classList.toggle('is-bad', vph > 8);
      labelEl.textContent = vph <= 3
        ? 'Valor da hora — ótimo custo-benefício'
        : (vph <= 8 ? 'Valor da hora' : 'Valor da hora — caro');
    } else {
      box.hidden = true;
    }
  }

  function updateRatingLabel() {
    const v = parseFloat(document.getElementById('media-rating').value);
    document.getElementById('rating-value').textContent = v > 0 ? String(v).replace(/\.0$/, '') : '—';
  }

  async function openForm(id) {
    editingId = id;
    editingRecordCache = null;
    const deleteBtn = document.getElementById('btn-delete-media');
    document.getElementById('form-media').reset();

    if (id) {
      const m = await DB.get('media', id);
      editingRecordCache = m;
      formType = m.type;
      setSegmented(m.type);
      document.getElementById('media-title').value = m.title;
      document.getElementById('media-status').value = m.status;
      document.getElementById('media-rating').value = m.rating || 0;
      document.getElementById('media-price').value = m.price || '';
      document.getElementById('media-hours').value = m.hours || '';
      document.getElementById('media-date').value = m.dateFinished || '';
      document.getElementById('media-review').value = m.review || '';
      deleteBtn.hidden = false;
      App.go('screen-media-form', escapeHtml(m.title) ? m.title : 'Editar');
    } else {
      formType = 'game';
      setSegmented('game');
      document.getElementById('media-status').value = 'queue';
      document.getElementById('media-rating').value = 0;
      deleteBtn.hidden = true;
      App.go('screen-media-form', 'Adicionar mídia');
    }
    updateRatingLabel();
    updateValueBox();
  }

  function wireForm() {
    document.getElementById('media-type-segmented').onclick = (e) => {
      const btn = e.target.closest('.seg-btn');
      if (!btn) return;
      formType = btn.dataset.type;
      setSegmented(formType);
    };
    document.getElementById('media-rating').oninput = updateRatingLabel;
    document.getElementById('media-price').oninput = updateValueBox;
    document.getElementById('media-hours').oninput = updateValueBox;
    document.getElementById('btn-cancel-media').onclick = () => App.back();

    document.getElementById('form-media').onsubmit = async (e) => {
      e.preventDefault();
      const title = document.getElementById('media-title').value.trim();
      if (!title) { toast('Dá um título'); return; }
      const now = new Date().toISOString();
      const record = {
        id: editingId || uuid(),
        type: formType,
        title,
        status: document.getElementById('media-status').value,
        rating: parseFloat(document.getElementById('media-rating').value) || 0,
        price: parseFloat(document.getElementById('media-price').value) || 0,
        hours: parseFloat(document.getElementById('media-hours').value) || 0,
        dateFinished: document.getElementById('media-date').value || null,
        review: document.getElementById('media-review').value.trim(),
        dateAdded: editingRecordCache?.dateAdded || now,
        updatedAt: now,
      };
      await DB.put('media', record);
      toast(editingId ? 'Atualizado' : 'Adicionado');
      await renderList();
      App.back();
    };

    document.getElementById('btn-delete-media').onclick = async () => {
      if (!editingId) return;
      if (!confirm('Excluir este item do backlog?')) return;
      await DB.delete('media', editingId);
      toast('Excluído');
      await renderList();
      App.back();
    };
  }

  // =========================================================
  // Public
  // =========================================================
  async function init() {
    wireList();
    wireForm();
    await renderList();
  }

  return { init, renderList };
})();