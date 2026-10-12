'use strict';

const TYPE_LABELS = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  store: 'Store',
  mall: 'Shopping center',
  gas_station: 'Gas station',
  hotel: 'Hotel',
  bar: 'Bar',
  public: 'Public restroom',
  other: 'Other',
};
const CATEGORIES = [
  ['overall', 'Overall'],
  ['cleanliness', 'Cleanliness'],
  ['supplies', 'Supplies'],
  ['privacy', 'Privacy'],
];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const icon = (name, cls = '') => `<svg class="icon ${cls}"><use href="#i-${name}"/></svg>`;
const ratingClass = (r) => (r == null ? 'r-none' : r >= 4 ? 'r-good' : r >= 2.5 ? 'r-ok' : 'r-bad');
const fmt = (r) => (r == null ? '–' : r.toFixed(1));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const locality = (b) => [b.city, b.country].filter(Boolean).join(', ');
const stars = (r) =>
  `<span class="stars" aria-label="${r == null ? 'No rating' : `${r} out of 5`}">${[1, 2, 3, 4, 5]
    .map((n) => icon('star', r != null && n <= Math.round(r) ? 'on' : ''))
    .join('')}</span>`;

// ---------- session ----------

const TOKEN_KEY = 'toilettime.token';
const storage = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v) => { try { v ? localStorage.setItem(TOKEN_KEY, v) : localStorage.removeItem(TOKEN_KEY); } catch {} },
};
let token = storage.get();
let currentUser = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !path.startsWith('/api/auth/login')) setSession(null);
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- map ----------

const map = L.map('map', { worldCopyJump: true, zoomControl: false }).setView([30, 10], 2);
L.control.zoom({ position: 'bottomright' }).addTo(map);
const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
L.tileLayer(`https://{s}.basemaps.cartocdn.com/${darkMode ? 'dark_all' : 'rastertiles/voyager'}/{z}/{x}/{y}{r}.png`, {
  maxZoom: 19,
  subdomains: 'abcd',
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

const markers = L.layerGroup().addTo(map);
const markerById = new Map();
let draftMarker = null;
let activeId = null;

function pinIcon(b) {
  return L.divIcon({
    className: '',
    html: `<div class="pin ${ratingClass(b.rating)}${b.id === activeId ? ' is-active' : ''}">${b.rating == null ? '–' : fmt(b.rating)}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

map.on('click', (e) => openAddDialog(e.latlng));

// ---------- list ----------

let bathrooms = [];

async function refresh() {
  const params = new URLSearchParams({
    q: $('#search').value.trim(),
    type: $('#typeFilter').value,
    sort: $('#sort').value,
  });
  const data = await api(`/api/bathrooms?${params}`);
  bathrooms = data.bathrooms;
  renderList();
  renderMarkers();
  renderPlaces();
}

function renderList() {
  $('#resultCount').textContent = plural(bathrooms.length, 'restroom');
  const list = $('#list');
  if (!bathrooms.length) {
    list.innerHTML = '<li class="empty">No restrooms match your filters.</li>';
    return;
  }
  list.innerHTML = bathrooms
    .map(
      (b) => `<li data-id="${esc(b.id)}" class="${b.id === activeId ? 'is-active' : ''}">
        <span class="name">${esc(b.name)}</span>
        <span class="score"><span class="score-pill ${ratingClass(b.rating)}">${fmt(b.rating)}</span></span>
        <span class="sub">${esc(TYPE_LABELS[b.type] || b.type)} · ${esc(locality(b) || 'Location not specified')}</span>
        <span class="sub rating-line">${stars(b.rating)} ${plural(b.reviewCount, 'review')}</span>
      </li>`,
    )
    .join('');
}

function renderMarkers() {
  markers.clearLayers();
  markerById.clear();
  for (const b of bathrooms) {
    const m = L.marker([b.lat, b.lng], { icon: pinIcon(b), title: b.name, riseOnHover: true })
      .on('click', () => openDetail(b.id, { pan: false }))
      .addTo(markers);
    markerById.set(b.id, m);
  }
}

// ---------- nearby places (OpenStreetMap) ----------

const PLACES_MIN_ZOOM = 15;
const placesLayer = L.layerGroup().addTo(map);
let places = [];
let placesRequest = 0;

const PLACE_ICONS = { public: 'toilet', restaurant: 'food', cafe: 'food', bar: 'food', store: 'bag', mall: 'bag', gas_station: 'pin', hotel: 'pin', other: 'pin' };

function renderPlaces() {
  placesLayer.clearLayers();
  const rated = new Set(bathrooms.map((b) => b.osmId).filter(Boolean));
  for (const p of places) {
    if (rated.has(p.osmId)) continue;
    const marker = L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        className: '',
        html: `<div class="place-pin${p.isRestroom ? ' restroom' : ''}">${icon(PLACE_ICONS[p.type] || 'pin')}</div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -10],
      }),
      title: p.name,
    });
    const facts = [p.accessible && 'Accessible', p.babyChanging && 'Baby changing', !p.free && 'Customers only'].filter(Boolean);
    const popup = document.createElement('div');
    popup.className = 'place-popup';
    popup.innerHTML = `<b>${esc(p.name)}</b>
      <div class="muted">${esc(TYPE_LABELS[p.type] || p.type)} · Not rated yet${facts.length ? ` · ${esc(facts.join(' · '))}` : ''}</div>
      <button class="btn btn-primary" type="button">Rate this restroom</button>`;
    popup.querySelector('button').addEventListener('click', () => {
      map.closePopup();
      requireAccount('Sign in to rate this restroom.', () => showAddDialog(L.latLng(p.lat, p.lng), p));
    });
    marker.bindPopup(popup).addTo(placesLayer);
  }
}

