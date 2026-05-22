package backend

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"
)

type Player struct {
	ID       int      `json:"id"`
	Name     string   `json:"name"`
	Email    string   `json:"email"`
	HCP      *float64 `json:"hcp,omitempty"`
	TeamID   *int     `json:"team_id,omitempty"`
	TeamName string   `json:"team_name,omitempty"`
}

type Team struct {
	ID      int      `json:"id"`
	Name    string   `json:"name"`
	Color   string   `json:"color"`
	Players []Player `json:"players,omitempty"`
}

type MatchFormat string

const (
	Singles       MatchFormat = "singles"
	TexasScramble MatchFormat = "texas_scramble"
	Foursome      MatchFormat = "foursome"
)

type Match struct {
	ID        int         `json:"id"`
	TeamA     *Team       `json:"team_a"`
	TeamB     *Team       `json:"team_b"`
	Format    MatchFormat `json:"format"`
	Status    string      `json:"status"` // prepared, running, completed
	StartTime string      `json:"start_time"`
	PlayersA  []Player    `json:"players_a"`
	PlayersB  []Player    `json:"players_b"`
}

type Score struct {
	ID       int `json:"id"`
	MatchID  int `json:"match_id"`
	PlayerID int `json:"player_id"`
	Hole     int `json:"hole"`
	Strokes  int `json:"strokes"`
}

// DB is a global variable for the SQLite connection (to be initialized elsewhere)
var DB *sql.DB

