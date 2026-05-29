package stealth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"io"
	"sync"
	"time"
)

// MaskProvider manages encryption/decryption of sensitive data
// in memory between beacon intervals.
type MaskProvider struct {
	mu     sync.Mutex
	key    []byte // derived from token
	salt   []byte
	masked bool
	// Encrypted blobs
	encToken       []byte
	encImplantID   []byte
	encResults     []byte
	// Plaintext cache (zeroed after encrypt, restored on decrypt)
	token     string
	implantID string
}

// NewMaskProvider creates a mask provider from the implant token.
// The AES key is derived as SHA256(token+salt)[:16].
func NewMaskProvider(token string) *MaskProvider {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		// Fallback: use nanosecond timestamp
		binary.LittleEndian.PutUint64(salt, uint64(time.Now().UnixNano()))
	}
	return &MaskProvider{
		key:  deriveKey([]byte(token), salt),
		salt: salt,
	}
}

// Mask encrypts sensitive data in memory. After calling Mask, the
// plaintext fields are zeroed until Unmask is called.
func (m *MaskProvider) Mask(token, implantID string, resultsData []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.token = token
	m.implantID = implantID

	var err error
	m.encToken, err = encrypt(m.key, []byte(token))
	if err != nil {
		return err
	}
	m.encImplantID, err = encrypt(m.key, []byte(implantID))
	if err != nil {
		return err
	}
	if len(resultsData) > 0 {
		m.encResults, err = encrypt(m.key, resultsData)
		if err != nil {
			return err
		}
	}

	m.masked = true
	return nil
}

// Unmask decrypts data back into memory. Returns the token and implant ID.
func (m *MaskProvider) Unmask() (token, implantID string, resultsData []byte, err error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.masked {
		return m.token, m.implantID, nil, nil
	}

	decToken, err := decrypt(m.key, m.encToken)
	if err != nil {
		return "", "", nil, err
	}
	decID, err := decrypt(m.key, m.encImplantID)
	if err != nil {
		return "", "", nil, err
	}

	m.token = string(decToken)
	m.implantID = string(decID)

	var results []byte
	if len(m.encResults) > 0 {
		decResults, err := decrypt(m.key, m.encResults)
		if err == nil {
			results = decResults
		}
	}

	return m.token, m.implantID, results, nil
}

// IsMasked returns true if data is currently encrypted.
func (m *MaskProvider) IsMasked() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.masked
}

// Zero wipes all sensitive data from memory.
func Zero(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}

// ---------------------------------------------------------------------------
// AES-128-GCM encryption helpers
// ---------------------------------------------------------------------------

func deriveKey(token, salt []byte) []byte {
	h := sha256.Sum256(append(token, salt...))
	return h[:16] // AES-128
}

func encrypt(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	return aesGCM.Seal(nonce, nonce, plaintext, nil), nil
}

func decrypt(key, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, io.ErrUnexpectedEOF
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	return aesGCM.Open(nil, nonce, ciphertext, nil)
}
