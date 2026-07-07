package backend

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
)

const sessionCookieName = "ryder_session"
const sessionLifetime = 30 * 24 * time.Hour

// Dummy hash compared against when the account doesn't exist, so login timing
// doesn't reveal whether an email is registered.
var dummyBcryptHash = []byte("$2a$12$C6UzMDM.H6dfI/f/IKcEeO7ZDVQyXlWCBhHYB3nEqBKuGrEsIvNVe")

type AdminUser struct {
	ID    int
	Email string
}

// --- Token / session helpers ---

func newRandomToken() (token, hash string) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, hashToken(token)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func createSession(userID int) (string, error) {
	token, hash := newRandomToken()
	expires := time.Now().Add(sessionLifetime).UTC()
	if _, err := DB.Exec("INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)", userID, hash, expires); err != nil {
		return "", err
	}
	return token, nil
}

func currentUser(r *http.Request) (*AdminUser, bool) {
	c, err := r.Cookie(sessionCookieName)
	if err != nil || c.Value == "" {
		return nil, false
	}
	var u AdminUser
	err = DB.QueryRow(`SELECT u.id, u.email FROM auth_sessions s JOIN admin_users u ON u.id = s.user_id
		WHERE s.token_hash = ? AND s.expires_at > ?`, hashToken(c.Value), time.Now().UTC()).Scan(&u.ID, &u.Email)
	if err != nil {
		return nil, false
	}
	return &u, true
}

func isAuthenticated(r *http.Request) bool {
	_, ok := currentUser(r)
	return ok
}

func secureCookies() bool {
	return strings.HasPrefix(os.Getenv("BASE_URL"), "https://")
}

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secureCookies(),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(sessionLifetime / time.Second),
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secureCookies(),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func cleanExpiredAuthRows() {
	now := time.Now().UTC()
	_, _ = DB.Exec("DELETE FROM auth_sessions WHERE expires_at <= ?", now)
	_, _ = DB.Exec("DELETE FROM password_reset_tokens WHERE expires_at <= ?", now)
}

// --- CSRF / middleware ---

// checkOrigin rejects cross-origin non-GET requests. Same-origin browser
// requests carry an Origin header whose host matches the request host; when
// the header is absent (curl, old browsers) the SameSite=Lax cookie already
// prevents cross-site credentialed POSTs.
func checkOrigin(r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return u.Host == r.Host
}

func RequireAdminAPI(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !checkOrigin(r) {
			writeJSONError(w, http.StatusForbidden, "invalid origin")
			return
		}
		if !isAuthenticated(r) {
			writeJSONError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		h(w, r)
	}
}

func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// --- Rate limiter ---

var rateLimiter = struct {
	sync.Mutex
	hits map[string][]time.Time
}{hits: map[string][]time.Time{}}

// clientIP prefers the first X-Forwarded-For hop (reverse proxy assumed in
// production; spoofable without one, which is acceptable here).
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func rateAllow(bucket string, r *http.Request, max int, window time.Duration) bool {
	key := bucket + ":" + clientIP(r)
	now := time.Now()
	rateLimiter.Lock()
	defer rateLimiter.Unlock()
	kept := rateLimiter.hits[key][:0]
	for _, t := range rateLimiter.hits[key] {
		if now.Sub(t) < window {
			kept = append(kept, t)
		}
	}
	if len(kept) >= max {
		rateLimiter.hits[key] = kept
		return false
	}
	rateLimiter.hits[key] = append(kept, now)
	return true
}

// --- Auth handlers ---

func validEmail(email string) bool {
	at := strings.Index(email, "@")
	return at > 0 && at < len(email)-1 && !strings.ContainsAny(email, " \t\r\n") && len(email) <= 254
}

