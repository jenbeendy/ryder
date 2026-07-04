package backend

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	"image/png"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	xdraw "golang.org/x/image/draw"
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
	Logo    string   `json:"logo"`
	Players []Player `json:"players,omitempty"`
}

type SessionRound struct {
	RoundNumber int    `json:"round_number"`
	Date        string `json:"date"`
}

type Session struct {
	ID       int            `json:"id"`
	Title    string         `json:"title"`
	TeamAID  int            `json:"team_a_id"`
	TeamBID  int            `json:"team_b_id"`
	IsActive bool           `json:"is_active"`
	Rounds   []SessionRound `json:"rounds"`
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
		Round        int    `json:"round"`
		TeamA        struct {
			ID      int           `json:"id"`
			Name    string        `json:"name"`
			Color   string        `json:"color"`
			Logo    string        `json:"logo"`
			Players []MatchPlayer `json:"players"`
		} `json:"team_a"`
		TeamB struct {
			ID      int           `json:"id"`
			Name    string        `json:"name"`
			Color   string        `json:"color"`
			Logo    string        `json:"logo"`
			Players []MatchPlayer `json:"players"`
		} `json:"team_b"`
	}
	// When a session is active, list only its matches
	query := `SELECT m.id, m.format, m.holes, m.status, m.start_time, m.starting_hole, m.round, ta.id, ta.name, ta.color, COALESCE(ta.logo, ''), tb.id, tb.name, tb.color, COALESCE(tb.logo, '') FROM matches m JOIN teams ta ON m.team_a_id=ta.id JOIN teams tb ON m.team_b_id=tb.id`
	args := []interface{}{}
	if sid, _, _, _, ok := getActiveSession(); ok {
		query += " WHERE m.session_id=?"
		args = append(args, sid)
	}
	query += " ORDER BY m.start_time"
	rows, err := DB.Query(query, args...)
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
		var taLogo, tbLogo string
		var startTime string
		if err := rows.Scan(&m.ID, &m.Format, &m.Holes, &m.Status, &startTime, &m.StartingHole, &m.Round, &taID, &taName, &taColor, &taLogo, &tbID, &tbName, &tbColor, &tbLogo); err != nil {
			continue
		}
		m.TeamA.ID, m.TeamA.Name, m.TeamA.Color, m.TeamA.Logo = taID, taName, taColor, taLogo
		m.TeamB.ID, m.TeamB.Name, m.TeamB.Color, m.TeamB.Logo = tbID, tbName, tbColor, tbLogo
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
	rows, err := DB.Query("SELECT id, name, color, COALESCE(logo, '') FROM teams ORDER BY name")
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
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.Logo); err != nil {
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

// UploadTeamLogo accepts a multipart form (team_id, logo file), validates the image
// (max 2 MB, PNG/JPEG, roughly square, min 91px), downsizes anything larger than
// 512px and stores it as img/team_<id>.png with the path saved on the team row.
func UploadTeamLogo(w http.ResponseWriter, r *http.Request) {
	const maxLogoBytes = 2 << 20 // 2 MB
	const maxLogoDim = 512
	const minLogoDim = 91

	r.Body = http.MaxBytesReader(w, r.Body, maxLogoBytes+64*1024)
	if err := r.ParseMultipartForm(maxLogoBytes); err != nil {
		http.Error(w, "file too large (max 2 MB)", http.StatusBadRequest)
		return
	}
	teamID, err := strconv.Atoi(r.FormValue("team_id"))
	if err != nil || teamID <= 0 {
		http.Error(w, "invalid team_id", http.StatusBadRequest)
		return
	}
	var exists int
	if err := DB.QueryRow("SELECT COUNT(*) FROM teams WHERE id=?", teamID).Scan(&exists); err != nil || exists == 0 {
		http.Error(w, "team not found", http.StatusNotFound)
		return
	}
	file, header, err := r.FormFile("logo")
	if err != nil {
		http.Error(w, "missing logo file", http.StatusBadRequest)
		return
	}
	defer file.Close()
	if header.Size > maxLogoBytes {
		http.Error(w, "file too large (max 2 MB)", http.StatusBadRequest)
		return
	}
	img, format, err := image.Decode(file)
	if err != nil {
		http.Error(w, "invalid image: must be PNG or JPEG", http.StatusBadRequest)
		return
	}
	if format != "png" && format != "jpeg" {
		http.Error(w, "unsupported format: must be PNG or JPEG", http.StatusBadRequest)
		return
	}
	b := img.Bounds()
	width, height := b.Dx(), b.Dy()
	if width < minLogoDim || height < minLogoDim {
		http.Error(w, fmt.Sprintf("image too small: minimum %dx%d px", minLogoDim, minLogoDim), http.StatusBadRequest)
		return
	}
	larger := width
	if height > larger {
		larger = height
	}
	if float64(abs(width-height)) > 0.1*float64(larger) {
		http.Error(w, "image must be square (within 10% tolerance)", http.StatusBadRequest)
		return
	}
	// Downscale to fit maxLogoDim while keeping aspect ratio
	if larger > maxLogoDim {
		scale := float64(maxLogoDim) / float64(larger)
		dst := image.NewRGBA(image.Rect(0, 0, int(float64(width)*scale), int(float64(height)*scale)))
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, b, xdraw.Over, nil)
		img = dst
	}
	logoPath := fmt.Sprintf("img/team_%d.png", teamID)
	out, err := os.Create(logoPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer out.Close()
	if err := png.Encode(out, img); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	logoURL := "/" + logoPath
	if _, err := DB.Exec("UPDATE teams SET logo=? WHERE id=?", logoURL, teamID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"logo": logoURL})
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
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

// --- Session Handlers ---

// getActiveSession returns the active session, or ok=false when none is active.
func getActiveSession() (id int, title string, teamA int, teamB int, ok bool) {
	err := DB.QueryRow("SELECT id, title, team_a_id, team_b_id FROM sessions WHERE is_active=1 LIMIT 1").Scan(&id, &title, &teamA, &teamB)
	if err != nil {
		return 0, "", 0, 0, false
	}
	return id, title, teamA, teamB, true
}

func loadSessionRounds(sessionID int) []SessionRound {
	rounds := []SessionRound{}
	rows, err := DB.Query("SELECT round_number, date FROM session_rounds WHERE session_id=? ORDER BY round_number", sessionID)
	if err != nil {
		return rounds
	}
	defer rows.Close()
	for rows.Next() {
		var sr SessionRound
		var date sql.NullString
		if err := rows.Scan(&sr.RoundNumber, &date); err == nil {
			sr.Date = date.String
			rounds = append(rounds, sr)
		}
	}
	return rounds
}

func ListSessions(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query(`SELECT s.id, s.title, s.team_a_id, s.team_b_id, s.is_active,
		COALESCE(ta.name, ''), COALESCE(tb.name, '')
		FROM sessions s
		LEFT JOIN teams ta ON s.team_a_id = ta.id
		LEFT JOIN teams tb ON s.team_b_id = tb.id
		ORDER BY s.id`)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type sessionOut struct {
		Session
		TeamAName string `json:"team_a_name"`
		TeamBName string `json:"team_b_name"`
	}
	sessions := []sessionOut{}
	for rows.Next() {
		var s sessionOut
		var active int
		if err := rows.Scan(&s.ID, &s.Title, &s.TeamAID, &s.TeamBID, &active, &s.TeamAName, &s.TeamBName); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		s.IsActive = active == 1
		sessions = append(sessions, s)
	}
	for i := range sessions {
		sessions[i].Rounds = loadSessionRounds(sessions[i].ID)
	}
	if err := json.NewEncoder(w).Encode(map[string]interface{}{"sessions": sessions}); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func validateSession(s *Session) string {
	if s.Title == "" {
		return "title is required"
	}
	if s.TeamAID == 0 || s.TeamBID == 0 {
		return "both teams are required"
	}
	if s.TeamAID == s.TeamBID {
		return "team A and team B must be different"
	}
	return ""
}

func AddSession(w http.ResponseWriter, r *http.Request) {
	var s Session
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if msg := validateSession(&s); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	res, err := DB.Exec("INSERT INTO sessions (title, team_a_id, team_b_id, is_active) VALUES (?, ?, ?, 0)", s.Title, s.TeamAID, s.TeamBID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	id, _ := res.LastInsertId()
	s.ID = int(id)
	for _, sr := range s.Rounds {
		_, _ = DB.Exec("INSERT OR REPLACE INTO session_rounds (session_id, round_number, date) VALUES (?, ?, ?)", s.ID, sr.RoundNumber, sr.Date)
	}
	if s.IsActive {
		_ = activateSession(s.ID)
	}
	if err := json.NewEncoder(w).Encode(s); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func EditSession(w http.ResponseWriter, r *http.Request) {
	var s Session
	if err := json.NewDecoder(r.Body).Decode(&s); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if msg := validateSession(&s); msg != "" {
		http.Error(w, msg, http.StatusBadRequest)
		return
	}
	_, err := DB.Exec("UPDATE sessions SET title=?, team_a_id=?, team_b_id=? WHERE id=?", s.Title, s.TeamAID, s.TeamBID, s.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_, _ = DB.Exec("DELETE FROM session_rounds WHERE session_id=?", s.ID)
	for _, sr := range s.Rounds {
		_, _ = DB.Exec("INSERT OR REPLACE INTO session_rounds (session_id, round_number, date) VALUES (?, ?, ?)", s.ID, sr.RoundNumber, sr.Date)
	}
	if err := json.NewEncoder(w).Encode(s); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func RemoveSession(w http.ResponseWriter, r *http.Request) {
	idStr := r.URL.Query().Get("id")
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		http.Error(w, "Invalid session id", http.StatusBadRequest)
		return
	}
	var cnt int
	if err := DB.QueryRow("SELECT COUNT(*) FROM matches WHERE session_id=?", id).Scan(&cnt); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if cnt > 0 {
		http.Error(w, "session has matches; remove them first", http.StatusConflict)
		return
	}
	if _, err := DB.Exec("DELETE FROM sessions WHERE id=?", id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	_, _ = DB.Exec("DELETE FROM session_rounds WHERE session_id=?", id)
	w.WriteHeader(http.StatusNoContent)
}

// activateSession makes the given session the only active one; id 0 clears the active flag.
func activateSession(id int) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE sessions SET is_active=0"); err != nil {
		tx.Rollback()
		return err
	}
	if id != 0 {
		if _, err := tx.Exec("UPDATE sessions SET is_active=1 WHERE id=?", id); err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func SetActiveSession(w http.ResponseWriter, r *http.Request) {
	type req struct {
		ID int `json:"id"`
	}
	var body req
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if body.ID != 0 {
		var exists int
		if err := DB.QueryRow("SELECT COUNT(*) FROM sessions WHERE id=?", body.ID).Scan(&exists); err != nil || exists == 0 {
			http.Error(w, "session not found", http.StatusNotFound)
			return
		}
	}
	if err := activateSession(body.ID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
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
		Round        int    `json:"round"`
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

	// Stamp new matches with the active session (NULL when none is active)
	var sessionID interface{}
	if sid, _, sTeamA, sTeamB, ok := getActiveSession(); ok {
		if !(body.TeamA == sTeamA && body.TeamB == sTeamB) && !(body.TeamA == sTeamB && body.TeamB == sTeamA) {
			http.Error(w, "match teams must be the active session's teams", http.StatusBadRequest)
			return
		}
		sessionID = sid
	}
	res, err := DB.Exec("INSERT INTO matches (team_a_id, team_b_id, format, status, holes, start_time, starting_hole, round, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", body.TeamA, body.TeamB, body.Format, "prepared", body.Holes, body.StartTime, body.StartingHole, body.Round, sessionID)
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
		Round        int    `json:"round"`
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
	_, err := DB.Exec(`UPDATE matches SET format=?, holes=?, team_a_id=?, team_b_id=?, start_time=?, starting_hole=?, round=? WHERE id=?`,
		body.Format, body.Holes, body.TeamA, body.TeamB, body.StartTime, body.StartingHole, body.Round, body.ID)
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
	// Resolve active session; when none exists, fall back to legacy behavior (all teams/matches)
	sessionID, sessionTitle, sessionTeamA, sessionTeamB, hasSession := getActiveSession()
	// 1. Get teams (only the session's two teams when a session is active)
	var teamRows *sql.Rows
	var err error
	if hasSession {
		// Session's team A first, team B second — preserves the order chosen at session creation
		teamRows, err = DB.Query("SELECT id, name, color, COALESCE(logo, '') FROM teams WHERE id IN (?, ?) ORDER BY CASE id WHEN ? THEN 0 ELSE 1 END", sessionTeamA, sessionTeamB, sessionTeamA)
	} else {
		teamRows, err = DB.Query("SELECT id, name, color, COALESCE(logo, '') FROM teams")
	}
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
		var logo string
		teamRows.Scan(&id, &name, &color, &logo)
		teams = append(teams, map[string]interface{}{"id": id, "name": name, "score": 0.0, "color": color, "logo": logo})
		teamScores[id] = 0.0
		projectedScores[id] = 0.0
		teamNames[id] = name
	}
	// 2. Get matches (filtered to the active session when one exists) and accumulate scores
	var matchRows *sql.Rows
	if hasSession {
		matchRows, _ = DB.Query("SELECT id, team_a_id, team_b_id, status, start_time, starting_hole, round FROM matches WHERE session_id=? ORDER BY start_time", sessionID)
	} else {
		matchRows, _ = DB.Query("SELECT id, team_a_id, team_b_id, status, start_time, starting_hole, round FROM matches ORDER BY start_time")
	}
	defer matchRows.Close()
	matches := []map[string]interface{}{}
	roundSet := map[int]bool{}
	for matchRows.Next() {
		var id, ta, tb int
		var status string
		var startTime string
		var startingHole, round int
		matchRows.Scan(&id, &ta, &tb, &status, &startTime, &startingHole, &round)
		roundSet[round] = true
		m := map[string]interface{}{"id": id, "team_a_id": ta, "team_b_id": tb, "status": status, "team_a_name": teamNames[ta], "team_b_name": teamNames[tb], "start_time": startTime, "starting_hole": startingHole, "round": round}
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
	availableRounds := []int{}
	for r := range roundSet {
		availableRounds = append(availableRounds, r)
	}
	// sort ascending
	for i := 0; i < len(availableRounds); i++ {
		for j := i + 1; j < len(availableRounds); j++ {
			if availableRounds[j] < availableRounds[i] {
				availableRounds[i], availableRounds[j] = availableRounds[j], availableRounds[i]
			}
		}
	}
	var sessionOut interface{}
	if hasSession {
		sessionOut = map[string]interface{}{
			"id":        sessionID,
			"title":     sessionTitle,
			"team_a_id": sessionTeamA,
			"team_b_id": sessionTeamB,
			"rounds":    loadSessionRounds(sessionID),
		}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{
		"teams":            teams,
		"matches":          grouped,
		"projectedScores":  projectedScores,
		"available_rounds": availableRounds,
		"session":          sessionOut,
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

// --- Player Statistics Handler ---
func HandlePlayerStats(w http.ResponseWriter, r *http.Request) {
	teamIDStr := r.URL.Query().Get("team_id")
	if teamIDStr == "" {
		http.Error(w, "team_id required", http.StatusBadRequest)
		return
	}
	teamID, err := strconv.Atoi(teamIDStr)
	if err != nil {
		http.Error(w, "invalid team_id", http.StatusBadRequest)
		return
	}

	type PlayerStats struct {
		ID     int                `json:"id"`
		Name   string             `json:"name"`
		Points map[string]float64 `json:"points"`
	}

	playerRows, err := DB.Query(`SELECT p.id, p.name FROM players p JOIN team_players tp ON p.id = tp.player_id WHERE tp.team_id = ? ORDER BY p.name`, teamID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer playerRows.Close()

	players := []*PlayerStats{}
	playerMap := map[int]*PlayerStats{}
	for playerRows.Next() {
		var id int
		var name string
		playerRows.Scan(&id, &name)
		ps := &PlayerStats{
			ID:   id,
			Name: name,
			Points: map[string]float64{
				"singles":        0,
				"texas_scramble": 0,
				"foursome":       0,
				"total":          0,
			},
		}
		players = append(players, ps)
		playerMap[id] = ps
	}

	rows, err := DB.Query(`
		SELECT p.id, m.format,
			SUM(CASE
				WHEN mp.team_side = 'A' AND hr.cnt_a > hr.cnt_b THEN 1
				WHEN mp.team_side = 'B' AND hr.cnt_b > hr.cnt_a THEN 1
				WHEN hr.cnt_a = hr.cnt_b THEN 0.5
				ELSE 0
			END) as points
		FROM players p
		JOIN team_players tp ON p.id = tp.player_id AND tp.team_id = ?
		JOIN match_players mp ON p.id = mp.player_id
		JOIN matches m ON mp.match_id = m.id AND m.status = 'completed'
		JOIN (
			SELECT match_id,
				SUM(CASE WHEN result = 'A' THEN 1 ELSE 0 END) as cnt_a,
				SUM(CASE WHEN result = 'B' THEN 1 ELSE 0 END) as cnt_b
			FROM hole_results
			GROUP BY match_id
		) hr ON hr.match_id = m.id
		GROUP BY p.id, m.format
	`, teamID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var playerID int
		var format string
		var points float64
		rows.Scan(&playerID, &format, &points)
		if ps, ok := playerMap[playerID]; ok {
			ps.Points[format] = points
			ps.Points["total"] += points
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(players)
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
