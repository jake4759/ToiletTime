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

let sb = null; // Supabase client, once the server says sign-in is set up
let token = null; // current Supabase access token
let currentUser = null; // { id, username, avatarUrl, email, emailVerified, ... } from /api/me
let contactEmail = null;
let visitRadiusM = 200;

// People whose reviews this browser hides (kept only in this browser).
const BLOCKED_KEY = 'toilettime.blocked';
let blocked = [];
try {
  blocked = JSON.parse(localStorage.getItem(BLOCKED_KEY) || '[]');
} catch {
  blocked = [];
}
const isBlocked = (id) => !!id && blocked.some((b) => b.id === id);
function saveBlocked() {
  try {
    localStorage.setItem(BLOCKED_KEY, JSON.stringify(blocked));
  } catch {
    // private browsing: the list lasts for this visit only
  }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, code: data.code });
  return data;
}

function toast(message) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), Math.max(2600, message.length * 60));
}

/** Where you are now, sent with reviews so the server can check you've been there (null if unavailable). */
function currentHere() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

/** A short note about what a review earned, if anything. */
function rewardText(rewards) {
  if (!rewards) return '';
  const items = rewards.newItems.map((i) => i.name);
  if (items.length) return ` Unlocked: ${items.join(', ')}! Dress up your character in the ToiletTime app.`;
  if (rewards.levelUp) return ` You're now a ${rewards.level.name}!`;
  return '';
}

const NOT_VISITED_HINT = ' If you\'re there now, allow location access and try again.';
const errorText = (err) => (err.code === 'not_visited' ? err.message + NOT_VISITED_HINT : err.message);

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
    const half = (d) => Math.min(d / 2, 0.03);
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

let reviewCircle = null;
$('#locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('Location is not supported by this browser.');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const here = [pos.coords.latitude, pos.coords.longitude];
      map.setView(here, 16);
      // You can review places inside this circle (or ones you've been near in the last 24 hours).
      reviewCircle?.remove();
      reviewCircle = L.layerGroup([
        L.circle(here, { radius: visitRadiusM, color: '#0f3d3e', weight: 2, opacity: 0.6, fillOpacity: 0.1 }),
        L.circleMarker(here, { radius: 7, color: '#fff', weight: 3, fillColor: '#0f3d3e', fillOpacity: 1 }),
      ])
        .bindTooltip(`You can review places inside this ${visitRadiusM} m circle`)
        .addTo(map);
    },
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
      <p class="muted visit-note">You can rate restrooms you've been to in the last 24 hours. We'll ask for your location to check.</p>
      <div class="actions">
        <p class="error" role="alert"></p>
        <button type="button" class="btn" id="cancelReview">Cancel</button>
        <button type="submit" class="btn btn-primary">${mine ? 'Update review' : 'Post review'}</button>
      </div>
    </form>
    <ul class="reviews">
      ${b.reviews.some((r) => isBlocked(r.userId)) ? '<li class="no-reviews">Some reviews are hidden because you chose to hide those people.</li>' : ''}
      ${b.reviews.filter((r) => !isBlocked(r.userId)).map(renderReview).join('') || '<li class="no-reviews">No reviews yet.</li>'}
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
      const posted = await api(`/api/bathrooms/${encodeURIComponent(id)}/reviews`, {
        method: 'POST',
        body: { ...readStars(form), comment: fd.get('comment'), here: await currentHere() },
      });
      await refresh();
      await openDetail(id, { pan: false });
      toast((mine ? 'Review updated.' : 'Review posted.') + rewardText(posted.rewards));
    } catch (ex) {
      form.querySelector('.error').textContent = errorText(ex);
    }
  };
}

function avatarHtml(url, name) {
  return url
    ? `<span class="avatar"><img src="${esc(url)}" alt=""></span>`
    : `<span class="avatar">${esc(initials(name || '?'))}</span>`;
}

