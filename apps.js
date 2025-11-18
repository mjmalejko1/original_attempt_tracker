// ---- Firebase imports ----
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// ---- Firebase config ----
const firebaseConfig = {
  apiKey: "AIzaSyCX9C7uy5JNklprp3tZeKV3tPGr410ix28",
  authDomain: "rio-links.firebaseapp.com",
  projectId: "rio-links",
  storageBucket: "rio-links.firebasestorage.app",
  messagingSenderId: "260295353704",
  appId: "1:260295353704:web:8700c3a72ccf786d1762dd",
  measurementId: "G-6MVV3ZFT3T"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const FAMILY_DOC_REF = doc(db, "rioLinks", "rio-links-family-1");

// ---- Core constants ----
const STORAGE_KEY = "rio-links_v2";
const PAR = 2;
const HOLES = 20;
const COURSE_PAR = PAR * HOLES;

const HOLE_NAMES = [
  "First Flight", "Arrow Line", "Hunter’s Hook", "Rising Edge", "Gravity Glide",
  "Climbing Turn", "The Drop Point", "Gauntlet Ridge", "Perch Line", "Switchback",
  "Moon Curve", "The Ascent", "Silent Path", "Hollow Ridge", "The Horseshoe",
  "Reverse Shoe", "Second Ridge", "True North", "Slope Run", "Home Roost"
];

// ---- No sound effects (stubbed) ----
const sounds = {
  click:   { play: () => {}, currentTime: 0 },
  nextHole:{ play: () => {}, currentTime: 0 },
  ace:     { play: () => {}, currentTime: 0 },
  birdie:  { play: () => {}, currentTime: 0 }
};

// ---- State ----
let appData = { players: [], rounds: [] };
let currentRound = null;
let editModeRoundId = null;
let handicapChartInstance = null;
let courseAnalyticsChart = null;

// ---- Storage helpers ----
function loadLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { appData = JSON.parse(raw); } catch (e) { console.error(e); }
  }
  if (!appData.players) appData.players = [];
  if (!appData.rounds) appData.rounds = [];
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
}

async function loadFromFirebase() {
  try {
    const snap = await getDoc(FAMILY_DOC_REF);
    if (snap.exists()) {
      const data = snap.data();
      if (data.players && data.rounds) {
        appData = data;
        saveLocal();
        renderPlayers();
      }
    } else {
      await setDoc(FAMILY_DOC_REF, appData);
    }
  } catch (e) {
    console.warn("Firebase load error", e);
  }
}

async function saveToFirebase() {
  const incompleteExists = appData.rounds.some(r =>
    Object.values(r.scores || {}).some(arr => arr.includes(null))
  );
  if (incompleteExists) {
    console.warn("Skipped Firebase sync: incomplete round present.");
    return;
  }
  try {
    await setDoc(FAMILY_DOC_REF, appData);
  } catch (e) {
    console.warn("Firebase save error:", e);
  }
}

const fmt = n => {
  const num = Number(n);
  if (Number.isNaN(num)) return "-";
  if (num > 0) return `+${num}`;
  if (num === 0) return "E";
  return `${num}`;
};

function getPlayer(id) {
  return appData.players.find(p => p.id === id);
}

function getPlayerRounds(id) {
  return appData.rounds
    .filter(r => r.scores && r.scores[id])
    .sort((a,b) => new Date(a.date) - new Date(b.date));
}

function computeHandicap(id) {
  const rounds = getPlayerRounds(id).slice(-10);
  if (!rounds.length) return 0;
  const diffs = rounds.map(r => {
    const total = r.scores[id].reduce((a,b)=>a+b,0);
    return total - COURSE_PAR;
  });
  const avg = diffs.reduce((a,b)=>a+b,0) / diffs.length;
  return Number(avg.toFixed(1));
}

