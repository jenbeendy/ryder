package backend

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func setupTestDB(t *testing.T) {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	stmts := []string{
		`CREATE TABLE admin_users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE COLLATE NOCASE,
			password_hash TEXT,
			google_sub TEXT UNIQUE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE auth_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
			token_hash TEXT NOT NULL UNIQUE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL
		);`,
		`CREATE TABLE password_reset_tokens (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
			token_hash TEXT NOT NULL UNIQUE,
			expires_at DATETIME NOT NULL,
			used_at DATETIME
		);`,
		`CREATE TABLE admin_invites (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL UNIQUE COLLATE NOCASE,
			invited_by INTEGER REFERENCES admin_users(id),
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			accepted_at DATETIME
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
	// Rate limiter is global; reset between tests.
	rateLimiter.Lock()
	rateLimiter.hits = map[string][]time.Time{}
	rateLimiter.Unlock()
}

func postJSON(t *testing.T, handler http.HandlerFunc, url, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	handler(w, req)
	return w
}

func sessionCookie(t *testing.T, w *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookieName {
			return c
		}
	}
	t.Fatal("no session cookie set")
	return nil
}

func TestRegisterFirstUserBecomesAdmin(t *testing.T) {
	setupTestDB(t)
	w := postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"a@b.com","password":"password1"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("first registration should succeed, got %d: %s", w.Code, w.Body)
	}
	c := sessionCookie(t, w)
	if !c.HttpOnly {
		t.Error("session cookie must be HttpOnly")
	}
}

func TestRegisterSecondUserRequiresInvite(t *testing.T) {
	setupTestDB(t)
	if w := postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"a@b.com","password":"password1"}`); w.Code != http.StatusOK {
		t.Fatalf("first registration failed: %d", w.Code)
	}
	if w := postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"x@y.com","password":"password1"}`); w.Code != http.StatusForbidden {
		t.Fatalf("uninvited registration should be forbidden, got %d", w.Code)
	}
	if _, err := DB.Exec("INSERT INTO admin_invites (email) VALUES ('x@y.com')"); err != nil {
		t.Fatal(err)
	}
	if w := postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"x@y.com","password":"password1"}`); w.Code != http.StatusOK {
		t.Fatalf("invited registration should succeed, got %d: %s", w.Code, w.Body)
	}
	var accepted int
	_ = DB.QueryRow("SELECT COUNT(*) FROM admin_invites WHERE email='x@y.com' AND accepted_at IS NOT NULL").Scan(&accepted)
	if accepted != 1 {
		t.Error("invite should be marked accepted")
	}
}

