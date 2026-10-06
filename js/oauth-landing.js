// Receives Google's response on /oauth.html and passes it to the main LifeMail window.
(function () {
  var h = new URLSearchParams(location.hash.slice(1));
  var q = new URLSearchParams(location.search);
  var res = {
    access_token: h.get('access_token'), expires_in: h.get('expires_in'), scope: h.get('scope'),
    state: h.get('state') || q.get('state'), error: h.get('error') || q.get('error'),
  };
  history.replaceState(null, '', '/oauth.html'); // remove the token from the address bar
  var mode = (res.state || '').split('.')[1];
  if (mode === 'redirect') {
    sessionStorage.setItem('lm_oauth_redirect_result', JSON.stringify(res));
    location.replace('/');
    return;
  }
  try { new BroadcastChannel('lifemail-oauth').postMessage(res); } catch (e) {}
  try { localStorage.setItem('lm_oauth_result', JSON.stringify(res)); } catch (e) {}
  document.getElementById('m').textContent = 'Signed in. You can close this window.';
  setTimeout(function () { window.close(); }, 300);
})();
