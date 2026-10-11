'use strict';

const TYPE_LABELS = {
  restaurant: '🍔 Restaurant',
  cafe: '☕ Café',
  store: '🛒 Store',
  mall: '🛍️ Mall',
  gas_station: '⛽ Gas station',
  hotel: '🏨 Hotel',
  bar: '🍺 Bar',
  public: '🏛️ Public',
  other: '📍 Other',
};
const CATEGORIES = [
  ['overall', 'Overall'],
  ['cleanliness', 'Cleanliness'],
  ['supplies', 'Supplies (paper, soap)'],
  ['privacy', 'Privacy'],
];

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ratingClass = (r) => (r == null ? 'r-none' : r >= 4 ? 'r-good' : r >= 2.5 ? 'r-ok' : 'r-bad');
const starText = (r) => (r == null ? 'No ratings yet' : '★'.repeat(Math.round(r)) + '☆'.repeat(5 - Math.round(r)));
const place = (b) => [b.city, b.country].filter(Boolean).join(', ');

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

// ---------- map ----------

const map = L.map('map', { worldCopyJump: true }).setView([25, 0], 2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const markers = L.layerGroup().addTo(map);
let draftMarker = null;

function pinIcon(b) {
  return L.divIcon({
    className: '',
    html: `<div class="pin ${ratingClass(b.rating)}"><span>${b.rating ?? '?'}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  });
}

map.on('click', (e) => {
  openAddDialog({ lat: e.latlng.lat, lng: e.latlng.lng });
});

// ---------- list + filters ----------

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
  const list = $('#list');
  if (!bathrooms.length) {
    list.innerHTML = '<li class="empty">No bathrooms found. Be the first to add one!</li>';
    return;
  }
  list.innerHTML = bathrooms
    .map(
      (b) => `<li data-id="${esc(b.id)}">
        <div class="badge ${ratingClass(b.rating)}">${b.rating ?? '–'}</div>
        <div>
          <div class="name">${esc(b.name)}</div>
          <div class="meta">${esc(TYPE_LABELS[b.type] || b.type)} · ${esc(place(b) || 'Unknown location')}</div>
          <div class="meta"><span class="stars">${starText(b.rating)}</span> · ${b.reviewCount} review${b.reviewCount === 1 ? '' : 's'}</div>
        </div>
      </li>`,
    )
    .join('');
}

function renderMarkers() {
  markers.clearLayers();
  for (const b of bathrooms) {
    L.marker([b.lat, b.lng], { icon: pinIcon(b), title: b.name })
      .on('click', () => openDetail(b.id))
      .addTo(markers);
  }
}

$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const b = bathrooms.find((x) => x.id === li.dataset.id);
  if (b) map.setView([b.lat, b.lng], Math.max(map.getZoom(), 15));
  openDetail(li.dataset.id);
});

let searchTimer;
$('#search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refresh, 250);
});
$('#typeFilter').addEventListener('change', refresh);
$('#sort').addEventListener('change', refresh);

// ---------- geocoding (OpenStreetMap Nominatim) ----------

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Place search unavailable');
  return res.json();
}

$('#placeSearch').addEventListener('keydown', async (e) => {
  if (e.key !== 'Enter') return;
  const q = e.target.value.trim();
  if (!q) return;
  try {
    const [hit] = await geocode(q);
    if (hit) map.fitBounds([[hit.boundingbox[0], hit.boundingbox[2]], [hit.boundingbox[1], hit.boundingbox[3]]], { maxZoom: 16 });
    else alert('Place not found');
  } catch (err) {
    alert(err.message);
  }
});

$('#locateBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocation not supported');
  navigator.geolocation.getCurrentPosition(
    (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
    () => alert('Could not get your location'),
  );
});

// ---------- star inputs ----------

function starInputs(container) {
  container.innerHTML = CATEGORIES.map(
    ([key, label]) => `<div class="rating-row">
      <span>${label}</span>
      <div class="star-input" data-key="${key}" data-value="0">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n} star">★</button>`).join('')}
      </div>
    </div>`,
  ).join('');
  container.querySelectorAll('.star-input').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-n]');
      if (!btn) return;
      group.dataset.value = btn.dataset.n;
      group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.dataset.n) <= Number(btn.dataset.n)));
    });
  });
}

function readStars(container) {
  const out = {};
  for (const group of container.querySelectorAll('.star-input')) {
    const v = Number(group.dataset.value);
    if (!v) throw new Error('Please rate every category');
    out[group.dataset.key] = v;
  }
  return out;
}

function reviewFields() {
  return `<div class="stars-holder"></div>
    <label>Your name <input name="author" maxlength="40" placeholder="Anonymous"></label>
    <label>Comments <textarea name="comment" rows="3" maxlength="1000" placeholder="How was it?"></textarea></label>`;
}

// ---------- detail dialog ----------

async function openDetail(id) {
  const b = await api(`/api/bathrooms/${encodeURIComponent(id)}`);
  const tags = [
    b.free ? '🆓 Free' : '💰 Paid / customers only',
    b.accessible && '♿ Accessible',
    b.babyChanging && '👶 Baby changing',
  ].filter(Boolean);

  $('#detailBody').innerHTML = `
    <h2>${esc(b.name)}</h2>
    <div class="meta">${esc(TYPE_LABELS[b.type] || b.type)} · ${esc([b.address, place(b)].filter(Boolean).join(', '))}</div>
    <div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <div class="score-grid">
      ${CATEGORIES.map(([k, label]) => {
        const v = k === 'overall' ? b.rating : b[k];
        return `<div class="score"><b>${v ?? '–'}</b><span>${label.split(' ')[0]}</span></div>`;
      }).join('')}
    </div>
    <h3>${b.reviewCount} review${b.reviewCount === 1 ? '' : 's'}</h3>
    <ul class="reviews">
      ${b.reviews.map((r) => `<li>
        <span class="who">${esc(r.author)}</span>
        <span class="stars">${starText(r.overall)}</span>
        <div class="when">${new Date(r.createdAt).toLocaleDateString()} · clean ${r.cleanliness}/5 · supplies ${r.supplies}/5 · privacy ${r.privacy}/5</div>
        ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}
      </li>`).join('') || '<li class="hint">No reviews yet — be the first!</li>'}
    </ul>`;

  const form = $('#reviewForm');
  form.innerHTML = `${reviewFields()}<p class="error"></p><button class="primary" type="submit">Submit rating</button>`;
  starInputs(form.querySelector('.stars-holder'));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector('.error');
    try {
      const fd = new FormData(form);
      await api(`/api/bathrooms/${encodeURIComponent(id)}/reviews`, {
        method: 'POST',
        body: { ...readStars(form), author: fd.get('author'), comment: fd.get('comment') },
      });
      await refresh();
      await openDetail(id);
    } catch (ex) {
      err.textContent = ex.message;
    }
  };

  if (!$('#detail').open) $('#detail').showModal();
}

// ---------- add dialog ----------

function openAddDialog(coords) {
  const form = $('#addForm');
  form.reset();
  $('#addError').textContent = '';
  $('#lookupResults').innerHTML = '';
  $('#addRating').innerHTML = reviewFields();
  starInputs($('#addRating .stars-holder'));
  if (coords) setCoords(coords.lat, coords.lng);
  else {
    const c = map.getCenter();
    setCoords(c.lat, c.lng);
  }
  $('#addDialog').showModal();
}

function setCoords(lat, lng) {
  const form = $('#addForm');
  form.lat.value = Number(lat).toFixed(6);
  form.lng.value = L.latLng(lat, lng).wrap().lng.toFixed(6);
  if (draftMarker) draftMarker.setLatLng([lat, lng]);
  else draftMarker = L.marker([lat, lng], { opacity: 0.6 }).addTo(map);
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

async function runLookup() {
  const q = $('#lookup').value.trim();
  const out = $('#lookupResults');
  if (!q) return;
  out.innerHTML = '<li class="hint">Searching…</li>';
  try {
    const hits = await geocode(q);
    if (!hits.length) {
      out.innerHTML = '<li class="hint">No matches</li>';
      return;
    }
    out.innerHTML = hits.map((h, i) => `<li data-i="${i}">${esc(h.display_name)}</li>`).join('');
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
      setCoords(h.lat, h.lon);
      map.setView([h.lat, h.lon], 17);
      out.innerHTML = '';
    };
  } catch (err) {
    out.innerHTML = `<li class="hint">${esc(err.message)}</li>`;
  }
}

$('#lookupBtn').addEventListener('click', runLookup);
$('#lookup').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runLookup();
  }
});

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  try {
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
    map.setView([created.lat, created.lng], 16);
    openDetail(created.id);
  } catch (err) {
    $('#addError').textContent = err.message;
  }
});

// ---------- dialogs ----------

document.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', () => btn.closest('dialog').close()));

// ---------- init ----------

(async function init() {
  const options = Object.entries(TYPE_LABELS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  $('#typeFilter').insertAdjacentHTML('beforeend', options);
  $('#addType').innerHTML = options;
  try {
    await refresh();
  } catch (err) {
    $('#list').innerHTML = `<li class="empty">Could not load bathrooms: ${esc(err.message)}</li>`;
  }
})();
