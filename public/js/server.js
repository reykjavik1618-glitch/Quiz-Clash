// Quiz Clash - Kahoot風リアルタイムクイズ対戦サーバー
// Express + Socket.IO で、ホストが出題し参加者がリアルタイムで回答する仕組みを実装

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/quizzes', express.static(path.join(__dirname, 'quizzes')));

// ---- ルーム管理 (メモリ上に保持。サーバー再起動で消える簡易実装) ----
const rooms = new Map(); // code -> room

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字(0,O,1,I)を除外

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function sanitizeQuiz(quiz) {
  if (!quiz || typeof quiz !== 'object') return null;
  if (!Array.isArray(quiz.questions) || quiz.questions.length === 0) return null;

  const questions = [];
  for (const q of quiz.questions) {
    if (!q || typeof q.text !== 'string' || !q.text.trim()) return null;
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return null;
    const options = q.options.map((o) => String(o || '').slice(0, 120));
    if (options.some((o) => !o.trim())) return null;
    const correctIndex = Number(q.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return null;
    let timeLimit = Number(q.timeLimit);
    if (!Number.isFinite(timeLimit) || timeLimit <= 0) timeLimit = 20;
    timeLimit = Math.min(120, Math.max(5, Math.round(timeLimit)));
    questions.push({
      text: String(q.text).slice(0, 200),
      options,
      correctIndex,
      timeLimit,
      doublePoints: Boolean(q.doublePoints),
    });
  }

  return {
    title: String(quiz.title || 'クイズ').slice(0, 100),
    questions,
  };
}

function publicPlayerList(room) {
  return Array.from(room.players.values())
    .map((p) => ({ id: p.id, name: p.name, score: p.score, streak: p.streak || 0 }))
    .sort((a, b) => b.score - a.score);
}

function getRoomOrNull(code) {
  return rooms.get(String(code || '').toUpperCase()) || null;
}

io.on('connection', (socket) => {
  // ---------- ホスト: ルーム作成 ----------
  socket.on('host:createRoom', (quiz, ack) => {
    const clean = sanitizeQuiz(quiz);
    if (!clean) {
      if (typeof ack === 'function') ack({ ok: false, error: 'クイズの内容が不正です（問題・選択肢・正解を確認してください）' });
      return;
    }

    const code = generateRoomCode();
    const room = {
      code,
      hostId: socket.id,
      quiz: clean,
      state: 'lobby',
      currentIndex: -1,
      players: new Map(),
      questionStartedAt: null,
      questionClosed: false,
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.code = code;
    socket.data.role = 'host';

    if (typeof ack === 'function') {
      ack({ ok: true, code, total: clean.questions.length, title: clean.title });
    }
  });

  // ---------- ホスト: ゲーム開始（ロビー -> 最初の問題） ----------
  socket.on('host:startGame', (code) => {
    const room = getRoomOrNull(code);
    if (!room || room.hostId !== socket.id || room.state !== 'lobby') return;
    advanceToQuestion(room, 0);
  });

  // ---------- ホスト: 次へ進む（問題 -> 結果 -> 次の問題 / 終了） ----------
  socket.on('host:nextStep', (code) => {
    const room = getRoomOrNull(code);
    if (!room || room.hostId !== socket.id) return;

    if (room.state === 'question') {
      showResults(room);
    } else if (room.state === 'results') {
      const nextIndex = room.currentIndex + 1;
      if (nextIndex >= room.quiz.questions.length) {
        endGame(room);
      } else {
        advanceToQuestion(room, nextIndex);
      }
    }
  });

  // ---------- 参加者: ルームに参加 ----------
  socket.on('player:join', ({ code, name }, ack) => {
    const room = getRoomOrNull(code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'そのルームコードは見つかりません' });
      return;
    }
    if (room.state !== 'lobby') {
      if (typeof ack === 'function') ack({ ok: false, error: 'このゲームはすでに開始されています' });
      return;
    }
    const cleanName = String(name || '').trim().slice(0, 20);
    if (!cleanName) {
      if (typeof ack === 'function') ack({ ok: false, error: 'ニックネームを入力してください' });
      return;
    }
    const nameTaken = Array.from(room.players.values()).some(
      (p) => p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (nameTaken) {
      if (typeof ack === 'function') ack({ ok: false, error: 'そのニックネームは使われています' });
      return;
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: cleanName,
      score: 0,
      streak: 0,
      answeredThisQuestion: false,
    });
    socket.join(room.code);
    socket.data.code = room.code;
    socket.data.role = 'player';

    if (typeof ack === 'function') {
      ack({ ok: true, title: room.quiz.title });
    }
    io.to(room.hostId).emit('room:players', { players: publicPlayerList(room) });
    io.to(room.code).emit('room:playerCount', { count: room.players.size });
  });

  // ---------- 参加者: 回答送信 ----------
  socket.on('player:submitAnswer', ({ code, answerIndex }, ack) => {
    const room = getRoomOrNull(code);
    if (!room || room.state !== 'question' || room.questionClosed) {
      if (typeof ack === 'function') ack({ ok: false, error: '回答を受け付けられませんでした' });
      return;
    }
    const player = room.players.get(socket.id);
    if (!player) {
      if (typeof ack === 'function') ack({ ok: false, error: '参加者情報が見つかりません' });
      return;
    }
    if (player.answeredThisQuestion) {
      if (typeof ack === 'function') ack({ ok: false, error: 'すでに回答済みです' });
      return;
    }

    const question = room.quiz.questions[room.currentIndex];
    const elapsedMs = Date.now() - room.questionStartedAt;
    const timeLimitMs = question.timeLimit * 1000;
    const withinTime = elapsedMs <= timeLimitMs + 250; // 多少の遅延を許容
    const isCorrect = withinTime && Number(answerIndex) === question.correctIndex;

    let pointsEarned = 0;
    if (isCorrect) {
      const ratio = Math.max(0, Math.min(1, 1 - elapsedMs / timeLimitMs));
      pointsEarned = Math.round(500 + 500 * ratio); // 正解 かつ 早いほど高得点(500〜1000点)
      if (question.doublePoints) pointsEarned *= 2; // ダブルポイント問題は2倍
      player.streak = (player.streak || 0) + 1;
    } else {
      player.streak = 0;
    }

    player.answeredThisQuestion = true;
    player.lastAnswerIndex = Number(answerIndex);
    player.score += pointsEarned;

    if (typeof ack === 'function') {
      ack({ ok: true, correct: isCorrect, pointsEarned, totalScore: player.score, streak: player.streak });
    }

    const answeredCount = Array.from(room.players.values()).filter((p) => p.answeredThisQuestion).length;
    io.to(room.hostId).emit('room:answerProgress', {
      answeredCount,
      totalPlayers: room.players.size,
    });

    // 参加者全員が回答し終わったら、制限時間内であっても結果表示に進める
    if (room.state === 'question' && !room.questionClosed && room.players.size > 0 && answeredCount >= room.players.size) {
      showResults(room);
    }
  });

  // ---------- 切断処理 ----------
  socket.on('disconnect', () => {
    const code = socket.data.code;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (room.hostId === socket.id) {
      // ホストが切断したらルームを終了し、参加者に通知
      io.to(room.code).emit('room:hostLeft');
      rooms.delete(room.code);
      return;
    }

    if (room.players.has(socket.id)) {
      room.players.delete(socket.id);
      io.to(room.hostId).emit('room:players', { players: publicPlayerList(room) });
      io.to(room.code).emit('room:playerCount', { count: room.players.size });

      // 退出により残った参加者全員が回答済みになった場合も、結果表示に進める
      if (room.state === 'question' && !room.questionClosed && room.players.size > 0) {
        const answeredCount = Array.from(room.players.values()).filter((p) => p.answeredThisQuestion).length;
        if (answeredCount >= room.players.size) {
          showResults(room);
        }
      }
    }
  });
});

