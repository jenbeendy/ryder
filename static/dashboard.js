let ws = null;
let wsConnected = false;
let pingInterval = null;
let pongTimeout = null;
let selectedRound = null;
let lastDashboardData = null;

// Periodically check WebSocket connection and reconnect if needed

// Remove old interval check, use ping/pong instead
// Ryder Cup Dashboard

async function fetchDashboard() {
    const [dashRes, settingsRes] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/settings'),
    ]);
    const data = await dashRes.json();
    const settings = settingsRes.ok ? await settingsRes.json() : {};
    lastDashboardData = { data, settings };
    const availableRounds = data.available_rounds || [];
    if (availableRounds.length > 0) {
        const maxRound = availableRounds[availableRounds.length - 1];
        if (selectedRound === null || !availableRounds.includes(selectedRound)) {
            selectedRound = maxRound;
        }
    }
    renderRoundSelector(availableRounds);
    renderTeams(data.teams || [], data.projectedScores || {});
    renderMatches(data.matches || {}, settings);
}

function renderRoundSelector(availableRounds) {
    const div = document.getElementById('round-selector');
    if (!div) return;
    if (availableRounds.length <= 1) {
        div.innerHTML = '';
        return;
    }
    div.innerHTML = availableRounds.map(r =>
        `<button onclick="selectRound(${r})" style="padding:0.3rem 0.9rem;border-radius:8px;border:2px solid #1741a6;background:${r === selectedRound ? '#1741a6' : '#fff'};color:${r === selectedRound ? '#fff' : '#1741a6'};font-weight:600;cursor:pointer;">${r + 1}. Kolo</button>`
    ).join('');
}

window.selectRound = function(r) {
    selectedRound = r;
    if (lastDashboardData) {
        renderRoundSelector(lastDashboardData.data.available_rounds || []);
        renderTeams(lastDashboardData.data.teams || [], lastDashboardData.data.projectedScores || {});
        renderMatches(lastDashboardData.data.matches || {}, lastDashboardData.settings);
    }
};

function renderTeams(teams, projectedScores) {
    const div = document.getElementById('teams');
    div.innerHTML = '';
    console.log('Rendering teams:', teams, projectedScores);
    
    function getContrastYIQ(hexcolor) {
        hexcolor = hexcolor.replace('#','');
        if (hexcolor.length === 3) hexcolor = hexcolor[0]+hexcolor[0]+hexcolor[1]+hexcolor[1]+hexcolor[2]+hexcolor[2];
        var r = parseInt(hexcolor.substr(0,2),16);
        var g = parseInt(hexcolor.substr(2,2),16);
        var b = parseInt(hexcolor.substr(4,2),16);
        var yiq = ((r*299)+(g*587)+(b*114))/1000;
        return (yiq >= 180) ? '#000' : '#fff';
    }
    teams.forEach(t => {
        const textColor = getContrastYIQ(t.color);
        let proj = '';
        if (projectedScores && projectedScores[t.id] !== undefined && projectedScores[t.id] !== t.score) {
            proj = ` <span class="projected-score" style="color:${textColor};">(${projectedScores[t.id]})</span>`;
        }
        div.innerHTML += `<div class="team" style="background:${t.color};color:${textColor};"><span class="team-name">${t.name}</span><b class="team-score">${t.score}${proj}</b></div>`;
    });
}

function renderMatches(grouped, settings) {
    function isVisible(m) {
        const roundKey = `visibility_round_${m.round}_${m.format}`;
        const globalKey = `visibility_${m.format}`;
        const effective = settings[roundKey] !== undefined ? settings[roundKey] : settings[globalKey];
        return effective !== 'false';
    }
    function visibleFilter(matches) {
        return (matches || []).filter(m =>
            isVisible(m) &&
            (selectedRound === null || m.round === selectedRound)
        );
    }
    renderMatchGroup('matches-completed', visibleFilter(grouped.completed), 'Completed');
    renderMatchGroup('matches-running', visibleFilter(grouped.running), 'Running');
    renderMatchGroup('matches-prepared', visibleFilter(grouped.prepared), 'Prepared');
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
    if (m.status === 'prepared' && m.start_time && m.format !== 'foursome') {
        startTimeHtml = `<span class='match-start-time' style="display:block; font-size:1.1em; color:#1741a6; font-weight:600; margin-bottom:0.2em;">${m.start_time}</span>`;
    }else {
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