let placesTimer;
function loadPlaces() {
  clearTimeout(placesTimer);
  if (map.getZoom() < PLACES_MIN_ZOOM) {
    placesLayer.clearLayers();
    return;
  }
  placesTimer = setTimeout(async () => {
    const c = map.getCenter();
    const b = map.getBounds();
    const half = (d) => Math.min(d / 2, 0.06);
    const latHalf = half(b.getNorth() - b.getSouth());
    const lngHalf = half(b.getEast() - b.getWest());
    const lng = L.latLng(c.lat, c.lng).wrap().lng;
    const area = {
      south: Math.max(-90, c.lat - latHalf).toFixed(5),
      north: Math.min(90, c.lat + latHalf).toFixed(5),
      west: Math.max(-180, lng - lngHalf).toFixed(5),
      east: Math.min(180, lng + lngHalf).toFixed(5),
    };
    const request = ++placesRequest;
    try {
      const data = await api(`/api/places?${new URLSearchParams(area)}`);
      if (request !== placesRequest) return;
      const byId = new Map(places.map((p) => [p.osmId, p]));
      for (const p of data.places) byId.set(p.osmId, p);
      places = [...byId.values()].slice(-800);
      renderPlaces();
    } catch {
      // Nearby places are optional; rated restrooms still show.
    }
  }, 400);
}

map.on('moveend', loadPlaces);

function setActive(id) {
  const prev = activeId;
  activeId = id;
  for (const pid of [prev, id]) {
    const b = bathrooms.find((x) => x.id === pid);
    if (b && markerById.has(pid)) {
      markerById.get(pid).setIcon(pinIcon(b)).setZIndexOffset(pid === id ? 1000 : 0);
    }
  }
  document.querySelectorAll('#list li[data-id]').forEach((li) => li.classList.toggle('is-active', li.dataset.id === id));
}

$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openDetail(li.dataset.id);
});

let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refresh, 200);
});
$('#typeFilter').addEventListener('change', refresh);
$('#sort').addEventListener('change', refresh);

// ---------- geocoding (OpenStreetMap Nominatim) ----------

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Location search is unavailable right now.');
  return res.json();
}

