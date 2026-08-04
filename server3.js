const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { buildLevelTable } = require('./levelTable');
const { isCorrectAnswer, isTooSimilarToPast, normalize } = require('./wordUtils');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// お題データ読み込み
const THEMES_PATH = path.join(__dirname, 'public', 'themes.json');
function loadThemes() {
  return JSON.parse(fs.readFileSync(THEMES_PATH, 'utf8')).themes;
}
let THEMES = loadThemes();

// 音源の長さ(秒)。実測値。public/audio.mp3 を差し替えた場合はここも要調整。
const AUDIO_DURATION = 1335.048;
// 音源は頭出しの無音などがあるため0:01から再生し、そこから5秒前カウントダウン(音源内の音声)を経て競技開始
const AUDIO_START_OFFSET = 2;
const COUNTDOWN_SEC = 5;
// 実際に回数・レベルが進行する時間(音源終了に合わせてぴったり終わるよう正規化)
const GAME_DURATION = AUDIO_DURATION - AUDIO_START_OFFSET - COUNTDOWN_SEC;
const { table: LEVEL_TABLE, totalCount: TOTAL_COUNT } = buildLevelTable(GAME_DURATION);

const rooms = new Map(); // code -> room

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function publicPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    words: p.words,
    eliminated: p.eliminated,
    connected: p.connected,
    correctThisLap: p.correctThisLap,
    hasAnsweredWrongThisLap: p.hasAnsweredWrongThisLap
  }));
}

function totalWordsCount(room) {
  return [...room.players.values()].reduce((s, p) => s + p.words.length, 0);
}

// 回の切り替わり(解答欄の表示)タイミングの微調整用オフセット(秒)。
// 理論値だけで計算すると実際の音源の「ド」(折り返しの合図音)と少しズレるため、
// 実際に音源を聞きながらこの値を調整してください。プラスにすると表示が遅くなり、
// マイナスにすると早くなります。
const REVEAL_DELAY = 1.3;

function findLapEntry(elapsed) {
  const adjusted = Math.max(0, elapsed - REVEAL_DELAY);
  // 線形探索で十分な回数規模(247)
  for (const e of LEVEL_TABLE) {
    if (adjusted >= e.startTime && adjusted < e.endTime) return e;
  }
  return LEVEL_TABLE[LEVEL_TABLE.length - 1];
}

function finalizeLap(room) {
  // 現在のラップの結果を反映し、脱落判定を行う
  for (const p of room.players.values()) {
    if (p.eliminated) continue;
    if (p.correctThisLap) {
      p.consecutiveFailLaps = 0;
    } else {
      p.consecutiveFailLaps += 1;
      if (p.consecutiveFailLaps >= 2) {
        p.eliminated = true;
      }
    }
    p.correctThisLap = false;
    p.hasAnsweredWrongThisLap = false;
  }
}

function allEliminated(room) {
  const players = [...room.players.values()];
  return players.length > 0 && players.every(p => p.eliminated);
}

function endGame(room) {
  clearInterval(room.timer);
  room.state = 'ended';
  const survivors = [...room.players.values()].filter(p => !p.eliminated);
  io.to(room.code).emit('gameEnd', {
    players: publicPlayers(room),
    survivors: survivors.map(p => ({ id: p.id, name: p.name, words: p.words.length }))
  });
}