func TestLoginAndSessionValidation(t *testing.T) {
	setupTestDB(t)
	postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"a@b.com","password":"password1"}`)

	if w := postJSON(t, LoginHandler, "/api/auth/login", `{"email":"a@b.com","password":"wrong-pass"}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password should 401, got %d", w.Code)
	}
	w := postJSON(t, LoginHandler, "/api/auth/login", `{"email":"a@b.com","password":"password1"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("login failed: %d %s", w.Code, w.Body)
	}
	c := sessionCookie(t, w)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.AddCookie(c)
	if _, ok := currentUser(req); !ok {
		t.Error("valid session cookie should authenticate")
	}
	req2 := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req2.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "forged-token"})
	if _, ok := currentUser(req2); ok {
		t.Error("forged token must not authenticate")
	}
}

func TestRequireAdminAPI(t *testing.T) {
	setupTestDB(t)
	called := false
	h := RequireAdminAPI(func(w http.ResponseWriter, r *http.Request) { called = true })

	req := httptest.NewRequest(http.MethodPost, "/api/player/add", nil)
	w := httptest.NewRecorder()
	h(w, req)
	if w.Code != http.StatusUnauthorized || called {
		t.Fatalf("unauthenticated request should 401 without running handler, got %d", w.Code)
	}

	reg := postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"a@b.com","password":"password1"}`)
	c := sessionCookie(t, reg)

	// Cross-origin POST with valid session must be rejected (CSRF).
	req = httptest.NewRequest(http.MethodPost, "/api/player/add", nil)
	req.AddCookie(c)
	req.Header.Set("Origin", "https://evil.example")
	w = httptest.NewRecorder()
	h(w, req)
	if w.Code != http.StatusForbidden || called {
		t.Fatalf("cross-origin POST should 403, got %d", w.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/player/add", nil)
	req.AddCookie(c)
	req.Header.Set("Origin", "http://"+req.Host)
	w = httptest.NewRecorder()
	h(w, req)
	if w.Code != http.StatusOK || !called {
		t.Fatalf("authenticated same-origin request should pass, got %d", w.Code)
	}
}

func TestPasswordResetSingleUse(t *testing.T) {
	setupTestDB(t)
	reg := postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"a@b.com","password":"password1"}`)
	oldCookie := sessionCookie(t, reg)

	var userID int
	if err := DB.QueryRow("SELECT id FROM admin_users WHERE email='a@b.com'").Scan(&userID); err != nil {
		t.Fatal(err)
	}
	token, hash := newRandomToken()
	if _, err := DB.Exec("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
		userID, hash, time.Now().Add(time.Hour).UTC()); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{"token": token, "password": "newpassword1"})
	if w := postJSON(t, ResetPasswordHandler, "/api/auth/reset", string(body)); w.Code != http.StatusOK {
		t.Fatalf("reset should succeed, got %d: %s", w.Code, w.Body)
	}
	// Old session invalidated.
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.AddCookie(oldCookie)
	if _, ok := currentUser(req); ok {
		t.Error("old session should be invalidated after reset")
	}
	// Token single-use.
	if w := postJSON(t, ResetPasswordHandler, "/api/auth/reset", string(body)); w.Code != http.StatusBadRequest {
		t.Fatalf("second use of reset token should fail, got %d", w.Code)
	}
	// New password works, old doesn't.
	if w := postJSON(t, LoginHandler, "/api/auth/login", `{"email":"a@b.com","password":"newpassword1"}`); w.Code != http.StatusOK {
		t.Fatalf("login with new password failed: %d", w.Code)
	}
	if w := postJSON(t, LoginHandler, "/api/auth/login", `{"email":"a@b.com","password":"password1"}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("old password should be rejected, got %d", w.Code)
	}
}

func TestForgotDoesNotRevealAccounts(t *testing.T) {
	setupTestDB(t)
	postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"a@b.com","password":"password1"}`)

	w1 := postJSON(t, ForgotPasswordHandler, "/api/auth/forgot", `{"email":"a@b.com"}`)
	w2 := postJSON(t, ForgotPasswordHandler, "/api/auth/forgot", `{"email":"nobody@nowhere.com"}`)
	if w1.Code != http.StatusOK || w2.Code != http.StatusOK {
		t.Fatalf("forgot must return 200 for both, got %d and %d", w1.Code, w2.Code)
	}
	if w1.Body.String() != w2.Body.String() {
		t.Error("forgot responses must be identical for existing and unknown emails")
	}
}

func TestLoginRateLimit(t *testing.T) {
	setupTestDB(t)
	postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"a@b.com","password":"password1"}`)
	var last int
	for range 11 {
		w := postJSON(t, LoginHandler, "/api/auth/login", `{"email":"a@b.com","password":"wrong-pass"}`)
		last = w.Code
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("11th failed login should be rate limited, got %d", last)
	}
}

func TestLogout(t *testing.T) {
	setupTestDB(t)
	reg := postJSON(t, RegisterHandler, "/api/auth/register", `{"email":"a@b.com","password":"password1"}`)
	c := sessionCookie(t, reg)

	w := postJSON(t, LogoutHandler, "/api/auth/logout", "", c)
	if w.Code != http.StatusNoContent {
		t.Fatalf("logout failed: %d", w.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	req.AddCookie(c)
	if _, ok := currentUser(req); ok {
		t.Error("session should be gone after logout")
	}
}