$('#placeSearch').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (!q) return;
  try {
    const [hit] = await geocode(q);
    if (!hit) return toast('No matching location found.');
    const [s, n, w, east] = hit.boundingbox.map(Number);
    map.fitBounds([[s, w], [n, east]], { maxZoom: 15 });
  } catch (err) {
    toast(err.message);
  }
});

$('#locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Location is not supported by this browser.');
  navigator.geolocation.getCurrentPosition(
    (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 14),
    () => toast('Unable to determine your location.'),
  );
});

// ---------- rating inputs ----------

function reviewFields() {
  return `<div class="rate-group">
      ${CATEGORIES.map(
        ([key, label]) => `<div class="rate-row">
          <span>${label}</span>
          <div class="star-input" data-key="${key}" data-value="0" role="radiogroup" aria-label="${label}">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" role="radio" aria-checked="false" aria-label="${n} of 5">${icon('star')}</button>`).join('')}
          </div>
        </div>`,
      ).join('')}
    </div>
    <label class="field">Review <textarea name="comment" maxlength="1000" placeholder="Cleanliness, availability, anything others should know"></textarea></label>`;
}

function bindStars(root) {
  root.querySelectorAll('.star-input').forEach((group) => {
    const buttons = [...group.querySelectorAll('button')];
    const paint = (n, cls) => buttons.forEach((b) => b.classList.toggle(cls, Number(b.dataset.n) <= n));
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      group.dataset.value = btn.dataset.n;
      paint(Number(btn.dataset.n), 'on');
      buttons.forEach((b) => b.setAttribute('aria-checked', String(b === btn)));
    });
    group.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('button');
      if (btn) paint(Number(btn.dataset.n), 'hover');
    });
    group.addEventListener('mouseleave', () => paint(0, 'hover'));
  });
}

function readStars(root) {
  const out = {};
  for (const group of root.querySelectorAll('.star-input')) {
    const v = Number(group.dataset.value);
    if (!v) throw new Error('Please rate all four categories.');
    out[group.dataset.key] = v;
  }
  return out;
}

function setStars(root, key, value) {
  const group = root.querySelector(`.star-input[data-key="${key}"]`);
  if (!group) return;
  group.dataset.value = String(value);
  group.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.n) <= value);
    b.setAttribute('aria-checked', String(Number(b.dataset.n) === value));
  });
}

// ---------- detail view ----------

function showList() {
  $('#detailView').hidden = true;
  $('#listView').hidden = false;
  setActive(null);
}

$('#backBtn').addEventListener('click', showList);