// registrationAllowed reports whether email may create an account: either no
// admin exists yet (first user bootstraps) or a pending invite matches. Must
// run inside tx; marks the invite accepted.
func registrationAllowed(tx *sql.Tx, email string) (bool, error) {
	var count int
	if err := tx.QueryRow("SELECT COUNT(*) FROM admin_users").Scan(&count); err != nil {
		return false, err
	}
	if count == 0 {
		return true, nil
	}
	res, err := tx.Exec("UPDATE admin_invites SET accepted_at = CURRENT_TIMESTAMP WHERE email = ? COLLATE NOCASE AND accepted_at IS NULL", email)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func RegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !checkOrigin(r) {
		writeJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}
	if !rateAllow("register", r, 5, time.Hour) {
		writeJSONError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if !validEmail(body.Email) {
		writeJSONError(w, http.StatusBadRequest, "invalid email address")
		return
	}
	if len(body.Password) < 8 {
		writeJSONError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}

	registerMu.Lock()
	defer registerMu.Unlock()
	tx, err := DB.Begin()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	defer func() { _ = tx.Rollback() }()
	allowed, err := registrationAllowed(tx, body.Email)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	if !allowed {
		writeJSONError(w, http.StatusForbidden, "registration is invite-only")
		return
	}
	res, err := tx.Exec("INSERT INTO admin_users (email, password_hash) VALUES (?, ?)", body.Email, string(hash))
	if err != nil {
		writeJSONError(w, http.StatusForbidden, "an account with this email already exists")
		return
	}
	userID, _ := res.LastInsertId()
	if err := tx.Commit(); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}

	token, err := createSession(int(userID))
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	setSessionCookie(w, token)
	writeJSON(w, map[string]string{"email": body.Email})
}

func LoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !checkOrigin(r) {
		writeJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}
	if !rateAllow("login", r, 10, 15*time.Minute) {
		writeJSONError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))

	var userID int
	var pwHash sql.NullString
	err := DB.QueryRow("SELECT id, password_hash FROM admin_users WHERE email = ? COLLATE NOCASE", body.Email).Scan(&userID, &pwHash)
	if err != nil || !pwHash.Valid {
		_ = bcrypt.CompareHashAndPassword(dummyBcryptHash, []byte(body.Password))
		writeJSONError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(pwHash.String), []byte(body.Password)) != nil {
		writeJSONError(w, http.StatusUnauthorized, "invalid email or password")
		return
	}

	cleanExpiredAuthRows()
	token, err := createSession(userID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	setSessionCookie(w, token)
	writeJSON(w, map[string]string{"email": body.Email})
}

func LogoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if c, err := r.Cookie(sessionCookieName); err == nil && c.Value != "" {
		_, _ = DB.Exec("DELETE FROM auth_sessions WHERE token_hash = ?", hashToken(c.Value))
	}
	clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func MeHandler(w http.ResponseWriter, r *http.Request) {
	u, ok := currentUser(r)
	if !ok {
		writeJSONError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	writeJSON(w, map[string]string{"email": u.Email})
}

func ForgotPasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !checkOrigin(r) {
		writeJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}
	if !rateAllow("forgot", r, 3, time.Hour) {
		writeJSONError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))

	// Same response whether or not the account exists (no enumeration).
	var userID int
	if err := DB.QueryRow("SELECT id FROM admin_users WHERE email = ? COLLATE NOCASE", body.Email).Scan(&userID); err == nil {
		token, hash := newRandomToken()
		expires := time.Now().Add(time.Hour).UTC()
		if _, err := DB.Exec("INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)", userID, hash, expires); err == nil {
			link := baseURL() + "/reset?token=" + token
			go func() {
				if err := SendMail(body.Email, "Ryder Cup admin password reset",
					"A password reset was requested for your Ryder admin account.\r\n\r\n"+
						"Reset link (valid 1 hour): "+link+"\r\n\r\n"+
						"If you did not request this, ignore this email."); err != nil {
					fmt.Println("failed to send reset email:", err)
				}
			}()
		}
	}
	writeJSON(w, map[string]string{"message": "If that email is registered, a reset link was sent."})
}

func ResetPasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !checkOrigin(r) {
		writeJSONError(w, http.StatusForbidden, "invalid origin")
		return
	}
	if !rateAllow("reset", r, 10, time.Hour) {
		writeJSONError(w, http.StatusTooManyRequests, "too many attempts, try again later")
		return
	}
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if len(body.Password) < 8 {
		writeJSONError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}

	tx, err := DB.Begin()
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	defer func() { _ = tx.Rollback() }()
	var tokenID, userID int
	err = tx.QueryRow(`SELECT id, user_id FROM password_reset_tokens
		WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`, hashToken(body.Token), time.Now().UTC()).Scan(&tokenID, &userID)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid or expired reset link")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	if _, err := tx.Exec("UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?", tokenID); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	if _, err := tx.Exec("UPDATE admin_users SET password_hash = ? WHERE id = ?", string(hash), userID); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	// A reset invalidates every existing session for the account.
	if _, err := tx.Exec("DELETE FROM auth_sessions WHERE user_id = ?", userID); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	if err := tx.Commit(); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}

	token, err := createSession(userID)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	setSessionCookie(w, token)
	writeJSON(w, map[string]string{"message": "password updated"})
}