// ---- ゲーム進行ヘルパー ----
function advanceToQuestion(room, index) {
  room.state = 'question';
  room.currentIndex = index;
  room.questionStartedAt = Date.now();
  room.questionClosed = false;
  for (const p of room.players.values()) {
    p.answeredThisQuestion = false;
    p.lastAnswerIndex = null;
  }

  const q = room.quiz.questions[index];
  io.to(room.code).emit('room:question', {
    index,
    total: room.quiz.questions.length,
    text: q.text,
    options: q.options,
    timeLimit: q.timeLimit,
    startedAt: room.questionStartedAt,
    doublePoints: !!q.doublePoints,
  });
}

function showResults(room) {
  room.state = 'results';
  room.questionClosed = true;
  const q = room.quiz.questions[room.currentIndex];

  // 時間切れで回答しなかった参加者は連続正解(streak)をリセット
  for (const p of room.players.values()) {
    if (!p.answeredThisQuestion) {
      p.streak = 0;
    }
  }

  const counts = new Array(q.options.length).fill(0);
  for (const p of room.players.values()) {
    if (Number.isInteger(p.lastAnswerIndex) && p.lastAnswerIndex >= 0 && p.lastAnswerIndex < counts.length) {
      counts[p.lastAnswerIndex] += 1;
    }
  }
  const answeredCount = Array.from(room.players.values()).filter((p) => p.answeredThisQuestion).length;

  io.to(room.code).emit('room:results', {
    index: room.currentIndex,
    total: room.quiz.questions.length,
    correctIndex: q.correctIndex,
    correctText: q.options[q.correctIndex],
    doublePoints: !!q.doublePoints,
    counts,
    answeredCount,
    totalPlayers: room.players.size,
    players: publicPlayerList(room),
  });
}

function endGame(room) {
  room.state = 'gameover';
  io.to(room.code).emit('room:gameover', {
    players: publicPlayerList(room),
  });
}

server.listen(PORT, () => {
  console.log('Quiz Clash サーバーが起動しました: http://localhost:' + PORT);
});