async function openDetail(id, { pan = true } = {}) {
  let b;
  try {
    b = await api(`/api/bathrooms/${encodeURIComponent(id)}`);
  } catch (err) {
    return toast(err.message);
  }
  setActive(id);
  if (pan) map.setView([b.lat, b.lng], Math.max(map.getZoom(), 15));

  const amenities = [
    [b.free, 'Free to use', 'Paying customers only'],
    [b.accessible, 'Wheelchair accessible', 'Not wheelchair accessible'],
    [b.babyChanging, 'Baby changing station', 'No baby changing station'],
  ];
  const address = [b.address, locality(b)].filter(Boolean).join(', ');
  const mine = currentUser && b.reviews.find((r) => r.userId === currentUser.id);

  $('#detailBody').innerHTML = `
    <div class="meta">${esc(TYPE_LABELS[b.type] || b.type)}</div>
    <h2>${esc(b.name)}</h2>
    ${address ? `<div class="address">${icon('pin')}${esc(address)}</div>` : ''}

    <div class="summary">
      <div>
        <div class="big">${fmt(b.rating)}</div>
        <div>${stars(b.rating)}</div>
        <div class="count">${plural(b.reviewCount, 'review')}</div>
      </div>
      <div class="bars">
        ${CATEGORIES.slice(1).map(([k, label]) => `<div class="bar">
          <span>${label}</span>
          <span class="track"><span class="fill" style="width:${((b[k] ?? 0) / 5) * 100}%"></span></span>
          <span class="val">${fmt(b[k])}</span>
        </div>`).join('')}
      </div>
    </div>

    <ul class="amenities">
      ${amenities.map(([yes, on, off]) => `<li class="${yes ? '' : 'no'}">${icon(yes ? 'check' : 'close')}${yes ? on : off}</li>`).join('')}
    </ul>

    <div class="section-head">
      <h3>Reviews</h3>
      <button class="btn" id="writeBtn">${mine ? 'Edit your review' : 'Write a review'}</button>
    </div>
    <form id="reviewForm" class="review-form" hidden novalidate>
      ${reviewFields()}
      <div class="actions">
        <p class="error" role="alert"></p>
        <button type="button" class="btn" id="cancelReview">Cancel</button>
        <button type="submit" class="btn btn-primary">${mine ? 'Update review' : 'Post review'}</button>
      </div>
    </form>
    <ul class="reviews">
      ${b.reviews.map(renderReview).join('') || '<li class="no-reviews">No reviews yet.</li>'}
    </ul>`;

  $('#listView').hidden = true;
  $('#detailView').hidden = false;
  $('#detailBody').scrollTop = 0;

  const form = $('#reviewForm');
  bindStars(form);
  if (mine) {
    for (const [key] of CATEGORIES) setStars(form, key, mine[key]);
    form.comment.value = mine.comment;
  }
  $('#writeBtn').onclick = () =>
    requireAccount('Sign in to rate this restroom.', () => {
      form.hidden = false;
      $('#writeBtn').hidden = true;
      form.querySelector('.star-input button').focus();
    });
  $('#cancelReview').onclick = () => {
    form.hidden = true;
    $('#writeBtn').hidden = false;
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(form);
      await api(`/api/bathrooms/${encodeURIComponent(id)}/reviews`, {
        method: 'POST',
        body: { ...readStars(form), comment: fd.get('comment') },
      });
      await refresh();
      await openDetail(id, { pan: false });
      toast(mine ? 'Review updated.' : 'Review posted.');
    } catch (ex) {
      form.querySelector('.error').textContent = ex.message;
    }
  };
}

function renderReview(r) {
  const initials = r.author.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const date = new Date(r.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `<li>
    <div class="review-top">
      <span class="avatar">${esc(initials)}</span>
      <div>
        <div class="who">${esc(r.author)}${currentUser && r.userId === currentUser.id ? ' <span class="you">· You</span>' : ''}</div>
        <div class="when">${date}</div>
      </div>
    </div>
    <div class="review-scores rating-line">${stars(r.overall)} · Cleanliness ${r.cleanliness} · Supplies ${r.supplies} · Privacy ${r.privacy}</div>
    ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
  </li>`;
}

// ---------- add dialog ----------

function openAddDialog(latlng) {
  requireAccount('Sign in to add a restroom.', () => showAddDialog(latlng));
}

function showAddDialog(latlng, place) {
  const form = $('#addForm');
  form.reset();
  $('#addError').textContent = '';
  $('#lookupResults').innerHTML = '';
  $('#addRating').innerHTML = reviewFields();
  bindStars($('#addRating'));
  form.osmId.value = place ? place.osmId : '';
  $('#addTitle').textContent = place ? `Rate ${place.name}` : 'Add a restroom';
  $('#addForm').querySelector('#lookup').closest('.field-icon').hidden = !!place;
  if (place) {
    form.name.value = place.name;
    form.type.value = place.type;
    form.address.value = place.address;
    form.city.value = place.city;
    form.country.value = place.country;
    form.free.checked = place.free;
    form.accessible.checked = place.accessible;
    form.babyChanging.checked = place.babyChanging;
  }
  const { lat, lng } = latlng || map.getCenter();
  setCoords(lat, lng);
  $('#addDialog').showModal();
}

function setCoords(lat, lng) {
  const form = $('#addForm');
  const wrapped = L.latLng(lat, lng).wrap();
  form.lat.value = wrapped.lat.toFixed(6);
  form.lng.value = wrapped.lng.toFixed(6);
  if (draftMarker) draftMarker.setLatLng([lat, lng]);
  else draftMarker = L.marker([lat, lng], { opacity: 0.7 }).addTo(map);
}

$('#addBtn').addEventListener('click', () => openAddDialog());
$('#addDialog').addEventListener('close', () => {
  if (draftMarker) {
    map.removeLayer(draftMarker);
    draftMarker = null;
  }
});

function guessType(hit) {
  const t = `${hit.category}:${hit.type}`;
  if (/fast_food|restaurant|food_court/.test(t)) return 'restaurant';
  if (/cafe/.test(t)) return 'cafe';
  if (/mall/.test(t)) return 'mall';
  if (/fuel/.test(t)) return 'gas_station';
  if (/hotel|hostel|motel/.test(t)) return 'hotel';
  if (/bar|pub/.test(t)) return 'bar';
  if (/^shop:/.test(t)) return 'store';
  if (/toilets/.test(t)) return 'public';
  return 'other';
}

let lookupTimer;
$('#lookup').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(lookupTimer);
    runLookup();
  }
});
$('#lookup').addEventListener('input', () => {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(runLookup, 600);
});

