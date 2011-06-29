/*
 * tst.fakedata.js: tests the fake data backend
 */

var mod_assert = require('assert');
var mod_metric = require('../../lib/ca/ca-metric');
var mod_tl = require('../../lib/tst/ca-test');
var fakebe = require('../../cmd/cainst/modules/fake');

var metadata = new mod_metric.caMetricMetadata();

metadata.addFromHost({
	modules: { sfe: { label: 'Springfield Elementary' } },
	types: { number: { arity: 'numeric' } },
	fields: {
		room:		{ label: 'classroom' },
		student:	{ label: 'student' },
		grade:		{ label: 'grade', type: 'number' }
	},
	metrics: [ {
		module: 'sfe',
		stat: 'itas',
		label: 'independent thought alarms',
		unit: 'alarms',
		fields: [ 'room', 'student' ]
	}, {
		module: 'sfe',
		stat: 'students',
		label: 'children',
		unit: 'students',
		fields: [ 'room', 'grade' ]
	} ]
}, 'in-core');

mod_assert.deepEqual(metadata.problems(), []);
var instrbei = new mod_tl.caFakeInstrBackendInterface(metadata);

var impls = {};

instrbei.registerMetric = function (metr)
{
	var name = metr['module'] + '.' + metr['stat'];
	mod_assert.ok(!(name in impls));
	impls[name] = metr;
};

fakebe.insinit(instrbei, mod_tl.ctStdout);
mod_assert.deepEqual(Object.keys(impls).sort(), [ 'sfe.itas', 'sfe.students' ]);
mod_assert.deepEqual(impls['sfe.itas']['fields'].sort(), ['room', 'student']);
mod_assert.deepEqual(impls['sfe.students']['fields'].sort(), ['grade', 'room']);

var metric, instn, value, keys, instd;

/* Can generate scalars. */
metric = {
	is_module: 'sfe',
	is_stat: 'itas',
	is_predicate: {},
	is_decomposition: [],
	is_granularity: 1
};

instn = impls['sfe.itas']['impl'](metric);
instd = false;
instn.instrument(function () { instd = true; });
mod_assert.ok(instd);
instn.value(function (val) { value = val; });
mod_assert.ok(typeof (value) == 'number');
instn.deinstrument(function () { instd = false; });
mod_assert.ok(!instd);

/* Can generate discrete objects */
metric['is_decomposition'] = [ 'room' ];

instn = impls['sfe.itas']['impl'](metric);
instd = false;
instn.instrument(function () { instd = true; });
mod_assert.ok(instd);
instn.value(function (val) { value = val; });
mod_assert.ok(typeof (value) == 'object');
keys = Object.keys(value);
keys.forEach(function (key) {
	mod_assert.ok(caStartsWith(key, 'room'));
	mod_assert.ok(typeof (value[key]) == 'number');
});
instn.deinstrument(function () { instd = false; });
mod_assert.ok(!instd);

/* Can generate distributions */
metric['stat'] = 'students';
metric['is_decomposition'] = [ 'grade' ];

instn = impls['sfe.students']['impl'](metric);
instd = false;
instn.instrument(function () { instd = true; });
mod_assert.ok(instd);
instn.value(function (val) { value = val; });
mod_assert.ok(Array.isArray(value));
mod_assert.ok(value.length > 0);
value.forEach(function (bucket) {
	mod_assert.ok(Array.isArray(bucket[0]));
	mod_assert.equal(bucket[0].length, 2);
	mod_assert.ok(typeof (bucket[1]) == 'number');
});
instn.deinstrument(function () { instd = false; });
mod_assert.ok(!instd);

/* Can generate discrete-decomposed distributions */
metric['stat'] = 'students';
metric['is_decomposition'] = [ 'room', 'grade' ];

instn = impls['sfe.students']['impl'](metric);
instd = false;
instn.instrument(function () { instd = true; });
mod_assert.ok(instd);
instn.value(function (val) { value = val; });
mod_assert.ok(typeof (value) == 'object');
keys = Object.keys(value);
keys.forEach(function (key) {
	mod_assert.ok(caStartsWith(key, 'room'));
	mod_assert.ok(Array.isArray(value[key]));
	mod_assert.ok(value[key].length > 0);
	value[key].forEach(function (bucket) {
		mod_assert.ok(Array.isArray(bucket[0]));
		mod_assert.equal(bucket[0].length, 2);
		mod_assert.ok(typeof (bucket[1]) == 'number');
	});
});
instn.deinstrument(function () { instd = false; });
mod_assert.ok(!instd);
