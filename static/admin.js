// --- Module state ---
let allPlayers = [];
let allMatches = [];
let matchFilterStatus = 'all';
let matchFilterFormat = 'all';
let playerFilterTeam = 'all';
let selectedPlayersA = [];
let selectedPlayersB = [];

// --- Players ---
async function fetchPlayers() {
    const res = await fetch('/api/player/list');
    if (!res.ok) return;
    const data = await res.json();
    allPlayers = data.players || [];
    renderPlayerFilterBar(allPlayers);
    renderPlayers(allPlayers);
}

function renderPlayerFilterBar(players) {
    const bar = document.getElementById('players-filter-bar');
    const btns = document.getElementById('players-filter-btns');
    const teams = [];
    const seen = new Set();
    players.forEach(p => {
        if (p.team_id && p.team_name && !seen.has(p.team_id)) {
            seen.add(p.team_id);
            teams.push({ id: p.team_id, name: p.team_name });
        }
    });
    if (teams.length === 0) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    btns.innerHTML = `<button class="filter-btn${playerFilterTeam === 'all' ? ' active' : ''}" onclick="setPlayerFilter('all')">All</button>` +
        teams.map(t => `<button class="filter-btn${playerFilterTeam == t.id ? ' active' : ''}" onclick="setPlayerFilter(${t.id})">${t.name}</button>`).join('');
}

function setPlayerFilter(teamId) {
    playerFilterTeam = teamId;
    renderPlayerFilterBar(allPlayers);
    renderPlayers(allPlayers);
}

function renderPlayers(players) {
    const filtered = playerFilterTeam === 'all' ? players : players.filter(p => p.team_id == playerFilterTeam);
    const ul = document.getElementById('players-list');
    ul.innerHTML = '';
    filtered.forEach(p => {
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
    await loadAllPlayers();
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
    await loadAllPlayers();
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
    allMatches = data.matches || [];
    applyMatchFilters();
}

function applyMatchFilters() {
    let filtered = allMatches;
    if (matchFilterStatus !== 'all') filtered = filtered.filter(m => m.status === matchFilterStatus);
    if (matchFilterFormat !== 'all') filtered = filtered.filter(m => m.format === matchFilterFormat);
    renderMatches(filtered);
}

window.setMatchFilter = function(type, value) {
    if (type === 'status') {
        matchFilterStatus = value;
        document.querySelectorAll('[data-filter-status]').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.filterStatus === value)
        );
    } else {
        matchFilterFormat = value;
        document.querySelectorAll('[data-filter-format]').forEach(btn =>
            btn.classList.toggle('active', btn.dataset.filterFormat === value)
        );
    }
    applyMatchFilters();
};

const FORMAT_LABEL = { singles: 'Singles', foursome: 'Foursome', texas_scramble: 'Texas Scramble' };
const STATUS_LABEL = { prepared: 'Prepared', running: 'Running', completed: 'Completed' };

function renderMatches(matches) {
    const container = document.getElementById('matches-list');
    container.innerHTML = '';
    if (matches.length === 0) {
        container.innerHTML = '<p style="color:#6b7280;text-align:center;padding:1.2rem 0;">No matches found.</p>';
        return;
    }
    matches.forEach(m => {
        const teamAPlayers = (m.team_a.players || []).map(p => `${p.name}${p.hcp != null ? ` (${p.hcp})` : ''}`).join(', ');
        const teamBPlayers = (m.team_b.players || []).map(p => `${p.name}${p.hcp != null ? ` (${p.hcp})` : ''}`).join(', ');
        const formatLabel = FORMAT_LABEL[m.format] || m.format;
        const statusLabel = STATUS_LABEL[m.status] || m.status;
        const metaParts = [];
        if (m.start_time) metaParts.push(m.start_time);
        metaParts.push(`Hole ${m.starting_hole || 1}`);
        const card = document.createElement('div');
        card.className = 'match-card';
        card.innerHTML = `
            <div class="match-card-header">
                <div class="match-badges">
                    <span class="match-badge format-${m.format}">${formatLabel}</span>
                    <span class="match-badge status-${m.status}">${statusLabel}</span>
                </div>
                <div class="match-meta">${metaParts.join(' · ')}</div>
            </div>
            <div class="match-teams">
                <div class="match-team">
                    <div class="match-team-name">${m.team_a?.name || ''}</div>
                    <div class="match-players">${teamAPlayers || '—'}</div>
                </div>
                <div class="match-vs">vs</div>
                <div class="match-team match-team-right">
                    <div class="match-team-name">${m.team_b?.name || ''}</div>
                    <div class="match-players">${teamBPlayers || '—'}</div>
                </div>
            </div>
            <div class="match-card-actions">
                <button class="edit" onclick="editMatch(${m.id})">Edit</button>
                <button class="danger" onclick="removeMatch(${m.id})">Remove</button>
                <button onclick="openScoreModal(${m.id}, '${m.team_a.name}', '${m.team_b.name}')">Enter Score</button>
            </div>
        `;
        container.appendChild(card);
    });
}

