// --- Edit Match Handler ---
window.editMatch = async function(matchId) {
    // Fetch match list and find the match by ID
    const res = await fetch('/api/match/list');
    if (!res.ok) return;
    const data = await res.json();
    const match = (data.matches || []).find(m => m.id === matchId);
    if (!match) return;
    // Populate form fields
    document.getElementById('match-id').value = match.id;
    document.getElementById('match-date').value = match.match_date || '';
    document.getElementById('match-start-time').value = match.start_time || '';
    document.getElementById('match-starting-hole').value = match.starting_hole || 1;
    document.getElementById('match-round').value = match.round ?? '';
    document.getElementById('match-bracket-slot').value = match.bracket_slot ?? '';
    document.getElementById('match-format').value = match.format;
    document.getElementById('match-team-a').value = match.team_a.id;
    document.getElementById('match-team-b').value = match.team_b.id;
    document.getElementById('match-holes').value = match.holes || '18';
    await updateMatchPlayersSelects();
    // Set selected players for each team
    const playersASelect = document.getElementById('match-players-a');
    const playersBSelect = document.getElementById('match-players-b');
    Array.from(playersASelect.options).forEach(opt => {
        opt.selected = (match.team_a.players || []).some(p => p.id === parseInt(opt.value));
    });
    Array.from(playersBSelect.options).forEach(opt => {
        opt.selected = (match.team_b.players || []).some(p => p.id === parseInt(opt.value));
    });
    document.querySelector('#match-form button').textContent = 'Save Match';
};
// Ryder Admin Panel JS

// --- Players ---
async function fetchPlayers() {
    const res = await fetch('/api/player/list');
    if (!res.ok) return;
    const data = await res.json();
    renderPlayers(data.players || []);
}

function renderPlayers(players) {
    const ul = document.getElementById('players-list');
    ul.innerHTML = '';
    players.forEach(p => {
        const hcp = p.hcp !== undefined && p.hcp !== null ? `, HCP: ${p.hcp}` : '';
        const team = p.team_name ? `, Team: ${p.team_name}` : '';
        const playerData = JSON.stringify({
            id: p.id,
            name: p.name || '',
            email: p.email || '',
            hcp: p.hcp !== undefined && p.hcp !== null ? p.hcp : '',
            team_id: p.team_id !== undefined && p.team_id !== null ? p.team_id : ''
        });
        const li = document.createElement('li');
        li.innerHTML = `<span>${p.name} (${p.email||''}${hcp}${team})</span>` +
            `<span class="actions">
                <button class="edit" data-player='${playerData.replace(/'/g, "&#39;")}' onclick="editPlayer(this)">Edit</button>
                <button onclick="removePlayer(${p.id})">Remove</button>
            </span>`;
        ul.appendChild(li);
    });
}

async function populatePlayerTeamSelect() {
    const res = await fetch('/api/team/list');
    const teams = (await res.json()).teams || [];
    const teamSel = document.getElementById('player-team');
    teamSel.innerHTML = '<option value="">(none)</option>';
    teams.forEach(t => {
        teamSel.innerHTML += `<option value="${t.id}">${t.name}</option>`;
    });
}

document.getElementById('player-form').onsubmit = async function(e) {
    e.preventDefault();
    const id = document.getElementById('player-id').value;
    const name = document.getElementById('player-name').value;
    const email = document.getElementById('player-email').value;
    const hcp = document.getElementById('player-hcp').value;
    const team_id = document.getElementById('player-team').value;
    const url = id ? '/api/player/edit' : '/api/player/add';
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id ? parseInt(id) : undefined, name, email, hcp: hcp ? parseFloat(hcp) : null, team_id: team_id ? parseInt(team_id) : null })
    });
    this.reset();
    document.querySelector('#player-form button').textContent = 'Add Player';
    fetchPlayers();
};

window.editPlayer = function(btn) {
    const data = btn.getAttribute('data-player');
    if (!data) return;
    const p = JSON.parse(data);
    document.getElementById('player-id').value = p.id;
    document.getElementById('player-name').value = p.name;
    document.getElementById('player-email').value = p.email;
    document.getElementById('player-hcp').value = p.hcp !== undefined && p.hcp !== null ? p.hcp : '';
    document.getElementById('player-team').value = p.team_id !== undefined && p.team_id !== null ? p.team_id : '';
    document.querySelector('#player-form button').textContent = 'Save Player';
};

window.removePlayer = async function(id) {
    await fetch(`/api/player/remove?id=${id}`);
    fetchPlayers();
};

// --- Teams ---
async function fetchTeams() {
    const res = await fetch('/api/team/list');
    if (!res.ok) return;
    const data = await res.json();
    renderTeams(data.teams || []);
}

