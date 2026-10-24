(() => {
  const { topEntries } = globalThis.CMRLeaderboard;
  if (typeof topEntries !== "function") {
    throw new Error("leaderboard helpers missing");
  }

  const COLORS = [
    { name:"RED",    hex:"#ff3b30" },
    { name:"BLUE",   hex:"#2f7dff" },
    { name:"GREEN",  hex:"#34c759" },
    { name:"YELLOW", hex:"#ffd60a" },
    { name:"PURPLE", hex:"#bf5af2" },
    { name:"ORANGE", hex:"#ff9f0a" },
  ];

  const ROUND_TIME_START_MS = 1800;
  const ROUND_TIME_MIN_MS   = 750;
  const TIME_DECAY_PER_ROUND = 35;

  const BASE_POINTS = 50;
  const SPEED_BONUS_MAX = 120;
  const COMBO_MAX = 8;

  const STORAGE_KEY = "cmr_leaderboard_v1";

  let running = false;
  let target = null;
  let round = 0;
  let score = 0;
  let combo = 1;

  let roundTimeMs = ROUND_TIME_START_MS;
  let roundStart = 0;
  let rafId = null;

  const canvas = document.getElementById("hud");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const comboEl = document.getElementById("combo");
  const buttonsEl = document.getElementById("buttons");
  const startBtn = document.getElementById("startBtn");
  const howBtn = document.getElementById("howBtn");

  const overlay = document.getElementById("overlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const playAgainBtn = document.getElementById("playAgainBtn");
  const closeBtn = document.getElementById("closeBtn");

  const leaderboardEl = document.getElementById("leaderboard");

  const randInt = (n) => Math.floor(Math.random() * n);
  const pickN = (arr, n) => {
    const copy = [...arr];
    const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(randInt(copy.length),1)[0]);
    return out;
  };

  function loadLB() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return topEntries(parsed);
    } catch {
      return [];
    }
  }
  function saveLB(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(topEntries(entries)));
    } catch {
      // Private mode or a full disk should still end the round.
    }
  }
  function pushScoreToLB(newScore) {
    const entry = { score: newScore, when: Date.now() };
    saveLB([...loadLB(), entry]);
    renderLB();
  }
  function renderLB() {
    const lb = loadLB();
    leaderboardEl.replaceChildren();
    if (!lb.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No scores yet — hit PLAY.";
      leaderboardEl.append(empty);
      return;
    }
    lb.forEach((e, i) => {
      const when = new Date(e.when);
      const label = Number.isNaN(when.getTime())
        ? ""
        : when.toLocaleDateString(undefined, { month:"short", day:"numeric" });
      const row = document.createElement("div");
      row.className = "lbRow";
      const left = document.createElement("div");
      left.append(document.createTextNode("#" + (i + 1) + " "));
      const span = document.createElement("span");
      span.className = "muted";
      span.textContent = label;
      left.append(span);
      const scoreB = document.createElement("b");
      scoreB.textContent = String(e.score);
      row.append(left, scoreB);
      leaderboardEl.append(row);
    });
  }

  function buildButtons(options) {
    buttonsEl.replaceChildren();
    options.forEach(c => {
      const b = document.createElement("button");
      b.className = "btn";
      b.type = "button";
      b.dataset.color = c.name;
      b.textContent = c.name;
      b.addEventListener("click", () => onPick(c));
      buttonsEl.append(b);
    });
  }

  function drawHUD(progress01) {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);

    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(w/2,h/2,150,0,Math.PI*2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();

    const cx = w/2, cy = h/2;
    const r = 145;
    const startAng = -Math.PI/2;

    ctx.lineWidth = 18;
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI*2);
    ctx.stroke();

    const p = Math.max(0, Math.min(1, progress01));
    const hue = 120 * p;
    ctx.strokeStyle = "hsl(" + hue + ", 90%, 55%)";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, startAng + (Math.PI*2 * p), false);
    ctx.stroke();

    const tileW = 210, tileH = 210, rad = 28;
    const x = cx - tileW/2, y = cy - tileH/2;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.35)";
    roundRect(ctx, x+6, y+10, tileW, tileH, rad);
    ctx.fill();
    ctx.restore();

    const fill = target ? target.hex : "rgba(255,255,255,.18)";
    ctx.fillStyle = fill;
    roundRect(ctx, x, y, tileW, tileH, rad);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,.25)";
    roundRect(ctx, x, y, tileW, tileH, rad);
    ctx.stroke();

    ctx.fillStyle = "rgba(10,8,25,.85)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 52px system-ui";
    const label = target ? target.name : "READY";
    ctx.fillText(label, cx, cy);

    ctx.font = "700 18px system-ui";
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fillText(running ? "Round " + round : "Press PLAY", cx, cy + 86);
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  function startGame() {
    running = true;
    round = 0;
    score = 0;
    combo = 1;
    roundTimeMs = ROUND_TIME_START_MS;
    updateHUDText();
    nextRound();
  }

  function nextRound() {
    round += 1;
    roundTimeMs = Math.max(ROUND_TIME_MIN_MS, ROUND_TIME_START_MS - (round-1) * TIME_DECAY_PER_ROUND);

    const options = pickN(COLORS, 4);
    target = options[randInt(options.length)];

    buildButtons(options);

    roundStart = performance.now();
    loop();
    updateHUDText();
  }

  function onPick(choice) {
    if (!running) return;

    const now = performance.now();
    const elapsed = now - roundStart;
    const remaining = Math.max(0, roundTimeMs - elapsed);

    if (remaining <= 0) {
      return endGame("Time ran out!");
    }
    if (choice.name !== target.name) {
      return endGame("Wrong colour!");
    }

    const speed01 = remaining / roundTimeMs;
    const speedBonus = Math.round(SPEED_BONUS_MAX * speed01);
    const gained = (BASE_POINTS + speedBonus) * combo;

    score += gained;
    combo = Math.min(COMBO_MAX, combo + 1);
    flashHUD();
    nextRound();
  }

  function flashHUD() {
    canvas.classList.add("flash");
    setTimeout(() => canvas.classList.remove("flash"), 70);
  }

  function updateHUDText() {
    scoreEl.textContent = String(score);
    comboEl.textContent = "x" + combo;
  }

  function paragraph(text) {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  function boldParagraph(text) {
    const p = document.createElement("p");
    const b = document.createElement("b");
    b.textContent = text;
    p.append(b);
    return p;
  }

  function scoreParagraph(value) {
    const p = document.createElement("p");
    p.append(document.createTextNode("Final score: "));
    const b = document.createElement("b");
    b.textContent = String(value);
    p.append(b);
    return p;
  }

  function endGame(reason) {
    running = false;
    cancelAnimationFrame(rafId);
    rafId = null;

    pushScoreToLB(score);

    modalTitle.textContent = "Game Over";
    modalBody.replaceChildren(
      boldParagraph(reason),
      scoreParagraph(score),
      paragraph("Best tip: build combo by staying accurate — speed comes second.")
    );
    overlay.style.display = "flex";

    target = null;
    buildButtons(pickN(COLORS, 4));
    drawHUD(0);
    updateHUDText();
    startBtn.textContent = "PLAY";
  }

  function loop() {
    if (!running) return;

    const now = performance.now();
    const elapsed = now - roundStart;
    const remaining = Math.max(0, roundTimeMs - elapsed);
    const progress01 = remaining / roundTimeMs;

    drawHUD(progress01);

    if (remaining <= 0) {
      endGame("Time ran out!");
      return;
    }

    rafId = requestAnimationFrame(loop);
  }

  function showHow() {
    modalTitle.textContent = "How to Play";
    modalBody.replaceChildren(
      paragraph("1) A colour appears in the middle."),
      paragraph("2) Tap the matching button."),
      paragraph("3) Faster taps earn more points."),
      boldParagraph("One mistake or timeout = game over."),
      paragraph("Climb the leaderboard with long streaks.")
    );
    overlay.style.display = "flex";
  }

  startBtn.addEventListener("click", () => {
    overlay.style.display = "none";
    startBtn.textContent = "PLAYING…";
    startGame();
  });
  howBtn.addEventListener("click", showHow);
  playAgainBtn.addEventListener("click", () => {
    overlay.style.display = "none";
    startBtn.textContent = "PLAYING…";
    startGame();
  });
  closeBtn.addEventListener("click", () => overlay.style.display = "none");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.style.display = "none"; });

  renderLB();
  buildButtons(pickN(COLORS, 4));
  drawHUD(0);
})();
