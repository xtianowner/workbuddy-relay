// A single offline entry point: expand only its embedded runtime and application,
// wait for the application, and remove the private temporary directory on exit.
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"
)

//go:embed runtime.gz
var nodePayload []byte

//go:embed application.gz
var applicationPayload []byte

//go:embed manifest.json
var manifestPayload []byte

var version = "development"

type asset struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type manifest struct {
	Runtime     asset `json:"runtime"`
	Application asset `json:"application"`
}

func expand(filename string, payload []byte, expected asset) error {
	if expected.Size <= 0 || expected.Size > 256*1024*1024 || len(expected.SHA256) != 64 {
		return fmt.Errorf("invalid embedded asset manifest")
	}
	source, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(filename, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0700)
	if err != nil {
		return err
	}
	digest := sha256.New()
	count, err := io.Copy(io.MultiWriter(target, digest), io.LimitReader(source, expected.Size+1))
	closeErr := target.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if count != expected.Size || hex.EncodeToString(digest.Sum(nil)) != expected.SHA256 {
		return fmt.Errorf("embedded asset integrity check failed")
	}
	return nil
}

func run() (exitCode int, err error) {
	started := time.Now()
	var metadata manifest
	if err = json.Unmarshal(manifestPayload, &metadata); err != nil {
		return 1, err
	}
	directory, err := os.MkdirTemp("", "workbuddy-relay-")
	if err != nil {
		return 1, err
	}
	defer func() {
		if cleanupErr := os.RemoveAll(directory); cleanupErr != nil && err == nil {
			err = fmt.Errorf("could not remove temporary runtime: %w", cleanupErr)
			if exitCode == 0 {
				exitCode = 1
			}
		}
	}()
	nodeName := "node"
	if runtime.GOOS == "windows" {
		nodeName += ".exe"
	}
	nodePath := filepath.Join(directory, nodeName)
	appPath := filepath.Join(directory, "workbuddy.cjs")
	if err = expand(nodePath, nodePayload, metadata.Runtime); err != nil {
		return 1, err
	}
	if err = expand(appPath, applicationPayload, metadata.Application); err != nil {
		return 1, err
	}
	if len(os.Args) == 2 && os.Args[1] == "--launcher-self-test" {
		output, runtimeErr := exec.Command(nodePath, "--version").Output()
		if runtimeErr != nil {
			return 1, runtimeErr
		}
		if err = os.RemoveAll(directory); err != nil {
			return 1, err
		}
		_, existsErr := os.Stat(directory)
		return 0, json.NewEncoder(os.Stdout).Encode(map[string]any{
			"version": version, "platform": runtime.GOOS, "arch": runtime.GOARCH,
			"runtimeVersion": string(bytes.TrimSpace(output)), "applicationSHA256": metadata.Application.SHA256,
			"runtimeSHA256": metadata.Runtime.SHA256, "elapsedMs": time.Since(started).Milliseconds(),
			"temporaryDirectoryRemoved": os.IsNotExist(existsErr), "applicationStarted": false,
		})
	}
	arguments := append([]string{appPath}, os.Args[1:]...)
	command := exec.Command(nodePath, arguments...)
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	// The app receives the original working directory. It never reads adjacent
	// executable files, network downloads, or an external runtime from PATH.
	command.Env = append(os.Environ(), "WB_PACKAGED_LAUNCHER=1")
	if err = command.Start(); err != nil {
		return 1, err
	}
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(interrupts)
	finished := make(chan error, 1)
	go func() { finished <- command.Wait() }()
	select {
	case err = <-finished:
	case <-interrupts:
		// Console interrupts reach both processes; make termination bounded even
		// when the child ignores them, then clean up only this instance's files.
		_ = command.Process.Kill()
		err = <-finished
	}
	if err != nil {
		if status, ok := err.(*exec.ExitError); ok {
			return status.ExitCode(), nil
		}
		return 1, err
	}
	return 0, nil
}

func main() {
	code, err := run()
	if err != nil {
		fmt.Fprintln(os.Stderr, "WorkBuddy Relay:", err)
		code = 1
	}
	if runtime.GOOS == "windows" && len(os.Args) == 1 && os.Getenv("WB_NO_HOLD") != "1" {
		fmt.Print("\nPress Enter to close...")
		var answer string
		_, _ = fmt.Scanln(&answer)
	}
	if code < 0 || code > 255 {
		fmt.Fprintln(os.Stderr, "Application exited with status", strconv.Itoa(code))
		code = 1
	}
	os.Exit(code)
}
