// Auto-scroll system for overflowing match lists
function setupAutoScroll() {
    ["matches-prepared", "matches-running", "matches-completed"].forEach(id => {
        const ul = document.getElementById(id);
        if (!ul) return;
        let scrollDir = 1;
        let scrollStep = 1;
        let scrollInterval = null;
        let lastScrollTop = null;
        let stillTimer = null;
        function startScroll() {
            if (ul.scrollHeight <= ul.clientHeight) return;
            if (scrollInterval) clearInterval(scrollInterval);
            scrollInterval = setInterval(() => {
                ul.scrollTop += scrollDir * scrollStep;
                const maxScroll = ul.scrollHeight - ul.clientHeight;
                if (ul.scrollTop >= maxScroll) {
                    ul.scrollTop = maxScroll;
                    scrollDir = -1;
                }
                if (ul.scrollTop <= 0) {
                    ul.scrollTop = 0;
                    scrollDir = 1;
                }
                // Check if stuck for 2 seconds
                if (lastScrollTop === ul.scrollTop) {
                    if (!stillTimer) {
                        stillTimer = setTimeout(() => {
                            scrollDir *= -1;
                            stillTimer = null;
                        }, 2000);
                    }
                } else {
                    if (stillTimer) {
                        clearTimeout(stillTimer);
                        stillTimer = null;
                    }
                }
                lastScrollTop = ul.scrollTop;
            }, 180);
        }
        function stopScroll() {
            if (scrollInterval) clearInterval(scrollInterval);
        }
        ul.addEventListener('mouseenter', stopScroll);
        ul.addEventListener('mouseleave', startScroll);
        startScroll();
        // Add resize event to restart scroll logic
        window.addEventListener('resize', () => {
            stopScroll();
            ul.scrollTop = 0;
            scrollDir = 1;
            startScroll();
        });
    });
}
let ws = null;
let wsConnected = false;
let pingInterval = null;
let pongTimeout = null;

// Ryder Cup Show Page JS
async function fetchShow() {
    const res = await fetch('/api/dashboard');
    const data = await res.json();
    renderShowTeamscore(data.teams || [], data.projectedScores || {});
    renderShowMatches(data.matches || {});
function renderShowTeamscore(teams, projectedScores) {
    const div = document.getElementById('show-teamscore');
        const leftDiv = document.getElementById('show-teamscore-left');
        const rightDiv = document.getElementById('show-teamscore-right');
        if (!leftDiv || !rightDiv) return;
        leftDiv.innerHTML = '';
        rightDiv.innerHTML = '';
        function getContrastYIQ(hexcolor) {
            hexcolor = hexcolor.replace('#','');
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
                projA = ` <span class="projected-score" style="color:${textColorA};">(${projectedScores[tA.id]})</span>`;
            }
            if (projectedScores && projectedScores[tB.id] !== undefined && projectedScores[tB.id] !== tB.score) {
                projB = ` <span class="projected-score" style="color:${textColorB};">(${projectedScores[tB.id]})</span>`;
            }
        leftDiv.style.background = tA.color;
        leftDiv.style.color = textColorA;
        leftDiv.innerHTML = `${tA.name}: <b>${tA.score}</b>${projA}`;
        rightDiv.style.background = tB.color;
        rightDiv.style.color = textColorB;
        rightDiv.innerHTML = `${tB.name}: <b>${tB.score}</b>${projB}`;
        }
}
}