function startGameLoop(room) {
  room.state = 'playing';
  room.startTime = Date.now();
  room.currentLapIndex = -1;

  room.timer = setInterval(() => {
    const elapsed = (Date.now() - room.startTime) / 1000;

    if (elapsed >= GAME_DURATION) {
      finalizeLap(room);
      endGame(room);
      return;
    }

    const entry = findLapEntry(elapsed);
    if (entry.lap !== room.currentLapIndex) {
      if (room.currentLapIndex !== -1) finalizeLap(room);
      room.currentLapIndex = entry.lap;
      room.currentLevel = entry.level;
      // 全員脱落したらその時点でゲーム終了
      if (allEliminated(room)) {
        endGame(room);
        return;
      }
    }

    const levelEndTime = (() => {
      let end = entry.endTime;
      for (const e of LEVEL_TABLE) {
        if (e.level === entry.level) end = e.endTime;
      }
      return end;
    })();

    io.to(room.code).emit('tick', {
      elapsed,
      lap: entry.lap - 1,
      level: entry.level,
      totalCount: TOTAL_COUNT,
      totalWords: totalWordsCount(room),
      nextLevelIn: Math.max(0, levelEndTime - (elapsed - REVEAL_DELAY)),
      players: publicPlayers(room)
    });
  }, 200);
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name, themeId }) => {
    const code = genCode();
    const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
    const room = {
      code,
      hostId: socket.id,
      state: 'lobby',
      theme,
      players: new Map(),
      currentLapIndex: -1,
      currentLevel: 1
    };
    rooms.set(code, room);

    room.players.set(socket.id, {
      id: socket.id, name: name || '参加者1', words: [],
      eliminated: false, connected: true, correctThisLap: false,
      hasAnsweredWrongThisLap: false, consecutiveFailLaps: 0
    });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('roomCreated', { code, theme: theme.name, isHost: true });
    io.to(code).emit('roomUpdate', { players: publicPlayers(room), hostId: room.hostId, theme: theme.name });
  });

  socket.on('joinRoom', ({ code, name }) => {
    const room = rooms.get(code);
    if (!room) return socket.emit('errorMsg', 'その部屋コードは存在しません');
    if (room.state !== 'lobby') return socket.emit('errorMsg', 'すでにゲームが開始されています');
    if (room.players.size >= 10) return socket.emit('errorMsg', '部屋が満員です(最大10人)');

    room.players.set(socket.id, {
      id: socket.id, name: name || `参加者${room.players.size + 1}`, words: [],
      eliminated: false, connected: true, correctThisLap: false,
      hasAnsweredWrongThisLap: false, consecutiveFailLaps: 0
    });
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('roomCreated', { code, theme: room.theme.name, isHost: socket.id === room.hostId });
    io.to(code).emit('roomUpdate', { players: publicPlayers(room), hostId: room.hostId, theme: room.theme.name });
  });

  socket.on('startGame', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.state !== 'lobby') return;
    room.state = 'countdown';
    // 音源は0:01の位置から即再生し、そこに重なる5秒前カウントダウンの表示と同時に進行する
    io.to(code).emit('countdown', {
      audioStartOffset: AUDIO_START_OFFSET,
      countdownSec: COUNTDOWN_SEC
    });
    setTimeout(() => {
      if (room.state === 'countdown') startGameLoop(room);
    }, COUNTDOWN_SEC * 1000);
  });

  socket.on('submitWord', ({ word }) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || player.eliminated || player.correctThisLap) return;
    if (!word || !word.trim()) return;

    const trimmed = word.trim();

    // 既出単語(表記ゆらぎ含む)チェック
    const dup = player.words.some(w => normalize(w) === normalize(trimmed));
    const tooSimilar = isTooSimilarToPast(trimmed, player.words);

    let correct = false;
    let reason = null;

    if (dup || tooSimilar) {
      correct = false;
      reason = dup ? 'duplicate' : 'too_similar';
    } else if (isCorrectAnswer(trimmed, room.theme.answers)) {
      correct = true;
    } else {
      reason = 'wrong';
    }

    if (correct) {
      player.words.push(trimmed);
      player.correctThisLap = true;
    } else {
      player.hasAnsweredWrongThisLap = true;
    }

    io.to(code).emit('wordResult', {
      playerId: socket.id,
      playerName: player.name,
      word: trimmed,
      correct,
      reason,
      players: publicPlayers(room),
      totalWords: totalWordsCount(room)
    });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) {
      if (room.state === 'lobby') {
        room.players.delete(socket.id);
      } else {
        player.connected = false;
      }
      io.to(code).emit('roomUpdate', { players: publicPlayers(room), hostId: room.hostId, theme: room.theme.name });
      if (room.players.size === 0) {
        clearInterval(room.timer);
        rooms.delete(code);
      }
    }
  });
});

app.get('/api/themes', (req, res) => {
  res.json(THEMES.map(t => ({ id: t.id, name: t.name, count: t.answers.length })));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`シャトルラン ワードバトル起動: http://localhost:${PORT}`));