function getHandicapTimeline(id) {
  const rounds = getPlayerRounds(id);
  const timeline = [];
  for (let i = 0; i < rounds.length; i++) {
    const slice = rounds.slice(Math.max(0, i-9), i+1);
    const diffs = slice.map(r => {
      const total = r.scores[id].reduce((a,b)=>a+b,0);
      return total - COURSE_PAR;
    });
    const avg = diffs.reduce((a,b)=>a+b,0) / diffs.length;
    const handicap = Number(avg.toFixed(1));
    timeline.push({ date: new Date(rounds[i].date), handicap });
  }
  return timeline;
}

function show(id) {
  document.querySelectorAll("section").forEach(s => s.classList.add("hidden"));
  const el = document.getElementById(id);
  if (el) el.classList.remove("hidden");
}

// ---- Players ----
function renderPlayers() {
  const ul = document.getElementById("playersList");
  if (!appData.players.length) {
    ul.innerHTML = "<li>No players yet.</li>";
    return;
  }
  ul.innerHTML = appData.players.map(p => {
    const hc = computeHandicap(p.id);
    return `<li>${p.name}<span class="pill">hcp ${hc > 0 ? `+${hc.toFixed(1)}` : hc.toFixed(1)}</span></li>`;
  }).join("");
}

function renderPlayerSelection() {
  const ul = document.getElementById("playerSelectList");
  if (!appData.players.length) {
    ul.innerHTML = "<li>No players yet.</li>";
    return;
  }
  ul.innerHTML = appData.players.map(p => `
    <li>
      <label style="display:flex;justify-content:space-between;align-items:center;">
        <span>${p.name}</span>
        <input type="checkbox" value="${p.id}">
      </label>
    </li>
  `).join("");
}

// ---- Save button state ----
function updateSaveButtonState() {
  const btn = document.getElementById("btnFinishRoundBottom");
  if (!currentRound) {
    btn.disabled = true;
    btn.style.opacity = "0.4";
    return;
  }
  const allFilled = currentRound.playerIds.every(pid =>
    currentRound.scores[pid].every(s => s !== null)
  );
  btn.disabled = !allFilled;
  btn.style.opacity = allFilled ? "1" : "0.4";
}

// ---- Round rendering ----
function renderRound() {
  if (!currentRound) return;
  const h = currentRound.currentHole;
  const hIndex = h - 1;

  const roundHoleLabel = document.getElementById("roundHoleLabel");
  const holeTitle = document.getElementById("holeTitle");
  const banner = document.getElementById("roundScoreBanner");
  const container = document.getElementById("scoreButtonsContainer");

  roundHoleLabel.textContent = `Hole ${h}/${HOLES}`;
  const courseName = h <= 10 ? "Barred Owl" : "Great Horned Owl";
  holeTitle.textContent = `${courseName} · ${HOLE_NAMES[h-1]} (Par ${PAR})`;

  let bannerHtml = "";
  currentRound.playerIds.forEach(pid => {
    const scores = currentRound.scores[pid];
    const played = scores.filter(v => v !== null);
    const total = played.reduce((a,b)=>a+b,0);
    const diff = played.length ? total - played.length * PAR : 0;
    bannerHtml += `<div>${getPlayer(pid).name}: ${total || 0} (${fmt(diff.toFixed(1))})</div>`;
  });
  banner.innerHTML = bannerHtml || "No scores yet.";

  container.innerHTML = "";
  currentRound.playerIds.forEach(pid => {
    const row = document.createElement("div");
    row.className = "player-row";
    const label = document.createElement("div");
    label.textContent = getPlayer(pid).name;
    row.appendChild(label);

    const btnRow = document.createElement("div");
    btnRow.className = "score-buttons";

    [1,2,3,4,5].forEach(num => {
      const btn = document.createElement("button");
      btn.textContent = num;
      if (currentRound.scores[pid][hIndex] === num) btn.classList.add("selected");

      btn.onclick = () => {
        currentRound.scores[pid][hIndex] = num;

        renderRound();
        updateSaveButtonState();
        renderScorecard();

        const allPlayersScored = currentRound.playerIds.every(pid2 =>
          currentRound.scores[pid2][hIndex] !== null
        );
        if (allPlayersScored && currentRound.currentHole < HOLES) {
          setTimeout(() => {
            currentRound.currentHole++;
            renderRound();
            updateSaveButtonState();
            renderScorecard();
          }, 400);
        }
      };

      btnRow.appendChild(btn);
    });

    row.appendChild(btnRow);
    container.appendChild(row);
  });

  container.classList.add("fade-in");
  setTimeout(() => container.classList.remove("fade-in"), 250);

  updateSaveButtonState();
}