function renderShowMatches(grouped) {
    // After update, re-enable auto-scroll for overflowing columns
    setTimeout(() => {
        ["matches-prepared", "matches-running", "matches-completed"].forEach(id => {
            const ul = document.getElementById(id);
            if (!ul || ul.parentElement.style.display === 'none') return;
            // Remove previous listeners to avoid duplicates
            ul.replaceWith(ul.cloneNode(true));
            const newUl = document.getElementById(id);
            // Enable auto-scroll only if overflowing
            if (newUl.scrollHeight > newUl.clientHeight) {
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
                        if (newUl.scrollTop >= maxScroll) {
                            newUl.scrollTop = maxScroll;
                            scrollDir = -1;
                        }
                        if (newUl.scrollTop <= 0) {
                            newUl.scrollTop = 0;
                            scrollDir = 1;
                        }
                        if (lastScrollTop === newUl.scrollTop) {
                            if (!stillTimer) {
                                stillTimer = setTimeout(() => {
                                    scrollDir *= -1;
                                    stillTimer = null;
                                }, 2000);
                            }
                        } else {
                            if (stillTimer) {
                                clearTimeout(stillTimer);
                                stillTimer = null;
                            }
                        }
                        lastScrollTop = newUl.scrollTop;
                    }, 40);
                }
                function stopScroll() {
                    if (scrollInterval) clearInterval(scrollInterval);
                }
                newUl.addEventListener('mouseenter', stopScroll);
                newUl.addEventListener('mouseleave', startScroll);
                startScroll();
                window.addEventListener('resize', () => {
                    stopScroll();
                    newUl.scrollTop = 0;
                    scrollDir = 1;
                    startScroll();
                });
            }
        });
    }, 0);
    // Count visible columns and update grid
    setTimeout(() => {
        const grid = document.querySelector('.matches-grid');
        if (!grid) return;
        const visibleSections = Array.from(grid.children).filter(sec => sec.style.display !== 'none');
        grid.style.gridTemplateColumns = `repeat(${visibleSections.length}, 1fr)`;
    }, 0);
    const groups = [
        { id: 'matches-prepared', arr: grouped.prepared || [] },
        { id: 'matches-running', arr: grouped.running || [] },
        { id: 'matches-completed', arr: grouped.completed || [] }
    ];
    groups.forEach(g => {
        renderShowMatchGroup(g.id, g.arr);
        const section = document.getElementById(g.id)?.parentElement;
        if (section) {
            if (g.arr.length === 0) {
                section.style.display = 'none';
            } else {
                section.style.display = '';
            }
        }
    });
}

function renderShowMatchGroup(listId, matches) {
    let ul = document.getElementById(listId);
    if (!ul) return;
    ul.innerHTML = '';
    matches.forEach(m => {
        ul.innerHTML += showMatchRow(m);
    });
}

function showMatchRow(m) {
    function playerList(players) {
        return (players || []).map(p => `${p.name}`).join('<br>');
    }
    const left = playerList(m.players_a);
    const right = playerList(m.players_b);
    let format = m.format ? m.format.charAt(0).toUpperCase() + m.format.slice(1).replace('_', ' ') : '';
    let scoreHtml = '';
    let holesLeft = null;
    if (m.status === 'running' && m.holeResults && m.holes) {
        let start = 0, end = 18;
        if (m.holes === 'front9') { start = 0; end = 9; }
        else if (m.holes === 'back9') { start = 9; end = 18; }
        let count = 0;
        for (let i = start; i < end; i++) {
            if (!m.holeResults[i]) count++;
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
        startTimeHtml = `<span class='match-start-time' style="display:block; font-size:1.1em; color:#2563eb; font-weight:600; margin-bottom:0.2em;;min-width:100px;text-align: right;">${m.start_time}</span>`;
    } else if (m.status === 'prepared') {
        startTimeHtml = `<span class='match-start-time' style="display:block; font-size:1.1em; color:#2563eb; font-weight:600; margin-bottom:0.2em;min-width:100px;text-align: right;"></span>`;
    } else {
        startTimeHtml = `<span class='match-score'>${scoreHtml}</span>`;
    }
    return `<li><span class="match-link">
        <span class='match-format'>${format}</span>
        <span class='match-players' style="display:flex; justify-content:space-between; gap:1.2em; min-width:0; width:100%; word-break:break-word;">
            <span style="display:block; text-align:left; min-width:0; max-width:48%; word-break:break-word;">${left}</span>
            <span style="display:block; text-align:right; min-width:0; max-width:48%; word-break:break-word;">${right}</span>
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
    setTimeout(setupAutoScroll, 500);
};

function setupShowWebSocket() {
    let wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let wsUrl = wsProto + '://' + window.location.host + '/ws';
    ws = new WebSocket(wsUrl);
    let reconnectTimeout = null;

    ws.onopen = function() {
        wsConnected = true;
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        fetchShow();
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(function() {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send('ping');
                if (pongTimeout) clearTimeout(pongTimeout);
                pongTimeout = setTimeout(function() {
                    ws.close();
                }, 4000);
            }
        }, 5000);
    };
    ws.onclose = function() {
        wsConnected = false;
        if (pingInterval) clearInterval(pingInterval);
        if (pongTimeout) clearTimeout(pongTimeout);
        reconnectTimeout = setTimeout(setupShowWebSocket, 500);
    };
    ws.onerror = function(e) {
        wsConnected = false;
    };
    ws.onmessage = function(e) {
        if (e.data === 'pong') {
            if (pongTimeout) clearTimeout(pongTimeout);
            return;
        }
        if (e.data === 'update') fetchShow();
    };
}