// --- Google OAuth ---

func baseURL() string {
	if b := os.Getenv("BASE_URL"); b != "" {
		return strings.TrimRight(b, "/")
	}
	return "http://localhost:" + func() string {
		if p := os.Getenv("PORT"); p != "" {
			return p
		}
		return "8080"
	}()
}

func googleOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		RedirectURL:  baseURL() + "/auth/google/callback",
		Scopes:       []string{"openid", "email"},
		Endpoint:     google.Endpoint,
	}
}

func GoogleLoginHandler(w http.ResponseWriter, r *http.Request) {
	cfg := googleOAuthConfig()
	if cfg.ClientID == "" || cfg.ClientSecret == "" {
		http.Redirect(w, r, "/login?error=google_not_configured", http.StatusFound)
		return
	}
	state, _ := newRandomToken()
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		Secure:   secureCookies(),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600,
	})
	http.Redirect(w, r, cfg.AuthCodeURL(state), http.StatusFound)
}

func GoogleCallbackHandler(w http.ResponseWriter, r *http.Request) {
	stateCookie, err := r.Cookie("oauth_state")
	if err != nil || stateCookie.Value == "" || r.URL.Query().Get("state") != stateCookie.Value {
		http.Redirect(w, r, "/login?error=oauth_failed", http.StatusFound)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "oauth_state", Value: "", Path: "/", MaxAge: -1})

	code := r.URL.Query().Get("code")
	if code == "" {
		http.Redirect(w, r, "/login?error=oauth_failed", http.StatusFound)
		return
	}
	tok, err := googleOAuthConfig().Exchange(r.Context(), code)
	if err != nil {
		fmt.Println("google oauth exchange failed:", err)
		http.Redirect(w, r, "/login?error=oauth_failed", http.StatusFound)
		return
	}
	rawIDToken, _ := tok.Extra("id_token").(string)
	claims, err := parseGoogleIDToken(rawIDToken)
	if err != nil {
		fmt.Println("google id_token invalid:", err)
		http.Redirect(w, r, "/login?error=oauth_failed", http.StatusFound)
		return
	}

	userID, err := findOrCreateGoogleUser(claims.Email, claims.Sub)
	if err != nil {
		if err == errNotInvited {
			http.Redirect(w, r, "/login?error=not_invited", http.StatusFound)
			return
		}
		fmt.Println("google login failed:", err)
		http.Redirect(w, r, "/login?error=oauth_failed", http.StatusFound)
		return
	}

	token, err := createSession(userID)
	if err != nil {
		http.Redirect(w, r, "/login?error=oauth_failed", http.StatusFound)
		return
	}
	setSessionCookie(w, token)
	http.Redirect(w, r, "/adminjd", http.StatusFound)
}

type googleClaims struct {
	Iss           string `json:"iss"`
	Aud           string `json:"aud"`
	Exp           int64  `json:"exp"`
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
}

// parseGoogleIDToken decodes and validates id_token claims without JWKS
// signature verification — sound only because the token arrives directly from
// Google's token endpoint over TLS (OIDC Core 3.1.3.7). Never call this with a
// token supplied by a client.
func parseGoogleIDToken(raw string) (*googleClaims, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("malformed id_token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, err
	}
	var c googleClaims
	if err := json.Unmarshal(payload, &c); err != nil {
		return nil, err
	}
	if c.Iss != "https://accounts.google.com" && c.Iss != "accounts.google.com" {
		return nil, fmt.Errorf("unexpected issuer %q", c.Iss)
	}
	if c.Aud != os.Getenv("GOOGLE_CLIENT_ID") {
		return nil, fmt.Errorf("audience mismatch")
	}
	if time.Now().Unix() >= c.Exp {
		return nil, fmt.Errorf("token expired")
	}
	if !c.EmailVerified || c.Email == "" {
		return nil, fmt.Errorf("email not verified")
	}
	return &c, nil
}

var errNotInvited = fmt.Errorf("not invited")

