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
    renderMatchGroup('matches-completed', grouped.completed || [], 'Completed');
    renderMatchGroup('matches-running', grouped.running || [], 'Running');
    renderMatchGroup('matches-prepared', grouped.prepared || [], 'Prepared');
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
    matches.forEach(m => {
        ul.innerHTML += matchRow(m);
    });
}

function matchRow(m) {
    // Format player lists
    function playerList(players) {
        return (players || []).map(p => `${p.name}(${p.hcp ?? ''})`).join(', ');
    }
    const left = playerList(m.players_a);
    const right = playerList(m.players_b);
    let format = m.format ? m.format.charAt(0).toUpperCase() + m.format.slice(1).replace('_', ' ') : '';
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
        // Split score_text into team and score if possible
        const match = m.score_text.match(/^(.*?) (\d+ Up)$/);
        if (match) {
            scoreHtml = `<div class='score-team'>${match[1]}</div><div class='score-value'>${match[2]}</div>`;
        } else if (m.score_text === 'A/S') {
            scoreHtml = `<div class='score-team'>All Square</div>`;
        } else {
            scoreHtml = `<div class='score-team'>${m.score_text}</div>`;
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
        if (m.match_date) preparedInfo += `<span style="display:block; font-size:0.85em; color:#555; font-weight:500;">${m.match_date}</span>`;
        if (m.start_time) preparedInfo += `<span style="display:block; font-size:1.1em; color:#2563eb; font-weight:600;">${m.start_time}</span>`;
        startTimeHtml = `<span class='match-start-time'>${preparedInfo}</span>`;
    } else {
        startTimeHtml = `<span class='match-score'>${scoreHtml}</span>`;
    }
    return `<li><span class="match-link" onclick="goToScore(${m.id})">
        <span class='match-format'>${format}</span>
        <span class='match-players'>${left}<br>${right}</span>
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
