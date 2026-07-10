package backend

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Player search against the Czech golf federation (golferis) GraphQL API.
// Proxied through the backend so the API token stays server-side.

const golferisURL = "https://market.golferis.cz/graphql/api"

const golferisQuery = `query findMembers($phrase: String!) {
  FindMembers(phrase: $phrase) {
    ...PlayerInfo
    __typename
  }
}
fragment PlayerInfo on Player {
  id
  age
  email
  phone
  avatar
  memberNumber
  firstName
  lastName
  hcp
  homeClub
  homeMembershipTypeShort
  homeMembershipTypeKey
  isSkga
  homeClubName
  golferIdentifier
  isBlocked
  user {
    gender
    __typename
  }
  cgkMember {
    ...CgkMember
    __typename
  }
}
fragment CgkMember on CgkMemberType {
  isCgkMember
}`

var golferisClient = &http.Client{Timeout: 10 * time.Second}

type golferisMember struct {
	Age              *int            `json:"age"`
	Email            string          `json:"email"`
	MemberNumber     string          `json:"memberNumber"`
	FirstName        string          `json:"firstName"`
	LastName         string          `json:"lastName"`
	HCP              json.RawMessage `json:"hcp"` // string or number, e.g. "54.0"
	HomeClubName     string          `json:"homeClubName"`
	GolferIdentifier string          `json:"golferIdentifier"`
	User             *struct {
		Gender string `json:"gender"`
	} `json:"user"`
}

// parseHCP handles the API returning hcp as either a JSON string or number,
// with a Czech comma decimal separator (e.g. "16,6"); returns nil for null,
// empty, or non-numeric values.
func parseHCP(raw json.RawMessage) *float64 {
	s := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	if s == "" || s == "null" {
		return nil
	}
	s = strings.ReplaceAll(s, ",", ".")
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return &f
}

type golferisSearchResult struct {
	FirstName        string   `json:"first_name"`
	LastName         string   `json:"last_name"`
	Email            string   `json:"email"`
	MemberNumber     string   `json:"member_number"`
	HCP              *float64 `json:"hcp"`
	HomeClubName     string   `json:"home_club_name"`
	Age              *int     `json:"age"`
	Gender           string   `json:"gender"`
	GolferIdentifier string   `json:"golfer_identifier"`
}

func SearchGolferis(w http.ResponseWriter, r *http.Request) {
	token := os.Getenv("GOLFERIS_TOKEN")
	if token == "" {
		writeJSONError(w, http.StatusServiceUnavailable, "player search is not configured (set GOLFERIS_TOKEN)")
		return
	}
	phrase := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(phrase)) < 2 {
		writeJSON(w, map[string]interface{}{"results": []golferisSearchResult{}})
		return
	}

	body, _ := json.Marshal(map[string]interface{}{
		"query":         golferisQuery,
		"operationName": "findMembers",
		"variables":     map[string]string{"phrase": phrase},
	})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, golferisURL, bytes.NewReader(body))
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apptype", "mobile")
	req.Header.Set("appinfo", `{"os":"ios","project":"tycko","version":"2.0.175","appLanguage":"cs"}`)
	req.Header.Set("accept", "multipart/mixed, application/graphql-response+json, application/graphql+json, application/json")
	req.Header.Set("authorization", "Bearer "+token)
	req.Header.Set("origin", "capacitor://app.tycko.cz")
	req.Header.Set("user-agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148")
	req.Header.Set("accept-language", "en-GB,en;q=0.9")

	res, err := golferisClient.Do(req)
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "golferis API request failed: "+err.Error())
		return
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		writeJSONError(w, http.StatusBadGateway, fmt.Sprintf("golferis API returned %d (check GOLFERIS_TOKEN)", res.StatusCode))
		return
	}

	var payload struct {
		Data struct {
			FindMembers []golferisMember `json:"FindMembers"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		writeJSONError(w, http.StatusBadGateway, "failed to read golferis response: "+err.Error())
		return
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		writeJSONError(w, http.StatusBadGateway, "failed to parse golferis response: "+err.Error())
		return
	}
	if len(payload.Errors) > 0 {
		writeJSONError(w, http.StatusBadGateway, "golferis API error: "+payload.Errors[0].Message)
		return
	}

	results := make([]golferisSearchResult, 0, len(payload.Data.FindMembers))
	for _, m := range payload.Data.FindMembers {
		gender := ""
		if m.User != nil {
			gender = m.User.Gender
		}
		results = append(results, golferisSearchResult{
			FirstName:        m.FirstName,
			LastName:         m.LastName,
			Email:            m.Email,
			MemberNumber:     m.MemberNumber,
			HCP:              parseHCP(m.HCP),
			HomeClubName:     m.HomeClubName,
			Age:              m.Age,
			Gender:           gender,
			GolferIdentifier: m.GolferIdentifier,
		})
	}
	sort.Slice(results, func(i, j int) bool {
		li, lj := strings.ToLower(results[i].LastName), strings.ToLower(results[j].LastName)
		if li != lj {
			return li < lj
		}
		return strings.ToLower(results[i].FirstName) < strings.ToLower(results[j].FirstName)
	})
	writeJSON(w, map[string]interface{}{"results": results})
}
