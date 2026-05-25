// --- WebSocket live update and liveness check ---
let ws = null;
let wsConnected = false;
let pingInterval = null;
let pongTimeout = null;

function setupWebSocket() {
    let wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let wsUrl = wsProto + '://' + window.location.host + '/ws';
    console.log('Connecting to WebSocket:', wsUrl);
    ws = new WebSocket(wsUrl);
    let reconnectTimeout = null;

    ws.onopen = function() {
        wsConnected = true;
        console.log('WebSocket connected');
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        // Manual update on reconnect
        if (currentMatch) showMatchScoreSection();
        // Start ping interval
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(function() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
                // Set pong timeout
                if (pongTimeout) clearTimeout(pongTimeout);
                pongTimeout = setTimeout(function() {
                    console.warn('Pong not received, closing WebSocket and reconnecting');
                    ws.close();
                }, 4000);
            }
        }, 5000);
    };
    ws.onclose = function() {
        wsConnected = false;
        console.log('WebSocket disconnected, will attempt to reconnect in 1/2s');
        if (pingInterval) clearInterval(pingInterval);
        if (pongTimeout) clearTimeout(pongTimeout);
        reconnectTimeout = setTimeout(setupWebSocket, 500);
    };
    ws.onerror = function(e) {
        wsConnected = false;
        console.error('WebSocket error:', e);
    };
    ws.onmessage = function(e) {
        console.log('WebSocket message:', e.data);
        if (e.data === 'pong') {
            if (pongTimeout) clearTimeout(pongTimeout);
            return;
        }
        if (e.data === 'update') {
            if (currentMatch) showMatchScoreSection();
        }
    };
}
// Ryder Score Entry Page

let matches = [];
let currentMatch = null;
let holeResults = Array(18).fill(null); // 'A', 'B', 'AS'
sEnabled = false;

async function fetchMatches() {
    const res = await fetch('/api/match/list');
    const data = await res.json();
    matches = data.matches || [];
}

async function showMatchScoreSection() {
    if (!currentMatch) return;
    document.getElementById('team-a').innerHTML = `<strong>${currentMatch.team_a.name}</strong><br>` +
        currentMatch.team_a.players.map(p => p.name).join('<br>');
    document.getElementById('team-b').innerHTML = `<strong>${currentMatch.team_b.name}</strong><br>` +
        currentMatch.team_b.players.map(p => p.name).join('<br>');
    // Load hole results and match status from DB
    await loadHoleResults();
    await loadMatchStatus();
    renderHoles();
    updateMatchScoreDisplay();
    updateFinishButton();
    renderMatchTitle();
    // Register finish button event every time section is shown
    const btn = document.getElementById('finish-btn');
    if (btn) {
        btn.onclick = async function() {
            if (!currentMatch) return;
            if (currentMatch.status === 'completed') {
                // If any hole is set, set to running, else prepared
                if (holeResults.some(v => v === 'A' || v === 'B' || v === 'AS')) {
                    await setMatchStatus('running');
                } else {
                    await setMatchStatus('prepared');
                }
            } else {
                await setMatchStatus('completed');
            }
        };
    }
    setScoringEnabled(currentMatch.status !== 'completed');
}

async function loadMatchStatus() {
    if (!currentMatch) return;
    // Use match list API to get latest status
    const res = await fetch('/api/match/list');
    if (res.ok) {
        const data = await res.json();
        const match = (data.matches || []).find(m => m.id == currentMatch.id);
        if (match && match.status) currentMatch.status = match.status;
    }
}

function getDisplayedHoleIndices() {
    const startHole = (currentMatch && currentMatch.starting_hole) ? currentMatch.starting_hole : 1;
    const startIdx = startHole - 1;
    const count = (currentMatch && currentMatch.holes === '9') ? 9 : 18;
    const result = [];
    for (let n = 0; n < count; n++) {
        result.push((startIdx + n) % 18);
    }
    return result;
}