async function runLookup() {
  const q = $('#lookup').value.trim();
  const out = $('#lookupResults');
  if (q.length < 3) {
    out.innerHTML = '';
    return;
  }
  out.innerHTML = '<li class="static">Searching…</li>';
  try {
    const hits = await geocode(q);
    if (!hits.length) {
      out.innerHTML = '<li class="static">No results.</li>';
      return;
    }
    out.innerHTML = hits
      .map((h, i) => {
        const [title, ...rest] = h.display_name.split(', ');
        return `<li data-i="${i}"><b>${esc(h.name || title)}</b><small>${esc(rest.join(', '))}</small></li>`;
      })
      .join('');
    out.onclick = (e) => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      const h = hits[Number(li.dataset.i)];
      const a = h.address || {};
      const form = $('#addForm');
      form.name.value = h.name || h.display_name.split(',')[0];
      form.type.value = guessType(h);
      form.address.value = [a.house_number, a.road].filter(Boolean).join(' ');
      form.city.value = a.city || a.town || a.village || a.suburb || '';
      form.country.value = a.country || '';
      setCoords(Number(h.lat), Number(h.lon));
      map.setView([h.lat, h.lon], 17);
      out.innerHTML = '';
    };
  } catch (err) {
    out.innerHTML = `<li class="static">${esc(err.message)}</li>`;
  }
}

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  try {
    if (!String(fd.get('name')).trim()) throw new Error('Business name is required.');
    const review = { ...readStars($('#addRating')), comment: fd.get('comment') };
    const created = await api('/api/bathrooms', {
      method: 'POST',
      body: {
        name: fd.get('name'),
        type: fd.get('type'),
        address: fd.get('address'),
        city: fd.get('city'),
        country: fd.get('country'),
        lat: Number(fd.get('lat')),
        lng: Number(fd.get('lng')),
        free: fd.has('free'),
        accessible: fd.has('accessible'),
        babyChanging: fd.has('babyChanging'),
        osmId: fd.get('osmId') || undefined,
        review,
      },
    });
    $('#addDialog').close();
    await refresh();
    await openDetail(created.id);
    toast('Restroom added.');
  } catch (err) {
    $('#addError').textContent = err.message;
  }
});

document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));

// ---------- accounts ----------

let afterSignIn = null;
let authMode = 'signIn';

const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

function setSession(session) {
  token = session ? session.token : null;
  currentUser = session ? session.user : null;
  storage.set(token);
  renderAccountButton();
}

