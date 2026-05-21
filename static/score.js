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
    function teamLogoSlug(name) {
        return name.toLowerCase().replace(/\s+/g, '_');
    }
    function teamHtml(team) {
        const slug = teamLogoSlug(team.name);
        const players = team.players.map(p => `<span class="team-label-player">${p.name}</span>`).join('');
        return `<div class="team-label-wrap">`
            + `<img src="/img/${slug}.png" alt="${team.name}" class="team-label-logo" onerror="this.style.display='none';this.nextElementSibling.style.display=''">`
            + `<span class="team-label-name" style="display:none">${team.name}</span>`
            + `<div class="team-label-players">${players}</div>`
            + `</div>`;
    }
    document.getElementById('team-a').innerHTML = teamHtml(currentMatch.team_a);
    document.getElementById('team-b').innerHTML = teamHtml(currentMatch.team_b);
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
                window.location.href = '/dashboard';
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

function renderHoles() {
    const holesDiv = document.getElementById('holes-list');
    holesDiv.innerHTML = '';
    const holeIndices = getDisplayedHoleIndices();
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
            <button type="button" class="hole-btn" data-hole="${i}" data-val="A">${currentMatch.team_a.name}</button>
            <button type="button" class="hole-btn" data-hole="${i}" data-val="AS">A/S</button>
            <button type="button" class="hole-btn" data-hole="${i}" data-val="B">${currentMatch.team_b.name}</button>
            </span>`;
        holesDiv.appendChild(row);
    }
    if (sEnabled) {
        document.querySelectorAll('.hole-btn').forEach(btn => {
            btn.onclick = function() {
                const hole = parseInt(this.getAttribute('data-hole'));
                const val = this.getAttribute('data-val');
                holeResults[hole] = (holeResults[hole] === val) ? undefined : val;
                updateHoleButtons(hole);
                updateMatchScoreDisplay();
                saveHoleResults();
            };
        });
    }
    for (const i of holeIndices) updateHoleButtons(i);
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
    let scoreText = '';
    if (aUp > bUp) scoreText = `${currentMatch.team_a.name} ${aUp-bUp} Up`;
    else if (bUp > aUp) scoreText = `${currentMatch.team_b.name} ${bUp-aUp} Up`;
    else scoreText = 'All Square';
    scoreText += `  (Zbývá ${holesLeft})`;
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
            holeResults = data.holes;
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