// Returns how many playoff holes to show (0 = no playoff yet or match decided by regular holes).
// Playoff holes live at holeResults indices 18, 19, 20...
function getPlayoffHolesCount() {
    const regularIndices = getDisplayedHoleIndices();
    const allRegularPlayed = regularIndices.every(i => holeResults[i] != null && holeResults[i] !== '');
    if (!allRegularPlayed) return 0;

    let aUp = 0, bUp = 0;
    for (const i of regularIndices) {
        if (holeResults[i] === 'A') aUp++;
        else if (holeResults[i] === 'B') bUp++;
    }
    if (aUp !== bUp) return 0; // Regular holes decided the match

    let p = 0;
    while (true) {
        const result = holeResults[18 + p];
        if (result == null || result === '') return p + 1; // Show this unplayed hole
        if (result === 'A') aUp++;
        else if (result === 'B') bUp++;
        p++;
        if (aUp !== bUp) return p; // Decided — show played holes but no more
    }
}

function teamLabel(team) {
    if (team.players && team.players.length === 1) {
        const parts = team.players[0].name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return parts.slice(0, -1).join(' ') + '\n' + parts[parts.length - 1];
        }
        return team.players[0].name;
    }
    if (team.players && team.players.length > 1) {
        // Multiple players: show each surname on its own line
        return team.players.map(p => {
            const parts = p.name.trim().split(/\s+/);
            return parts[parts.length - 1];
        }).join('\n');
    }
    return team.name;
}

function renderHoles() {
    const holesDiv = document.getElementById('holes-list');
    holesDiv.innerHTML = '';
    const holeIndices = getDisplayedHoleIndices();
    const labelA = teamLabel(currentMatch.team_a);
    const labelB = teamLabel(currentMatch.team_b);
    for (let pos = 0; pos < holeIndices.length; pos++) {
        const i = holeIndices[pos];
        // Add divider at wrap point (when index goes from higher to lower)
        if (pos > 0 && i < holeIndices[pos - 1]) {
            const emptyRow = document.createElement('div');
            emptyRow.className = 'hole-row hole-divider';
            emptyRow.style.height = '1.5em';
            emptyRow.style.background = 'transparent';
            emptyRow.style.border = 'none';
            holesDiv.appendChild(emptyRow);
        }
        const row = document.createElement('div');
        row.className = 'hole-row';
        row.innerHTML = `<span class="hole-label">${i+1}</span>` +
            `<span class="hole-score">
            <button type="button" class="hole-btn" data-hole="${i}" data-val="A">${labelA}</button>
            <button type="button" class="hole-btn" data-hole="${i}" data-val="AS">A/S</button>
            <button type="button" class="hole-btn" data-hole="${i}" data-val="B">${labelB}</button>
            </span>`;
        holesDiv.appendChild(row);
    }
    // Playoff holes
    const playoffCount = getPlayoffHolesCount();
    if (playoffCount > 0) {
        const divider = document.createElement('div');
        divider.className = 'hole-row';
        divider.style.cssText = 'background:transparent; border:none; justify-content:center; font-weight:700; color:#2563eb; font-size:1.05em; border-top:2px solid #2563eb; margin-top:0.5rem; padding-top:0.7rem;';
        divider.textContent = 'Rozstřel';
        holesDiv.appendChild(divider);
        for (let p = 0; p < playoffCount; p++) {
            const idx = 18 + p;
            const label = (p % 18) + 1;
            const row = document.createElement('div');
            row.className = 'hole-row';
            row.innerHTML = `<span class="hole-label">${label}</span>` +
                `<span class="hole-score">
                <button type="button" class="hole-btn" data-hole="${idx}" data-val="A">${labelA}</button>
                <button type="button" class="hole-btn" data-hole="${idx}" data-val="AS">A/S</button>
                <button type="button" class="hole-btn" data-hole="${idx}" data-val="B">${labelB}</button>
                </span>`;
            holesDiv.appendChild(row);
        }
    }

    if (sEnabled) {
        document.querySelectorAll('.hole-btn').forEach(btn => {
            btn.onclick = function() {
                const hole = parseInt(this.getAttribute('data-hole'));
                const val = this.getAttribute('data-val');
                holeResults[hole] = (holeResults[hole] === val) ? null : val;
                renderHoles();
                updateMatchScoreDisplay();
                saveHoleResults();
            };
        });
    }
    for (const i of holeIndices) updateHoleButtons(i);
    for (let p = 0; p < playoffCount; p++) updateHoleButtons(18 + p);
}

