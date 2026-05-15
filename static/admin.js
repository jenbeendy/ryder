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
    document.getElementById('match-start-time').value = match.start_time || '';
    document.getElementById('match-starting-hole').value = match.starting_hole || 1;
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
async function fetchMatches() {
    const res = await fetch('/api/match/list');
    if (!res.ok) return;
    const data = await res.json();
    renderMatches(data.matches || []);
}

function renderMatches(matches) {
    const ul = document.getElementById('matches-list');
    ul.innerHTML = '';
    matches.forEach(m => {
        const teamAPlayers = (m.team_a.players || []).map(p => `${p.name} (HCP: ${p.hcp ?? ''})`).join(', ');
        const teamBPlayers = (m.team_b.players || []).map(p => `${p.name} (HCP: ${p.hcp ?? ''})`).join(', ');
        const li = document.createElement('li');
        li.innerHTML = `<span>${m.format.toUpperCase()} | Hole: ${m.starting_hole || 1} | ${m.team_a?.name || ''} [${teamAPlayers}] vs ${m.team_b?.name || ''} [${teamBPlayers}] | Status: ${m.status}</span>` +
            `<span class="actions">
                <button class="edit" onclick="editMatch(${m.id})">Edit</button>
                <button onclick="removeMatch(${m.id})">Remove</button>
                <button onclick="openScoreModal(${m.id}, '${m.team_a.name}', '${m.team_b.name}')">Enter Score</button>
            </span>`;
        ul.appendChild(li);
    });
}

window.openScoreModal = async function(matchId, teamAName, teamBName) {
    document.getElementById('score-match-id').value = matchId;
    document.getElementById('score-team-a').innerHTML = `<label>${teamAName} Score <input type='number' step='0.1' id='score-a' required></label>`;
    document.getElementById('score-team-b').innerHTML = `<label>${teamBName} Score <input type='number' step='0.1' id='score-b' required></label>`;
    document.getElementById('score-modal').style.display = 'flex';
    // Optionally fetch existing scores
    const res = await fetch(`/api/match/score?match_id=${matchId}`);
    if (res.ok) {
        const data = await res.json();
        if (data.scores) {
            if (data.scores.A !== undefined) document.getElementById('score-a').value = data.scores.A;
            if (data.scores.B !== undefined) document.getElementById('score-b').value = data.scores.B;
        }
    }
};

window.closeScoreModal = function() {
    document.getElementById('score-modal').style.display = 'none';
};

document.getElementById('score-form').onsubmit = async function(e) {
    e.preventDefault();
    const matchId = document.getElementById('score-match-id').value;
    const scoreA = parseFloat(document.getElementById('score-a').value);
    const scoreB = parseFloat(document.getElementById('score-b').value);
    await fetch('/api/match/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: parseInt(matchId), scores: { A: scoreA, B: scoreB } })
    });
    closeScoreModal();
    fetchMatches();
};

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
    const start_time = document.getElementById('match-start-time').value;
    const starting_hole = parseInt(document.getElementById('match-starting-hole').value) || 1;
    const id = document.getElementById('match-id').value;
    const url = id ? '/api/match/edit' : '/api/match/add';
    const payload = { format, holes, team_a: teamA, team_b: teamB, players_a: playersA, players_b: playersB, start_time, starting_hole };
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
    await fetch(`/api/match/remove?id=${matchId}`);
    fetchMatches();
};