// registerMu serializes account creation so two concurrent requests cannot
// both pass the "no admins yet" first-user check.
var registerMu sync.Mutex

func findOrCreateGoogleUser(email, sub string) (int, error) {
	email = strings.ToLower(email)
	registerMu.Lock()
	defer registerMu.Unlock()
	tx, err := DB.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	var userID int
	var existingSub sql.NullString
	err = tx.QueryRow("SELECT id, google_sub FROM admin_users WHERE google_sub = ? OR email = ? COLLATE NOCASE", sub, email).Scan(&userID, &existingSub)
	switch err {
	case nil:
		if !existingSub.Valid || existingSub.String == "" {
			if _, err := tx.Exec("UPDATE admin_users SET google_sub = ? WHERE id = ?", sub, userID); err != nil {
				return 0, err
			}
		}
	case sql.ErrNoRows:
		allowed, aerr := registrationAllowed(tx, email)
		if aerr != nil {
			return 0, aerr
		}
		if !allowed {
			return 0, errNotInvited
		}
		res, ierr := tx.Exec("INSERT INTO admin_users (email, google_sub) VALUES (?, ?)", email, sub)
		if ierr != nil {
			return 0, ierr
		}
		id64, _ := res.LastInsertId()
		userID = int(id64)
	default:
		return 0, err
	}
	return userID, tx.Commit()
}

// --- Admin / invite management ---

func InviteAdmin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	inviter, _ := currentUser(r)
	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if !validEmail(body.Email) {
		writeJSONError(w, http.StatusBadRequest, "invalid email address")
		return
	}
	var exists int
	_ = DB.QueryRow("SELECT COUNT(*) FROM admin_users WHERE email = ? COLLATE NOCASE", body.Email).Scan(&exists)
	if exists > 0 {
		writeJSONError(w, http.StatusBadRequest, "this email is already an admin")
		return
	}
	if _, err := DB.Exec("INSERT INTO admin_invites (email, invited_by) VALUES (?, ?)", body.Email, inviter.ID); err != nil {
		writeJSONError(w, http.StatusBadRequest, "this email is already invited")
		return
	}
	// Best effort — the invite stays valid even if the email fails.
	go func() {
		if err := SendMail(body.Email, "Ryder Cup admin invitation",
			"You have been invited to administer the Ryder Cup app.\r\n\r\n"+
				"Visit "+baseURL()+"/login to register with this email address or sign in with Google."); err != nil {
			fmt.Println("failed to send invite email:", err)
		}
	}()
	writeJSON(w, map[string]string{"email": body.Email})
}

func ListInvites(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query("SELECT id, email, created_at, accepted_at IS NOT NULL FROM admin_invites ORDER BY created_at DESC")
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	defer func() { _ = rows.Close() }()
	type invite struct {
		ID        int    `json:"id"`
		Email     string `json:"email"`
		CreatedAt string `json:"created_at"`
		Accepted  bool   `json:"accepted"`
	}
	invites := []invite{}
	for rows.Next() {
		var i invite
		if err := rows.Scan(&i.ID, &i.Email, &i.CreatedAt, &i.Accepted); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "server error")
			return
		}
		invites = append(invites, i)
	}
	writeJSON(w, map[string]any{"invites": invites})
}

func RemoveInvite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSONError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		ID int `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if _, err := DB.Exec("DELETE FROM admin_invites WHERE id = ? AND accepted_at IS NULL", body.ID); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func ListAdminUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := DB.Query("SELECT id, email, google_sub IS NOT NULL, password_hash IS NOT NULL, created_at FROM admin_users ORDER BY created_at")
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "server error")
		return
	}
	defer func() { _ = rows.Close() }()
	type adminInfo struct {
		ID          int    `json:"id"`
		Email       string `json:"email"`
		HasGoogle   bool   `json:"has_google"`
		HasPassword bool   `json:"has_password"`
		CreatedAt   string `json:"created_at"`
	}
	admins := []adminInfo{}
	for rows.Next() {
		var a adminInfo
		if err := rows.Scan(&a.ID, &a.Email, &a.HasGoogle, &a.HasPassword, &a.CreatedAt); err != nil {
			writeJSONError(w, http.StatusInternalServerError, "server error")
			return
		}
		admins = append(admins, a)
	}
	writeJSON(w, map[string]any{"admins": admins})
}
