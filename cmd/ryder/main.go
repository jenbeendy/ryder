package main

import (
	"database/sql"
	"fmt"
	"log"

	_ "github.com/mattn/go-sqlite3"
	"github.com/tests/copilot/ryder/internal/backend"
)

func autoMigrate(db *sql.DB) {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS players (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			email TEXT,
			hcp REAL
		);`,
		`CREATE TABLE IF NOT EXISTS teams (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			color TEXT DEFAULT '#2563eb'
		);`,
		`CREATE TABLE IF NOT EXISTS team_players (
			team_id INTEGER NOT NULL,
			player_id INTEGER NOT NULL,
			PRIMARY KEY (team_id, player_id),
			FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
			FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS matches (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			team_a_id INTEGER,
			team_b_id INTEGER,
			format TEXT NOT NULL,
			status TEXT NOT NULL,
			start_time TEXT,
			holes TEXT DEFAULT '18',
			starting_hole INTEGER DEFAULT 1,
			FOREIGN KEY (team_a_id) REFERENCES teams(id),
			FOREIGN KEY (team_b_id) REFERENCES teams(id)
		);`,
		`CREATE TABLE IF NOT EXISTS match_players (
			match_id INTEGER NOT NULL,
			player_id INTEGER NOT NULL,
			team_side TEXT NOT NULL, -- 'A' or 'B'
			PRIMARY KEY (match_id, player_id),
			FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
			FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS scores (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			match_id INTEGER NOT NULL,
			player_id INTEGER NOT NULL,
			hole INTEGER NOT NULL,
			strokes INTEGER NOT NULL,
			FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
			FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS hole_results (
			match_id INTEGER NOT NULL,
			hole INTEGER NOT NULL,
			result TEXT,
			PRIMARY KEY (match_id, hole)
		);`,
	}
	for _, stmt := range tables {
		if _, err := db.Exec(stmt); err != nil {
			log.Fatalf("failed to migrate: %v", err)
		}
	}

	// Add HCP column if not exists
	_, _ = db.Exec("ALTER TABLE players ADD COLUMN hcp REAL;")
	// Add holes column if not exists
	_, _ = db.Exec("ALTER TABLE matches ADD COLUMN holes TEXT DEFAULT '18';")
	// Add starting_hole column if not exists
	_, _ = db.Exec("ALTER TABLE matches ADD COLUMN starting_hole INTEGER DEFAULT 1;")
	// Add match_date column if not exists
	_, _ = db.Exec("ALTER TABLE matches ADD COLUMN match_date TEXT;")
}

func main() {
	fmt.Println("Hello, Ryder!")

	db, err := sql.Open("sqlite3", "ryder.db")
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}
	autoMigrate(db)
	backend.DB = db

	// TODO: Run DB migrations if needed

	backend.StartServer()
}
