// Quiz Clash - 参加者画面ロジック
(function () {
  const socket = io();

  const OPTION_STYLES = [
    { cls: 'opt-red', shape: '▲' },
    { cls: 'opt-blue', shape: '◆' },
    { cls: 'opt-yellow', shape: '●' },
    { cls: 'opt-green', shape: '■' },
  ];

  const screens = {
    join: document.getElementById('screen-join'),
    waiting: document.getElementById('screen-waiting'),
    answer: document.getElementById('screen-answer'),
    playerResult: document.getElementById('screen-player-result'),
    final: document.getElementById('screen-final'),
    hostLeft: document.getElementById('screen-host-left'),
  };

  function showScreen(name) {
    Object.entries(screens).forEach(([key, el]) => {
      el.classList.toggle('hidden', key !== name);
    });
  }

  let roomCode = null;
  let myName = '';
  let hasAnsweredThisQuestion = false;
  let lastAckResult = null;

  // ---------------- 演出: 紙吹雪・ファイア・トロフィー ----------------
  const CONFETTI_COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c', '#46178f'];

  function launchConfetti(count) {
    const total = count || 50;
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

  function launchFireBurst(count) {
    const total = count || 10;
    for (let i = 0; i < total; i++) {
      const flame = document.createElement('div');
      flame.className = 'fire-piece';
      flame.textContent = '🔥';
      flame.style.left = (30 + Math.random() * 40) + 'vw';
      flame.style.animationDuration = (0.9 + Math.random() * 0.6) + 's';
      flame.style.animationDelay = (Math.random() * 0.25) + 's';
      document.body.appendChild(flame);
      setTimeout(() => flame.remove(), 2000);
    }
  }

  function ensureStreakBadge() {
    let el = document.getElementById('streak-badge');
    if (!el) {
      el = document.createElement('p');
      el.id = 'streak-badge';
      el.className = 'streak-badge hidden';
      document.getElementById('result-badge').appendChild(el);
    }
    return el;
  }

  function ensureTrophyDisplay() {
    let el = document.getElementById('trophy-display');
    if (!el) {
      el = document.createElement('div');
      el.id = 'trophy-display';
      el.className = 'trophy-display hidden';
      el.textContent = '🏆';
      const finalScreen = document.getElementById('screen-final');
      const rankDisplay = document.getElementById('final-rank-display');
      finalScreen.insertBefore(el, rankDisplay);
    }
    return el;
  }

  function ensureDoubleBadge() {
    let el = document.getElementById('double-points-badge');
    if (!el) {
      el = document.createElement('div');
      el.id = 'double-points-badge';
      el.className = 'double-points-badge hidden';
      el.textContent = '⭐ ダブルポイント問題！（得点2倍） ⭐';
      const status = document.getElementById('answer-status');
      status.parentNode.insertBefore(el, status);
    }
    return el;
  }

  // ---------------- 参加画面 ----------------
  const joinCodeInput = document.getElementById('join-code');
  const joinNameInput = document.getElementById('join-name');
  const joinError = document.getElementById('join-error');

  // URLパラメータでコードが渡された場合は自動入力 (例: /play.html?code=AB12CD)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('code')) {
    joinCodeInput.value = urlParams.get('code').toUpperCase();
  }

  document.getElementById('btn-join').addEventListener('click', doJoin);
  joinNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doJoin();
  });

  function doJoin() {
    joinError.textContent = '';
    const code = joinCodeInput.value.trim().toUpperCase();
    const name = joinNameInput.value.trim();
    if (!code || !name) {
      joinError.textContent = '参加コードとニックネームを入力してください';
      return;
    }
    socket.emit('player:join', { code, name }, (res) => {
      if (!res.ok) {
        joinError.textContent = res.error || '参加に失敗しました';
        return;
      }
      roomCode = code;
      myName = name;
      document.getElementById('waiting-greeting').textContent = `ようこそ、${name}さん！`;
      showScreen('waiting');
    });
  }

  // ---------------- 出題画面 ----------------
  socket.on('room:question', ({ doublePoints }) => {
    hasAnsweredThisQuestion = false;
    lastAckResult = null;
    showScreen('answer');
    document.getElementById('answer-status').textContent = 'ホスト画面の問題を見て回答してください';
    document.getElementById('answer-submitted').classList.add('hidden');

    ensureDoubleBadge().classList.toggle('hidden', !doublePoints);

    const optionsGrid = document.getElementById('answer-options');
    optionsGrid.classList.remove('hidden');
    optionsGrid.innerHTML = OPTION_STYLES.map(
      (style, i) => `<button type="button" class="option-tile player-option-btn ${style.cls}" data-index="${i}"><span class="option-shape">${style.shape}</span></button>`
    ).join('');

    optionsGrid.querySelectorAll('.player-option-btn').forEach((btn) => {
      btn.addEventListener('click', () => submitAnswer(Number(btn.dataset.index)));
    });
  });

  function submitAnswer(answerIndex) {
    if (hasAnsweredThisQuestion) return;
    hasAnsweredThisQuestion = true;

    document.getElementById('answer-options').classList.add('hidden');
    document.getElementById('answer-submitted').classList.remove('hidden');

    socket.emit('player:submitAnswer', { code: roomCode, answerIndex }, (res) => {
      if (!res.ok) return;
      lastAckResult = res;
      showImmediateResult(res);
    });
  }

  function showImmediateResult(res) {
    showScreen('playerResult');
    document.getElementById('result-title').textContent = res.correct ? '正解！ 🎉' : '残念…';
    document.getElementById('result-badge').className = 'result-badge ' + (res.correct ? 'is-correct' : 'is-wrong');
    document.getElementById('result-points').textContent = res.correct ? `+${res.pointsEarned}点` : '+0点';
    document.getElementById('result-total').textContent = `合計: ${res.totalScore}点`;
    document.getElementById('result-rank').textContent = '';

    const streakBadge = ensureStreakBadge();
    if (res.correct && res.streak >= 2) {
      streakBadge.textContent = `🔥 ${res.streak}連続正解！`;
      streakBadge.classList.remove('hidden');
    } else {
      streakBadge.classList.add('hidden');
    }

    if (res.correct) {
      launchConfetti(45);
      if (res.streak >= 2) {
        launchFireBurst(10 + Math.min(20, res.streak * 3));
      }
    }
  }

  // ---------------- 結果・リーダーボード反映 ----------------
  socket.on('room:results', ({ correctText, players }) => {
    const me = players.find((p) => p.id === socket.id);
    const rank = me ? players.findIndex((p) => p.id === socket.id) + 1 : null;

    if (!hasAnsweredThisQuestion) {
      // 時間内に回答しなかった場合
      showScreen('playerResult');
      document.getElementById('result-title').textContent = '時間切れ…';
      document.getElementById('result-badge').className = 'result-badge is-wrong';
      document.getElementById('result-points').textContent = '+0点';
      document.getElementById('result-total').textContent = me ? `合計: ${me.score}点` : '';
      ensureStreakBadge().classList.add('hidden');
    }

    document.getElementById('result-rank').textContent = rank
      ? `現在 ${rank} 位 / ${players.length} 人中`
      : '';

    if (correctText) {
      const status = document.getElementById('result-title');
      status.dataset.correctText = correctText;
    }
  });

  // ---------------- 最終結果 ----------------
  socket.on('room:gameover', ({ players }) => {
    showScreen('final');
    const rank = players.findIndex((p) => p.id === socket.id) + 1;
    const me = players.find((p) => p.id === socket.id);
    document.getElementById('final-rank-display').textContent = rank > 0 ? `${rank} 位` : '-';
    document.getElementById('final-score-display').textContent = me ? `合計 ${me.score} 点` : '';

    const trophy = ensureTrophyDisplay();
    if (rank === 1) {
      trophy.classList.remove('hidden');
      launchConfetti(90);
    } else {
      trophy.classList.add('hidden');
    }
  });

  socket.on('room:hostLeft', () => {
    showScreen('hostLeft');
  });
})();
