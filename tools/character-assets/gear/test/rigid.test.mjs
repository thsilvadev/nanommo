import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRigid } from '../lib/rigid.mjs';
import { boxDoc } from './fixtures.mjs';

test('a 2 m tall piece is moved to its pivot and scaled to 0.5 m along +Y', () => {
  const { doc } = boxDoc([0, 1, 0], [0.05, 1, 0.05], 'Staff');
  boxDoc([5, 5, 5], [1, 1, 1], 'Other', doc);
  const out = extractRigid(doc, 'Staff', { pivot: [0, 1, 0], length: 0.5 });
  const nodes = out.getRoot().listNodes().filter((n) => n.getMesh());
  assert.deepEqual(nodes.map((n) => n.getName()), ['Staff']);
  const P = nodes[0].getMesh().listPrimitives()[0].getAttribute('POSITION');
  const min = P.getMinNormalized([]), max = P.getMaxNormalized([]);
  assert.ok(Math.abs(min[1] + 0.25) < 0.001 && Math.abs(max[1] - 0.25) < 0.001, `${min} ${max}`);
});

test("'up: z' turns the piece's Z axis onto +Y", () => {
  const { doc } = boxDoc([0, 0, 0], [0.05, 0.05, 1], 'Lying');
  const out = extractRigid(doc, 'Lying', { up: 'z' });
  const P = out.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
  assert.ok(P.getMaxNormalized([])[1] > 0.99);
});
