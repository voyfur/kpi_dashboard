import test from 'node:test';
import assert from 'node:assert/strict';
import * as kpi from '../src/domain/kpi.ts';

test('zero stays plotted and a missing point breaks the line', () => {
  assert.equal(typeof kpi.getNumericExtent, 'function');
  assert.equal(typeof kpi.splitKpiLineSegments, 'function');
  const points = [
    { value: '0' },
    { value: null },
    { value: '5.25' },
    { value: '7' },
  ];

  assert.deepEqual(kpi.getNumericExtent(points.map((point) => point.value)), [0, 7]);
  assert.deepEqual(kpi.splitKpiLineSegments(points), [[0], [2, 3]]);
});

test('line extent pads flat values and ignores absent values', () => {
  assert.equal(typeof kpi.getNumericExtent, 'function');
  assert.deepEqual(kpi.getNumericExtent([null, '4.5', '4.5']), [4.275, 4.725]);
  assert.equal(kpi.getNumericExtent([null, null]), null);
});

test('series validation allows two units and blocks mixed cadence or a third unit', () => {
  assert.equal(typeof kpi.validateKpiSeries, 'function');
  const compatible = [
    { cadence: 'week', unit: 'USD' },
    { cadence: 'week', unit: '%' },
  ];
  assert.equal(kpi.validateKpiSeries(compatible), null);
  assert.equal(kpi.validateKpiSeries([{ cadence: 'week', unit: 'USD' }, { cadence: 'month', unit: 'USD' }]), 'cadence');
  assert.equal(kpi.validateKpiSeries([{ cadence: 'week', unit: 'USD' }, { cadence: 'week', unit: '%' }, { cadence: 'week', unit: 'count' }]), 'units');
});
