/* =========================================================
   speedrun.js — LiveSplit Features: Gold Splits, SoB, History
   ========================================================= */
const Speedrun = (() => {

  let games = [];       // cache of all games
  let runsByGame = {};  // gameId -> [runs]
  let editingGameId = null;
  let formSegments = []; 

  // ---- Live timer state ----
  const Timer = {
    game: null,
    pbRun: null,
    bestSegments: [],   // Array com o Gold Split de cada área
    running: false,
    finished: false,
    startTs: 0,
    pausedAccum: 0,
    splitTimes: [],     // cumulative ms
    segDeltas: [],      // frozen segment delta (ms)
    rafId: null,
    rowEls: [],
    rowDeltaEls: [],
    rowPbEls: [],
  };

  function getElapsed() {
    if (!Timer.running) return 0;
    return performance.now() - Timer.startTs - Timer.pausedAccum;
  }

  // =========================================================
  // Data loading & LiveSplit Math
  // =========================================================
  async function loadAll() {
    games = await DB.getAll('games');
    const allRuns = await DB.getAll('runs');
    runsByGame = {};
    for (const r of allRuns) {
      (runsByGame[r.gameId] ||= []).push(r);
    }
  }

  function pbFor(gameId) {
    const runs = runsByGame[gameId] || [];
    if (!runs.length) return null;
    return runs.reduce((min, r) => (r.totalTime < min.totalTime ? r : min));
  }

  // Calcula o melhor tempo da história de CADA segmento (Gold Splits)
  function getBestSegments(gameId) {
    const runs = runsByGame[gameId] || [];
    const game = games.find(g => g.id === gameId);
    if (!game || !runs.length) return [];
    
    const bests = new Array(game.segments.length).fill(Infinity);
    
    runs.forEach(run => {
      // Ignora runs incompletas (útil quando implementarmos Skip)
      if (run.segmentTimes.length === game.segments.length) {
        run.segmentTimes.forEach((time, i) => {
          const prev = i > 0 ? run.segmentTimes[i - 1] : 0;
          const dur = time - prev;
          if (dur < bests[i]) bests[i] = dur;
        });
      }
    });
    return bests.map(b => b === Infinity ? null : b);
  }

  // =========================================================
  // Home list
  // =========================================================
  async function renderHome() {
    await loadAll();
    const wrap = document.getElementById('speedrun-game-list');
    const empty = document.getElementById('speedrun-empty');

    if (!games.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    wrap.innerHTML = games.map(g => {
      const runs = runsByGame[g.id] || [];
      const pb = pbFor(g.id);
      const pbBadge = pb
        ? `<span class="badge badge-gold">${formatClock(pb.totalTime)}</span>`
        : `<span class="badge badge-neutral">sem recorde</span>`;
      return `
        <div class="card" data-game-id="${g.id}">
          <div class="card-top">
            <div>
              <div class="card-title">${escapeHtml(g.name)}</div>
              <div class="card-sub">${g.segments.length} área${g.segments.length === 1 ? '' : 's'} · ${runs.length} tentativa${runs.length === 1 ? '' : 's'}</div>
            </div>
            ${pbBadge}
          </div>
          <div class="form-actions" style="margin-top:2px;">
            <button type="button" class="btn-ghost btn-small" data-action="edit">Editar</button>
            <button type="button" class="btn-ghost btn-small" data-action="history">Histórico</button>
            <button type="button" class="btn-primary btn-small" data-action="start">Iniciar</button>
          </div>
        </div>`;
    }).join('');
  }

  // =========================================================
  // Category (game) form
  // =========================================================
function renderSegmentRows() {
    const wrap = document.getElementById('segment-list');
    wrap.innerHTML = formSegments.map((name, i) => `
      <div class="segment-row" data-idx="${i}">
        <span class="seg-index">${i + 1}</span>
        <input type="text" value="${escapeHtml(name)}" placeholder="Nome da área" data-seg-input maxlength="60">
        
        <!-- Nosso novo grupo de botões -->
        <div class="seg-actions">
          <button type="button" class="seg-action-icon" data-seg-up ${i === 0 ? 'disabled' : ''} aria-label="Mover para cima">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
          </button>
          
          <button type="button" class="seg-action-icon" data-seg-down ${i === formSegments.length - 1 ? 'disabled' : ''} aria-label="Mover para baixo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          
          <button type="button" class="seg-action-icon seg-remove" data-seg-remove aria-label="Remover área">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>`).join('');
  }

  function openGameForm(gameId) {
    editingGameId = gameId;
    const deleteBtn = document.getElementById('btn-delete-game');
    const warning = document.getElementById('segment-edit-warning');

    if (gameId) {
      const g = games.find(x => x.id === gameId);
      document.getElementById('game-name').value = g.name;
      formSegments = [...g.segments];
      deleteBtn.hidden = false;
      warning.hidden = !(runsByGame[gameId] && runsByGame[gameId].length);
      App.go('screen-speedrun-form', 'Editar categoria');
    } else {
      document.getElementById('game-name').value = '';
      formSegments = ['', ''];
      deleteBtn.hidden = true;
      warning.hidden = true;
      App.go('screen-speedrun-form', 'Nova categoria');
    }
    renderSegmentRows();
  }

  // =========================================================
  // Live timer screen
  // =========================================================
  // 1. ADICIONA AS VARIÁVEIS DE PAUSA NO RESET
  function resetTimerState(game, pbRun) {
    Timer.game = game;
    Timer.pbRun = pbRun;
    Timer.bestSegments = getBestSegments(game.id);
    Timer.running = false;
    Timer.finished = false;
    Timer.isPaused = false; // NOVO
    Timer.pauseTs = 0;      // NOVO
    Timer.startTs = 0;
    Timer.pausedAccum = 0;
    Timer.splitTimes = [];
    Timer.segDeltas = [];
    if (Timer.rafId) cancelAnimationFrame(Timer.rafId);
    Timer.rafId = null;
  }

  // =========================================================
  // Live timer screen (Com Navegação Corrigida)
  // =========================================================

  // Nova função que apenas limpa a interface do cronômetro
// Nova função que apenas limpa a interface do cronômetro
  function refreshTimerView(gameId) {
    const g = games.find(x => x.id === gameId);
    const pb = pbFor(gameId);
    resetTimerState(g, pb);

    document.getElementById('run-summary').hidden = true;
    document.getElementById('pb-line').innerHTML = pb
      ? `Recorde: <span class="pb-time">${formatClock(pb.totalTime)}</span>`
      : 'Sem recorde ainda — essa tentativa já entra pro histórico';
      
    // Sum of Best
    const sobLine = document.getElementById('sob-line');
    if (Timer.bestSegments.length > 0 && Timer.bestSegments.every(b => b !== null)) {
      const sob = Timer.bestSegments.reduce((a, b) => a + b, 0);
      document.getElementById('sob-time').textContent = formatClock(sob);
      sobLine.hidden = false;
    } else {
      sobLine.hidden = true;
    }

    document.getElementById('clock-display').textContent = '0:00.00';
    document.getElementById('live-delta').textContent = '';
    document.getElementById('live-delta').className = 'live-delta';
    document.getElementById('clock-box').className = 'clock-box';

    const mainBtn = document.getElementById('btn-timer-main');
    mainBtn.textContent = 'Iniciar';
    mainBtn.className = 'btn-timer-main';
    mainBtn.disabled = false;
    document.getElementById('btn-undo-split').disabled = true;
    document.getElementById('btn-reset-run').disabled = true;
    
    // --- É AQUI QUE OS BOTÕES SÃO ZERADOS ---
    const skipBtn = document.getElementById('btn-skip-split');
    if(skipBtn) skipBtn.disabled = true;

    const pauseBtn = document.getElementById('btn-pause-run');
    if(pauseBtn) { 
      pauseBtn.disabled = true; 
      pauseBtn.textContent = 'Pausar'; 
    }
    // ----------------------------------------

    renderSplitRows();
  }

  function openTimer(gameId) {
    // 1. Limpa o cronômetro
    refreshTimerView(gameId);
    
    // 2. Avisa a navegação (só acontece quando abre a tela a primeira vez!)
    const g = games.find(x => x.id === gameId);
    App.go('screen-speedrun-timer', g.name);
    
    const ctxBtn = document.getElementById('btn-context');
    ctxBtn.hidden = false;
    ctxBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"/><path d="M8.5 14L6 22l6-3 6 3-2.5-8"/></svg>`;
    ctxBtn.onclick = () => openHistory(gameId);
  }

  function closeSummary() {
    document.getElementById('run-summary').hidden = true;
    // Agora apenas recarrega o visual, sem acumular telas!
    refreshTimerView(Timer.game.id); 
  }

  function resetRun() {
    if (Timer.running && Timer.splitTimes.length && !confirm('Resetar essa tentativa? O progresso atual será perdido.')) return;
    // Agora apenas recarrega o visual, sem acumular telas!
    refreshTimerView(Timer.game.id); 
  }

  function renderSplitRows() {
    const wrap = document.getElementById('splits-list');
    wrap.innerHTML = Timer.game.segments.map((name, i) => `
      <div class="split-row" data-idx="${i}">
        <span class="split-name">${escapeHtml(name)}</span>
        <span class="split-pb"></span>
        <span class="split-delta">—</span>
      </div>`).join('');
    Timer.rowEls = [...wrap.querySelectorAll('.split-row')];
    Timer.rowDeltaEls = [...wrap.querySelectorAll('.split-delta')];
    Timer.rowPbEls = [...wrap.querySelectorAll('.split-pb')];

    Timer.rowPbEls.forEach((el, i) => {
      if (Timer.pbRun && i < Timer.pbRun.segmentTimes.length) {
        const dur = Timer.pbRun.segmentTimes[i] - (i > 0 ? Timer.pbRun.segmentTimes[i - 1] : 0);
        el.textContent = formatClock(dur);
      } else {
        el.textContent = '—';
      }
    });
    highlightCurrentRow();
  }

// 2. DESLIGA O DESTAQUE SE ESTIVER PAUSADO
  function highlightCurrentRow() {
    const idx = Timer.splitTimes.length;
    Timer.rowEls.forEach((row, i) => {
      const isCurrent = (i === idx && Timer.running && !Timer.finished && !Timer.isPaused);
      row.classList.toggle('is-current', isCurrent);
      row.querySelector('.split-name').classList.toggle('is-current', isCurrent);
      if (isCurrent) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function pbSegmentDuration(idx) {
    if (!Timer.pbRun || idx >= Timer.pbRun.segmentTimes.length) return null;
    return Timer.pbRun.segmentTimes[idx] - (idx > 0 ? Timer.pbRun.segmentTimes[idx - 1] : 0);
  }

  function tick() {
    if (!Timer.running || Timer.finished) return;
    const elapsed = getElapsed();
    document.getElementById('clock-display').textContent = formatClock(elapsed);

    const idx = Timer.splitTimes.length;
    const pbDur = pbSegmentDuration(idx);
    const liveDeltaEl = document.getElementById('live-delta');
    const clockBox = document.getElementById('clock-box');

    if (pbDur !== null && idx < Timer.game.segments.length) {
      const liveSegElapsed = elapsed - (idx > 0 ? Timer.splitTimes[idx - 1] : 0);
      const delta = liveSegElapsed - pbDur;
      const cls = delta < 0 ? 'is-ahead' : 'is-behind';
      const text = formatDelta(delta);
      liveDeltaEl.textContent = text;
      liveDeltaEl.className = 'live-delta ' + cls;
      clockBox.className = 'clock-box ' + cls;
    } else {
      liveDeltaEl.textContent = '';
      liveDeltaEl.className = 'live-delta';
      clockBox.className = 'clock-box';
    }

    Timer.rafId = requestAnimationFrame(tick);
  }

  // --- NOVA FUNÇÃO ---
  function togglePause() {
    if (Timer.finished) return;
    if (!Timer.running && !Timer.isPaused) return; // Se não começou, ignora

    const pauseBtn = document.getElementById('btn-pause-run');
    const mainBtn = document.getElementById('btn-timer-main');

    if (Timer.isPaused) {
      // RETOMAR
      Timer.isPaused = false;
      Timer.running = true;
      Timer.pausedAccum += performance.now() - Timer.pauseTs; // Desconta o tempo que ficou parado
      
      pauseBtn.textContent = 'Pausar';
      mainBtn.disabled = false; // Religa o botão Split
      
      highlightCurrentRow();
      tick(); // Recomeça a animação do relógio
    } else {
      // PAUSAR
      Timer.isPaused = true;
      Timer.running = false;
      Timer.pauseTs = performance.now(); // Marca a hora exata da pausa
      
      pauseBtn.textContent = 'Retomar';
      mainBtn.disabled = true; // Desabilita o Split para não clicar sem querer
      
      highlightCurrentRow(); // Apaga o destaque da linha
      if (Timer.rafId) cancelAnimationFrame(Timer.rafId);
    }
  }

  function startOrSplit() {
    if (!Timer.running) {
      Timer.running = true;
      Timer.finished = false;
      Timer.startTs = performance.now();
      Timer.pausedAccum = 0;
      Timer.splitTimes = [];
      Timer.segDeltas = [];
      const mainBtn = document.getElementById('btn-timer-main');
      mainBtn.textContent = 'Split';
      mainBtn.className = 'btn-timer-main is-running';
      document.getElementById('btn-reset-run').disabled = false;
      highlightCurrentRow();
      tick();
      return;
    }

    const elapsed = getElapsed();
    const idx = Timer.splitTimes.length;
    Timer.splitTimes.push(elapsed);

    const pbDur = pbSegmentDuration(idx);
    const segStart = idx > 0 ? Timer.splitTimes[idx - 1] : 0;
    const segDuration = elapsed - segStart;
    const delta = pbDur !== null ? segDuration - pbDur : null;
    Timer.segDeltas.push(delta);

    // Lógica do GOLD SPLIT
    const bestDur = Timer.bestSegments[idx];
    const isGold = bestDur !== null && segDuration < bestDur;

    if (Timer.rowEls[idx]) {
      const cell = Timer.rowDeltaEls[idx];
      if (delta !== null) {
        let cls = delta < 0 ? 'is-ahead' : 'is-behind';
        if (isGold) cls = 'is-gold'; // Substitui verde por dourado
        cell.textContent = formatDelta(delta);
        cell.className = 'split-delta ' + cls;
      } else if (isGold) {
        // Primeira run da vida batendo um tempo base
        cell.textContent = '-0.00';
        cell.className = 'split-delta is-gold';
      }
    }

    document.getElementById('btn-undo-split').disabled = false;

    if (idx === Timer.game.segments.length - 1) {
      finishRun(elapsed);
    } else {
      highlightCurrentRow();
    }
  }

  function undoLastSplit() {
    if (!Timer.running || Timer.finished || !Timer.splitTimes.length) return;
    const idx = Timer.splitTimes.length - 1;
    Timer.splitTimes.pop();
    Timer.segDeltas.pop();
    if (Timer.rowDeltaEls[idx]) {
      Timer.rowDeltaEls[idx].textContent = '—';
      Timer.rowDeltaEls[idx].className = 'split-delta';
    }
    document.getElementById('btn-undo-split').disabled = Timer.splitTimes.length === 0;
    highlightCurrentRow();
  }

  // --- ADICIONE ESTA NOVA FUNÇÃO ---
  function skipSplit() {
    if (!Timer.running || Timer.finished) return;
    
    const idx = Timer.splitTimes.length;
    // Salva null para indicar que a área foi pulada
    Timer.splitTimes.push(null);
    Timer.segDeltas.push(null);

    if (Timer.rowEls[idx]) {
      const cell = Timer.rowDeltaEls[idx];
      cell.textContent = 'Pulou';
      cell.className = 'split-delta';
      // Risca o tempo na interface principal
      Timer.rowEls[idx].style.opacity = '0.4';
    }

    document.getElementById('btn-undo-split').disabled = false;

    // Se pulou a última área, encerra a corrida com o tempo atual
    if (idx === Timer.game.segments.length - 1) {
      finishRun(getElapsed());
    } else {
      highlightCurrentRow();
    }
  }

  // --- SUBSTITUA O SEU finishRun POR ESTE ---
// 3. ATUALIZA A TELA INICIAL QUANDO ACABA (O Fim do Recorde Fantasma)
  async function finishRun(totalTime) {
    Timer.finished = true;
    Timer.running = false;
    if (Timer.rafId) cancelAnimationFrame(Timer.rafId);
    document.getElementById('clock-display').textContent = formatClock(totalTime);
    document.getElementById('live-delta').textContent = '';
    document.getElementById('clock-box').className = 'clock-box';

    const previousRuns = runsByGame[Timer.game.id] || [];
    const prevPb = previousRuns.length ? previousRuns.reduce((min, r) => r.totalTime < min.totalTime ? r : min) : null;
    const isNewPB = !prevPb || totalTime < prevPb.totalTime;
    
    const run = {
      id: uuid(),
      gameId: Timer.game.id,
      date: new Date().toISOString(),
      segmentTimes: [...Timer.splitTimes],
      totalTime,
    };
    
    await DB.put('runs', run);
    (runsByGame[Timer.game.id] ||= []).push(run);
    if (isNewPB) Timer.pbRun = run;

    // --- MÁGICA AQUI: Atualiza a tela inicial lá atrás! ---
    await renderHome();

    document.getElementById('btn-timer-main').className = 'btn-timer-main';
    document.getElementById('btn-timer-main').textContent = 'Iniciar';
    document.getElementById('btn-undo-split').disabled = true;
    
    // Trava os botões
    const skipBtn = document.getElementById('btn-skip-split');
    if(skipBtn) skipBtn.disabled = true;
    const pauseBtn = document.getElementById('btn-pause-run');
    if(pauseBtn) { pauseBtn.disabled = true; pauseBtn.textContent = 'Pausar'; }

    // (O resto do seu código de relatorio continua igual daqui para baixo)
    const detailsWrap = document.getElementById('run-summary-details');
    detailsWrap.innerHTML = Timer.game.segments.map((name, i) => {
      const segTime = run.segmentTimes[i];
      let timeText = '—';
      let colorClass = '';

      if (segTime !== null && segTime !== undefined) {
        let prevTime = 0;
        for (let j = i - 1; j >= 0; j--) {
          if (run.segmentTimes[j] !== null && run.segmentTimes[j] !== undefined) {
            prevTime = run.segmentTimes[j];
            break;
          }
        }
        const duration = segTime - prevTime;
        timeText = formatClock(duration);
        if (Timer.bestSegments[i] !== null && duration <= Timer.bestSegments[i]) {
           colorClass = 'is-gold';
        }
      } else {
        timeText = 'Pulou';
      }

      return `
        <div class="summary-row">
          <span class="seg-name">${escapeHtml(name)}</span>
          <span class="seg-time ${colorClass}">${timeText}</span>
        </div>
      `;
    }).join('');

    const flag = document.getElementById('run-summary-flag');
    const sub = document.getElementById('run-summary-sub');
    const elTime = document.getElementById('run-summary-time');
    const elPb = document.getElementById('run-summary-pb');

    flag.textContent = isNewPB ? '🏆 Novo recorde!' : 'Corrida concluída';
    elTime.textContent = formatClock(totalTime);
    elPb.textContent = prevPb ? formatClock(prevPb.totalTime) : '—';
    
    if (isNewPB) {
      elTime.classList.add('is-gold');
      sub.textContent = 'Essa é a nova marca a bater da próxima vez!';
    } else {
      elTime.classList.remove('is-gold');
      const diff = totalTime - prevPb.totalTime;
      sub.textContent = `Ficou ${formatDelta(diff)} atrás do seu recorde.`;
    }
    
    document.getElementById('run-summary').hidden = false;
  }

  // =========================================================
  // History screen (Com Exclusão)
  // =========================================================
  // =========================================================
  // History screen (Com Exclusão Corrigida)
  // =========================================================
  
  // Nova função que APENAS atualiza o visual da lista no HTML
  function renderHistoryList(gameId) {
    const g = games.find(x => x.id === gameId);
    const runs = [...(runsByGame[gameId] || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
    const pb = pbFor(gameId);

    const wrap = document.getElementById('history-list');
    const empty = document.getElementById('history-empty');
    
    if (!runs.length) {
      wrap.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      wrap.innerHTML = runs.map(r => `
        <div class="card">
          <div class="history-row">
            <div>
              <div class="history-time">${formatClock(r.totalTime)}</div>
              <div class="history-date">${formatDateBR(r.date)}</div>
            </div>
            <div style="display:flex; align-items:center; gap:8px;">
              ${pb && r.id === pb.id ? '<span class="badge badge-gold">recorde</span>' : ''}
              <button class="btn-delete-run" data-run-id="${r.id}" data-game-id="${g.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </div>
          </div>
        </div>`).join('');
    }
  }

  function openHistory(gameId) {
    const g = games.find(x => x.id === gameId);
    renderHistoryList(gameId); // Chama a função para montar a lista
    App.go('screen-speedrun-history', `Histórico — ${g.name}`); // Abre a tela
  }

  function wireHistory() {
    document.getElementById('history-list').onclick = async (e) => {
      const btn = e.target.closest('.btn-delete-run');
      if (!btn) return;
      if (!confirm('Excluir esta corrida do histórico? Se ela for seu recorde, o app recalculará o novo recorde automaticamente.')) return;
      
      const runId = btn.dataset.runId;
      const gameId = btn.dataset.gameId;
      
      // Apaga do banco de dados e da memória
      await DB.delete('runs', runId);
      runsByGame[gameId] = runsByGame[gameId].filter(r => r.id !== runId);
      toast('Corrida apagada');
      
      // Atualiza a tela de histórico que você está vendo agora
      renderHistoryList(gameId); 
      
      // MÁGICA AQUI: Atualiza a tela inicial lá atrás, invisível, 
      // para arrumar a badge dourada antes mesmo de você clicar em Voltar!
      await renderHome(); 
    };
  }

  // =========================================================
  // Wire (Event Listeners corretos com .onclick)
  // =========================================================
  function wireHomeList() {
    document.getElementById('speedrun-game-list').onclick = (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const gameId = card.dataset.gameId;
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'edit') openGameForm(gameId);
      else if (action === 'history') openHistory(gameId);
      else openTimer(gameId);
    };
    document.getElementById('btn-new-game').onclick = () => openGameForm(null);
  }


  function wireGameForm() {
    const segList = document.getElementById('segment-list');
    
    segList.oninput = (e) => {
      const input = e.target.closest('[data-seg-input]');
      if (!input) return;
      const idx = Number(input.closest('.segment-row').dataset.idx);
      formSegments[idx] = input.value;
    };
    
    segList.onclick = (e) => {
      const row = e.target.closest('.segment-row');
      if (!row) return;
      const idx = Number(row.dataset.idx);

      // Botão de Excluir
      if (e.target.closest('[data-seg-remove]')) {
        if (formSegments.length <= 1) { toast('Precisa de pelo menos 1 área'); return; }
        formSegments.splice(idx, 1);
        renderSegmentRows();
        return;
      }

      // Botão Mover para Cima
      if (e.target.closest('[data-seg-up]')) {
        if (idx > 0) {
          const temp = formSegments[idx];
          formSegments[idx] = formSegments[idx - 1]; // Joga a área de cima para baixo
          formSegments[idx - 1] = temp;              // Puxa a área atual para cima
          renderSegmentRows();
        }
        return;
      }

      // Botão Mover para Baixo
      if (e.target.closest('[data-seg-down]')) {
        if (idx < formSegments.length - 1) {
          const temp = formSegments[idx];
          formSegments[idx] = formSegments[idx + 1]; // Joga a área de baixo para cima
          formSegments[idx + 1] = temp;              // Empurra a área atual para baixo
          renderSegmentRows();
        }
        return;
      }
    };

    document.getElementById('btn-add-segment').onclick = () => {
      formSegments.push('');
      renderSegmentRows();
      const inputs = segList.querySelectorAll('[data-seg-input]');
      inputs[inputs.length - 1]?.focus();
    };

    document.getElementById('btn-cancel-game').onclick = () => App.back();

    document.getElementById('form-speedrun-game').onsubmit = async (e) => {
      e.preventDefault();
      const name = document.getElementById('game-name').value.trim();
      const segments = formSegments.map(s => s.trim()).filter(Boolean);
      if (!name) { toast('Dá um nome pra essa categoria'); return; }
      if (!segments.length) { toast('Adiciona pelo menos 1 área'); return; }

      if (editingGameId) {
        const g = games.find(x => x.id === editingGameId);
        g.name = name;
        g.segments = segments;
        await DB.put('games', g);
        toast('Categoria atualizada');
      } else {
        const g = { id: uuid(), name, segments, createdAt: new Date().toISOString() };
        await DB.put('games', g);
        toast('Categoria criada');
      }
      await renderHome();
      App.back();
    };

    document.getElementById('btn-delete-game').onclick = async () => {
      if (!editingGameId) return;
      if (!confirm('Excluir esta categoria e todo o histórico de corridas dela? Essa ação não pode ser desfeita.')) return;
      await DB.delete('games', editingGameId);
      await DB.deleteWhere('runs', 'gameId', editingGameId);
      toast('Categoria excluída');
      await renderHome();
      App.replaceRoot('screen-speedrun-home');
    };
  }

  // 4. LIGA O BOTÃO NA NAVEGAÇÃO
  function wireTimer() {
    document.getElementById('btn-timer-main').onclick = startOrSplit;
    document.getElementById('btn-undo-split').onclick = undoLastSplit;
    
    const skipBtn = document.getElementById('btn-skip-split');
    if (skipBtn) skipBtn.onclick = skipSplit;
    
    const pauseBtn = document.getElementById('btn-pause-run');
    if (pauseBtn) pauseBtn.onclick = togglePause;
    
    const originalStart = document.getElementById('btn-timer-main').onclick;
    document.getElementById('btn-timer-main').onclick = () => {
       originalStart();
       if (skipBtn) skipBtn.disabled = !Timer.running;
       // Desperta o Pause também
       if (pauseBtn) pauseBtn.disabled = (!Timer.running && !Timer.isPaused);
    };
    
    document.getElementById('btn-reset-run').onclick = resetRun;
    document.getElementById('btn-summary-close').onclick = closeSummary;
  }


  // =========================================================
  // Public
  // =========================================================
  async function init() {
    wireHomeList();
    wireGameForm();
    wireTimer();
    wireHistory();
    await renderHome();
  }

  return { init, renderHome, openGameForm, openTimer, openHistory, startOrSplit, undoLastSplit, resetRun };
})();