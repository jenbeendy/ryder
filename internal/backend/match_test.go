package backend

import (
	"database/sql"
	"net/http"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func setupMatchTestDB(t *testing.T) {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	stmts := []string{
		`CREATE TABLE matches (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			team_a_id INTEGER,
			team_b_id INTEGER,
			format TEXT NOT NULL,
			status TEXT NOT NULL,
			start_time TEXT,
			holes TEXT DEFAULT '18',
			starting_hole INTEGER DEFAULT 1,
			round INTEGER DEFAULT 0,
			session_id INTEGER
		);`,
		`CREATE TABLE match_players (
			match_id INTEGER NOT NULL,
			player_id INTEGER NOT NULL,
			team_side TEXT NOT NULL,
			PRIMARY KEY (match_id, player_id)
		);`,
		`CREATE TABLE sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			title TEXT NOT NULL,
			team_a_id INTEGER,
			team_b_id INTEGER,
			is_active INTEGER DEFAULT 0
		);`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatal(err)
		}
	}
	old := DB
	DB = db
	t.Cleanup(func() {
		DB = old
		_ = db.Close()
	})
}

func countRows(t *testing.T, table string) int {
	t.Helper()
	var n int
	if err := DB.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestAddMatchWithFoursomeCreatesBoth(t *testing.T) {
	setupMatchTestDB(t)
	body := `{"format":"texas_scramble","holes":"9","team_a":1,"team_b":2,
		"players_a":[10,11],"players_b":[20,21],"start_time":"8:30","starting_hole":1,"round":1,
		"foursome":{"start_time":"10:30","starting_hole":10}}`
	w := postJSON(t, AddMatch, "/api/match/add", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if n := countRows(t, "matches"); n != 2 {
		t.Fatalf("expected 2 matches, got %d", n)
	}
	if n := countRows(t, "match_players"); n != 8 {
		t.Fatalf("expected 8 match_players rows, got %d", n)
	}
	var format, holes, startTime string
	var hole int
	err := DB.QueryRow("SELECT format, holes, start_time, starting_hole FROM matches WHERE format='foursome'").
		Scan(&format, &holes, &startTime, &hole)
	if err != nil {
		t.Fatal(err)
	}
	if holes != "9" || startTime != "10:30" || hole != 10 {
		t.Fatalf("unexpected foursome match: holes=%s start=%s hole=%d", holes, startTime, hole)
	}
}

func TestAddMatchWithFoursomeRollsBackOnFailure(t *testing.T) {
	setupMatchTestDB(t)
	if _, err := DB.Exec(`CREATE TRIGGER fail_foursome BEFORE INSERT ON matches
		WHEN NEW.format='foursome' BEGIN SELECT RAISE(ABORT,'boom'); END;`); err != nil {
		t.Fatal(err)
	}
	body := `{"format":"texas_scramble","holes":"9","team_a":1,"team_b":2,
		"players_a":[10],"players_b":[20],"start_time":"8:30","starting_hole":1,"round":1,
		"foursome":{"start_time":"10:30","starting_hole":10}}`
	w := postJSON(t, AddMatch, "/api/match/add", body)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
	if n := countRows(t, "matches"); n != 0 {
		t.Fatalf("expected rollback to leave 0 matches, got %d", n)
	}
	if n := countRows(t, "match_players"); n != 0 {
		t.Fatalf("expected rollback to leave 0 match_players, got %d", n)
	}
}

func TestAddMatchWithoutFoursome(t *testing.T) {
	setupMatchTestDB(t)
	body := `{"format":"singles","holes":"18","team_a":1,"team_b":2,
		"players_a":[10],"players_b":[20],"start_time":"9:00","starting_hole":1,"round":1}`
	w := postJSON(t, AddMatch, "/api/match/add", body)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if n := countRows(t, "matches"); n != 1 {
		t.Fatalf("expected 1 match, got %d", n)
	}
}