// ---- Scorecard rendering (landscape) ----
function renderScorecard() {
  if (!currentRound) return;
  const container = document.getElementById("scorecardTableContainer");
  if (!container) return;
  container.innerHTML = "";

  const table = document.createElement("table");
  let headerHtml = "<tr><th>Player</th>";
  for (let i = 1; i <= HOLES; i++) headerHtml += `<th>${i}</th>`;
  headerHtml += "<th>Total</th><th>±</th></tr>";
  table.innerHTML = headerHtml;

  currentRound.playerIds.forEach(pid => {
    const player = getPlayer(pid);
    const scores = currentRound.scores[pid];
    let rowHtml = `<tr><td>${player ? player.name : "Player"}</td>`;

    scores.forEach((s, idx) => {
      let cls = "scorecell";
      if (s === 1) cls += " ace";
      else if (s === 2) cls += " birdie";
      else if (s !== null && s > PAR) cls += " bogey";

      rowHtml += `<td class="${cls}" data-player="${pid}" data-hole="${idx}">${s ?? "-"}</td>`;
    });

    const playedScores = scores.filter(v => v !== null);
    const playedCount = playedScores.length;
    let displayTotal = "-";
    let displayDiff = "-";
    if (playedCount > 0) {
      const partialTotal = playedScores.reduce((a,b)=>a+b,0);
      const expectedPar = playedCount * PAR;
      const partialDiff = partialTotal - expectedPar;
      displayTotal = partialTotal;
      displayDiff = fmt(Number(partialDiff.toFixed(2)));
    }
    rowHtml += `<td>${displayTotal}</td><td>${displayDiff}</td></tr>`;
    table.innerHTML += rowHtml;
  });

  container.appendChild(table);
}

// ---- Orientation handling ----
function handleOrientation() {
  if (!currentRound) return;
  const isLandscape = window.innerWidth > window.innerHeight;
  const visibleSection = document.querySelector("section:not(.hidden)");
  const currentId = visibleSection ? visibleSection.id : null;

  if (isLandscape) {
    if (currentId === "screen-round" || currentId === "screen-scorecard") {
      renderScorecard();
      show("screen-scorecard");
    }
  } else {
    if (currentId === "screen-scorecard") {
      show("screen-round");
    }
  }
}

// ---- Finalize round ----
async function finalizeRound() {
  if (!currentRound) return;
  const allFilled = currentRound.playerIds.every(pid =>
    currentRound.scores[pid].every(s => s !== null)
  );
  if (!allFilled) {
    alert("Please enter a score for every hole for every player.");
    return;
  }

  if (editModeRoundId) {
    const idx = appData.rounds.findIndex(r => r.id === editModeRoundId);
    if (idx >= 0) appData.rounds[idx] = currentRound;
  } else {
    appData.rounds.push(currentRound);
  }

  saveLocal();
  await saveToFirebase();

  renderSummary(currentRound);
  currentRound = null;
  editModeRoundId = null;
  show("screen-summary");
}

