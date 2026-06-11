let ws = null;
let wsConnected = false;
let pingInterval = null;
let pongTimeout = null;

// Periodically check WebSocket connection and reconnect if needed

// Remove old interval check, use ping/pong instead
// Ryder Cup Dashboard

async function fetchDashboard() {
    const res = await fetch('/api/dashboard');
    const data = await res.json();
    renderMatches(data.matches || {});
}

function renderMatches(grouped) {
    renderMatchGroup('matches-running', grouped.running || [], 'Running');
    renderMatchGroup('matches-prepared', grouped.prepared || [], 'Prepared');
    renderBracket([].concat(grouped.completed || [], grouped.running || [], grouped.prepared || []));
}

function renderMatchGroup(listId, matches, label) {
    let ul = document.getElementById(listId);
    if (!ul) {
        // fallback for old dashboard.html
        ul = document.getElementById('match-list');
        if (!ul) return;
        ul.innerHTML = '';
        matches.forEach(m => {
            ul.innerHTML += matchRow(m);
        });
        return;
    }
    ul.innerHTML = '';
    let lastRound = null;
    let seenRound = false;
    matches.forEach(m => {
        const round = (m.round === null || m.round === undefined) ? null : m.round;
        if (round !== lastRound && (round !== null || seenRound)) {
            ul.innerHTML += `<li class="round-header">${round !== null ? 'Kolo ' + round : 'Ostatní zápasy'}</li>`;
        }
        if (round !== null) seenRound = true;
        lastRound = round;
        ul.innerHTML += matchRow(m);
    });
}

// --- Bracket tree (rounds are positioned purely from match.round + match.bracket_slot;
// slot i/i+1 in round N feed slot floor(i/2) in round N+1, the standard single-elim numbering) ---
function renderBracket(allMatches) {
    const section = document.getElementById('bracket-section');
    const container = document.getElementById('bracket-view');
    if (!section || !container) return;
    const bracketMatches = allMatches.filter(m =>
        m.round !== null && m.round !== undefined && m.bracket_slot !== null && m.bracket_slot !== undefined);
    if (bracketMatches.length === 0) {
        section.style.display = 'none';
        container.innerHTML = '';
        return;
    }
    section.style.display = '';
    // Full tree shape: rounds are consecutive integers starting at the lowest
    // round seen. The size of the whole tree (and thus how many rounds lead up
    // to the final) is inferred from how far each match's slot projects back to
    // round 0 — slot s in round (minRound+idx) implies at least (s+1)*2^idx
    // first-round slots, rounded up to the nearest power of two. Missing
    // matches (including entire not-yet-created rounds up to the final) render
    // as placeholder cells.
    const minRound = Math.min(...bracketMatches.map(m => m.round));
    let maxImplied = 1;
    bracketMatches.forEach(m => {
        const span = Math.pow(2, m.round - minRound);
        maxImplied = Math.max(maxImplied, (m.bracket_slot + 1) * span);
    });
    const firstRoundSize = Math.pow(2, Math.ceil(Math.log2(maxImplied)));
    const numRounds = Math.round(Math.log2(firstRoundSize)) + 1;
    const rounds = [];
    for (let i = 0; i < numRounds; i++) rounds.push(minRound + i);
    const maxRows = firstRoundSize;
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'bracket-grid';
    grid.style.gridTemplateColumns = `repeat(${numRounds}, minmax(270px, 1fr))`;
    grid.style.gridTemplateRows = `auto repeat(${maxRows}, minmax(36px, auto))`;
    rounds.forEach((r, idx) => {
        const span = Math.pow(2, idx);
        const slotCount = Math.pow(2, numRounds - 1 - idx);
        const label = document.createElement('div');
        label.className = 'bracket-round-label';
        label.style.gridColumn = idx + 1;
        label.style.gridRow = '1';
        label.textContent = `Kolo ${r}`;
        grid.appendChild(label);
        const existing = bracketMatches.filter(m => m.round === r);
        for (let slot = 0; slot < slotCount; slot++) {
            const m = existing.find(x => x.bracket_slot === slot);
            const cell = document.createElement('div');
            cell.className = 'bracket-match';
            cell.dataset.round = r;
            cell.dataset.slot = slot;
            cell.style.gridColumn = idx + 1;
            cell.style.gridRow = `${slot * span + 2} / span ${span}`;
            if (m) {
                cell.innerHTML = matchRow(m);
            } else {
                cell.classList.add('bracket-placeholder');
                cell.innerHTML = `<li class="bracket-placeholder-card"><span class="match-link">
                    <span class='match-players' style="text-align:center; width:100%; color:#aaa; font-style:italic;">TBD</span>
                </span></li>`;
            }
            grid.appendChild(cell);
        }
    });
    container.appendChild(grid);
    requestAnimationFrame(() => drawBracketConnectors(grid, rounds));
}