window.openScoreModal = async function(matchId, teamAName, teamBName) {
    document.getElementById('score-match-id').value = matchId;
    document.getElementById('score-team-a').innerHTML = `<label>${teamAName} Score <input type='number' step='0.1' id='score-a' required></label>`;
    document.getElementById('score-team-b').innerHTML = `<label>${teamBName} Score <input type='number' step='0.1' id='score-b' required></label>`;
    document.getElementById('score-modal').style.display = 'flex';
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

// --- Load all players for typeahead ---
async function loadAllPlayers() {
    const res = await fetch('/api/player/list');
    if (!res.ok) return;
    const data = await res.json();
    allPlayers = data.players || [];
}

// --- Template system ---
const TEMPLATE_KEY = 'ryder_match_templates';

function getTemplates() {
    try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || []; }
    catch { return []; }
}

function saveTemplate(tpl) {
    const templates = getTemplates();
    templates.push(tpl);
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
}

function deleteTemplate(id) {
    const templates = getTemplates().filter(t => t.id !== id);
    localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
}

window.applyTemplate = function(id) {
    const tpl = getTemplates().find(t => t.id === id);
    if (!tpl) return;
    document.getElementById('match-format').value = tpl.format;
    document.getElementById('match-holes').value = tpl.holes;
    document.getElementById('match-start-time').value = tpl.start_time || '';
    document.getElementById('match-starting-hole').value = tpl.starting_hole || 1;
    enforcePlayerCapacity();
};

window.deleteTemplateAndRefresh = function(id) {
    deleteTemplate(id);
    renderTemplateBar();
};

window.showTemplateSaveInput = function() {
    document.getElementById('template-name-input-wrap').style.display = '';
    document.getElementById('template-save-btn').style.display = 'none';
    document.getElementById('template-name-input').focus();
};

window.hideTemplateSaveInput = function() {
    document.getElementById('template-name-input-wrap').style.display = 'none';
    document.getElementById('template-save-btn').style.display = '';
    document.getElementById('template-name-input').value = '';
};

window.confirmSaveTemplate = function() {
    const name = document.getElementById('template-name-input').value.trim();
    if (!name) return;
    const tpl = {
        id: String(Date.now()),
        name,
        format: document.getElementById('match-format').value,
        holes: document.getElementById('match-holes').value,
        start_time: document.getElementById('match-start-time').value,
        starting_hole: parseInt(document.getElementById('match-starting-hole').value) || 1
    };
    saveTemplate(tpl);
    hideTemplateSaveInput();
    renderTemplateBar();
};

function renderTemplateBar() {
    const bar = document.getElementById('template-bar');
    const templates = getTemplates();
    let html = '<div class="template-pills">';
    templates.forEach(t => {
        html += `<span class="template-pill">` +
            `<button type="button" class="template-apply" onclick="applyTemplate('${t.id}')">${t.name}</button>` +
            `<button type="button" class="template-delete" onclick="deleteTemplateAndRefresh('${t.id}')">×</button>` +
            `</span>`;
    });
    html += '</div>';
    html += `<div class="template-save-row">` +
        `<button type="button" id="template-save-btn" onclick="showTemplateSaveInput()">+ Save as template</button>` +
        `<span id="template-name-input-wrap" style="display:none;">` +
        `<input type="text" id="template-name-input" placeholder="Template name">` +
        `<button type="button" onclick="confirmSaveTemplate()">Save</button>` +
        `<button type="button" onclick="hideTemplateSaveInput()">Cancel</button>` +
        `</span>` +
        `</div>`;
    bar.innerHTML = html;
}