// ---- Summary ----
function renderSummary(round) {
  const div = document.getElementById("summaryContent");
  const date = new Date(round.date).toLocaleString();
  let html = `<div><strong>${date}</strong></div>`;

  let bestDiff = null;
  let winners = [];

  round.playerIds.forEach(pid => {
    const scores = round.scores[pid];
    const total = scores.reduce((a,b)=>a+b,0);
    const diff = total - COURSE_PAR;

    if (bestDiff === null || diff < bestDiff) {
      bestDiff = diff;
      winners = [getPlayer(pid).name];
    } else if (diff === bestDiff) {
      winners.push(getPlayer(pid).name);
    }

    const front = scores.slice(0,10).reduce((a,b)=>a+b,0);
    const back  = scores.slice(10).reduce((a,b)=>a+b,0);

    html += `
      <div style="margin-top:6px;">
        <strong>${getPlayer(pid).name}</strong>: ${total} (${fmt(diff.toFixed(1))})<br>
        Front (Barred Owl): ${front} · Back (Great Horned): ${back}
      </div>
    `;
  });

  html += `<div style="margin-top:10px;">🏆 Winner: ${winners.join(", ")}</div>`;
  div.innerHTML = html;
}

// ---- History ----
function renderHistory() {
  const div = document.getElementById("historyContent");
  if (!appData.rounds.length) {
    div.innerHTML = "<p>No rounds yet.</p>";
    return;
  }
  div.innerHTML = appData.rounds.slice().reverse().map(r => {
    const date = new Date(r.date).toLocaleString();
    let playersHtml = "";
    Object.keys(r.scores).forEach(pid => {
      const scores = r.scores[pid];
      const total = scores.reduce((a,b)=>a+b,0);
      const diff = total - COURSE_PAR;
      playersHtml += `${getPlayer(pid)?.name ?? "Player"}: ${total} (${fmt(diff.toFixed(1))})<br>`;
    });
    return `
      <div class="history-card">
        <strong>${date}</strong><br>
        ${playersHtml}
        <button class="btn-small" onclick="editRound('${r.id}')">Edit</button>
        <button class="btn-small btn-secondary" onclick="deleteRound('${r.id}')">Delete</button>
      </div>
    `;
  }).join("");
}

window.deleteRound = async id => {
  if (!confirm("Delete round?")) return;
  appData.rounds = appData.rounds.filter(r => r.id !== id);
  saveLocal();
  await saveToFirebase();
  renderHistory();
};

window.editRound = id => {
  const r = appData.rounds.find(x => x.id === id);
  if (!r) return;
  editModeRoundId = id;
  currentRound = JSON.parse(JSON.stringify(r));
  renderRound();
  handleOrientation();
  show("screen-round");
};

// ---- Analytics ----
function computeAnalytics(pid) {
  const rounds = getPlayerRounds(pid);
  if (!rounds.length) return null;
  const totals = rounds.map(r => r.scores[pid].reduce((a,b)=>a+b,0));
  const avg = totals.reduce((a,b)=>a+b,0) / totals.length;
  return {
    rounds: rounds.length,
    avg: Number(avg.toFixed(1)),
    best: Math.min(...totals),
    worst: Math.max(...totals),
    handicap: computeHandicap(pid)
  };
}

function renderAnalyticsPlayerList() {
  const ul = document.getElementById("analyticsPlayerList");
  if (!appData.players.length) {
    ul.innerHTML = "<li>No players yet.</li>";
    return;
  }
  ul.innerHTML = appData.players.map(p => `
    <li style="padding:6px 0;cursor:pointer;" onclick="showAnalytics('${p.id}')">
      ${p.name}
    </li>
  `).join("");
}

window.showAnalytics = pid => {
  const info = computeAnalytics(pid);
  const div = document.getElementById("analyticsResults");
  const canvas = document.getElementById("handicapChart");

  if (!info) {
    div.innerHTML = "<p>No rounds yet for this player.</p>";
    canvas.style.display = "none";
    return;
  }

  div.innerHTML = `
    <p><strong>${getPlayer(pid).name}</strong></p>
    <p>Rounds: ${info.rounds}</p>
    <p>Average Score: ${info.avg.toFixed(1)}</p>
    <p>Best: ${info.best}</p>
    <p>Worst: ${info.worst}</p>
    <p>Handicap: ${info.handicap > 0 ? `+${info.handicap.toFixed(1)}` : info.handicap.toFixed(1)}</p>
  `;

  const timeline = getHandicapTimeline(pid);
  if (!timeline.length) {
    canvas.style.display = "none";
    return;
  }
  canvas.style.display = "block";

  const labels = timeline.map(t => t.date.toLocaleDateString());
  const data = timeline.map(t => t.handicap);

  if (handicapChartInstance) handicapChartInstance.destroy();

  handicapChartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Handicap",
        data,
        borderColor: "#007aff",
        borderWidth: 3,
        tension: 0.3,
        pointRadius: 3
      }]
    },
    options: {
      plugins: { legend: { display: false }},
      scales: { y: { beginAtZero: false } }
    }
  });
};

