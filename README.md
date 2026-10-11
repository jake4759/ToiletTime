# 🚽 ToiletTime

Find and rate bathrooms at stores, restaurants, cafés and more — anywhere in the world.

## Features

- 🌍 **World map** (OpenStreetMap + Leaflet): every bathroom is a pin colored by its rating (green / yellow / red).
- ➕ **Add a bathroom**: click the map to drop a pin, or search for the store/restaurant by name and the address, city, country and type are filled in for you.
- ⭐ **Rate it**: overall, cleanliness, supplies (paper/soap) and privacy, plus a comment.
- 🔍 **Browse others' ratings**: search by name/city/country, filter by place type, sort by top rated, worst rated, most reviewed or newest.
- 📍 **Near me** and **jump to city** to explore bathrooms anywhere.
- Tags for free vs. paid/customers-only, wheelchair accessible and baby changing.

## Run it

Requires Node.js 18+. No dependencies to install.

```bash
npm start          # http://localhost:3000
npm test           # API tests
```

Set `PORT` to change the port and `DB_FILE` to change where ratings are stored
(default `data/db.json`, created on first write; it starts from `data/seed.json`).

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/bathrooms?q=&type=&sort=` | List bathrooms with average ratings |
| POST | `/api/bathrooms` | Add a bathroom (`name`, `lat`, `lng`, optional `review`) |
| GET | `/api/bathrooms/:id` | Bathroom details and all reviews |
| POST | `/api/bathrooms/:id/reviews` | Add a rating (`overall`, `cleanliness`, `supplies`, `privacy` 1–5, `author`, `comment`) |
