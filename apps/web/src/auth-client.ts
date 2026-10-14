let csrfToken = "";
export function setCSRF(token = "") {
  csrfToken = token;
}
export function authHeaders() {
  return { "X-Forma-Request": "1", "X-CSRF-Token": csrfToken };
}
export function requireLogin() {
  setCSRF();
  window.dispatchEvent(new Event("forma:unauthorized"));
}
