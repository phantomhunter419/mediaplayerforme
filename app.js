/* Spindle — a hi-fi style Now Playing deck for Spotify
   Vanilla JS, no build step. Everything lives in localStorage on this device. */

(function () {
  'use strict';

  const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';
  const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
  const AUTH_ENDPOINT = 'https://accounts.spotify.com/authorize';
  const API_BASE = 'https://api.spotify.com/v1';
  const POLL_MS = 4000;

  // ---------- element refs ----------
  const el = (id) => document.getElementById(id);
  const connectOverlay = el('connectOverlay');
  const settingsPanel = el('settingsPanel');
  const clientIdInput = el('clientIdInput');
  const redirectUriInput = el('redirectUriInput');
  const trackTitleEl = el('trackTitle');
  const trackArtistEl = el('trackArtist');
  const statusLine = el('statusLine');
  const nowPlayingStatus = el('nowPlayingStatus');
  const elapsedTimeEl = el('elapsedTime');
  const durationTimeEl = el('durationTime');
  const progressFill = el('progressFill');
  const powerLed = el('powerLed');
  const tonearm = el('tonearm');
  const vinylWrap = el('vinylWrap');
  const vinylLabel = el('vinylLabel');
  const vinylLid = el('vinylLid');
  const cdWrap = el('cdWrap');
  const cdDisc = el('cdDisc');
  const cdLid = el('cdLid');
  const swipeHint = el('swipeHint');
  const reelLeft = el('reelLeft');
  const reelRight = el('reelRight');
  const reelLeftTape = el('reelLeftTape');
  const reelRightTape = el('reelRightTape');
  const cassetteTitle = el('cassetteTitle');
  const cassetteSub = el('cassetteSub');
  const nextBtnBig = el('nextBtnBig');
  const playBtnBig = el('playBtnBig');
  const pauseBtnBig = el('pauseBtnBig');
  const stopBtnBig = el('stopBtnBig');
  const toastEl = el('toast');
  const mediaWindow = el('mediaWindow');
  const cassetteBody = el('cassetteBody');
  const tonearmHead = el('tonearmHead');
  const cdHub = el('cdHub');
  const queuePanel = el('queuePanel');
  const queueSearchInput = el('queueSearchInput');
  const queueSearchResultsEl = el('queueSearchResults');
  const queueListEl = el('queueList');
  const queueTabBtn = el('queueTabBtn');
  const settingsTabBtn = el('settingsTabBtn');

  // ---------- small storage helpers ----------
  const store = {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => localStorage.removeItem(k)
  };

  function defaultRedirectUri() {
    return window.location.origin + window.location.pathname;
  }
  function getClientId() { return store.get('sd_client_id') || ''; }
  function getRedirectUri() { return store.get('sd_redirect_uri') || defaultRedirectUri(); }

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
  }

  // ---------- PKCE helpers ----------
  function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    let out = '';
    for (let i = 0; i < length; i++) out += possible[values[i] % possible.length];
    return out;
  }
  async function sha256(plain) {
    const data = new TextEncoder().encode(plain);
    return crypto.subtle.digest('SHA-256', data);
  }
  function base64UrlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // ---------- auth flow ----------
  async function startAuth() {
    const clientId = getClientId();
    if (!clientId) {
      openSettings();
      toast('Add your Spotify Client ID first');
      return;
    }
    const verifier = generateRandomString(64);
    store.set('sd_code_verifier', verifier);
    const challenge = base64UrlEncode(await sha256(verifier));
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: getRedirectUri(),
      code_challenge_method: 'S256',
      code_challenge: challenge,
      scope: SCOPES
    });
    window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async function handleRedirectCallback() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    if (error) {
      toast('Spotify sign-in was cancelled');
      history.replaceState({}, '', window.location.pathname);
      return;
    }
    if (!code) return;

    const verifier = store.get('sd_code_verifier');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
      client_id: getClientId(),
      code_verifier: verifier || ''
    });
    try {
      const resp = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const json = await resp.json();
      history.replaceState({}, '', window.location.pathname);
      if (json.access_token) {
        store.set('sd_access_token', json.access_token);
        if (json.refresh_token) store.set('sd_refresh_token', json.refresh_token);
        store.set('sd_expires_at', String(Date.now() + json.expires_in * 1000));
      } else {
        toast('Could not finish connecting — check Client ID / Redirect URI');
      }
    } catch (e) {
      history.replaceState({}, '', window.location.pathname);
      toast('Network error while connecting');
    }
  }

  async function refreshAccessToken() {
    const refreshToken = store.get('sd_refresh_token');
    const clientId = getClientId();
    if (!refreshToken || !clientId) return false;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId
    });
    try {
      const resp = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      if (!resp.ok) return false;
      const json = await resp.json();
      if (!json.access_token) return false;
      store.set('sd_access_token', json.access_token);
      if (json.refresh_token) store.set('sd_refresh_token', json.refresh_token);
      store.set('sd_expires_at', String(Date.now() + json.expires_in * 1000));
      return true;
    } catch (e) {
      return false;
    }
  }

  async function ensureFreshToken() {
    const token = store.get('sd_access_token');
    if (!token) return false;
    const expiresAt = Number(store.get('sd_expires_at') || 0);
    if (Date.now() > expiresAt - 60000) {
      return refreshAccessToken();
    }
    return true;
  }

  function isConnected() {
    return !!store.get('sd_access_token');
  }

  function disconnect() {
    store.remove('sd_access_token');
    store.remove('sd_refresh_token');
    store.remove('sd_expires_at');
    store.remove('sd_code_verifier');
    stopPolling();
    showConnectOverlay();
    resetInfoStrip();
    toast('Disconnected');
  }

  // ---------- Spotify API ----------
  async function spotifyFetch(path, method) {
    const ok = await ensureFreshToken();
    if (!ok) throw new Error('not authenticated');
    const token = store.get('sd_access_token');
    return fetch(`${API_BASE}${path}`, {
      method: method || 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  let lastArtUrl = null;
  let lastIsPlaying = false;
  let lastTrackId = null;

  async function fetchNowPlaying() {
    if (!isConnected()) return;
    let resp;
    try {
      resp = await spotifyFetch('/me/player/currently-playing?additional_types=track');
    } catch (e) {
      showConnectOverlay();
      return;
    }
    if (resp.status === 204) { showIdle(); return; }
    if (resp.status === 401) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) { disconnect(); }
      return;
    }
    if (!resp.ok) return; // transient — try again next tick
    let data;
    try { data = await resp.json(); } catch (e) { return; }
    if (!data || !data.item) { showIdle(); return; }
    renderNowPlaying(data);
  }

  function formatTime(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function setSpinning(playing) {
    vinylWrap.classList.toggle('spinning', playing);
    cdWrap.classList.toggle('spinning', playing);
    reelLeft.classList.toggle('spinning', playing);
    reelRight.classList.toggle('spinning', playing);
    tonearm.classList.toggle('playing', playing);
    powerLed.classList.toggle('on', playing);
    vinylLid.classList.toggle('open', playing);
    cdLid.classList.toggle('open', playing);
    playBtnBig.classList.toggle('active', playing);
    pauseBtnBig.classList.toggle('active', !playing);
  }

  function updateMarquee() {
    const span = trackTitleEl;
    const container = span.parentElement;
    span.classList.remove('scrolling');
    span.style.removeProperty('--marquee-distance');
    // measure on next frame so layout has settled
    requestAnimationFrame(() => {
      const overflow = span.scrollWidth - container.clientWidth;
      if (overflow > 4) {
        const distance = overflow + 24;
        const duration = Math.max(6, distance / 26);
        span.style.setProperty('--marquee-distance', distance + 'px');
        span.style.setProperty('--marquee-duration', duration + 's');
        span.classList.add('scrolling');
      }
    });
  }

  function updateReelTape(ratio) {
    const clamped = Math.min(1, Math.max(0, ratio));
    const leftInset = 8 + clamped * 32;
    const rightInset = 40 - clamped * 32;
    reelLeftTape.style.inset = leftInset + '%';
    reelRightTape.style.inset = rightInset + '%';
  }

  let currentAmbient = 'A';
  function setAmbient(url) {
    const showEl = currentAmbient === 'A' ? el('ambientB') : el('ambientA');
    const hideEl = currentAmbient === 'A' ? el('ambientA') : el('ambientB');
    showEl.style.backgroundImage = `url("${url}")`;
    showEl.classList.add('visible');
    hideEl.classList.remove('visible');
    currentAmbient = currentAmbient === 'A' ? 'B' : 'A';
  }

  function extractAccentColor(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = el('colorCanvas');
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 24, 24);
          const data = ctx.getImageData(0, 0, 24, 24).data;
          let r = 0, g = 0, b = 0, count = 0;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
          }
          resolve(`${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)}`);
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function renderNowPlaying(data) {
    const item = data.item;
    const title = item.name || 'Unknown title';
    const artists = (item.artists || []).map((a) => a.name).join(', ');
    const images = (item.album && item.album.images) || [];
    const artUrl = images[0] ? images[0].url : null;
    const isPlaying = !!data.is_playing;
    const progressMs = data.progress_ms || 0;
    const durationMs = item.duration_ms || 1;
    const deviceName = data.device ? data.device.name : null;

    const trackId = item.id || title;
    if (trackId && trackId !== lastTrackId) {
      const isFirstLoad = lastTrackId === null;
      lastTrackId = trackId;
      if (!isFirstLoad) {
        cassetteBody.classList.remove('tape-change');
        void cassetteBody.offsetWidth; // restart the animation even if it's still mid-run
        cassetteBody.classList.add('tape-change');
        setTimeout(() => cassetteBody.classList.remove('tape-change'), 950);
      }
    }

    trackTitleEl.textContent = title;
    trackArtistEl.textContent = artists;
    cassetteTitle.textContent = title;
    cassetteSub.textContent = deviceName ? `SIDE A · ${deviceName.toUpperCase()}` : 'SIDE A';

    elapsedTimeEl.textContent = formatTime(progressMs);
    durationTimeEl.textContent = formatTime(durationMs);
    progressFill.style.width = `${Math.min(100, (progressMs / durationMs) * 100)}%`;
    updateReelTape(progressMs / durationMs);

    updateMarquee();

    setSpinning(isPlaying);
    statusLine.textContent = isPlaying ? 'Playing' : 'Paused';
    nowPlayingStatus.textContent = isPlaying ? 'Playing' : 'Paused';
    lastIsPlaying = isPlaying;

    if (artUrl && artUrl !== lastArtUrl) {
      lastArtUrl = artUrl;
      vinylLabel.style.backgroundImage = `url("${artUrl}")`;
      cdDisc.style.backgroundImage = `url("${artUrl}")`;
      vinylLid.style.backgroundImage = `url("${artUrl}")`;
      cdLid.style.backgroundImage = `url("${artUrl}")`;
      setAmbient(artUrl);
      extractAccentColor(artUrl).then((rgb) => {
        if (rgb) document.documentElement.style.setProperty('--art-accent', rgb);
      });
    }

    hideConnectOverlay();
  }

  function showIdle() {
    statusLine.textContent = 'Idle — nothing playing right now';
    nowPlayingStatus.textContent = 'Idle';
    setSpinning(false);
    lastIsPlaying = false;
    hideConnectOverlay();
  }

  function resetInfoStrip() {
    trackTitleEl.textContent = 'Not connected';
    trackArtistEl.textContent = 'Tap connect to link Spotify';
    cassetteTitle.textContent = 'Not connected';
    cassetteSub.textContent = 'SIDE A';
    elapsedTimeEl.textContent = '0:00';
    durationTimeEl.textContent = '0:00';
    progressFill.style.width = '0%';
    statusLine.textContent = 'Not connected';
    nowPlayingStatus.textContent = 'Not connected';
    setSpinning(false);
    lastArtUrl = null;
    lastTrackId = null;
  }

  // ---------- polling ----------
  let pollTimer = null;
  function startPolling() {
    fetchNowPlaying();
    clearInterval(pollTimer);
    pollTimer = setInterval(fetchNowPlaying, POLL_MS);
  }
  function stopPolling() {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function hideConnectOverlay() { connectOverlay.classList.add('hidden'); }
  function showConnectOverlay() { connectOverlay.classList.remove('hidden'); }

  // ---------- transport controls ----------
  async function transportAction(path, method) {
    try {
      const resp = await spotifyFetch(path, method);
      if (resp.status === 404) { toast('Open Spotify on a device first'); return; }
      if (resp.status === 403) { toast('Playback control needs Spotify Premium'); return; }
      setTimeout(fetchNowPlaying, 500);
    } catch (e) {
      toast('Not connected yet');
    }
  }

  nextBtnBig.addEventListener('click', () => transportAction('/me/player/next', 'POST'));
  playBtnBig.addEventListener('click', () => transportAction('/me/player/play', 'PUT'));
  pauseBtnBig.addEventListener('click', () => transportAction('/me/player/pause', 'PUT'));
  stopBtnBig.addEventListener('click', async () => {
    try {
      await spotifyFetch('/me/player/pause', 'PUT');
      await spotifyFetch('/me/player/seek?position_ms=0', 'PUT');
      setTimeout(fetchNowPlaying, 500);
    } catch (e) {
      toast('Not connected yet');
    }
  });

  // ---------- format switching ----------
  const FORMAT_ORDER = ['vinyl', 'cd', 'cassette'];
  function setFormat(fmt) {
    document.querySelectorAll('.format-tab').forEach((t) => t.classList.toggle('active', t.dataset.format === fmt));
    document.querySelectorAll('.media-format').forEach((m) => m.classList.toggle('active', m.dataset.format === fmt));
    store.set('sd_format', fmt);
  }
  document.querySelectorAll('.format-tab').forEach((tab) => {
    tab.addEventListener('click', () => setFormat(tab.dataset.format));
  });

  let touchStartX = null;
  let touchStartY = null;
  mediaWindow.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  mediaWindow.addEventListener('touchend', (e) => {
    if (touchStartX === null || touchStartY === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    touchStartX = null;
    touchStartY = null;

    if (Math.abs(dy) > Math.abs(dx)) {
      if (dy < -50) openQueue(e);
      return;
    }
    if (Math.abs(dx) < 40) return;
    const current = store.get('sd_format') || 'vinyl';
    let idx = FORMAT_ORDER.indexOf(current);
    idx = dx < 0 ? (idx + 1) % FORMAT_ORDER.length : (idx - 1 + FORMAT_ORDER.length) % FORMAT_ORDER.length;
    setFormat(FORMAT_ORDER[idx]);
  }, { passive: true });

  // ---------- queue panel ----------
  function makeTrackRow(track, addable) {
    const row = document.createElement('div');
    row.className = 'queue-row';

    const images = (track.album && track.album.images) || [];
    const thumbUrl = images.length ? images[images.length - 1].url : '';
    const img = document.createElement('img');
    img.className = 'queue-thumb';
    img.src = thumbUrl;
    img.alt = '';

    const meta = document.createElement('div');
    meta.className = 'queue-meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'queue-track-name';
    nameEl.textContent = track.name;
    const artistEl = document.createElement('div');
    artistEl.className = 'queue-track-artist';
    artistEl.textContent = (track.artists || []).map((a) => a.name).join(', ');
    meta.append(nameEl, artistEl);

    row.append(img, meta);

    if (addable) {
      const btn = document.createElement('button');
      btn.className = 'queue-add-btn';
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11,5H13V11H19V13H13V19H11V13H5V11H11Z"/></svg>';
      btn.addEventListener('click', () => addToQueue(track.uri, btn));
      row.append(btn);
    }
    return row;
  }

  async function loadQueue() {
    queueListEl.innerHTML = '';
    try {
      const resp = await spotifyFetch('/me/player/queue');
      if (!resp.ok) { queueListEl.innerHTML = '<div class="queue-empty">Couldn\'t load the queue.</div>'; return; }
      const data = await resp.json();
      const items = (data.queue || []).slice(0, 15);
      if (items.length === 0) {
        queueListEl.innerHTML = '<div class="queue-empty">Nothing queued next.</div>';
        return;
      }
      items.forEach((t) => queueListEl.appendChild(makeTrackRow(t, false)));
    } catch (e) {
      queueListEl.innerHTML = '<div class="queue-empty">Couldn\'t load the queue.</div>';
    }
  }

  let searchDebounceTimer;
  async function searchTracks(query) {
    if (!query) { queueSearchResultsEl.innerHTML = ''; return; }
    try {
      const resp = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=10`);
      if (!resp.ok) return;
      const data = await resp.json();
      const items = (data.tracks && data.tracks.items) || [];
      queueSearchResultsEl.innerHTML = '';
      if (items.length === 0) {
        queueSearchResultsEl.innerHTML = '<div class="queue-empty">No matches.</div>';
        return;
      }
      items.forEach((t) => queueSearchResultsEl.appendChild(makeTrackRow(t, true)));
    } catch (e) { /* ignore transient search errors */ }
  }
  queueSearchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    const q = queueSearchInput.value.trim();
    searchDebounceTimer = setTimeout(() => searchTracks(q), 400);
  });

  async function addToQueue(uri, btnEl) {
    btnEl.disabled = true;
    try {
      const resp = await spotifyFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}`, 'POST');
      if (resp.status === 404) { toast('Open Spotify on a device first'); }
      else if (resp.status === 403) { toast('Adding to queue needs Spotify Premium'); }
      else if (resp.ok) { toast('Added to queue'); setTimeout(loadQueue, 400); }
      else { toast('Could not add that track'); }
    } catch (e) {
      toast('Not connected yet');
    } finally {
      btnEl.disabled = false;
    }
  }

  function setQueueOrigin(originEvent) {
    const rect = mediaWindow.getBoundingClientRect();
    let x = rect.left + rect.width / 2;
    let y = rect.top + rect.height * 0.65;
    if (originEvent) {
      if (originEvent.changedTouches && originEvent.changedTouches[0]) {
        x = originEvent.changedTouches[0].clientX;
        y = originEvent.changedTouches[0].clientY;
      } else if (typeof originEvent.clientX === 'number' && (originEvent.clientX || originEvent.clientY)) {
        x = originEvent.clientX;
        y = originEvent.clientY;
      }
    }
    const originX = Math.min(100, Math.max(0, ((x - rect.left) / rect.width) * 100)).toFixed(1);
    const originY = Math.min(100, Math.max(0, ((y - rect.top) / rect.height) * 100)).toFixed(1);
    queuePanel.style.setProperty('--queue-origin-x', originX + '%');
    queuePanel.style.setProperty('--queue-origin-y', originY + '%');
  }

  function openQueue(originEvent) {
    queueSearchInput.value = '';
    queueSearchResultsEl.innerHTML = '';
    loadQueue();
    setQueueOrigin(originEvent);
    queuePanel.classList.add('visible');
    queueTabBtn.classList.add('active');
    const currentFormat = store.get('sd_format') || 'vinyl';
    if (currentFormat === 'cassette') cassetteBody.classList.add('flip-open');
    store.set('sd_hint_seen', '1');
    swipeHint.classList.add('hidden');
  }
  function closeQueue() {
    queuePanel.classList.remove('visible');
    queueTabBtn.classList.remove('active');
    cassetteBody.classList.remove('flip-open');
  }

  queueTabBtn.addEventListener('click', (e) => {
    if (queuePanel.classList.contains('visible')) closeQueue();
    else openQueue(e);
  });
  el('closeQueue').addEventListener('click', closeQueue);
  cassetteBody.addEventListener('click', (e) => openQueue(e));

  function pulseAndOpenQueue(targetEl, e) {
    targetEl.classList.remove('queue-tap');
    void targetEl.offsetWidth;
    targetEl.classList.add('queue-tap');
    setTimeout(() => targetEl.classList.remove('queue-tap'), 460);
    openQueue(e);
  }
  tonearmHead.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!tonearm.classList.contains('playing')) return;
    pulseAndOpenQueue(tonearmHead, e);
  });
  cdHub.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!cdWrap.classList.contains('spinning')) return;
    pulseAndOpenQueue(cdHub, e);
  });

  // ---------- settings panel ----------
  function openSettings() {
    clientIdInput.value = getClientId();
    redirectUriInput.value = getRedirectUri();
    settingsPanel.classList.remove('hidden');
    settingsTabBtn.classList.add('active');
  }
  function closeSettings() {
    settingsPanel.classList.add('hidden');
    settingsTabBtn.classList.remove('active');
  }

  settingsTabBtn.addEventListener('click', () => {
    if (settingsPanel.classList.contains('hidden')) openSettings();
    else closeSettings();
  });
  el('openSettingsFromConnect').addEventListener('click', openSettings);
  el('closeSettings').addEventListener('click', closeSettings);
  el('saveSettings').addEventListener('click', () => {
    store.set('sd_client_id', clientIdInput.value.trim());
    store.set('sd_redirect_uri', redirectUriInput.value.trim());
    closeSettings();
    toast('Saved');
  });
  el('disconnectBtn').addEventListener('click', () => {
    closeSettings();
    disconnect();
  });
  el('connectBtn').addEventListener('click', startAuth);

  // ---------- init ----------
  window.addEventListener('resize', () => updateMarquee());
  window.addEventListener('orientationchange', () => setTimeout(updateMarquee, 300));

  (async function init() {
    setFormat(store.get('sd_format') || 'vinyl');
    resetInfoStrip();
    if (store.get('sd_hint_seen')) swipeHint.classList.add('hidden');
    await handleRedirectCallback();
    if (isConnected()) {
      hideConnectOverlay();
      startPolling();
    } else {
      showConnectOverlay();
    }
  })();
})();
