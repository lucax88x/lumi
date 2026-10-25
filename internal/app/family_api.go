package app

import (
	"lumi/internal/api"
	"net/http"
)

type portalAPI struct{ *Portal }

func (p *portalAPI) GetStatus(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, false, func(s *Server) { s.GetStatus(w, r) })
}
func (p *portalAPI) ListConversations(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, false, func(s *Server) { s.ListConversations(w, r) })
}
func (p *portalAPI) CreateConversation(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, false, func(s *Server) { s.CreateConversation(w, r) })
}
func (p *portalAPI) GetConversation(w http.ResponseWriter, r *http.Request, familyId string, conversationId string) {
	p.withFamily(w, r, familyId, false, func(s *Server) { s.GetConversation(w, r, conversationId) })
}
func (p *portalAPI) SendMessage(w http.ResponseWriter, r *http.Request, familyId string, conversationId string) {
	p.withFamily(w, r, familyId, false, func(s *Server) { s.SendMessage(w, r, conversationId) })
}
func (p *portalAPI) Transcribe(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, false, func(s *Server) { s.Transcribe(w, r) })
}
func (p *portalAPI) GetSettings(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, true, func(s *Server) { s.GetSettings(w, r) })
}
func (p *portalAPI) UpdateSettings(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, true, func(s *Server) { s.UpdateSettings(w, r) })
}
func (p *portalAPI) GetConnection(w http.ResponseWriter, r *http.Request) {
	p.admin.GetConnection(w, r)
}
func (p *portalAPI) Disconnect(w http.ResponseWriter, r *http.Request) {
	p.familiesMu.Lock()
	for _, family := range p.families {
		family.cancelAll()
	}
	p.familiesMu.Unlock()
	p.admin.Disconnect(w, r)
}
func (p *portalAPI) StartConnection(w http.ResponseWriter, r *http.Request) {
	p.admin.StartConnection(w, r)
}
func (p *portalAPI) CompleteConnection(w http.ResponseWriter, r *http.Request) {
	p.admin.CompleteConnection(w, r)
}
func (p *portalAPI) ListModels(w http.ResponseWriter, r *http.Request) {
	p.admin.ListModels(w, r)
}
func (p *portalAPI) GetAdminSettings(w http.ResponseWriter, r *http.Request) {
	p.admin.GetSettings(w, r)
}
func (p *portalAPI) UpdateAdminSettings(w http.ResponseWriter, r *http.Request) {
	p.admin.UpdateSettings(w, r)
}
func (p *portalAPI) PreviewPrompt(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, true, func(s *Server) { s.PreviewPrompt(w, r) })
}
func (p *portalAPI) ClearConversations(w http.ResponseWriter, r *http.Request, familyId string) {
	p.withFamily(w, r, familyId, true, func(s *Server) { s.ClearConversations(w, r) })
}
func (p *portalAPI) DeleteConversation(w http.ResponseWriter, r *http.Request, familyId string, conversationId string) {
	p.withFamily(w, r, familyId, true, func(s *Server) { s.DeleteConversation(w, r, conversationId) })
}
func (p *portalAPI) SearchWordImages(w http.ResponseWriter, r *http.Request, familyId string, params api.SearchWordImagesParams) {
	p.withFamily(w, r, familyId, false, func(s *Server) { s.SearchWordImages(w, r, params) })
}
