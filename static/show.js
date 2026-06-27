let ws = null;
let wsConnected = false;
let pingInterval = null;
let pongTimeout = null;

async function fetchShow() {
    const [dashRes, settingsRes] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/settings'),
    ]);
    const data = await dashRes.json();
    const settings = settingsRes.ok ? await settingsRes.json() : {};
    const availableRounds = data.available_rounds || [];
    const latestRound = availableRounds.length > 0 ? availableRounds[availableRounds.length - 1] : null;
    renderShowTeamscore(data.teams || [], data.projectedScores || {});
    renderShowMatches(data.matches || {}, settings, latestRound);
}

function renderShowTeamscore(teams, projectedScores) {
    const leftDiv = document.getElementById('show-teamscore-left');
    const rightDiv = document.getElementById('show-teamscore-right');
    if (!leftDiv || !rightDiv) return;
    leftDiv.innerHTML = '';
    rightDiv.innerHTML = '';

    function getContrastYIQ(hexcolor) {
        hexcolor = hexcolor.replace('#', '');
        if (hexcolor.length === 3) hexcolor = hexcolor[0]+hexcolor[0]+hexcolor[1]+hexcolor[1]+hexcolor[2]+hexcolor[2];
        var r = parseInt(hexcolor.substr(0,2),16);
        var g = parseInt(hexcolor.substr(2,2),16);
        var b = parseInt(hexcolor.substr(4,2),16);
        var yiq = ((r*299)+(g*587)+(b*114))/1000;
        return (yiq >= 180) ? '#000' : '#fff';
    }

    if (teams.length >= 2) {
        const tA = teams[0];
        const tB = teams[1];
        const textColorA = getContrastYIQ(tA.color);
        const textColorB = getContrastYIQ(tB.color);
        let projA = '';
        let projB = '';
        if (projectedScores && projectedScores[tA.id] !== undefined && projectedScores[tA.id] !== tA.score) {
            projA = `<span class="projected-score" style="color:${textColorA};">(${projectedScores[tA.id]})</span>`;
        }
        if (projectedScores && projectedScores[tB.id] !== undefined && projectedScores[tB.id] !== tB.score) {
            projB = `<span class="projected-score" style="color:${textColorB};">(${projectedScores[tB.id]})</span>`;
        }
        leftDiv.style.background = tA.color;
        leftDiv.style.color = textColorA;
        leftDiv.innerHTML = `<span class="team-name">${tA.name}</span><b class="team-score">${tA.score}${projA}</b>`;
        rightDiv.style.background = tB.color;
        rightDiv.style.color = textColorB;
        rightDiv.innerHTML = `<span class="team-name">${tB.name}</span><b class="team-score">${tB.score}${projB}</b>`;
    }
}

function renderShowMatches(grouped, settings, latestRound) {
    function isVisible(m) {
        const roundKey = `visibility_round_${m.round}_${m.format}`;
        const globalKey = `visibility_${m.format}`;
        const effective = settings[roundKey] !== undefined ? settings[roundKey] : settings[globalKey];
        return effective !== 'false';
    }
    function visibleFilter(matches) {
        return (matches || []).filter(m =>
            isVisible(m) && (latestRound === null || m.round === latestRound)
        );
    }

    const groups = [
        { id: 'matches-prepared', arr: visibleFilter(grouped.prepared) },
        { id: 'matches-running', arr: visibleFilter(grouped.running) },
        { id: 'matches-completed', arr: visibleFilter(grouped.completed) },
    ];
    groups.forEach(g => {
        renderShowMatchGroup(g.id, g.arr);
        const section = document.getElementById(g.id)?.parentElement;
        if (section) {
            section.style.display = g.arr.length === 0 ? 'none' : '';
        }
    });

    setTimeout(() => {
        const grid = document.querySelector('.matches-grid');
        if (!grid) return;
        const visibleSections = Array.from(grid.children).filter(sec => sec.style.display !== 'none');
        grid.style.gridTemplateColumns = `repeat(${visibleSections.length}, 1fr)`;
    }, 0);

    setTimeout(() => {
        ["matches-prepared", "matches-running", "matches-completed"].forEach(id => {
            const ul = document.getElementById(id);
            if (!ul || ul.parentElement.style.display === 'none') return;
            ul.replaceWith(ul.cloneNode(true));
            const newUl = document.getElementById(id);
            if (newUl.scrollHeight <= newUl.clientHeight) return;
            let scrollDir = 1;
            let scrollStep = 0.5;
            let scrollInterval = null;
            let lastScrollTop = null;
            let stillTimer = null;
            function startScroll() {
                if (newUl.scrollHeight <= newUl.clientHeight) return;
                if (scrollInterval) clearInterval(scrollInterval);
                scrollInterval = setInterval(() => {
                    newUl.scrollTop += scrollDir * scrollStep;
                    const maxScroll = newUl.scrollHeight - newUl.clientHeight;
                    if (newUl.scrollTop >= maxScroll) { newUl.scrollTop = maxScroll; scrollDir = -1; }
                    if (newUl.scrollTop <= 0) { newUl.scrollTop = 0; scrollDir = 1; }
                    if (lastScrollTop === newUl.scrollTop) {
                        if (!stillTimer) stillTimer = setTimeout(() => { scrollDir *= -1; stillTimer = null; }, 2000);
                    } else {
                        if (stillTimer) { clearTimeout(stillTimer); stillTimer = null; }
                    }
                    lastScrollTop = newUl.scrollTop;
                }, 40);
            }
            function stopScroll() { if (scrollInterval) clearInterval(scrollInterval); }
            newUl.addEventListener('mouseenter', stopScroll);
            newUl.addEventListener('mouseleave', startScroll);
            startScroll();
            window.addEventListener('resize', () => { stopScroll(); newUl.scrollTop = 0; scrollDir = 1; startScroll(); });
        });
    }, 0);
}