function renderReview(r) {
  const mine = currentUser && r.userId === currentUser.id;
  const date = new Date(r.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `<li>
    <div class="review-top">
      ${avatarHtml(r.authorAvatarUrl, r.author)}
      <div>
        <div class="who">${esc(r.author)}${mine ? ' <span class="you">· You</span>' : ''}</div>
        <div class="when">${date}</div>
      </div>
    </div>
    <div class="review-scores rating-line">${stars(r.overall)} · Cleanliness ${r.cleanliness} · Supplies ${r.supplies} · Privacy ${r.privacy}</div>
    ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
    ${mine
      ? `<div class="review-actions"><button type="button" class="btn-link delete-review" data-delete-review="${esc(r.id)}">Delete my review</button></div>`
      : `<div class="review-actions">
          <button type="button" class="btn-link" data-report-review="${esc(r.id)}">Report</button>
          ${r.userId ? `<button type="button" class="btn-link" data-block-user="${esc(r.userId)}" data-block-name="${esc(r.author)}">Hide this person's reviews</button>` : ''}
        </div>`}
  </li>`;
}

let reportingReview = null;

document.addEventListener('click', (e) => {
  const report = e.target.closest('[data-report-review]');
  if (report) {
    reportingReview = report.dataset.reportReview;
    requireSignedIn('Sign in to report a review.', () => {
      $('#reportForm').reset();
      $('#reportError').textContent = '';
      $('#reportDialog').showModal();
    });
    return;
  }
  const blockBtn = e.target.closest('[data-block-user]');
  if (blockBtn) {
    if (!isBlocked(blockBtn.dataset.blockUser)) {
      blocked.push({ id: blockBtn.dataset.blockUser, username: blockBtn.dataset.blockName });
      saveBlocked();
    }
    toast(`You won't see reviews from ${blockBtn.dataset.blockName}. Undo this in your profile.`);
    if (activeId) openDetail(activeId, { pan: false });
  }
});

$('#reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reason = new FormData(e.target).get('reason');
  if (!reason) return ($('#reportError').textContent = 'Choose a reason.');
  try {
    const result = await api(`/api/reviews/${encodeURIComponent(reportingReview)}/report`, { method: 'POST', body: { reason } });
    $('#reportDialog').close();
    toast("Thanks for reporting. We'll take a look.");
    if (result.hidden) {
      await refresh();
      if (activeId) openDetail(activeId, { pan: false });
    }
  } catch (err) {
    $('#reportError').textContent = err.message;
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-delete-review]');
  if (!btn) return;
  if (!confirm('Delete your review? This removes your rating and comment.')) return;
  try {
    await api(`/api/reviews/${encodeURIComponent(btn.dataset.deleteReview)}`, { method: 'DELETE' });
    toast('Review deleted.');
    await refresh();
    if (activeId) openDetail(activeId, { pan: false });
    if ($('#accountDialog').open) loadMyReviews();
  } catch (err) {
    toast(err.message);
  }
});

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
        here: await currentHere(),
      },
    });
    $('#addDialog').close();
    await refresh();
    await openDetail(created.id);
    toast('Restroom added.' + rewardText(created.rewards));
  } catch (err) {
    $('#addError').textContent = errorText(err);
  }
});

document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));

// ---------- accounts (Supabase) ----------

let afterSignIn = null;
let authEmail = '';
let googleEnabled = false;

const initials = (name) =>
  String(name).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';

const AUTH_ERRORS = {
  invalid_credentials: 'Incorrect email or password.',
  email_not_confirmed: 'Please verify your email first.',
  user_already_exists: 'An account with this email already exists. Try signing in.',
  email_exists: 'An account with this email already exists. Try signing in.',
  weak_password: 'Choose a stronger password: at least 8 characters, not a common one.',
  otp_expired: 'That code is wrong or has expired. Check the latest email or send a new code.',
  over_email_send_rate_limit: 'Too many emails sent. Please wait a few minutes and try again.',
  over_request_rate_limit: 'Too many attempts. Please wait a few minutes and try again.',
  same_password: 'Your new password must be different from the old one.',
  email_address_invalid: 'Enter a valid email address.',
};

