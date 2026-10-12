import test from 'node:test';
import assert from 'node:assert/strict';

import { getLocationStatus, isLocationActive } from './location-status.ts';

test('returns active for fresh GPS location', () => {
  const status = getLocationStatus({
    type: 'Point',
    coordinates: [77.1, 28.6],
    source: 'CURRENT_GPS',
    accuracy: 10,
    timestamp: new Date().toISOString(),
  });

  assert.equal(status.isActive, true);
  assert.equal(status.source, 'CURRENT_GPS');
});

test('returns inactive for stale last-known location', () => {
  const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const status = getLocationStatus({
    type: 'Point',
    coordinates: [77.1, 28.6],
    source: 'LAST_KNOWN',
    accuracy: 50,
    timestamp: stale,
  });

  assert.equal(status.isActive, false);
  assert.equal(status.source, 'LAST_KNOWN');
  assert.equal(status.staleMs !== null && status.staleMs > 0, true);
});

test('marks unknown or malformed location as inactive', () => {
  assert.equal(isLocationActive({ type: 'Point', coordinates: [], source: 'UNKNOWN', accuracy: null, timestamp: new Date().toISOString() }), false);
  assert.equal(isLocationActive(null), false);
});
