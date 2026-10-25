package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"lumi/internal/api"
)

var imageWord = regexp.MustCompile(`^[\p{L}\p{N} '\x{2019}-]+$`)

// Fetch only Wikipedia's API. User input is a search term, never a fetch URL.
func (s *Server) SearchWordImages(w http.ResponseWriter, r *http.Request, params api.SearchWordImagesParams) {
	images, err := s.searchImages(r.Context(), params.Word)
	if err != nil {
		var failure *imageSearchError
		if errors.As(err, &failure) {
			problem(w, failure.status, failure.code, failure.message)
		} else {
			problem(w, 503, "images_unavailable", "Non riesco a cercare immagini adesso. Prova tra poco.")
		}
		return
	}
	sendJSON(w, 200, images)
}

type imageSearchError struct {
	status        int
	code, message string
}

func (e *imageSearchError) Error() string { return e.message }

func (s *Server) searchImages(ctx context.Context, word string) ([]api.WordImage, error) {
	word = strings.Join(strings.Fields(word), " ")
	if len([]rune(word)) == 0 || len([]rune(word)) > 80 || !imageWord.MatchString(word) {
		return nil, &imageSearchError{400, "invalid_word", "Scrivi una parola da cercare, per esempio arcobaleno."}
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	query := url.Values{
		"action": {"query"}, "format": {"json"}, "formatversion": {"2"},
		"generator": {"search"}, "gsrsearch": {word}, "gsrnamespace": {"0"}, "gsrlimit": {"3"},
		"prop": {"pageimages"}, "piprop": {"thumbnail|name"}, "pithumbsize": {"480"}, "pilimit": {"3"}, "pilicense": {"free"},
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://it.wikipedia.org/w/api.php?"+query.Encode(), nil)
	req.Header.Set("User-Agent", "Lumi/1.0 (private educational word assistant)")
	client := *s.http
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(req)
	if err != nil {
		return nil, &imageSearchError{503, "images_unavailable", "Non riesco a cercare immagini adesso. Prova tra poco."}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, &imageSearchError{503, "images_unavailable", "Non riesco a cercare immagini adesso. Prova tra poco."}
	}
	var result struct {
		Error json.RawMessage `json:"error"`
		Query struct {
			Pages []struct {
				Title     string `json:"title"`
				Index     int    `json:"index"`
				PageImage string `json:"pageimage"`
				Thumbnail struct {
					Source string `json:"source"`
				} `json:"thumbnail"`
			} `json:"pages"`
		} `json:"query"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 256<<10)).Decode(&result) != nil || len(result.Error) > 0 {
		return nil, &imageSearchError{502, "images_unavailable", "La ricerca delle immagini non è riuscita. Prova tra poco."}
	}
	sort.SliceStable(result.Query.Pages, func(i, j int) bool { return result.Query.Pages[i].Index < result.Query.Pages[j].Index })
	images := []api.WordImage{}
	for _, page := range result.Query.Pages {
		image, err := url.Parse(page.Thumbnail.Source)
		if err != nil || image.Scheme != "https" || (image.Host != "upload.wikimedia.org" && image.Host != "thumb.wikimedia.org") || image.User != nil || page.Title == "" || page.PageImage == "" {
			continue
		}
		images = append(images, api.WordImage{
			Title: page.Title, ImageUrl: image.String(),
			SourceUrl: "https://it.wikipedia.org/wiki/" + url.PathEscape(strings.ReplaceAll(page.Title, " ", "_")),
			CreditUrl: "https://it.wikipedia.org/wiki/File:" + url.PathEscape(strings.ReplaceAll(page.PageImage, " ", "_")),
		})
		if len(images) == 3 {
			break
		}
	}
	return images, nil
}