function renderShowMatchGroup(listId, matches) {
    const ul = document.getElementById(listId);
    if (!ul) return;
    ul.innerHTML = '';
    matches.forEach(m => { ul.innerHTML += showMatchRow(m); });
}

function showMatchRow(m) {
    function playerList(players) {
        return (players || []).map(p => p.name).join('<br>');
    }
    const left = playerList(m.players_a);
    const right = playerList(m.players_b);
    let format = m.format ? m.format.charAt(0).toUpperCase() + m.format.slice(1).replace('_', ' ') : '';
    let scoreHtml = '';
    let holesLeft = null;
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
    let startTimeHtml = '';
    if (m.status === 'prepared' && m.start_time) {
        startTimeHtml = `<span class='match-start-time' style="display:block;font-size:1.1em;color:#2563eb;font-weight:600;min-width:100px;text-align:right;">${m.start_time}</span>`;
    } else {
        startTimeHtml = `<span class='match-score'>${scoreHtml}</span>`;
    }
    return `<li><span class="match-link">
        <span class='match-format'>${format}</span>
        <span class='match-players' style="display:flex;justify-content:space-between;gap:1.2em;min-width:0;width:100%;word-break:break-word;">
            <span style="display:block;text-align:left;min-width:0;max-width:48%;word-break:break-word;">${left}</span>
            <span style="display:block;text-align:right;min-width:0;max-width:48%;word-break:break-word;">${right}</span>
        </span>
        ${startTimeHtml}
    </span></li>`;
}

window.onload = function() {
    fetchShow();
    setupShowWebSocket();
    window.onfocus = function() {
        if (!wsConnected) {
            setupShowWebSocket();
            fetchShow();
        }
    };
};

function setupShowWebSocket() {
    let wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let wsUrl = wsProto + '://' + window.location.host + '/ws';
    ws = new WebSocket(wsUrl);
    let reconnectTimeout = null;

    ws.onopen = function() {
        wsConnected = true;
        if (reconnectTimeout) { clearTimeout(reconnectTimeout); reconnectTimeout = null; }
        fetchShow();
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(function() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
                if (pongTimeout) clearTimeout(pongTimeout);
                pongTimeout = setTimeout(function() { ws.close(); }, 4000);
            }
        }, 5000);
    };
    ws.onclose = function() {
        wsConnected = false;
        if (pingInterval) clearInterval(pingInterval);
        if (pongTimeout) clearTimeout(pongTimeout);
        reconnectTimeout = setTimeout(setupShowWebSocket, 500);
    };
    ws.onerror = function() { wsConnected = false; };
    ws.onmessage = function(e) {
        if (e.data === 'pong') { if (pongTimeout) clearTimeout(pongTimeout); return; }
        if (e.data === 'update') fetchShow();
    };
}