function updateHoleButtons(hole) {
    function getContrastYIQ(hexcolor) {
        hexcolor = hexcolor.replace('#','');
        if (hexcolor.length === 3) hexcolor = hexcolor[0]+hexcolor[0]+hexcolor[1]+hexcolor[1]+hexcolor[2]+hexcolor[2];
        var r = parseInt(hexcolor.substr(0,2),16);
        var g = parseInt(hexcolor.substr(2,2),16);
        var b = parseInt(hexcolor.substr(4,2),16);
        var yiq = ((r*299)+(g*587)+(b*114))/1000;
        return (yiq >= 180) ? '#000' : '#fff';
    }
    document.querySelectorAll(`.hole-btn[data-hole="${hole}"]`).forEach(btn => {
        const val = btn.getAttribute('data-val');
        btn.classList.remove('selected');
        btn.style.background = '';
        btn.style.color = '';
        if (val === holeResults[hole]) {
            btn.classList.add('selected');
            // if (val === 'A') {
            //     btn.style.background = currentMatch.team_a.color;
            //     btn.style.color = getContrastYIQ(currentMatch.team_a.color);
            // } else if (val === 'B') {
            //     btn.style.background = currentMatch.team_b.color;
            //     btn.style.color = getContrastYIQ(currentMatch.team_b.color);
            // }
            // btn.style.background = currentMatch.team_a.color;
            // btn.style.color = getContrastYIQ(currentMatch.team_a.color);
        }
    });
}

function updateMatchScoreDisplay() {
    let aUp = 0, bUp = 0, holesLeft = 0;
    const holeIndices = getDisplayedHoleIndices();
    for (const i of holeIndices) {
        if (holeResults[i] === 'A') aUp++;
        else if (holeResults[i] === 'B') bUp++;
        if (!holeResults[i]) holesLeft++;
    }
    const playoffCount = getPlayoffHolesCount();
    for (let p = 0; p < playoffCount; p++) {
        const r = holeResults[18 + p];
        if (r === 'A') aUp++;
        else if (r === 'B') bUp++;
    }
    let scoreText = '';
    if (aUp > bUp) scoreText = `${teamLabel(currentMatch.team_a)} ${aUp-bUp} Up`;
    else if (bUp > aUp) scoreText = `${teamLabel(currentMatch.team_b)} ${bUp-aUp} Up`;
    else scoreText = 'All Square';
    if (playoffCount > 0) {
        scoreText += '  (Rozstřel)';
    } else {
        scoreText += `  (Zbývá ${holesLeft})`;
    }
    document.getElementById('match-score').textContent = scoreText;
}

