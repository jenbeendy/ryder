package backend

import (
	"fmt"
	"net/http"
	"os"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/joho/godotenv"
)

func StartServer() {
	mux := http.NewServeMux()
	// --- WebSocket Hub ---
	var wsUpgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	var wsClients = make(map[*websocket.Conn]bool)
	var wsLock sync.Mutex
	broadcast := func() {
		wsLock.Lock()
		defer wsLock.Unlock()
		fmt.Printf("Broadcasting update to %d WebSocket clients\n", len(wsClients))
		for c := range wsClients {
			_ = c.WriteMessage(websocket.TextMessage, []byte("update"))
		}
	}
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			fmt.Println("WebSocket upgrade error:", err)
			return
		}
		fmt.Printf("WebSocket client connected: %s\n", r.RemoteAddr)
		wsLock.Lock()
		wsClients[conn] = true
		wsLock.Unlock()
		defer func() {
			wsLock.Lock()
			delete(wsClients, conn)
			wsLock.Unlock()
			conn.Close()
			fmt.Printf("WebSocket client disconnected: %s\n", r.RemoteAddr)
		}()
		for {
			mt, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if mt == websocket.TextMessage && string(msg) == "ping" {
				_ = conn.WriteMessage(websocket.TextMessage, []byte("pong"))
			}
		}
	})

	// Wrap mutating endpoints to broadcast updates
	wrapAndBroadcast := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			h(w, r)
			if r.Method == http.MethodPost {
				go broadcast()
			}
		}
	}

	// Load .env file if present
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	fmt.Printf("Starting backend server on port %s...\n", port)

	// Dashboard page (must be registered before /)
	mux.HandleFunc("/dashboard", HandleMainPage)
	mux.HandleFunc("/dashboard/", HandleMainPage)
	// Main page (dashboard as homepage)
	mux.HandleFunc("/", HandleMainPage)
	// Player endpoints
	mux.HandleFunc("/api/player/add", wrapAndBroadcast(AddPlayer))
	mux.HandleFunc("/api/player/edit", wrapAndBroadcast(EditPlayer))
	mux.HandleFunc("/api/player/remove", wrapAndBroadcast(RemovePlayer))
	mux.HandleFunc("/api/player/list", ListPlayers)
	// Team endpoints
	mux.HandleFunc("/api/team/add", wrapAndBroadcast(AddTeam))
	mux.HandleFunc("/api/team/edit", wrapAndBroadcast(EditTeam))
	mux.HandleFunc("/api/team/remove", wrapAndBroadcast(RemoveTeam))
	mux.HandleFunc("/api/team/list", ListTeams)
	mux.HandleFunc("/api/team/assign", AssignPlayersToTeam)
	mux.HandleFunc("/api/team/players", ListPlayersByTeam)
	// Match endpoints
	mux.HandleFunc("/api/match/add", wrapAndBroadcast(AddMatch))
	mux.HandleFunc("/api/match/edit", wrapAndBroadcast(EditMatch))
	mux.HandleFunc("/api/match/remove", wrapAndBroadcast(RemoveMatch))
	mux.HandleFunc("/api/match/list", ListMatches)
	mux.HandleFunc("/api/matches", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			AddMatch(w, r)
			return
		}
		// Handle other methods (GET, etc.) if needed
	})
	// Score endpoint
	mux.HandleFunc("/api/score/submit", wrapAndBroadcast(SubmitScore))
	// Dashboard
	mux.HandleFunc("/api/dashboard", Dashboard)
	// Settings
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			GetSettings(w, r)
			return
		}
		if r.Method == http.MethodPost {
			UpdateSetting(w, r)
			go broadcast()
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
	// Match score endpoints
	mux.HandleFunc("/api/match/score", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			SubmitMatchScore(w, r)
			go broadcast()
			return
		}
		if r.Method == http.MethodGet {
			GetMatchScore(w, r)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
	// Hole score endpoints
	mux.HandleFunc("/api/match/holescore", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			SaveHoleResults(w, r)
			go broadcast()
			return
		}
		if r.Method == http.MethodGet {
			LoadHoleResults(w, r)
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})
	// Match status endpoint
	mux.HandleFunc("/api/match/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			SetMatchStatus(w, r)
			go broadcast()
			return
		}
		w.WriteHeader(http.StatusMethodNotAllowed)
	})

	addr := ":" + port
	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Printf("Server failed to start: %v\n", err)
	}

}
