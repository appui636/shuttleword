const socket = io();

let myId = null;
let isHost = false;
let roomCode = null;
let themeName = '';
let eliminatedShown = false;

const $ = sel => document.querySelector(sel);
const screens = {};
document.querySelectorAll('.screen').forEach(s => screens[s.id] = s);
function showScreen(id){
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[id].classList.add('active');
}

/* ---------- タイトル画面 ---------- */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

$('#btn-create').addEventListener('click', ()=>{
  const name = $('#input-name').value.trim() || '参加者1';
  socket.emit('createRoom', { name, themeId: 1 });
});

$('#btn-join').addEventListener('click', ()=>{
  const name = $('#input-name').value.trim() || undefined;
  const code = $('#input-code').value.trim().toUpperCase();
  if (!code) { $('#title-error').textContent = '部屋コードを入力してください'; return; }
  socket.emit('joinRoom', { code, name });
});

socket.on('errorMsg', msg => { $('#title-error').textContent = msg; });

socket.on('roomCreated', ({ code, theme, isHost: host }) => {
  myId = socket.id;
  roomCode = code;
  isHost = host;
  themeName = theme;
  $('#lobby-code').textContent = code;
  $('#lobby-theme').textContent = theme;
  $('#game-theme').textContent = theme;
  $('#btn-start').style.display = isHost ? 'block' : 'none';
  $('#lobby-wait').style.display = isHost ? 'none' : 'block';
  showScreen('screen-lobby');
});

