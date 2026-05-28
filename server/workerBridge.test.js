import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkerProjectUpdate,
  isAllowedClipUrl,
  normalizeClipRows,
  sanitizeFilename,
  selectNextQueuedProject
} from './workerBridge.js';

test('selectNextQueuedProject picks an explicit project before queue order', () => {
  const projects = [
    { id: 'old', status: 'queued', created_at: '2026-01-01T00:00:00Z' },
    { id: 'target', status: 'failed', created_at: '2026-01-02T00:00:00Z' }
  ];

  assert.equal(selectNextQueuedProject(projects, 'target').id, 'target');
});

test('selectNextQueuedProject picks oldest queued project with footage', () => {
  const projects = [
    { id: 'missing-footage', status: 'queued', footage_url: '', created_at: '2026-01-01T00:00:00Z' },
    { id: 'processing', status: 'processing', footage_url: 'file:///tmp/b.mp4', created_at: '2026-01-02T00:00:00Z' },
    { id: 'newer', status: 'queued', footage_url: 'file:///tmp/c.mp4', created_at: '2026-01-03T00:00:00Z' },
    { id: 'older', status: 'new', footage_url: 'file:///tmp/a.mp4', created_at: '2026-01-02T00:00:00Z' }
  ];

  assert.equal(selectNextQueuedProject(projects)?.id, 'older');
});

test('buildWorkerProjectUpdate merges worker patch into intake_data', () => {
  const project = {
    intake_data: {
      source: 'unsergpt',
      worker: { started_at: 'old' }
    }
  };

  assert.deepEqual(
    buildWorkerProjectUpdate(project, { status: 'processing' }, { label: 'kg_demo' }),
    {
      status: 'processing',
      intake_data: {
        source: 'unsergpt',
        worker: {
          started_at: 'old',
          label: 'kg_demo'
        }
      }
    }
  );
});

test('normalizeClipRows keeps only safe worker clip fields', () => {
  const rows = normalizeClipRows('project-1', [
    {
      project_id: 'other',
      title: 'Best Moment',
      score: '91',
      description: 'Strong hook',
      duration_seconds: '42',
      thumbnail_url: 'https://cdn.example.com/thumb.jpg',
      download_url: 'http://127.0.0.1:8787/output/demo.mp4',
      preview_url: 'file:///Users/adamporsborg/my-videos/output/demo.mp4',
      ignored: true
    }
  ]);

  assert.deepEqual(rows, [
    {
      project_id: 'project-1',
      title: 'Best Moment',
      score: 91,
      description: 'Strong hook',
      duration_seconds: 42,
      thumbnail_url: 'https://cdn.example.com/thumb.jpg',
      download_url: 'http://127.0.0.1:8787/output/demo.mp4',
      preview_url: 'file:///Users/adamporsborg/my-videos/output/demo.mp4'
    }
  ]);
});

test('isAllowedClipUrl accepts local output and rejects unrelated file URLs', () => {
  assert.equal(isAllowedClipUrl('file:///Users/adamporsborg/my-videos/output/demo.mp4'), true);
  assert.equal(isAllowedClipUrl('http://127.0.0.1:8787/output/demo.mp4'), true);
  assert.equal(isAllowedClipUrl('file:///Users/adamporsborg/Desktop/private.mp4'), false);
});

test('sanitizeFilename strips unsafe path characters', () => {
  assert.equal(sanitizeFilename('../../Campaign Clip.mov'), 'Campaign_Clip.mov');
  assert.equal(sanitizeFilename(''), 'footage.mp4');
});
