// E2E smoke test: ホスト作成 -> 参加者参加 -> 出題 -> 回答 -> 結果 -> 終了 の一連の流れを検証
const { io } = require('socket.io-client');

const URL = 'http://localhost:3000';
let pass = 0;
let fail = 0;

function check(label, cond) {
  if (cond) {
    pass++;
    console.log('OK   - ' + label);
  } else {
    fail++;
    console.log('FAIL - ' + label);
  }
}

const quiz = {
  title: 'テストクイズ',
  questions: [
    { text: 'Q1', options: ['A', 'B', 'C', 'D'], correctIndex: 1, timeLimit: 5 },
    { text: 'Q2', options: ['A', 'B', 'C', 'D'], correctIndex: 2, timeLimit: 5 },
  ],
};

const host = io(URL);
const player1 = io(URL);
const player2 = io(URL);

let roomCode = null;

host.on('connect', () => {
  host.emit('host:createRoom', quiz, (res) => {
    check('ルーム作成に成功', res.ok === true);
    check('問題数が正しい', res.total === 2);
    roomCode = res.code;
    check('ルームコードが6文字', typeof roomCode === 'string' && roomCode.length === 6);

    player1.emit('player:join', { code: roomCode, name: 'たろう' }, (r1) => {
      check('player1の参加成功', r1.ok === true);
      player2.emit('player:join', { code: roomCode, name: 'はなこ' }, (r2) => {
        check('player2の参加成功', r2.ok === true);

        const dupSocket = io(URL);
        dupSocket.on('connect', () => {
          dupSocket.emit('player:join', { code: roomCode, name: 'たろう' }, (rDup) => {
            check('重複ニックネームは拒否される', rDup.ok === false);
            dupSocket.close();

            setTimeout(() => {
              host.emit('host:startGame', roomCode);
            }, 200);
          });
        });
      });
    });
  });
});

host.on('room:players', ({ players }) => {
  if (players.length === 2) {
    check('ホストに参加者2人が通知される', true);
  }
});

host.on('room:question', ({ index, text }) => {
  check('問題' + (index + 1) + 'がホストに配信される', text === quiz.questions[index].text);

  if (index === 0) {
    player1.emit('player:submitAnswer', { code: roomCode, answerIndex: 1 }, (res) => {
      check('player1(正解)は正解判定&得点あり', res.ok === true && res.correct === true && res.pointsEarned > 0);
    });
    player2.emit('player:submitAnswer', { code: roomCode, answerIndex: 0 }, (res) => {
      check('player2(不正解)は不正解判定&0点', res.ok === true && res.correct === false && res.pointsEarned === 0);
    });
    setTimeout(() => host.emit('host:nextStep', roomCode), 600);
  } else if (index === 1) {
    setTimeout(() => host.emit('host:nextStep', roomCode), 400);
  }
});

let resultsSeenForQ1 = false;

host.on('room:results', ({ index, correctIndex, counts, players }) => {
  if (index === 0 && !resultsSeenForQ1) {
    resultsSeenForQ1 = true;
    check('結果: 正解インデックスが一致', correctIndex === 1);
    check('結果: 回答分布の合計が2', counts.reduce((a, b) => a + b, 0) === 2);
    const top = players[0];
    check('結果: 正解したplayer1が1位でスコア>0', top.name === 'たろう' && top.score > 0);
    setTimeout(() => host.emit('host:nextStep', roomCode), 300);
  } else if (index === 1) {
    check('最終問題の結果到達', true);
    setTimeout(() => host.emit('host:nextStep', roomCode), 300);
  }
});

host.on('room:gameover', ({ players }) => {
  check('ゲーム終了イベントを受信', Array.isArray(players) && players.length === 2);
  console.log('\n結果: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  host.close();
  player1.close();
  player2.close();
  process.exit(fail === 0 ? 0 : 1);
});

setTimeout(() => {
  console.log('\nタイムアウト: テストが完了しませんでした');
  console.log('結果: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
  process.exit(1);
}, 8000);