// ---- Leaderboards ----
function generateLeaderboards() {
  const rounds = appData.rounds;
  const results = [];

  rounds.forEach(r => {
    Object.keys(r.scores).forEach(pid => {
      const player = getPlayer(pid)?.name ?? "Player";
      const scores = r.scores[pid];
      const total = scores.reduce((a,b)=>a+b,0);
      const diffTotal = total - COURSE_PAR;
      const front = scores.slice(0,10).reduce((a,b)=>a+b,0);
      const diffFront = front - (10*PAR);
      const back = scores.slice(10).reduce((a,b)=>a+b,0);
      const diffBack = back - (10*PAR);

      results.push({
        player,
        date: new Date(r.date),
        total, diffTotal,
        front, diffFront,
        back, diffBack
      });
    });
  });

  return {
    overall: results.slice().sort((a,b)=>a.total-b.total).slice(0,10),
    barred:  results.slice().sort((a,b)=>a.front-b.front).slice(0,10),
    horned:  results.slice().sort((a,b)=>a.back-b.back).slice(0,10)
  };
}

function renderLeaderboards() {
  const data = generateLeaderboards();
  const overallDiv = document.getElementById("leaderboardOverall");
  const barredDiv  = document.getElementById("leaderboardBarred");
  const hornedDiv  = document.getElementById("leaderboardHorned");

  overallDiv.innerHTML =
    "<h3>🏆 Best Combined (20 holes)</h3>" +
    (data.overall.length
      ? "<ol>" + data.overall.map(r =>
          `<li>${r.player}: ${r.total} (${fmt(r.diffTotal.toFixed(1))}) — ${r.date.toLocaleDateString()}</li>`
        ).join("") + "</ol>"
      : "<p>No rounds yet.</p>");

  barredDiv.innerHTML =
    "<h3>🦅 Barred Owl (Front 10)</h3>" +
    (data.barred.length
      ? "<ol>" + data.barred.map(r =>
          `<li>${r.player}: ${r.front} (${fmt(r.diffFront.toFixed(1))}) — ${r.date.toLocaleDateString()}</li>`
        ).join("") + "</ol>"
      : "<p>No rounds yet.</p>");

  hornedDiv.innerHTML =
    "<h3>🦉 Great Horned (Back 10)</h3>" +
    (data.horned.length
      ? "<ol>" + data.horned.map(r =>
          `<li>${r.player}: ${r.back} (${fmt(r.diffBack.toFixed(1))}) — ${r.date.toLocaleDateString()}</li>`
        ).join("") + "</ol>"
      : "<p>No rounds yet.</p>");
}