function renderAccountButton() {
  const btn = $('#accountBtn');
  if (currentUser) {
    btn.innerHTML = `<span class="avatar">${esc(initials(currentUser.name))}</span><span id="accountLabel">${esc(currentUser.name.split(' ')[0])}</span>`;
    btn.setAttribute('aria-label', `Account, signed in as ${currentUser.name}`);
  } else {
    btn.innerHTML = `${icon('user')}<span id="accountLabel">Sign in</span>`;
    btn.setAttribute('aria-label', 'Sign in');
  }
}

/** Runs `action` now if signed in, otherwise after the user signs in. */
function requireAccount(reason, action) {
  if (currentUser) return action();
  afterSignIn = action;
  openAuth(reason);
}

function setAuthMode(mode) {
  authMode = mode;
  const signUp = mode === 'signUp';
  $('#authTitle').textContent = signUp ? 'Create an account' : 'Sign in';
  $('#authSubmit').textContent = signUp ? 'Create account' : 'Sign in';
  $('#nameField').hidden = !signUp;
  $('#authSwitchText').textContent = signUp ? 'Already have an account?' : 'New to ToiletTime?';
  $('#authSwitch').textContent = signUp ? 'Sign in' : 'Create an account';
  $('#authForm').password.autocomplete = signUp ? 'new-password' : 'current-password';
  $('#authForm').password.placeholder = signUp ? 'At least 8 characters' : '';
  $('#authError').textContent = '';
}

function openAuth(reason) {
  $('#authForm').reset();
  setAuthMode('signIn');
  $('#authReason').textContent = reason || 'Sign in to rate restrooms and add new ones.';
  $('#authDialog').showModal();
}

$('#authSwitch').addEventListener('click', () => setAuthMode(authMode === 'signIn' ? 'signUp' : 'signIn'));
$('#authDialog').addEventListener('close', () => {
  if (!currentUser) afterSignIn = null;
});

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const signUp = authMode === 'signUp';
  try {
    const session = await api(signUp ? '/api/auth/signup' : '/api/auth/login', {
      method: 'POST',
      body: { name: fd.get('name'), email: fd.get('email'), password: fd.get('password') },
    });
    setSession(session);
    $('#authDialog').close();
    toast(signUp ? `Welcome, ${session.user.name}!` : `Signed in as ${session.user.name}.`);
    const next = afterSignIn;
    afterSignIn = null;
    if (next) next();
    else if (!$('#detailView').hidden && activeId) openDetail(activeId, { pan: false });
  } catch (err) {
    $('#authError').textContent = err.message;
  }
});

$('#accountBtn').addEventListener('click', () => {
  if (!currentUser) return openAuth();
  $('#accountAvatar').textContent = initials(currentUser.name);
  $('#accountName').textContent = currentUser.name;
  $('#accountEmail').textContent = currentUser.email;
  $('#accountSince').textContent = `Member since ${new Date(currentUser.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
  $('#accountDialog').showModal();
});

$('#signOutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {});
  setSession(null);
  $('#accountDialog').close();
  toast('Signed out.');
  if (!$('#detailView').hidden && activeId) openDetail(activeId, { pan: false });
});

$('#deleteAccountBtn').addEventListener('click', async () => {
  const ok = confirm('Delete your account? This cannot be undone. Your reviews stay on ToiletTime without your name.');
  if (!ok) return;
  try {
    await api('/api/auth/me', { method: 'DELETE' });
    setSession(null);
    $('#accountDialog').close();
    toast('Your account was deleted.');
  } catch (err) {
    toast(err.message);
  }
});

async function restoreSession() {
  if (!token) return renderAccountButton();
  try {
    const { user } = await api('/api/auth/me');
    setSession({ token, user });
  } catch {
    renderAccountButton();
  }
}

// ---------- init ----------

(async function init() {
  const options = Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#typeFilter').insertAdjacentHTML('beforeend', options);
  $('#addType').innerHTML = options;
  await restoreSession();
  try {
    await refresh();
    loadPlaces();
  } catch (err) {
    $('#list').innerHTML = `<li class="empty">Could not load restrooms. ${esc(err.message)}</li>`;
  }
})();