socket.on('roomUpdate', ({ players, hostId }) => {
  isHost = socket.id === hostId;
  $('#btn-start').style.display = isHost ? 'block' : 'none';
  $('#lobby-wait').style.display = isHost ? 'none' : 'block';
  const list = $('#lobby-players');
  list.innerHTML = '';
  players.forEach(p=>{
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(p.name)}</span>` + (p.id === hostId ? '<span class="host-badge">ホスト</span>' : '');
    list.appendChild(li);
  });
});

$('#btn-start').addEventListener('click', ()=>{
  socket.emit('startGame');
});

/* ---------- カウントダウン ---------- */
const audio = () => $('#audio-player');

socket.on('countdown', ({ audioStartOffset, countdownSec }) => {
  showScreen('screen-countdown');
  const a = audio();
  a.currentTime = audioStartOffset;
  a.play().catch(()=>{ /* 自動再生がブロックされてもゲーム進行(サーバー時間基準)には影響しない */ });

  const startAt = Date.now();
  const tickCountdown = () => {
    const remain = countdownSec - (Date.now() - startAt) / 1000;
    if (remain > 0) {
      $('#countdown-num').textContent = Math.ceil(remain);
      requestAnimationFrame(tickCountdown);
    } else {
      showScreen('screen-game');
    }
  };
  tickCountdown();
});

/* ---------- ゲーム進行 ---------- */
let currentPlayersState = [];
let lastLap = -1;

socket.on('tick', data => {
  $('#stat-level').textContent = data.level;
  $('#stat-time').textContent = formatTime(data.elapsed);
  $('#stat-lap').textContent = data.lap;
  $('#stat-words').textContent = data.totalWords;
  $('#stat-nextlevel').textContent = data.nextLevelIn.toFixed(1) + '秒';

  if (data.lap !== lastLap) {
    lastLap = data.lap;
  }
  currentPlayersState = data.players;
  renderPlayers(data.players);
});

socket.on('wordResult', ({ playerId, correct, reason, players, totalWords }) => {
  currentPlayersState = players;
  renderPlayers(players);
  const col = document.querySelector(`.player-col[data-id="${playerId}"] .p-flash`);
  if (col) {
    if (correct) {
      col.textContent = '⭕ 正解!';
      col.className = 'p-flash ok';
    } else {
      const msgs = { duplicate: '❌ 既に使った単語です', too_similar: '❌ 似た単語は使えません', wrong: '❌ 不正解' };
      col.textContent = msgs[reason] || '❌ 不正解';
      col.className = 'p-flash ng';
    }
  }
});

function formatTime(sec){
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

function escapeHtml(str){
  return (str||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderPlayers(players){
  const grid = $('#players-grid');
  // 既存要素があれば使い回し、なければ再構築
  if (grid.children.length !== players.length) {
    grid.innerHTML = '';
    players.forEach(p => grid.appendChild(buildPlayerCol(p)));
  }
  players.forEach(p=>{
    const col = grid.querySelector(`.player-col[data-id="${p.id}"]`);
    if (!col) return;
    col.classList.toggle('eliminated', p.eliminated);
    const nameEl = col.querySelector('.p-name');
    nameEl.innerHTML = escapeHtml(p.name) + (p.eliminated ? ' <span class="badge-out">脱落</span>' : '');

    const wordsList = col.querySelector('.p-words');
    if (wordsList.dataset.count != p.words.length) {
      wordsList.innerHTML = p.words.map(w => `<li>${escapeHtml(w)}</li>`).join('');
      wordsList.dataset.count = p.words.length;
    }

    const inputRow = col.querySelector('.p-input-row');
    const waitingLabel = col.querySelector('.waiting-label');
    if (p.eliminated) {
      inputRow.style.display = 'none';
      waitingLabel.style.display = 'block';
      waitingLabel.textContent = '脱落しました';
    } else if (p.correctThisLap) {
      inputRow.style.display = 'none';
      waitingLabel.style.display = 'block';
      waitingLabel.textContent = '次の回を待っています…';
    } else {
      inputRow.style.display = 'flex';
      waitingLabel.style.display = 'none';
    }
  });
}

function buildPlayerCol(p){
  const col = document.createElement('div');
  col.className = 'player-col';
  col.dataset.id = p.id;
  col.innerHTML = `
    <div class="p-name">${escapeHtml(p.name)}</div>
    <div class="p-flash"></div>
    <div class="p-input-row">
      <input type="text" placeholder="単語を入力" maxlength="30">
      <button>確定</button>
    </div>
    <div class="waiting-label" style="display:none;"></div>
    <ul class="p-words"></ul>
  `;
  const input = col.querySelector('input');
  const btn = col.querySelector('button');
  const submit = () => {
    const val = input.value;
    if (!val.trim()) return;
    if (p.id === myId) {
      socket.emit('submitWord', { word: val });
      input.value = '';
    }
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  if (p.id !== myId) {
    input.disabled = true;
    btn.disabled = true;
    input.placeholder = '(本人のみ入力可)';
  }
  return col;
}

// ラップが変わったら自分の入力欄をリセット(表示切替はrenderPlayersが担当するが、値も念のためクリア)
socket.on('tick', data => {
  if (data.lap !== lastLap) {
    const myInput = document.querySelector(`.player-col[data-id="${myId}"] input`);
    if (myInput) myInput.value = '';
    const flash = document.querySelector(`.player-col[data-id="${myId}"] .p-flash`);
    if (flash) { flash.textContent=''; flash.className='p-flash'; }
  }
});

/* ---------- 結果画面 ---------- */
socket.on('gameEnd', ({ players }) => {
  audio().pause();
  const list = $('#result-list');
  list.innerHTML = '';
  players
    .slice()
    .sort((a,b)=> b.words.length - a.words.length)
    .forEach(p=>{
      const row = document.createElement('div');
      row.className = 'result-row ' + (p.eliminated ? 'out' : 'survivor');
      row.innerHTML = `<span>${escapeHtml(p.name)}${p.eliminated ? '(脱落)' : '(生存)'}</span><span>${p.words.length}回</span>`;
      list.appendChild(row);
    });
  showScreen('screen-result');
});

$('#btn-back').addEventListener('click', ()=>{ location.reload(); });
