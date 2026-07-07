package backend

import (
	"fmt"
	"net/smtp"
	"os"
	"strings"
)

// SendMail sends a plain-text email using SMTP settings from the environment
// (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM). When SMTP_HOST is
// unset the message is logged to stdout instead, so reset/invite links remain
// usable during local development.
func SendMail(to, subject, body string) error {
	host := os.Getenv("SMTP_HOST")
	if host == "" {
		fmt.Printf("SMTP not configured, would send email:\nTo: %s\nSubject: %s\n%s\n", to, subject, body)
		return nil
	}
	port := os.Getenv("SMTP_PORT")
	if port == "" {
		port = "587"
	}
	user := os.Getenv("SMTP_USER")
	pass := os.Getenv("SMTP_PASS")
	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = user
	}

	msg := strings.Join([]string{
		"From: " + from,
		"To: " + to,
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=\"utf-8\"",
		"",
		body,
	}, "\r\n")

	var auth smtp.Auth
	if user != "" {
		auth = smtp.PlainAuth("", user, pass, host)
	}
	return smtp.SendMail(host+":"+port, auth, from, []string{to}, []byte(msg))
}