function renderTeams(teams) {
    const ul = document.getElementById('teams-list');
    ul.innerHTML = '';
    teams.forEach(t => {
        const li = document.createElement('li');
        li.innerHTML = `<span><span style="display:inline-block;width:1em;height:1em;background:${t.color};border-radius:50%;margin-right:0.5em;"></span>${t.name}</span>` +
            `<span class="actions">
                <button class="edit" onclick="editTeam(${t.id}, '${t.name}', '${t.color}')">Edit</button>
                <button onclick="removeTeam(${t.id})">Remove</button>
            </span>`;
        ul.appendChild(li);
    });
}

document.getElementById('team-form').onsubmit = async function(e) {
    e.preventDefault();
    const id = document.getElementById('team-id').value;
    const name = document.getElementById('team-name').value;
    const color = document.getElementById('team-color').value;
    const url = id ? '/api/team/edit' : '/api/team/add';
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id ? parseInt(id) : undefined, name, color })
    });
    this.reset();
    document.querySelector('#team-form button').textContent = 'Add Team';
    fetchTeams();
};

window.editTeam = function(id, name, color) {
    document.getElementById('team-id').value = id;
    document.getElementById('team-name').value = name;
    document.getElementById('team-color').value = color || '#2563eb';
    document.querySelector('#team-form button').textContent = 'Save Team';
};

window.removeTeam = async function(id) {
    await fetch(`/api/team/remove?id=${id}`);
    fetchTeams();
};

// --- Matches ---
let allMatches = [];
let activeMatchFilter = 'all';
let activeLockFilter = 'all';

window.setMatchFilter = function(filter) {
    activeMatchFilter = filter;
    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.filter === filter)
    );
    renderMatches(allMatches);
};

window.setLockFilter = function(filter) {
    activeLockFilter = activeLockFilter === filter ? 'all' : filter;
    document.querySelectorAll('.filter-btn[data-lock]').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.lock === activeLockFilter)
    );
    renderMatches(allMatches);
};

async function fetchMatches() {
    const res = await fetch('/api/match/list');
    if (!res.ok) return;
    const data = await res.json();
    allMatches = data.matches || [];
    renderMatches(allMatches);
}

function renderMatches(matches) {
    const ul = document.getElementById('matches-list');
    ul.innerHTML = '';
    if (activeMatchFilter !== 'all') {
        matches = matches.filter(m => m.status === activeMatchFilter);
    }
    if (activeLockFilter === 'locked') {
        matches = matches.filter(m => m.locked);
    } else if (activeLockFilter === 'unlocked') {
        matches = matches.filter(m => !m.locked);
    }
    matches.forEach(m => {
        const fmtPlayer = p => `${p.name}${p.hcp != null ? ` (${p.hcp})` : ''}`;
        const teamAPlayers = (m.team_a.players || []).map(fmtPlayer).join(', ');
        const teamBPlayers = (m.team_b.players || []).map(fmtPlayer).join(', ');

        const when = [m.match_date, m.start_time].filter(Boolean).join(' · ');
        const roundStr = m.round != null
            ? `Round ${m.round}${m.bracket_slot != null ? `.${m.bracket_slot}` : ''}`
            : '';
        const metaParts = [when, roundStr].filter(Boolean);

        const statusClass = { prepared: 'badge-prepared', running: 'badge-running', completed: 'badge-completed' }[m.status] || 'badge-prepared';
        const lockLabel = m.locked ? 'Unlock' : 'Lock';
        const lockClass = m.locked ? 'btn-lock locked' : 'btn-lock';

        const li = document.createElement('li');
        li.className = 'match-card';
        li.innerHTML = `
            <div class="match-meta">
                <span class="match-badge ${statusClass}">${m.status}</span>
                ${m.locked ? '🔒 ' : ''}<strong>${m.format.replace('_', ' ').toUpperCase()}</strong> · ${m.holes} holes · Hole ${m.starting_hole || 1}${metaParts.length ? ' · ' + metaParts.join(' · ') : ''}
            </div>
            <div class="match-teams">${m.team_a?.name || ''} vs ${m.team_b?.name || ''}</div>
            <div class="match-players">
                ${teamAPlayers ? `<strong>${m.team_a?.name}:</strong> ${teamAPlayers}` : ''}
                ${teamAPlayers && teamBPlayers ? ' &nbsp;|&nbsp; ' : ''}
                ${teamBPlayers ? `<strong>${m.team_b?.name}:</strong> ${teamBPlayers}` : ''}
            </div>
            <div class="match-actions">
                <button class="edit" onclick="editMatch(${m.id})">Edit</button>

                <button class="${lockClass}" onclick="toggleLockMatch(${m.id}, ${!m.locked})">${lockLabel}</button>
                <button class="btn-reset" onclick="resetMatch(${m.id})">Reset</button>
                <button class="btn-danger" onclick="removeMatch(${m.id})">Remove</button>
            </div>`;
        ul.appendChild(li);
    });
}