async function saveHoleResults() {
    if (!currentMatch) return;
    await fetch(`/api/match/holescore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: currentMatch.id, holes: holeResults })
    });
    // If any hole is set, set match as running
    if (holeResults.some(v => v === 'A' || v === 'B' || v === 'AS')) {
        if (currentMatch.status !== 'running') {
            await setMatchStatus('running', true);
        }
    }
    // Notify dashboard to update
    localStorage.setItem('ryder-dashboard-update', Date.now().toString());
}

function setScoringEnabled(enabled) {
    document.querySelectorAll('.hole-btn').forEach(btn => {
        btn.disabled = !enabled;
        if (!enabled) {
            btn.classList.add('disabled');
        } else {
            btn.classList.remove('disabled');
        }
    });
}

// Patch setMatchStatus to notify dashboard
async function setMatchStatus(status, silent) {
    if (!currentMatch) return;
    // Optimistically update UI
    currentMatch.status = status;
    updateFinishButton();
    setScoringEnabled(status !== 'completed');
    await fetch('/api/match/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: currentMatch.id, status })
    });
    if (!silent) localStorage.setItem('ryder-dashboard-update', Date.now().toString());
}

async function loadHoleResults() {
    if (!currentMatch) return;
    const res = await fetch(`/api/match/holescore?match_id=${currentMatch.id}`);
    if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.holes)) {
            holeResults = data.holes.map(v => v || null);
            while (holeResults.length < 18) holeResults.push(null);
        }
    }
}

function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
}

window.onload = async function() {
    await fetchMatches();
    setupWebSocket();
    // Disable scoring and finish button by default
    sEnabled = false;
    const finishBtn = document.getElementById('finish-btn');
    if (finishBtn) finishBtn.disabled = true;
    // Enable scoring only after 5 clicks on pinned score within 3 seconds OR via button
    let clickCount = 0;
    let clickTimer = null;
    const pinnedScore = document.getElementById('match-score');
    function enableScoring() {
        sEnabled = true;
        if (finishBtn) finishBtn.disabled = false;
        renderHoles();
    }
    function resetClicks() {
        clickCount = 0;
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
        }
    }
    if (pinnedScore) {
        // Desktop: count clicks
        pinnedScore.addEventListener('click', function() {
            clickCount++;
            if (clickCount === 1) {
                clickTimer = setTimeout(resetClicks, 3000);
            }
            if (clickCount === 5) {
                enableScoring();
                resetClicks();
            }
        });
        // Mobile: count completed taps only
        let tapRegistered = false;
        pinnedScore.addEventListener('touchstart', function(e) {
            tapRegistered = false;
        });
        pinnedScore.addEventListener('touchend', function(e) {
            if (!tapRegistered) {
                tapRegistered = true;
                clickCount++;
                if (clickCount === 1) {
                    clickTimer = setTimeout(resetClicks, 3000);
                }
                if (clickCount === 5) {
                    enableScoring();
                    resetClicks();
                }
            }
        });
    }
    // Add scoring enable button
    const scoringEnableBtn = document.getElementById('enable-scoring-btn');
    if (scoringEnableBtn) {
        scoringEnableBtn.onclick = function() {
            enableScoring();
            scoringEnableBtn.disabled = true;
            scoringEnableBtn.textContent = 'Skórování povoleno';
            scoringEnableBtn.style.background = '#79b879ff';
        };
    }
    window.onfocus = function() {
        if (!wsConnected) {
            console.log('Window focused: WebSocket not connected, reconnecting and updating match');
            setupWebSocket();
            if (currentMatch) showMatchScoreSection();
        }
    };
    const matchId = getQueryParam('match');
    if (matchId) {
        currentMatch = matches.find(m => m.id == matchId);
        if (currentMatch) {
            showMatchScoreSection();
            return;
        }
    }
};

function updateFinishButton() {
    const btn = document.getElementById('finish-btn');
    if (!btn || !currentMatch) return;
    if (currentMatch.status === 'completed') {
        btn.textContent = 'Upravit zápas';
        btn.style.background = '#e53e3e';
    } else {
        btn.textContent = 'Ukončit zápas';
        btn.style.background = '#38a169';
    }
}

function renderMatchTitle() {
    const title = document.getElementById('match-title');
    if (!title || !currentMatch) return;
    let typeText = '';
    if (currentMatch.holes === '9') {
        typeText = '9 jamek';
    } else {
        typeText = '18 jamek';
    }
    // Czech translation for format
    if (currentMatch.format) {
        let formatCz = '';
        switch (currentMatch.format) {
            case 'singles':
                formatCz = 'Singly'; break;
            case 'foursome':
                formatCz = 'Foursome'; break;
            case 'texas_scramble':
                formatCz = 'Texas Scramble'; break;
            default:
                formatCz = currentMatch.format;
        }
        typeText += ' - ' + formatCz;
    }
    title.textContent = typeText;
}

// Call renderMatchTitle() after loading match data
function loadMatch(matchId) {
    fetch(`/api/match?id=${matchId}`)
        .then(r => r.json())
        .then(data => {
            currentMatch = data.match;
            console.log('Loaded match:', currentMatch);
            renderMatchTitle();
            renderHoles();
            updateMatchScoreDisplay();
            updateFinishButton();
        });
}