// ---- Course Analytics ----
function renderCourseAnalytics() {
  const container = document.getElementById("courseAnalyticsContainer");
  const canvas = document.getElementById("courseAnalyticsChart");
  container.innerHTML = "";

  if (!appData.rounds.length) {
    container.innerHTML = "<p>No rounds recorded yet.</p>";
    if (courseAnalyticsChart) courseAnalyticsChart.destroy();
    return;
  }

  const holeStats = Array(HOLES).fill(null).map((_, i) => ({
    hole: i + 1,
    name: HOLE_NAMES[i],
    scores: []
  }));

  appData.rounds.forEach(r => {
    Object.values(r.scores).forEach(arr => {
      arr.forEach((score, i) => {
        if (score !== null) holeStats[i].scores.push(score);
      });
    });
  });

  const difficultyData = holeStats.map(h => {
    if (!h.scores.length) return { ...h, avg: null, diff: null };
    const avg = h.scores.reduce((a,b)=>a+b,0) / h.scores.length;
    return { ...h, avg, diff: avg - PAR };
  });

  difficultyData.sort((a,b)=>(b.diff ?? -999) - (a.diff ?? -999));

  let html = "<table><tr><th>#</th><th>Hole</th><th>Avg</th><th>Δ</th></tr>";
  difficultyData.forEach((h, idx) => {
    html += `<tr>
      <td>${idx+1}</td>
      <td>${h.name}</td>
      <td>${h.avg !== null ? h.avg.toFixed(2) : "-"}</td>
      <td>${h.diff !== null ? fmt(Number(h.diff.toFixed(2))) : "-"}</td>
    </tr>`;
  });
  html += "</table>";
  container.innerHTML = html;

  const labels = difficultyData.map(h => `H${h.hole}`);
  const values = difficultyData.map(h => h.diff ?? 0);

  if (courseAnalyticsChart) courseAnalyticsChart.destroy();

  courseAnalyticsChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: values.map(v =>
          v > 0.5 ? "#ff6b6b" : v > 0 ? "#ffd93b" : "#7dd87d"
        )
      }]
    },
    options: {
      plugins: { legend: { display: false }},
      scales: {
        y: { title: { display: true, text: "Avg vs Par (Strokes)" } }
      }
    }
  });
}