/** Throws a friendly error if a Supabase call failed; returns its data otherwise. */
function check({ data, error }) {
  if (error) throw new Error(AUTH_ERRORS[error.code] || error.message || 'Something went wrong. Please try again.');
  return data;
}

/** What still stands between this person and posting: 'signin', 'verify', 'username' or null. */
function missingStep() {
  if (!token) return 'signin';
  if (currentUser && !currentUser.emailVerified) return 'verify';
  if (currentUser && !currentUser.username) return 'username';
  return null;
}

async function loadMe() {
  if (!token) {
    currentUser = null;
  } else {
    try {
      currentUser = (await api('/api/me')).user;
    } catch {
      currentUser = null;
    }
  }
  renderAccountButton();
}

function renderAccountButton() {
  const btn = $('#accountBtn');
  if (currentUser) {
    const name = currentUser.username || currentUser.email;
    btn.innerHTML = `${avatarHtml(currentUser.avatarUrl, name)}<span id="accountLabel">${esc(currentUser.username ? `@${currentUser.username}` : 'Profile')}</span>`;
    btn.setAttribute('aria-label', `Profile, signed in as ${name}`);
  } else {
    btn.innerHTML = `${icon('user')}<span id="accountLabel">Sign in</span>`;
    btn.setAttribute('aria-label', 'Sign in');
  }
}

/** Runs `action` once the person is signed in, verified and has a username. */
function requireAccount(reason, action) {
  const step = missingStep();
  if (!step) return action();
  if (!sb) return toast('Sign-in is not set up on this server yet.');
  afterSignIn = action;
  if (step === 'username') return openUsername();
  if (step === 'verify') return openAuth('verify', { email: currentUser.email, reason: 'Verify your email to start posting.' });
  openAuth('signIn', { reason });
}

/** Like requireAccount, but only needs a sign-in (for reporting). */
function requireSignedIn(reason, action) {
  if (token) return action();
  if (!sb) return toast('Sign-in is not set up on this server yet.');
  afterSignIn = action;
  openAuth('signIn', { reason });
}

function continueAfterSignIn() {
  const step = missingStep();
  if (step === 'verify') return openAuth('verify', { email: currentUser.email });
  if (step === 'username') return openUsername();
  const next = afterSignIn;
  afterSignIn = null;
  if (next) next();
  else if (!$('#detailView').hidden && activeId) openDetail(activeId, { pan: false });
}

// ----- the sign-in dialog

const AUTH_TEXT = {
  signIn: { title: 'Sign in', submit: 'Sign in', switchText: 'New to ToiletTime?', switchLabel: 'Create an account', switchTo: 'signUp' },
  signUp: { title: 'Create an account', submit: 'Create account', switchText: 'Already have an account?', switchLabel: 'Sign in', switchTo: 'signIn' },
  verify: { title: 'Check your email', submit: 'Verify', switchText: 'Wrong email?', switchLabel: 'Start over', switchTo: 'signUp' },
  forgot: { title: 'Reset your password', submit: 'Send code', switchText: 'Remembered it?', switchLabel: 'Sign in', switchTo: 'signIn' },
  reset: { title: 'Choose a new password', submit: 'Save new password', switchText: "Didn't get a code?", switchLabel: 'Send another', switchTo: 'forgot' },
};

function setAuthMode(mode, { reason, note } = {}) {
  const form = $('#authForm');
  const text = AUTH_TEXT[mode];
  form.dataset.mode = mode;
  $('#authTitle').textContent = text.title;
  $('#authSubmit').textContent = text.submit;
  $('#authSwitchText').textContent = text.switchText;
  $('#authSwitch').textContent = text.switchLabel;
  $('#authError').textContent = '';
  $('#socialBlock').hidden = !googleEnabled;
  form.password.autocomplete = mode === 'signUp' ? 'new-password' : 'current-password';
  form.password.placeholder = mode === 'signUp' ? 'At least 8 characters' : '';
  if (authEmail) form.email.value = authEmail;
  form.code.value = '';
  $('#authReason').textContent =
    reason ??
    (mode === 'verify'
      ? `Enter the code we sent to ${authEmail}. It can take a minute to arrive; check spam too.`
      : mode === 'reset'
        ? `If ${authEmail} has an account, we sent it a code. Enter it with your new password.`
        : mode === 'forgot'
          ? "Enter your account's email and we'll send you a code."
          : '');
  $('#authNote').textContent = note || '';
}