// --- Update match player selects based on team selection ---
async function updateMatchPlayersSelects() {
    const teamA = document.getElementById('match-team-a').value;
    const teamB = document.getElementById('match-team-b').value;
    const [playersARes, playersBRes] = await Promise.all([
        fetch(`/api/team/players?team_id=${teamA}`),
        fetch(`/api/team/players?team_id=${teamB}`)
    ]);
    const playersA = (await playersARes.json()).players || [];
    const playersB = (await playersBRes.json()).players || [];
    const playersASelect = document.getElementById('match-players-a');
    const playersBSelect = document.getElementById('match-players-b');
    playersASelect.innerHTML = '';
    playersA.forEach(p => {
        playersASelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
    playersBSelect.innerHTML = '';
    playersB.forEach(p => {
        playersBSelect.innerHTML += `<option value="${p.id}">${p.name}</option>`;
    });
}

document.getElementById('match-team-a').onchange = updateMatchPlayersSelects;
document.getElementById('match-team-b').onchange = updateMatchPlayersSelects;
document.getElementById('match-format').onchange = function() {
    const format = this.value;
    const playersA = document.getElementById('match-players-a');
    const playersB = document.getElementById('match-players-b');
    if (format === 'foursome' || format === 'texas_scramble') {
        playersA.size = playersB.size = 2;
        playersA.setAttribute('multiple', 'multiple');
        playersB.setAttribute('multiple', 'multiple');
        playersA.onchange = function() {
            if (playersA.selectedOptions.length > 2) {
                this.options[this.selectedIndex].selected = false;
            }
        };
        playersB.onchange = function() {
            if (playersB.selectedOptions.length > 2) {
                this.options[this.selectedIndex].selected = false;
            }
        };
    } else {
        playersA.size = playersB.size = 4;
        playersA.onchange = null;
        playersB.onchange = null;
    }
};

// Fix: define populateMatchForm to avoid ReferenceError
async function populateMatchForm() {
    // Populate team selects for match creation
    const teamsRes = await fetch('/api/team/list');
    const teams = (await teamsRes.json()).teams || [];
    const teamA = document.getElementById('match-team-a');
    const teamB = document.getElementById('match-team-b');
    teamA.innerHTML = teamB.innerHTML = '';
    teams.forEach(t => {
        teamA.innerHTML += `<option value="${t.id}">${t.name}</option>`;
        teamB.innerHTML += `<option value="${t.id}">${t.name}</option>`;
    });
    if (teams.length > 1) teamB.selectedIndex = 1;
    await updateMatchPlayersSelects();
}


// --- Match Form Submission ---
document.getElementById('match-form').onsubmit = async function(e) {
    e.preventDefault();
    const format = document.getElementById('match-format').value;
    const holes = document.getElementById('match-holes').value;
    const teamA = parseInt(document.getElementById('match-team-a').value);
    const teamB = parseInt(document.getElementById('match-team-b').value);
    const playersA = Array.from(document.getElementById('match-players-a').selectedOptions).map(opt => parseInt(opt.value));
    const playersB = Array.from(document.getElementById('match-players-b').selectedOptions).map(opt => parseInt(opt.value));
    const match_date = document.getElementById('match-date').value;
    const start_time = document.getElementById('match-start-time').value;
    const starting_hole = parseInt(document.getElementById('match-starting-hole').value) || 1;
    const roundRaw = document.getElementById('match-round').value;
    const slotRaw = document.getElementById('match-bracket-slot').value;
    const round = roundRaw === '' ? null : parseInt(roundRaw);
    const bracket_slot = slotRaw === '' ? null : parseInt(slotRaw);
    const id = document.getElementById('match-id').value;
    const url = id ? '/api/match/edit' : '/api/match/add';
    const payload = { format, holes, team_a: teamA, team_b: teamB, players_a: playersA, players_b: playersB, start_time, starting_hole, match_date, round, bracket_slot };
    if (id) payload.id = parseInt(id);
    await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    this.reset();
    fetchMatches();
    populateMatchForm();
    updateMatchPlayersSelects();
    document.querySelector('#match-form button').textContent = 'Add Match';
    document.getElementById('match-id').value = '';
};

// --- Round Dates ---
window.fetchRoundDates = async function() {
    const [matchesRes, rdRes] = await Promise.all([
        fetch('/api/match/list'),
        fetch('/api/round-dates/list')
    ]);
    const matchData = await matchesRes.json();
    const rdData = await rdRes.json();
    const fromMatches = new Set(
        (matchData.matches || []).filter(m => m.round != null).map(m => m.round)
    );
    const rdMap = {};
    (rdData.round_dates || []).forEach(rd => {
        rdMap[rd.round] = rd;
        fromMatches.add(rd.round);
    });
    const rounds = [...fromMatches].sort((a, b) => a - b);
    renderRoundDates(rounds, rdMap);
};

function renderRoundDates(rounds, rdMap) {
    const container = document.getElementById('rounds-dates-list');
    container.innerHTML = '';
    // Form to add a new round
    const addDiv = document.createElement('div');
    addDiv.style.cssText = 'margin-bottom:1.2rem;padding:0.75rem 1rem;background:#e8f0fe;border-radius:8px;';
    addDiv.innerHTML = `
        <strong>Přidat kolo</strong>
        <div style="display:flex;gap:1rem;align-items:center;margin-top:0.4rem;flex-wrap:wrap;">
            <label style="margin:0;display:flex;align-items:center;gap:0.3rem;">Kolo:
                <input type="number" id="rd-new-round" min="1" placeholder="č." style="width:4em;margin:0;padding:0.3rem;">
            </label>
            <label style="margin:0;display:flex;align-items:center;gap:0.3rem;">Od:
                <input type="date" id="rd-new-from" style="width:auto;margin:0;padding:0.3rem;">
            </label>
            <label style="margin:0;display:flex;align-items:center;gap:0.3rem;">Do:
                <input type="date" id="rd-new-to" style="width:auto;margin:0;padding:0.3rem;">
            </label>
            <button onclick="addNewRoundDate()" style="margin:0;padding:0.3rem 1rem;font-size:0.9rem;">Přidat</button>
        </div>`;
    container.appendChild(addDiv);
    rounds.forEach(r => {
        const rd = rdMap[r] || {};
        const div = document.createElement('div');
        div.style.cssText = 'margin-bottom:1rem;padding:0.75rem 1rem;background:#f3f7ff;border-radius:8px;';
        div.innerHTML = `
            <strong>Kolo ${r}</strong>
            <div style="display:flex;gap:1rem;align-items:center;margin-top:0.4rem;flex-wrap:wrap;">
                <label style="margin:0;display:flex;align-items:center;gap:0.3rem;">Od:
                    <input type="date" id="rd-from-${r}" value="${rd.date_from || ''}" style="width:auto;margin:0;padding:0.3rem;">
                </label>
                <label style="margin:0;display:flex;align-items:center;gap:0.3rem;">Do:
                    <input type="date" id="rd-to-${r}" value="${rd.date_to || ''}" style="width:auto;margin:0;padding:0.3rem;">
                </label>
                <button onclick="saveRoundDate(${r})" style="margin:0;padding:0.3rem 1rem;font-size:0.9rem;">Uložit</button>
            </div>`;
        container.appendChild(div);
    });
}

window.addNewRoundDate = async function() {
    const roundVal = document.getElementById('rd-new-round').value;
    if (!roundVal) return;
    const round = parseInt(roundVal);
    const dateFrom = document.getElementById('rd-new-from').value;
    const dateTo = document.getElementById('rd-new-to').value;
    await fetch('/api/round-dates/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round, date_from: dateFrom, date_to: dateTo })
    });
    fetchRoundDates();
};

window.saveRoundDate = async function(round) {
    const dateFrom = document.getElementById(`rd-from-${round}`).value;
    const dateTo = document.getElementById(`rd-to-${round}`).value;
    await fetch('/api/round-dates/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ round, date_from: dateFrom, date_to: dateTo })
    });
    fetchRoundDates();
};

window.showTab = function(tabId) {
    document.querySelectorAll('.tab-btn').forEach(t =>
        t.classList.toggle('active', t.dataset.tab === tabId)
    );
    document.querySelectorAll('.section').forEach(s =>
        s.classList.toggle('active', s.id === tabId)
    );
};

window.onload = function() {
    fetchPlayers();
    fetchTeams();
    fetchMatches();
    populateMatchForm();
    populatePlayerTeamSelect();
    document.querySelector('#player-form button').textContent = 'Add Player';
    document.querySelector('#team-form button').textContent = 'Add Team';
    document.querySelector('#match-form button').textContent = 'Add Match';
};

window.removeMatch = async function(matchId) {
    if (!confirm('Remove this match? This cannot be undone.')) return;
    await fetch(`/api/match/remove?id=${matchId}`);
    fetchMatches();
};

window.resetMatch = async function(matchId) {
    if (!confirm('Reset match? This will delete all scores and set status to prepared.')) return;
    await fetch('/api/match/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId })
    });
    fetchMatches();
};

window.toggleLockMatch = async function(matchId, locked) {
    await fetch('/api/match/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, locked })
    });
    fetchMatches();
};
