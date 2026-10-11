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

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(message) {
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
    <label class="field">Name <input name="author" maxlength="40" placeholder="Optional"></label>
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
      <button class="btn" id="writeBtn">Write a review</button>
    </div>
    <form id="reviewForm" class="review-form" hidden novalidate>
      ${reviewFields()}
      <div class="actions">
        <p class="error" role="alert"></p>
        <button type="button" class="btn" id="cancelReview">Cancel</button>
        <button type="submit" class="btn btn-primary">Post review</button>
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
  $('#writeBtn').onclick = () => {
    form.hidden = false;
    $('#writeBtn').hidden = true;
    form.querySelector('.star-input button').focus();
  };
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
        body: { ...readStars(form), author: fd.get('author'), comment: fd.get('comment') },
      });
      await refresh();
      await openDetail(id, { pan: false });
      toast('Review posted.');
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
        <div class="who">${esc(r.author)}</div>
        <div class="when">${date}</div>
      </div>
    </div>
    <div class="review-scores rating-line">${stars(r.overall)} · Cleanliness ${r.cleanliness} · Supplies ${r.supplies} · Privacy ${r.privacy}</div>
    ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
  </li>`;
}

// ---------- add dialog ----------

function openAddDialog(latlng) {
  const form = $('#addForm');
  form.reset();
  $('#addError').textContent = '';
  $('#lookupResults').innerHTML = '';
  $('#addRating').innerHTML = reviewFields();
  bindStars($('#addRating'));
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
    const review = { ...readStars($('#addRating')), author: fd.get('author'), comment: fd.get('comment') };
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

// ---------- init ----------

(async function init() {
  const options = Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#typeFilter').insertAdjacentHTML('beforeend', options);
  $('#addType').innerHTML = options;
  try {
    await refresh();
  } catch (err) {
    $('#list').innerHTML = `<li class="empty">Could not load restrooms. ${esc(err.message)}</li>`;
  }
})();