// --- Typeahead ---
function getMaxPlayers() {
    const fmt = document.getElementById('match-format').value;
    return (fmt === 'foursome' || fmt === 'texas_scramble') ? 2 : 1;
}

function renderTags(side) {
    const selected = side === 'a' ? selectedPlayersA : selectedPlayersB;
    const container = document.getElementById(`tags-${side}`);
    container.innerHTML = '';
    selected.forEach(p => {
        const span = document.createElement('span');
        span.className = 'player-tag';
        span.innerHTML = `${p.name}<button type="button" class="tag-remove" data-id="${p.id}" data-side="${side}">×</button>`;
        span.querySelector('.tag-remove').addEventListener('click', function() {
            removeMatchPlayer(parseInt(this.dataset.id), this.dataset.side);
        });
        container.appendChild(span);
    });
}

function addPlayer(player, side) {
    const max = getMaxPlayers();
    const selected = side === 'a' ? selectedPlayersA : selectedPlayersB;
    const other = side === 'a' ? selectedPlayersB : selectedPlayersA;

    if (other.some(p => p.id === player.id)) {
        flashInput(`input-${side}`, 'Player already on other side');
        return;
    }
    if (selected.length >= max) {
        flashInput(`input-${side}`, `Max ${max} player${max > 1 ? 's' : ''} for this format`);
        return;
    }
    if (selected.some(p => p.id === player.id)) return;

    selected.push({ id: player.id, name: player.name, team_id: player.team_id });

    if (player.team_id) {
        document.getElementById(`match-team-${side}`).value = player.team_id;
        clearTeamWarning(side);
    } else {
        showTeamWarning(side);
    }

    renderTags(side);
}

function removeMatchPlayer(playerId, side) {
    if (side === 'a') {
        selectedPlayersA = selectedPlayersA.filter(p => p.id !== playerId);
    } else {
        selectedPlayersB = selectedPlayersB.filter(p => p.id !== playerId);
    }
    renderTags(side);
}

function enforcePlayerCapacity() {
    const max = getMaxPlayers();
    if (selectedPlayersA.length > max) {
        selectedPlayersA = selectedPlayersA.slice(0, max);
        renderTags('a');
    }
    if (selectedPlayersB.length > max) {
        selectedPlayersB = selectedPlayersB.slice(0, max);
        renderTags('b');
    }
}

function flashInput(inputId, msg) {
    const input = document.getElementById(inputId);
    const origBorder = input.style.borderColor;
    const origPlaceholder = input.placeholder;
    input.style.borderColor = '#e53e3e';
    input.placeholder = msg;
    setTimeout(() => {
        input.style.borderColor = origBorder;
        input.placeholder = origPlaceholder;
    }, 1500);
}

function showTeamWarning(side) {
    const warnId = `team-warning-${side}`;
    let warn = document.getElementById(warnId);
    if (!warn) {
        warn = document.createElement('div');
        warn.id = warnId;
        warn.className = 'team-warning';
        warn.textContent = 'Player has no team — set team manually';
        const select = document.getElementById(`match-team-${side}`);
        select.parentNode.insertBefore(warn, select.nextSibling);
    }
    warn.style.display = '';
}

function clearTeamWarning(side) {
    const warn = document.getElementById(`team-warning-${side}`);
    if (warn) warn.style.display = 'none';
}

function createTypeahead(inputId, dropdownId, tagsId, side) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    let highlightedIndex = -1;

    function getFiltered(query) {
        const q = query.toLowerCase().trim();
        const bothSelected = [...selectedPlayersA, ...selectedPlayersB];
        const teamId = parseInt(document.getElementById(`match-team-${side}`).value);
        return allPlayers.filter(p =>
            (!q || p.name.toLowerCase().includes(q)) &&
            !bothSelected.some(s => s.id === p.id) &&
            p.team_id === teamId
        ).slice(0, 20);
    }

    function renderDropdown(players) {
        dropdown.innerHTML = '';
        highlightedIndex = -1;
        if (players.length === 0) {
            dropdown.classList.add('hidden');
            return;
        }
        players.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p.team_name ? `${p.name} (${p.team_name})` : `${p.name} (no team)`;
            li.addEventListener('mousedown', e => {
                e.preventDefault();
                addPlayer(p, side);
                input.value = '';
                dropdown.classList.add('hidden');
            });
            dropdown.appendChild(li);
        });
        dropdown.classList.remove('hidden');
    }

    input.addEventListener('focus', () => {
        renderDropdown(getFiltered(input.value));
    });

    input.addEventListener('input', () => {
        renderDropdown(getFiltered(input.value));
    });

    input.addEventListener('keydown', e => {
        const items = dropdown.querySelectorAll('li');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
            items.forEach((li, i) => li.classList.toggle('highlighted', i === highlightedIndex));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, 0);
            items.forEach((li, i) => li.classList.toggle('highlighted', i === highlightedIndex));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const idx = highlightedIndex >= 0 ? highlightedIndex : 0;
            if (items[idx]) items[idx].dispatchEvent(new MouseEvent('mousedown'));
        } else if (e.key === 'Escape') {
            dropdown.classList.add('hidden');
        } else if (e.key === 'Backspace' && input.value === '') {
            const selected = side === 'a' ? selectedPlayersA : selectedPlayersB;
            if (selected.length > 0) {
                removeMatchPlayer(selected[selected.length - 1].id, side);
            }
        }
    });

    input.addEventListener('blur', () => {
        setTimeout(() => dropdown.classList.add('hidden'), 200);
    });
}

