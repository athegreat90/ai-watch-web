// Development only. Plays the part of the Nginx proxy: it forwards the read routes to a local
// AI Watch server. The token comes from the environment, never from a file in the repository.
//   AIW_DEV_UPSTREAM  default http://127.0.0.1:8765
//   AIW_DEV_TOKEN     the server's monitor token
const target = process.env.AIW_DEV_UPSTREAM || 'http://127.0.0.1:8765';
const token = process.env.AIW_DEV_TOKEN || '';

module.exports = {
  '/api/status': { target, changeOrigin: true, headers: token ? { 'X-Monitor-Key': token } : {} },
  '/api/sessions': { target, changeOrigin: true, headers: token ? { 'X-Monitor-Key': token } : {} },
  '/health': { target, changeOrigin: true },
};
