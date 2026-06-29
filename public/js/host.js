// Quiz Clash - ホスト画面ロジック
(function () {
  const socket = io();

  const OPTION_STYLES = [
    { cls: 'opt-red', shape: '▲' },
    { cls: 'opt-blue', shape: '◆' },
    { cls: 'opt-yellow', shape: '●' },
    { cls: 'opt-green', shape: '■' },
  ];

  const screens = {
    editor: document.getElementById('screen-editor'),
    lobby: document.getElementById('screen-lobby'),
    question: document.getElementById('screen-question'),
    results: document.getElementById('screen-results'),
    gameover: document.getElementById('screen-gameover'),
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle('hidden', key !== name);
    });
  }

  // ---------------- 演出: 紙吹雪 ----------------
  const CONFETTI_COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#46178f'];

  function launchConfetti(count) {
    const total = count || 60;
    for (let i = 0; i < total; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.background = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
      piece.style.animationDuration = (1.6 + Math.random() * 1.3) + 's';
      piece.style.animationDelay = (Math.random() * 0.3) + 's';
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 3500);
    }
  }

  // ---------------- 演出: ダブルポイント・バッジ ----------------
  function ensureDoubleBadge(id, beforeEl) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'double-points-badge hidden';
      el.textContent = '⭐ ダブルポイント問題！（得点2倍） ⭐';
      beforeEl.parentNode.insertBefore(el, beforeEl);
    }
    return el;
  }

  // ---------------- 編集画面 ----------------
  const questionsList = document.getElementById('questions-list');
  const editorError = document.getElementById('editor-error');
  let questionBlockCount = 0;

  function addQuestionBlock(data) {
    questionBlockCount += 1;
    const idx = questionBlockCount;
    const wrap = document.createElement('div');
    wrap.className = 'question-block';
    wrap.dataset.blockId = String(idx);

    const opts = (data && data.options) || ['', '', '', ''];
    const correctIndex = data && Number.isInteger(data.correctIndex) ? data.correctIndex : 0;
    const timeLimit = (data && data.timeLimit) || 20;
    const text = (data && data.text) || '';
    const doublePoints = !!(data && data.doublePoints);

    wrap.innerHTML = `
      <div class="question-block-header">
        <span class="question-block-num">問題</span>
        <button type="button" class="btn-remove-question" title="この問題を削除">✕</button>
      </div>
      <input type="text" class="q-input-text" placeholder="問題文を入力" maxlength="200" value="${escapeAttr(text)}" />
      <div class="q-input-options">
        ${opts
          .map(
            (val, i) => `
          <div class="q-option-row">
            <input type="radio" name="correct-${idx}" class="q-correct-radio" value="${i}" ${i === correctIndex ? 'checked' : ''} title="正解にする" />
            <input type="text" class="q-input-option" placeholder="選択肢 ${i + 1}" maxlength="120" value="${escapeAttr(val)}" />
          </div>`
          )
          .join('')}
      </div>
      <div class="question-block-footer">
        <label class="time-limit-label">制限時間（秒）:
          <input type="number" class="q-input-time" min="5" max="120" value="${timeLimit}" />
        </label>
        <label class="double-points-label">
          <input type="checkbox" class="q-double-points" ${doublePoints ? 'checked' : ''} />
          ⭐ ダブルポイント（得点2倍）
        </label>
      </div>
    `;

    wrap.querySelector('.btn-remove-question').addEventListener('click', () => {
      wrap.remove();
    });

    questionsList.appendChild(wrap);
  }

  function escapeAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  document.getElementById('btn-add-question').addEventListener('click', () => addQuestionBlock());

  function loadQuizIntoEditor(quizData) {
    document.getElementById('quiz-title').value = (quizData && quizData.title) || '';
    questionsList.innerHTML = '';
    ((quizData && quizData.questions) || []).forEach((q) => addQuestionBlock(q));
  }

  document.getElementById('btn-load-sample').addEventListener('click', async () => {
    try {
      const res = await fetch('/quizzes/sample-quiz.json');
      const sample = await res.json();
      loadQuizIntoEditor(sample);
      editorError.textContent = '';
    } catch (err) {
      editorError.textContent = 'サンプルの読み込みに失敗しました';
    }
  });

  function collectQuiz() {
    const title = document.getElementById('quiz-title').value.trim() || 'クイズ';
    const blocks = Array.from(questionsList.querySelectorAll('.question-block'));
    const questions = [];

    for (const block of blocks) {
      const text = block.querySelector('.q-input-text').value.trim();
      const optionInputs = Array.from(block.querySelectorAll('.q-input-option'));
      const options = optionInputs.map((inp) => inp.value.trim()).filter((v) => v.length > 0);
      const radio = block.querySelector('.q-correct-radio:checked');
      const correctIndex = radio ? Number(radio.value) : 0;
      const timeLimit = Number(block.querySelector('.q-input-time').value) || 20;
      const doublePoints = block.querySelector('.q-double-points').checked;

      if (!text || options.length < 2) continue;
      questions.push({
        text,
        options,
        correctIndex: Math.min(correctIndex, options.length - 1),
        timeLimit,
        doublePoints,
      });
    }
    return { title, questions };
  }

  // ---------------- クイズの保存・読み込み（JSONファイル） ----------------
  document.getElementById('btn-save-quiz').addEventListener('click', () => {
    const quiz = collectQuiz();
    if (quiz.questions.length === 0) {
      editorError.textContent = '保存する前に、問題を1つ以上入力してください';
      return;
    }
    editorError.textContent = '';
    const blob = new Blob([JSON.stringify(quiz, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const safeName = (quiz.title || 'quiz').replace(/[\\/:*?"<>|]/g, '_');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const fileLoadInput = document.getElementById('file-load-quiz');
  document.getElementById('btn-load-quiz').addEventListener('click', () => {
    fileLoadInput.click();
  });
  fileLoadInput.addEventListener('change', () => {
    const file = fileLoadInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.questions)) throw new Error('invalid quiz format');
        loadQuizIntoEditor(data);
        editorError.textContent = '';
      } catch (err) {
        editorError.textContent = 'クイズファイルの読み込みに失敗しました（形式を確認してください）';
      }
    };
    reader.readAsText(file);
    fileLoadInput.value = '';
  });

  // ---------------- 参加用URL・QRコード ----------------
  function showJoinInfo(code) {
    const joinUrl = `${window.location.origin}/play.html?code=${code}`;

    const link = document.getElementById('join-url-link');
    link.href = joinUrl;
    link.textContent = joinUrl;

    const qrWrap = document.getElementById('qr-wrap');
    qrWrap.innerHTML = '';
    if (window.QRCode && typeof window.QRCode.toString === 'function') {
      window.QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 200 }, (err, svg) => {
        if (!err) qrWrap.innerHTML = svg;
      });
    }
  }

  document.getElementById('btn-create-room').addEventListener('click', () => {
    editorError.textContent = '';
    const quiz = collectQuiz();
    if (quiz.questions.length === 0) {
      editorError.textContent = '問題を1つ以上、選択肢を2つ以上入力してください';
      return;
    }
    socket.emit('host:createRoom', quiz, (res) => {
      if (!res.ok) {
        editorError.textContent = res.error || 'ルーム作成に失敗しました';
        return;
      }
      currentRoomCode = res.code;
      totalQuestions = res.total;
      document.getElementById('room-code').textContent = res.code;
      showJoinInfo(res.code);
      showScreen('lobby');
    });
  });

  // 初期状態で1問用意
  addQuestionBlock();

  // ---------------- ロビー画面 ----------------
  let currentRoomCode = null;
  let totalQuestions = 0;

  socket.on('room:players', ({ players }) => {
    const grid = document.getElementById('players-grid');
    grid.innerHTML = players.map((p) => `<div class="player-chip">${escapeHtml(p.name)}</div>`).join('');
    document.getElementById('player-count').textContent = String(players.length);
    document.getElementById('btn-start-game').disabled = players.length === 0;
  });

  socket.on('room:playerCount', ({ count }) => {
    document.getElementById('player-count').textContent = String(count);
    document.getElementById('btn-start-game').disabled = count === 0;
  });

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  document.getElementById('btn-start-game').addEventListener('click', () => {
    socket.emit('host:startGame', currentRoomCode);
  });

  // ---------------- 出題画面 ----------------
  let timerInterval = null;

  socket.on('room:question', ({ index, total, text, options, timeLimit, startedAt, doublePoints }) => {
    showScreen('question');
    document.getElementById('q-progress').textContent = `問題 ${index + 1} / ${total}`;
    document.getElementById('q-text').textContent = text;
    document.getElementById('q-answered').textContent = '回答: 0 / 0';

    const qText = document.getElementById('q-text');
    ensureDoubleBadge('double-points-badge-question', qText).classList.toggle('hidden', !doublePoints);

    const optionsGrid = document.getElementById('q-options');
    optionsGrid.innerHTML = options
      .map((opt, i) => {
        const style = OPTION_STYLES[i] || OPTION_STYLES[0];
        return `<div class="option-tile ${style.cls}"><span class="option-shape">${style.shape}</span><span class="option-text">${escapeHtml(opt)}</span></div>`;
      })
      .join('');

    if (timerInterval) clearInterval(timerInterval);
    const timerBar = document.getElementById('timer-bar');
    timerBar.style.width = '100%';
    timerInterval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const ratio = Math.max(0, 1 - elapsed / (timeLimit * 1000));
      timerBar.style.width = `${ratio * 100}%`;
      if (ratio <= 0) clearInterval(timerInterval);
    }, 100);
  });

  socket.on('room:answerProgress', ({ answeredCount, totalPlayers }) => {
    document.getElementById('q-answered').textContent = `回答: ${answeredCount} / ${totalPlayers}`;
  });

  document.getElementById('btn-show-results').addEventListener('click', () => {
    socket.emit('host:nextStep', currentRoomCode);
  });

  // ---------------- 結果画面 ----------------
  socket.on('room:results', ({ index, total, correctIndex, correctText, doublePoints, counts, players }) => {
    if (timerInterval) clearInterval(timerInterval);
    showScreen('results');

    const style = OPTION_STYLES[correctIndex] || OPTION_STYLES[0];
    document.getElementById('results-correct-text').innerHTML =
      `<span class="option-shape ${style.cls}">${style.shape}</span> ${escapeHtml(correctText)}`;

    const resultsCorrectText = document.getElementById('results-correct-text');
    ensureDoubleBadge('double-points-badge-results', resultsCorrectText).classList.toggle('hidden', !doublePoints);

    const maxCount = Math.max(1, ...counts);
    document.getElementById('results-bars').innerHTML = counts
      .map((c, i) => {
        const s = OPTION_STYLES[i] || OPTION_STYLES[0];
        const widthPct = Math.round((c / maxCount) * 100);
        const isCorrect = i === correctIndex;
        return `
          <div class="result-bar-row">
            <span class="option-shape ${s.cls}">${s.shape}</span>
            <div class="result-bar-track"><div class="result-bar-fill ${isCorrect ? 'correct' : ''}" style="width:${widthPct}%"></div></div>
            <span class="result-bar-count">${c}</span>
          </div>`;
      })
      .join('');

    renderLeaderboard('leaderboard-list', players);

    const btn = document.getElementById('btn-next-step');
    btn.textContent = index + 1 >= total ? '最終結果を見る' : '次の問題へ';
  });

  document.getElementById('btn-next-step').addEventListener('click', () => {
    socket.emit('host:nextStep', currentRoomCode);
  });

  function renderLeaderboard(elementId, players) {
    const el = document.getElementById(elementId);
    el.innerHTML = players
      .slice(0, 10)
      .map(
        (p, i) => `
        <div class="leaderboard-row ${i === 0 ? 'rank-first' : ''}">
          <span class="leaderboard-rank">${i + 1}</span>
          <span class="leaderboard-name">${escapeHtml(p.name)}</span>
          <span class="leaderboard-score">${p.score}${p.streak >= 2 ? ` <span class="streak-tag">🔥${p.streak}</span>` : ''}</span>
        </div>`
      )
      .join('');
  }

  // ---------------- 終了画面 ----------------
  socket.on('room:gameover', ({ players }) => {
    showScreen('gameover');
    const podium = document.getElementById('podium');
    const top3 = players.slice(0, 3);
    const order = [1, 0, 2]; // 2位・1位・3位の順で表示（中央が1位）
    podium.innerHTML = order
      .filter((i) => top3[i])
      .map((i) => {
        const p = top3[i];
        const heightCls = i === 0 ? 'podium-1' : i === 1 ? 'podium-2' : 'podium-3';
        const trophy = i === 0 ? '<div class="podium-trophy">🏆</div>' : '';
        return `<div class="podium-col ${heightCls}">${trophy}<div class="podium-name">${escapeHtml(p.name)}</div><div class="podium-score">${p.score}</div><div class="podium-rank">${i + 1}</div></div>`;
      })
      .join('');
    renderLeaderboard('final-leaderboard-list', players);
    launchConfetti(90);
  });

  socket.on('room:hostLeft', () => {
    // ホスト側では発生しない
  });
})();