function openAuth(mode, { email, reason } = {}) {
  $('#authForm').reset();
  if (email) authEmail = email;
  setAuthMode(mode, { reason });
  if (!$('#authDialog').open) $('#authDialog').showModal();
}

$('#authSwitch').addEventListener('click', () => setAuthMode(AUTH_TEXT[$('#authForm').dataset.mode].switchTo));
$('#forgotLink').addEventListener('click', () => {
  authEmail = $('#authForm').email.value.trim();
  setAuthMode('forgot');
});
// Closing a dialog before finishing (not signed in / no username yet) cancels what was waiting.
$('#authDialog').addEventListener('close', () => {
  if (!token) afterSignIn = null;
});
$('#usernameDialog').addEventListener('close', () => {
  if (missingStep() === 'username') afterSignIn = null;
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-toggle-password]');
  if (!btn) return;
  const input = btn.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const mode = form.dataset.mode;
  const email = form.email.value.trim() || authEmail;
  const submit = $('#authSubmit');
  submit.disabled = true;
  $('#authError').textContent = '';
  try {
    if (mode === 'signIn') {
      const { error } = await sb.auth.signInWithPassword({ email, password: form.password.value });
      if (error?.code === 'email_not_confirmed') {
        authEmail = email;
        await sb.auth.resend({ type: 'signup', email });
        return setAuthMode('verify');
      }
      check({ error });
      await signedIn();
    } else if (mode === 'signUp') {
      if (form.password.value.length < 8) throw new Error('Use at least 8 characters for your password.');
      if (!form.agree.checked) throw new Error('Please confirm you are 13 or older and agree to the Terms and Privacy Policy.');
      const data = check(await sb.auth.signUp({ email, password: form.password.value }));
      authEmail = email;
      if (data.session) await signedIn();
      else setAuthMode('verify');
    } else if (mode === 'verify') {
      const code = form.code.value.trim();
      const first = await sb.auth.verifyOtp({ email: authEmail, token: code, type: 'email' });
      if (first.error) check(await sb.auth.verifyOtp({ email: authEmail, token: code, type: 'signup' }));
      toast('Email verified.');
      await signedIn();
    } else if (mode === 'forgot') {
      check(await sb.auth.resetPasswordForEmail(email));
      authEmail = email;
      setAuthMode('reset');
    } else if (mode === 'reset') {
      if (form.newPassword.value.length < 8) throw new Error('Use at least 8 characters for your new password.');
      check(await sb.auth.verifyOtp({ email: authEmail, token: form.code.value.trim(), type: 'recovery' }));
      check(await sb.auth.updateUser({ password: form.newPassword.value }));
      toast('Password updated.');
      await signedIn();
    }
  } catch (err) {
    $('#authError').textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});

$('#linkSignIn').addEventListener('click', () => setAuthMode('signIn'));

$('#resendLink').addEventListener('click', async () => {
  try {
    check(await sb.auth.resend({ type: 'signup', email: authEmail }));
    setAuthMode('verify', { note: 'New code sent.' });
  } catch (err) {
    $('#authError').textContent = err.message;
  }
});

$('#googleBtn').addEventListener('click', async () => {
  try {
    check(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } }));
  } catch (err) {
    $('#authError').textContent = err.message;
  }
});

async function signedIn() {
  const { data } = await sb.auth.getSession();
  token = data.session?.access_token ?? null;
  await loadMe();
  $('#authDialog').close();
  if (currentUser?.username) toast(`Signed in as @${currentUser.username}.`);
  continueAfterSignIn();
}