// --- Assign Multiple Players to Team ---
func AssignPlayersToTeam(w http.ResponseWriter, r *http.Request) {
	type req struct {
		TeamID    int   `json:"team_id"`
		PlayerIDs []int `json:"player_ids"`
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// Remove all current assignments for this team
	if _, err := DB.Exec("DELETE FROM team_players WHERE team_id=?", body.TeamID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Add new assignments
	for _, pid := range body.PlayerIDs {
		if _, err := DB.Exec("INSERT INTO team_players (team_id, player_id) VALUES (?, ?)", body.TeamID, pid); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- List Players by Team ---
func ListPlayersByTeam(w http.ResponseWriter, r *http.Request) {
	teamID := r.URL.Query().Get("team_id")
	rows, err := DB.Query("SELECT p.id, p.name, p.email FROM players p JOIN team_players tp ON p.id=tp.player_id WHERE tp.team_id=? ORDER BY p.name", teamID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() { _ = rows.Close() }()
	var players []Player
	for rows.Next() {
		var p Player
		if err := rows.Scan(&p.ID, &p.Name, &p.Email); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		players = append(players, p)
	}
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"players": players}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// --- Match List Handler ---
func ListMatches(w http.ResponseWriter, r *http.Request) {
	type MatchPlayer struct {
		ID   int     `json:"id"`
		Name string  `json:"name"`
		HCP  float64 `json:"hcp"`
	}
	type Match struct {
		ID           int    `json:"id"`
		Format       string `json:"format"`
		Holes        string `json:"holes"`
		Status       string `json:"status"`
		StartTime    string `json:"start_time"`
		StartingHole int    `json:"starting_hole"`
		TeamA        struct {
			ID      int           `json:"id"`
			Name    string        `json:"name"`
			Color   string        `json:"color"`
			Players []MatchPlayer `json:"players"`
		} `json:"team_a"`
		TeamB struct {
			ID      int           `json:"id"`
			Name    string        `json:"name"`
			Color   string        `json:"color"`
			Players []MatchPlayer `json:"players"`
		} `json:"team_b"`
	}
	rows, err := DB.Query(`SELECT m.id, m.format, m.holes, m.status, m.start_time, m.starting_hole, ta.id, ta.name, ta.color, tb.id, tb.name, tb.color FROM matches m JOIN teams ta ON m.team_a_id=ta.id JOIN teams tb ON m.team_b_id=tb.id`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	matches := []Match{}
	for rows.Next() {
		var m Match
		var taID, tbID int
		var taName, tbName string
		var tbColor, taColor string
		var startTime string
		if err := rows.Scan(&m.ID, &m.Format, &m.Holes, &m.Status, &startTime, &m.StartingHole, &taID, &taName, &taColor, &tbID, &tbName, &tbColor); err != nil {
			continue
		}
		m.TeamA.ID, m.TeamA.Name, m.TeamA.Color = taID, taName, taColor
		m.TeamB.ID, m.TeamB.Name, m.TeamB.Color = tbID, tbName, tbColor
		m.StartTime = startTime
		// Fetch players for each team in this match
		paRows, _ := DB.Query(`SELECT p.id, p.name, p.hcp FROM match_players mp JOIN players p ON mp.player_id=p.id WHERE mp.match_id=? AND mp.team_side='A'`, m.ID)
		for paRows.Next() {
			var p MatchPlayer
			paRows.Scan(&p.ID, &p.Name, &p.HCP)
			m.TeamA.Players = append(m.TeamA.Players, p)
		}
		paRows.Close()
		pbRows, _ := DB.Query(`SELECT p.id, p.name, p.hcp FROM match_players mp JOIN players p ON mp.player_id=p.id WHERE mp.match_id=? AND mp.team_side='B'`, m.ID)
		for pbRows.Next() {
			var p MatchPlayer
			pbRows.Scan(&p.ID, &p.Name, &p.HCP)
			m.TeamB.Players = append(m.TeamB.Players, p)
		}
		pbRows.Close()
		matches = append(matches, m)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"matches": matches})
}

// --- Player List Handler ---
func ListPlayers(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query(`SELECT p.id, p.name, p.email, p.hcp, tp.team_id, t.name
		FROM players p
		LEFT JOIN team_players tp ON p.id = tp.player_id
		LEFT JOIN teams t ON tp.team_id = t.id
		ORDER BY p.hcp ASC, p.name ASC`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() {
		if err := rows.Close(); err != nil {
			fmt.Println("error closing rows:", err)
		}
	}()
	var players []Player
	for rows.Next() {
		var p Player
		var hcp sql.NullFloat64
		var teamID sql.NullInt64
		var teamName sql.NullString
		if err := rows.Scan(&p.ID, &p.Name, &p.Email, &hcp, &teamID, &teamName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if hcp.Valid {
			p.HCP = &hcp.Float64
		}
		if teamID.Valid {
			tid := int(teamID.Int64)
			p.TeamID = &tid
		}
		if teamName.Valid {
			p.TeamName = teamName.String
		}
		players = append(players, p)
	}
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"players": players}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// --- Team List Handler ---
func ListTeams(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query("SELECT id, name, color FROM teams ORDER BY name")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() {
		if err := rows.Close(); err != nil {
			fmt.Println("error closing rows:", err)
		}
	}()
	var teams []Team
	for rows.Next() {
		var t Team
		if err := rows.Scan(&t.ID, &t.Name, &t.Color); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		teams = append(teams, t)
	}
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"teams": teams}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// --- Team Edit/Remove Handlers ---
func EditTeam(w http.ResponseWriter, r *http.Request) {
	var t Team
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_, err := DB.Exec("UPDATE teams SET name=?, color=? WHERE id=?", t.Name, t.Color, t.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if err := json.NewEncoder(w).Encode(t); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func RemoveTeam(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, _ := strconv.Atoi(idStr)
	_, err := DB.Exec("DELETE FROM teams WHERE id=?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Player Handlers ---
func AddPlayer(w http.ResponseWriter, r *http.Request) {
	var p Player
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := DB.Exec("INSERT INTO players (name, email, hcp) VALUES (?, ?, ?)", p.Name, p.Email, p.HCP)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	id, _ := res.LastInsertId()
	p.ID = int(id)
	if p.TeamID != nil {
		_, _ = DB.Exec("INSERT OR IGNORE INTO team_players (team_id, player_id) VALUES (?, ?)", *p.TeamID, p.ID)
	}
	if err := json.NewEncoder(w).Encode(p); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func EditPlayer(w http.ResponseWriter, r *http.Request) {
	var p Player
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_, err := DB.Exec("UPDATE players SET name=?, email=?, hcp=? WHERE id=?", p.Name, p.Email, p.HCP, p.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Remove from all teams, then add to selected team if provided
	_, _ = DB.Exec("DELETE FROM team_players WHERE player_id=?", p.ID)
	if p.TeamID != nil {
		_, _ = DB.Exec("INSERT OR IGNORE INTO team_players (team_id, player_id) VALUES (?, ?)", *p.TeamID, p.ID)
	}
	if err := json.NewEncoder(w).Encode(p); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// --- Remove Player Handler ---
func RemovePlayer(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, _ := strconv.Atoi(idStr)
	_, err := DB.Exec("DELETE FROM players WHERE id=?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Team Handlers ---
func AddTeam(w http.ResponseWriter, r *http.Request) {
	var t Team
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := DB.Exec("INSERT INTO teams (name, color) VALUES (?, ?)", t.Name, t.Color)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	id, _ := res.LastInsertId()
	t.ID = int(id)
	if err := json.NewEncoder(w).Encode(t); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func AssignPlayerToTeam(w http.ResponseWriter, r *http.Request) {
	type req struct {
		PlayerID int `json:"player_id"`
		TeamID   int `json:"team_id"`
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_, err := DB.Exec("INSERT INTO team_players (team_id, player_id) VALUES (?, ?)", body.TeamID, body.PlayerID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Match Handlers ---
func AddMatch(w http.ResponseWriter, r *http.Request) {
	type req struct {
		Format       string `json:"format"`
		Holes        string `json:"holes"`
		TeamA        int    `json:"team_a"`
		TeamB        int    `json:"team_b"`
		PlayersA     []int  `json:"players_a"`
		PlayersB     []int  `json:"players_b"`
		StartTime    string `json:"start_time"`
		StartingHole int    `json:"starting_hole"`
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.StartingHole < 1 || body.StartingHole > 18 {
		body.StartingHole = 1
	}

	randInt := func(min, max int) int {
		return min + int(time.Now().UnixNano())%(max-min+1)
	}

	time.Sleep(time.Duration(randInt(10, 100)) * time.Millisecond)

	res, err := DB.Exec("INSERT INTO matches (team_a_id, team_b_id, format, status, holes, start_time, starting_hole) VALUES (?, ?, ?, ?, ?, ?, ?)", body.TeamA, body.TeamB, body.Format, "prepared", body.Holes, body.StartTime, body.StartingHole)
	if err != nil {
		log.Printf("AddMatch error: %v | payload: %+v", err, body)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	matchID, _ := res.LastInsertId()
	for _, pid := range body.PlayersA {
		_, _ = DB.Exec("INSERT INTO match_players (match_id, player_id, team_side) VALUES (?, ?, ?)", matchID, pid, "A")
	}
	for _, pid := range body.PlayersB {
		_, _ = DB.Exec("INSERT INTO match_players (match_id, player_id, team_side) VALUES (?, ?, ?)", matchID, pid, "B")
	}
	w.WriteHeader(http.StatusCreated)
}

func EditMatch(w http.ResponseWriter, r *http.Request) {
	type req struct {
		ID           int    `json:"id"`
		Format       string `json:"format"`
		Holes        string `json:"holes"`
		TeamA        int    `json:"team_a"`
		TeamB        int    `json:"team_b"`
		PlayersA     []int  `json:"players_a"`
		PlayersB     []int  `json:"players_b"`
		StartTime    string `json:"start_time"`
		StartingHole int    `json:"starting_hole"`
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.StartingHole < 1 || body.StartingHole > 18 {
		body.StartingHole = 1
	}
	// Update match details
	_, err := DB.Exec(`UPDATE matches SET format=?, holes=?, team_a_id=?, team_b_id=?, start_time=?, starting_hole=? WHERE id=?`,
		body.Format, body.Holes, body.TeamA, body.TeamB, body.StartTime, body.StartingHole, body.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Remove old players
	_, _ = DB.Exec(`DELETE FROM match_players WHERE match_id=?`, body.ID)
	// Add new players for team A
	for _, pid := range body.PlayersA {
		_, _ = DB.Exec(`INSERT INTO match_players (match_id, player_id, team_side) VALUES (?, ?, 'A')`, body.ID, pid)
	}
	// Add new players for team B
	for _, pid := range body.PlayersB {
		_, _ = DB.Exec(`INSERT INTO match_players (match_id, player_id, team_side) VALUES (?, ?, 'B')`, body.ID, pid)
	}
	w.WriteHeader(http.StatusOK)
}

func RemoveMatch(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		http.Error(w, "Invalid match id", http.StatusBadRequest)
		return
	}
	_, err = DB.Exec("DELETE FROM matches WHERE id=?", id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Score Handlers ---
func SubmitScore(w http.ResponseWriter, r *http.Request) {
	var s Score
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	_, err := DB.Exec("INSERT INTO scores (match_id, player_id, hole, strokes) VALUES (?, ?, ?, ?)", s.MatchID, s.PlayerID, s.Hole, s.Strokes)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

// Submit scores for a match
func SubmitMatchScore(w http.ResponseWriter, r *http.Request) {
	type req struct {
		MatchID int                `json:"match_id"`
		Scores  map[string]float64 `json:"scores"` // key: team_side ("A"/"B"), value: score
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	for side, score := range body.Scores {
		_, err := DB.Exec("INSERT OR REPLACE INTO scores (match_id, team_side, score) VALUES (?, ?, ?)", body.MatchID, side, score)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// Get scores for a match
func GetMatchScore(w http.ResponseWriter, r *http.Request) {
	matchID := r.URL.Query().Get("match_id")
	rows, err := DB.Query("SELECT team_side, score FROM scores WHERE match_id=?", matchID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	scores := map[string]float64{}
	for rows.Next() {
		var side string
		var score float64
		rows.Scan(&side, &score)
		scores[side] = score
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"scores": scores})
}

// --- Dashboard Handler ---
func Dashboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	// 1. Get all teams
	teamRows, err := DB.Query("SELECT id, name, color FROM teams")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer teamRows.Close()
	teams := []map[string]interface{}{}
	teamScores := map[int]float64{}
	projectedScores := map[int]float64{}
	teamNames := map[int]string{}
	for teamRows.Next() {
		var id int
		var name string
		var color string
		teamRows.Scan(&id, &name, &color)
		teams = append(teams, map[string]interface{}{"id": id, "name": name, "score": 0.0, "color": color})
		teamScores[id] = 0.0
		projectedScores[id] = 0.0
		teamNames[id] = name
	}
	// 2. Get all finished matches and accumulate scores
	matchRows, _ := DB.Query("SELECT id, team_a_id, team_b_id, status, start_time, starting_hole FROM matches")
	defer matchRows.Close()
	matches := []map[string]interface{}{}
	for matchRows.Next() {
		var id, ta, tb int
		var status string
		var startTime string
		var startingHole int
		matchRows.Scan(&id, &ta, &tb, &status, &startTime, &startingHole)
		m := map[string]interface{}{"id": id, "team_a_id": ta, "team_b_id": tb, "status": status, "team_a_name": teamNames[ta], "team_b_name": teamNames[tb], "start_time": startTime, "starting_hole": startingHole}
		// Add player names and HCPs for each team
		paRows, err := DB.Query(`SELECT p.name, p.hcp FROM match_players mp JOIN players p ON mp.player_id=p.id WHERE mp.match_id=? AND mp.team_side='A'`, id)
		if err != nil {
			m["players_a"] = []map[string]interface{}{}
		} else {
			playersA := []map[string]interface{}{}
			for paRows.Next() {
				var n string
				var hcp sql.NullFloat64
				paRows.Scan(&n, &hcp)
				playersA = append(playersA, map[string]interface{}{"name": n, "hcp": hcp.Float64})
			}
			paRows.Close()
			m["players_a"] = playersA
		}
		pbRows, err := DB.Query(`SELECT p.name, p.hcp FROM match_players mp JOIN players p ON mp.player_id=p.id WHERE mp.match_id=? AND mp.team_side='B'`, id)
		if err != nil {
			m["players_b"] = []map[string]interface{}{}
		} else {
			playersB := []map[string]interface{}{}
			for pbRows.Next() {
				var n string
				var hcp sql.NullFloat64
				pbRows.Scan(&n, &hcp)
				playersB = append(playersB, map[string]interface{}{"name": n, "hcp": hcp.Float64})
			}
			pbRows.Close()
			m["players_b"] = playersB
		}
		// Add per-hole results for this match
		holeResults := make([]string, 18)
		hrRows, err := DB.Query("SELECT hole, result FROM hole_results WHERE match_id=?", id)
		if err == nil {
			for hrRows.Next() {
				var hole int
				var result string
				hrRows.Scan(&hole, &result)
				if hole >= 1 && hole <= 18 {
					holeResults[hole-1] = result
				}
			}
			hrRows.Close()
		}
		m["holeResults"] = holeResults
		// Add holes type (18, front9, back9) to match object
		var holesType string
		_ = DB.QueryRow("SELECT holes FROM matches WHERE id=?", id).Scan(&holesType)
		m["holes"] = holesType
		// Get per-match winner if finished, or current score if running
		if status == "completed" || status == "running" {
			rows, err := DB.Query("SELECT result, COUNT(*) FROM hole_results WHERE match_id=? GROUP BY result", id)
			if err == nil {
				var a, b int
				for rows.Next() {
					var res string
					var cnt int
					rows.Scan(&res, &cnt)
					if res == "A" {
						a += cnt
					}
					if res == "B" {
						b += cnt
					}
				}
				rows.Close()
				if status == "completed" {
					if a > b {
						teamScores[ta]++
						projectedScores[ta]++
					} else if b > a {
						teamScores[tb]++
						projectedScores[tb]++
					} else if a == b {
						teamScores[ta] += 0.5
						teamScores[tb] += 0.5
						projectedScores[ta] += 0.5
						projectedScores[tb] += 0.5
					}
				} else if status == "running" {
					if a > b {
						projectedScores[ta]++
					} else if b > a {
						projectedScores[tb]++
					} else if a == b {
						projectedScores[ta] += 0.5
						projectedScores[tb] += 0.5
					}
				}
				m["score_a"] = a
				m["score_b"] = b
				if a > b {
					m["score_text"] = fmt.Sprintf("%s %d Up", teamNames[ta], a-b)
				} else if b > a {
					m["score_text"] = fmt.Sprintf("%s %d Up", teamNames[tb], b-a)
				} else {
					m["score_text"] = "A/S"
				}
			}
		}
		// Add match format
		var format string
		_ = DB.QueryRow("SELECT format FROM matches WHERE id=?", id).Scan(&format)
		m["format"] = format
		matches = append(matches, m)
	}
	// Update team scores
	for i := range teams {
		id := teams[i]["id"].(int)
		teams[i]["score"] = teamScores[id]
	}
	// 3. Group matches by status, defaulting unknown/missing to 'prepared'
	grouped := map[string][]map[string]interface{}{"completed": {}, "running": {}, "prepared": {}}
	for _, m := range matches {
		status, ok := m["status"].(string)
		if !ok || (status != "completed" && status != "running" && status != "prepared") {
			status = "prepared"
		}
		grouped[status] = append(grouped[status], m)
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"teams":           teams,
		"matches":         grouped,
		"projectedScores": projectedScores,
	})
}

func HandleMainPage(w http.ResponseWriter, r *http.Request) {
	fmt.Println("Handling main page request for path:", r.URL.Path)
	if r.URL.Path == "/dashboard" || r.URL.Path == "/dashboard/" {
		http.ServeFile(w, r, "static/dashboard.html")
		return
	}
	if r.URL.Path == "/show" || r.URL.Path == "/show/" {
		http.ServeFile(w, r, "static/show.html")
		return
	}
	if r.URL.Path == "/" || r.URL.Path == "" {
		http.ServeFile(w, r, "static/dashboard.html")
		return
	}
	if r.URL.Path == "/adminjd" || r.URL.Path == "/adminjd/" {
		http.ServeFile(w, r, "static/adminjd.html")
		return
	}
	// Serve static assets (JS, CSS, etc.)
	if len(r.URL.Path) > 8 && r.URL.Path[:8] == "/static/" {
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		http.ServeFile(w, r, "."+r.URL.Path)
		return
	}
	// Serve images from /img/
	if len(r.URL.Path) > 5 && r.URL.Path[:5] == "/img/" {
		http.ServeFile(w, r, "."+r.URL.Path)
		return
	}
	http.ServeFile(w, r, "static/index.html")
}

// --- Settings Handlers ---
func GetSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	rows, err := DB.Query("SELECT key, value FROM settings")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	settings := map[string]string{}
	for rows.Next() {
		var k, v string
		rows.Scan(&k, &v)
		settings[k] = v
	}
	json.NewEncoder(w).Encode(settings)
}

func UpdateSetting(w http.ResponseWriter, r *http.Request) {
	var body map[string]string
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	for k, v := range body {
		_, err := DB.Exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", k, v)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Per-hole Result Handlers ---
func SaveHoleResults(w http.ResponseWriter, r *http.Request) {
	type req struct {
		MatchID int      `json:"match_id"`
		Holes   []string `json:"holes"` // 18 values: "A", "B", "AS", or ""
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	// Remove old results
	_, _ = DB.Exec("DELETE FROM hole_results WHERE match_id=?", body.MatchID)
	for i, v := range body.Holes {
		if v == "" {
			continue
		}
		_, _ = DB.Exec("INSERT INTO hole_results (match_id, hole, result) VALUES (?, ?, ?)", body.MatchID, i+1, v)
	}
	w.WriteHeader(http.StatusNoContent)
}

func LoadHoleResults(w http.ResponseWriter, r *http.Request) {
	matchID := r.URL.Query().Get("match_id")
	rows, err := DB.Query("SELECT hole, result FROM hole_results WHERE match_id=?", matchID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	holes := make([]string, 18)
	for rows.Next() {
		var hole int
		var result string
		rows.Scan(&hole, &result)
		if hole >= 1 && hole <= 18 {
			holes[hole-1] = result
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"holes": holes})
}

// --- Set Match Status Handler ---
func SetMatchStatus(w http.ResponseWriter, r *http.Request) {
	type req struct {
		MatchID int    `json:"match_id"`
		Status  string `json:"status"`
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	_, err := DB.Exec("UPDATE matches SET status=? WHERE id=?", body.Status, body.MatchID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