function drawBracketConnectors(grid, rounds) {
    grid.querySelectorAll('.bracket-connector').forEach(el => el.remove());
    const gridRect = grid.getBoundingClientRect();
    const addLine = (x1, y1, x2, y2) => {
        const line = document.createElement('div');
        line.className = 'bracket-connector';
        if (y1 === y2) {
            line.style.left = Math.min(x1, x2) + 'px';
            line.style.top = (y1 - 1) + 'px';
            line.style.width = Math.abs(x2 - x1) + 'px';
            line.style.height = '2px';
        } else {
            line.style.left = (x1 - 1) + 'px';
            line.style.top = Math.min(y1, y2) + 'px';
            line.style.width = '2px';
            line.style.height = Math.abs(y2 - y1) + 'px';
        }
        grid.appendChild(line);
    };
    for (let idx = 0; idx < rounds.length - 1; idx++) {
        const currentCells = grid.querySelectorAll(`[data-round="${rounds[idx]}"]`);
        currentCells.forEach(fromEl => {
            const slot = parseInt(fromEl.dataset.slot, 10);
            const parentSlot = Math.floor(slot / 2);
            const toEl = grid.querySelector(`[data-round="${rounds[idx + 1]}"][data-slot="${parentSlot}"]`);
            if (!toEl) return;
            const fromRect = fromEl.getBoundingClientRect();
            const toRect = toEl.getBoundingClientRect();
            const x1 = fromRect.right - gridRect.left;
            const y1 = fromRect.top + fromRect.height / 2 - gridRect.top;
            const x2 = toRect.left - gridRect.left;
            const y2 = toRect.top + toRect.height / 2 - gridRect.top;
            const midX = (x1 + x2) / 2;
            addLine(x1, y1, midX, y1);
            addLine(midX, y1, midX, y2);
            addLine(midX, y2, x2, y2);
        });
    }
}

function matchRow(m) {
    // Format player lists
    function playerList(players) {
        return (players || []).map(p => `<span style="white-space:nowrap">${p.name} (${p.hcp ?? ''})</span>`).join(', ');
    }
    const left = playerList(m.players_a);
    const right = playerList(m.players_b);
    const aWins = m.score_a !== undefined && m.score_b !== undefined && m.score_a > m.score_b;
    const bWins = m.score_a !== undefined && m.score_b !== undefined && m.score_b > m.score_a;
    const leftClass = aWins ? ' class="match-team-winner"' : '';
    const rightClass = bWins ? ' class="match-team-winner"' : '';
    let scoreHtml = '';
    let holesLeft = null;
    // Determine holes to play based on format and holeResults
    if (m.status === 'running' && m.holeResults && m.holes) {
        const startHole = m.starting_hole || 1;
        const holeCount = m.holes === '9' ? 9 : 18;
        let count = 0;
        for (let n = 0; n < holeCount; n++) {
            const idx = (startHole - 1 + n) % 18;
            if (!m.holeResults[idx]) count++;
        }
        holesLeft = count;
    }
    if ((m.status === 'completed' || m.status === 'running') && m.score_text) {
        const match = m.score_text.match(/^(.*?) (\d+ Up)$/);
        if (match) {
            scoreHtml = `<div class='score-value'>${match[2]}</div>`;
        } else if (m.score_text === 'A/S') {
            scoreHtml = `<div class='score-value'>A/S</div>`;
        } else {
            scoreHtml = `<div class='score-value'>${m.score_text}</div>`;
        }
        if (holesLeft !== null) {
            scoreHtml += `<div class='score-holes-left'>(Zbývá ${holesLeft})</div>`;
        }
    }
    console.log('Rendering match:', m);
    // Split players and score into columns for alignment
    let startTimeHtml = '';
    if (m.status === 'prepared') {
        let preparedInfo = '';
        if (m.start_time) preparedInfo += `<span style="display:block; font-size:1.1em; color:#1741a6; font-weight:600;">${m.start_time}</span>`;
        if (m.match_date) {
            const dp = m.match_date.split('-');
            const fmtDate = dp.length === 3 ? `${parseInt(dp[2])}.${parseInt(dp[1])}.${dp[0]}` : m.match_date;
            preparedInfo += `<span style="display:block; font-size:0.8em; color:#1741a6; font-weight:600;">${fmtDate}</span>`;
        }
        startTimeHtml = `<span class='match-start-time' style="text-align:center;">${preparedInfo}</span>`;
    } else {
        startTimeHtml = `<span class='match-score'>${scoreHtml}</span>`;
    }
    return `<li><span class="match-link" onclick="goToScore(${m.id})">
        <span class='match-players'><span${leftClass}>${left}</span><br><span${rightClass}>${right}</span></span>
        ${startTimeHtml}
    </span></li>`;
}

window.goToScore = function(matchId) {
    window.location.href = `/static/score.html?match=${matchId}`;
};


window.onload = function() {
    console.log('Dashboard loaded');
    fetchDashboard();
    setupWebSocket();
    window.onfocus = function() {
        if (!wsConnected) {
            console.log('Window focused: WebSocket not connected, reconnecting and fetching scores');
            setupWebSocket();
            fetchDashboard();
        }
    };
};

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
        fetchDashboard();
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
        if (e.data === 'update') fetchDashboard();
    };
}