// --- Match format change ---
document.getElementById('match-format').onchange = function() {
    enforcePlayerCapacity();
};

// --- Populate match form (team dropdowns) ---
async function populateMatchForm() {
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
}

// --- Edit Match Handler ---
window.editMatch = async function(matchId) {
    const res = await fetch('/api/match/list');
    if (!res.ok) return;
    const data = await res.json();
    const match = (data.matches || []).find(m => m.id === matchId);
    if (!match) return;

    selectedPlayersA = [];
    selectedPlayersB = [];
    renderTags('a');
    renderTags('b');

    document.getElementById('match-id').value = match.id;
    document.getElementById('match-start-time').value = match.start_time || '';
    document.getElementById('match-starting-hole').value = match.starting_hole || 1;
    document.getElementById('match-format').value = match.format;
    document.getElementById('match-team-a').value = match.team_a.id;
    document.getElementById('match-team-b').value = match.team_b.id;
    document.getElementById('match-holes').value = match.holes || '18';

    (match.team_a.players || []).forEach(mp => {
        const full = allPlayers.find(p => p.id === mp.id) || { id: mp.id, name: mp.name, team_id: match.team_a.id };
        selectedPlayersA.push({ id: full.id, name: full.name, team_id: full.team_id });
    });
    (match.team_b.players || []).forEach(mp => {
        const full = allPlayers.find(p => p.id === mp.id) || { id: mp.id, name: mp.name, team_id: match.team_b.id };
        selectedPlayersB.push({ id: full.id, name: full.name, team_id: full.team_id });
    });
    renderTags('a');
    renderTags('b');

    document.querySelector('#match-form button[type="submit"]').textContent = 'Save Match';
};

// --- Match Form Submission ---
document.getElementById('match-form').onsubmit = async function(e) {
    e.preventDefault();
    if (selectedPlayersA.length === 0 || selectedPlayersB.length === 0) {
        alert('Select at least 1 player per side');
        return;
    }
    const format = document.getElementById('match-format').value;
    const holes = document.getElementById('match-holes').value;
    const teamA = parseInt(document.getElementById('match-team-a').value);
    const teamB = parseInt(document.getElementById('match-team-b').value);
    const playersA = selectedPlayersA.map(p => p.id);
    const playersB = selectedPlayersB.map(p => p.id);
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
    selectedPlayersA = [];
    selectedPlayersB = [];
    renderTags('a');
    renderTags('b');
    fetchMatches();
    populateMatchForm();
    document.querySelector('#match-form button[type="submit"]').textContent = 'Add Match';
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

window.onload = async function() {
    await loadAllPlayers();
    fetchPlayers();
    fetchTeams();
    fetchMatches();
    populateMatchForm();
    populatePlayerTeamSelect();
    renderTemplateBar();
    createTypeahead('input-a', 'dropdown-a', 'tags-a', 'a');
    createTypeahead('input-b', 'dropdown-b', 'tags-b', 'b');
    document.querySelector('#player-form button').textContent = 'Add Player';
    document.querySelector('#team-form button').textContent = 'Add Team';
    document.querySelector('#match-form button[type="submit"]').textContent = 'Add Match';
};

window.removeMatch = async function(matchId) {
    await fetch(`/api/match/remove?id=${matchId}`);
    fetchMatches();
};