// ----- username

function openUsername() {
  $('#usernameForm').reset();
  $('#usernameError').textContent = '';
  $('#usernameDialog').showModal();
}

$('#usernameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    currentUser = (await api('/api/me', { method: 'PATCH', body: { username: e.target.username.value.trim() } })).user;
    renderAccountButton();
    $('#usernameDialog').close();
    toast(`Welcome, @${currentUser.username}!`);
    continueAfterSignIn();
  } catch (err) {
    $('#usernameError').textContent = err.message;
  }
});

// ----- profile

$('#accountBtn').addEventListener('click', () => {
  if (!sb) return toast('Sign-in is not set up on this server yet.');
  const step = missingStep();
  if (step === 'signin') return openAuth('signIn');
  if (step === 'verify') return openAuth('verify', { email: currentUser.email });
  if (step === 'username') return openUsername();
  renderProfile();
  loadMyReviews();
  $('#accountDialog').showModal();
});

function renderProfile() {
  $('#accountAvatar').innerHTML = currentUser.avatarUrl
    ? `<img src="${esc(currentUser.avatarUrl)}" alt="">`
    : esc(initials(currentUser.username));
  $('#removeAvatarBtn').hidden = !currentUser.avatarUrl;
  $('#accountName').textContent = `@${currentUser.username}`;
  $('#accountEmail').textContent = `${currentUser.email}${currentUser.emailVerified ? ' ✓ verified' : ''}`;
  $('#accountSince').textContent = `Member since ${new Date(currentUser.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
  $('#renameForm').username.value = currentUser.username;
  $('#accountError').textContent = '';
  renderBlocked();
}

function renderBlocked() {
  $('#blockedSection').hidden = blocked.length === 0;
  $('#blockedList').innerHTML = blocked
    .map((b) => `<li><div class="mr-main"><div class="mr-name">${esc(b.username)}</div></div>
      <button type="button" class="btn-link" data-unblock="${esc(b.id)}">Show again</button></li>`)
    .join('');
}

$('#blockedList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-unblock]');
  if (!btn) return;
  blocked = blocked.filter((b) => b.id !== btn.dataset.unblock);
  saveBlocked();
  renderBlocked();
  if (activeId) openDetail(activeId, { pan: false });
});

$('#contactLink').addEventListener('click', (e) => {
  e.preventDefault();
  if (contactEmail) location.href = `mailto:${contactEmail}?subject=${encodeURIComponent('ToiletTime support')}`;
  else toast('A support email has not been set up yet.');
});

async function loadMyReviews() {
  const list = $('#myReviews');
  list.innerHTML = '<li class="empty">Loading…</li>';
  try {
    const { reviews } = await api('/api/me/reviews');
    $('#myReviewCount').textContent = `(${reviews.length})`;
    list.innerHTML =
      reviews
        .map(
          (r) => `<li>
            <div class="mr-main" data-open-restroom="${esc(r.restroomId)}">
              <div class="mr-name">${esc(r.restroomName)}</div>
              <div class="mr-meta">${stars(r.overall)} ${new Date(r.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
              ${r.hidden ? '<div class="hidden-badge">Hidden after reports. Edit it to post it again, or contact support.</div>' : ''}
            </div>
            <button type="button" class="icon-btn delete-review" data-delete-review="${esc(r.id)}" aria-label="Delete review of ${esc(r.restroomName)}">${icon('trash')}</button>
          </li>`,
        )
        .join('') || '<li class="empty">You haven’t reviewed any restrooms yet.</li>';
  } catch (err) {
    list.innerHTML = `<li class="empty">${esc(err.message)}</li>`;
  }
}

$('#myReviews').addEventListener('click', (e) => {
  const item = e.target.closest('[data-open-restroom]');
  if (!item) return;
  $('#accountDialog').close();
  openDetail(item.dataset.openRestroom);
});

$('#renameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    currentUser = (await api('/api/me', { method: 'PATCH', body: { username: e.target.username.value.trim() } })).user;
    renderAccountButton();
    renderProfile();
    toast('Username saved.');
  } catch (err) {
    $('#accountError').textContent = err.message;
  }
});

$('#passwordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const value = e.target.newPassword.value;
  try {
    if (value.length < 8) throw new Error('Use at least 8 characters for your new password.');
    check(await sb.auth.updateUser({ password: value }));
    e.target.reset();
    toast('Password changed.');
  } catch (err) {
    $('#accountError').textContent = err.message;
  }
});

/** Shrinks a chosen photo to a 320px square JPEG (base64) before upload. */
function squareJpeg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 320;
      canvas.getContext('2d').drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 320, 320);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a picture we can use."));
    };
    img.src = url;
  });
}

$('#avatarInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const image = await squareJpeg(file);
    currentUser = (await api('/api/me/avatar', { method: 'PUT', body: { image } })).user;
    renderAccountButton();
    renderProfile();
    toast('Profile picture updated.');
    if (!$('#detailView').hidden && activeId) openDetail(activeId, { pan: false });
  } catch (err) {
    $('#accountError').textContent = err.message;
  }
});

$('#removeAvatarBtn').addEventListener('click', async () => {
  try {
    currentUser = (await api('/api/me/avatar', { method: 'DELETE' })).user;
    renderAccountButton();
    renderProfile();
    if (!$('#detailView').hidden && activeId) openDetail(activeId, { pan: false });
  } catch (err) {
    $('#accountError').textContent = err.message;
  }
});

$('#signOutBtn').addEventListener('click', async () => {
  await sb.auth.signOut().catch(() => {});
  token = null;
  currentUser = null;
  renderAccountButton();
  $('#accountDialog').close();
  toast('Signed out.');
  if (!$('#detailView').hidden && activeId) openDetail(activeId, { pan: false });
});

$('#deleteAccountBtn').addEventListener('click', async () => {
  const ok = confirm('Delete your account? This cannot be undone. Your reviews stay on ToiletTime without your name.');
  if (!ok) return;
  try {
    await api('/api/me', { method: 'DELETE' });
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    token = null;
    currentUser = null;
    renderAccountButton();
    $('#accountDialog').close();
    toast('Your account was deleted.');
  } catch (err) {
    $('#accountError').textContent = err.message;
  }
});

/** Connects to Supabase (if the server has it set up) and restores the saved sign-in. */
async function startAuth() {
  renderAccountButton();
  let config = null;
  try {
    const settings = await api('/api/config');
    config = settings.auth;
    contactEmail = settings.contactEmail;
    if (settings.rules?.visitRadiusM) visitRadiusM = settings.rules.visitRadiusM;
  } catch {
    // Browsing still works without accounts.
  }
  if (!config || !window.supabase) return;
  sb = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  });
  fetch(`${config.supabaseUrl}/auth/v1/settings`, { headers: { apikey: config.supabaseKey } })
    .then((r) => r.json())
    .then((s) => (googleEnabled = !!s.external?.google))
    .catch(() => {});
  sb.auth.onAuthStateChange((event, session) => {
    const changed = (session?.access_token ?? null) !== token;
    token = session?.access_token ?? null;
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      renderAccountButton();
    } else if (changed && event !== 'TOKEN_REFRESHED') {
      // Returning from Google sign-in lands here; finish any setup it still needs.
      loadMe().then(() => {
        if (event === 'SIGNED_IN' && missingStep() === 'username' && !$('#usernameDialog').open && !$('#authDialog').open) openUsername();
      });
    }
  });
  const { data } = await sb.auth.getSession();
  token = data.session?.access_token ?? null;
  await loadMe();
}

// ---------- init ----------

(async function init() {
  const options = Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#typeFilter').insertAdjacentHTML('beforeend', options);
  $('#addType').innerHTML = options;
  await startAuth();
  try {
    await refresh();
    loadPlaces();
  } catch (err) {
    $('#list').innerHTML = `<li class="empty">Could not load restrooms. ${esc(err.message)}</li>`;
  }
})();
