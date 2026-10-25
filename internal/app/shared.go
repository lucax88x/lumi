package app

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Reuse the original server-wide grant. When upgrading from family grants,
// promote the only connected family; multiple grants require an Admin choice.
// Old files remain untouched and are never loaded by family runtimes again.
func newSharedServer(c Config) (*Server, error) {
	path := filepath.Join(c.DataDir, "chatgpt.json")
	var selectedDir string
	var selected credentials
	if _, err := os.Stat(path); os.IsNotExist(err) {
		files, err := filepath.Glob(filepath.Join(c.DataDir, "families", "*", "chatgpt.json"))
		if err != nil {
			return nil, err
		}
		connected := 0
		for _, file := range files {
			b, err := os.ReadFile(file)
			if err != nil {
				return nil, err
			}
			var creds credentials
			if json.Unmarshal(b, &creds) == nil && creds.RefreshToken != "" && hasPermission(creds.Scopes) {
				connected++
				selected, selectedDir = creds, filepath.Dir(file)
			}
		}
		if connected == 1 {
			if err := os.MkdirAll(c.DataDir, 0700); err != nil {
				return nil, err
			}
			if err := (&OAuth{path: path, creds: selected}).save(); err != nil {
				return nil, err
			}
		} else {
			selectedDir = ""
		}
	}
	shared, err := NewServer(c)
	if err != nil || selectedDir == "" {
		return shared, err
	}
	old, err := OpenStore(selectedDir)
	if err != nil {
		shared.Close()
		return nil, err
	}
	defer old.Close()
	settings, err := old.Settings()
	if err == nil {
		global, e := shared.store.Settings()
		err = e
		if err == nil && global.Model == "" {
			global.Model = settings.Model
			err = shared.store.SaveSettings(global)
		}
	}
	if err != nil {
		shared.Close()
		return nil, err
	}
	return shared, nil
}