// ---- Export CSV ----
function exportCSV() {
  if (!appData.rounds.length) {
    alert("No rounds to export yet.");
    return;
  }
  const rows = ["Date,Player,Hole,Score"];
  appData.rounds.forEach(r => {
    Object.keys(r.scores).forEach(pid => {
      const player = getPlayer(pid)?.name ?? "Player";
      r.scores[pid].forEach((score, idx) => {
        rows.push(`${r.date},${player},${idx+1},${score}`);
      });
    });
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rio-links-scores-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Export JSON ----
function exportBackupJSON() {
  const json = JSON.stringify(appData, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rio-links-backup-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- Import JSON ----
function importBackupJSON(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data.players || !data.rounds) {
        alert("Invalid backup file.");
        return;
      }
      appData = data;
      saveLocal();
      await saveToFirebase();
      alert("Backup restored successfully!");
      renderPlayers();
      show("screen-home");
    } catch (e) {
      console.error(e);
      alert("Error reading backup file.");
    }
  };
  reader.readAsText(file);
}

// ---- Scorecard cell editing ----
document.addEventListener("click", (e) => {
  if (!currentRound) return;
  if (!e.target.classList.contains("scorecell")) return;

  const pid = e.target.dataset.player;
  const holeIdx = parseInt(e.target.dataset.hole, 10);
  if (!pid || Number.isNaN(holeIdx)) return;

  const existing = currentRound.scores[pid][holeIdx];
  const input = prompt(
    `Score for ${getPlayer(pid)?.name || "Player"} on Hole ${holeIdx + 1}:`,
    existing ?? ""
  );
  if (input === null) return;

  const val = parseInt(input, 10);
  if (!Number.isInteger(val) || val < 1 || val > 10) return;

  currentRound.scores[pid][holeIdx] = val;

  renderScorecard();
  renderRound();
  updateSaveButtonState();
});

// ---- Swipe navigation ----
let touchStartX = 0;
document.addEventListener("touchstart", e => {
  if (!e.changedTouches || !e.changedTouches.length) return;
  touchStartX = e.changedTouches[0].screenX;
});
document.addEventListener("touchend", e => {
  if (!currentRound || !e.changedTouches || !e.changedTouches.length) return;
  const dx = e.changedTouches[0].screenX - touchStartX;
  if (dx > 60) {
    currentRound.currentHole = Math.max(1, currentRound.currentHole - 1);
    renderRound();
    renderScorecard();
  } else if (dx < -60) {
    currentRound.currentHole = Math.min(HOLES, currentRound.currentHole + 1);
    renderRound();
    renderScorecard();
  }
});

// ---- Button wiring ----
document.getElementById("btnHomeStart").onclick = () => {
  renderPlayerSelection();
  show("screen-select-players");
};
document.getElementById("btnHomePlayers").onclick = () => {
  renderPlayers();
  show("screen-players");
};
document.getElementById("btnHomeHistory").onclick = () => {
  renderHistory();
  show("screen-history");
};
document.getElementById("btnHomeAnalytics").onclick = () => {
  renderAnalyticsPlayerList();
  document.getElementById("analyticsResults").innerHTML = "";
  document.getElementById("handicapChart").style.display = "none";
  show("screen-analytics");
};
document.getElementById("btnHomeLeaderboard").onclick = () => {
  renderLeaderboards();
  show("screen-leaderboards");
};
document.getElementById("btnHomeCourseAnalytics").onclick = () => {
  renderCourseAnalytics();
  show("screen-course-analytics");
};
document.getElementById("btnHomeExport").onclick = exportCSV;
document.getElementById("btnExportJSON").onclick = exportBackupJSON;

document.getElementById("btnImportBackup").onclick = () => {
  document.getElementById("backupFileInput").click();
};
document.getElementById("backupFileInput").onchange = e => {
  const file = e.target.files[0];
  if (file) importBackupJSON(file);
};

document.getElementById("btnAddPlayer").onclick = async () => {
  const input = document.getElementById("playerNameInput");
  const name = input.value.trim();
  if (!name) return;
  appData.players.push({ id: "p_" + Date.now(), name });
  input.value = "";
  saveLocal();
  await saveToFirebase();
  renderPlayers();
};

document.getElementById("btnBackFromPlayers").onclick = () => show("screen-home");
document.getElementById("btnBackFromSelect").onclick = () => show("screen-home");
document.getElementById("btnBackFromHistory").onclick = () => show("screen-home");
document.getElementById("btnBackFromAnalytics").onclick = () => show("screen-home");
document.getElementById("btnBackFromLeaderboards").onclick = () => show("screen-home");
document.getElementById("btnBackFromCourseAnalytics").onclick = () => show("screen-home");

document.getElementById("btnStartRoundFromSelection").onclick = () => {
  const ids = [...document.querySelectorAll("#playerSelectList input:checked")].map(cb => cb.value);
  if (!ids.length) {
    alert("Select at least one player.");
    return;
  }
  currentRound = {
    id: "r_" + Date.now(),
    date: new Date().toISOString(),
    playerIds: ids.slice(),
    currentHole: 1,
    scores: Object.fromEntries(ids.map(id => [id, Array(HOLES).fill(null)]))
  };
  editModeRoundId = null;
  renderRound();
  handleOrientation();
  show("screen-round");
};

document.getElementById("btnPrevHole").onclick = () => {
  if (!currentRound) return;
  currentRound.currentHole = Math.max(1, currentRound.currentHole - 1);
  renderRound();
  renderScorecard();
};
document.getElementById("btnNextHole").onclick = () => {
  if (!currentRound) return;
  currentRound.currentHole = Math.min(HOLES, currentRound.currentHole + 1);
  renderRound();
  renderScorecard();
};
document.getElementById("btnFinishRoundBottom").onclick = finalizeRound;
document.getElementById("btnBackFromRound").onclick = () => {
  if (confirm("Cancel this round? Unsaved changes will be lost.")) {
    currentRound = null;
    editModeRoundId = null;
    show("screen-home");
  }
};
document.getElementById("btnSummaryDone").onclick = () => show("screen-home");

// Orientation listeners
window.addEventListener("orientationchange", handleOrientation);
window.addEventListener("resize", handleOrientation);

// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js")
    .catch(err => console.log("SW registration failed:", err));
}

// ---- Init ----
loadLocal();
renderPlayers();
show("screen-home");
loadFromFirebase();
