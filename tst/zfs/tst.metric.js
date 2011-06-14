/*
 * tst.metric.js: tests inszMetricImpl
 */

var mod_assert = require('assert');
var mod_metric = require('../../lib/ca/ca-metric');
var mod_zfs = require('../../lib/ca/ca-zfs');
var mod_tl = require('../../lib/tst/ca-test');
var mod_instrzfs = require('../../cmd/cainst/modules/zfs');

var metric, cache, cmd_expected, fields_expected, error_returned, data_returned;

var fake_metric_def = {
	scope: 'dataset',
	columns: [ 'quota' ],
	value: function (dataset) { return (dataset['quota']); }
};

var metadata = new mod_metric.caMetricMetadata();
metadata.addFromHost({
	modules: {},
	types: {},
	fields: { zdataset: { label: 'zdataset' } },
	metrics: []
}, 'in-core');

var instrbei = new mod_tl.caFakeInstrBackendInterface(metadata);


function FakeZfsData(cmd, fields, callback)
{
	mod_assert.equal(cmd, cmd_expected);
	mod_assert.deepEqual(fields, fields_expected);
	setTimeout(function () { callback(error_returned, data_returned); }, 0);
}

function setup()
{
	cmd_expected = 'cazfs';
	error_returned = null;
	cache = new mod_zfs.caZfsDataCache(cmd_expected, FakeZfsData,
	    mod_tl.ctStdout);
	mod_tl.advance();
}

/*
 * Check instrument(), deinstrument(), and basic value().
 */
function check_basic()
{
	metric = new mod_instrzfs.inszMetricImpl(fake_metric_def, {
	    is_predicate: {}, is_decomposition: []
	}, instrbei, cache);

	metric.instrument(function () {
		fields_expected = [ 'quota' ];
		data_returned = { obj1: { quota: 10 }, obj2: { quota: 5 } };
		metric.value(function (val) {
			mod_assert.equal(15, val);
			metric.deinstrument(function () {
				/* deinstrument should have cleared cache */
				fields_expected = [];
				cache.data(mod_tl.advance);
			});

		});
	});
}

/*
 * Check a complex predicate and decomposition.  The actual implementation of
 * predication and decomposition are tested elsewhere so we're just making sure
 * that's being invoked.
 */
function check_complex()
{
	metric = new mod_instrzfs.inszMetricImpl(fake_metric_def, {
	    is_predicate: { or: [
		{ eq: [ 'zdataset', 'foo/bar' ] },
		{ eq: [ 'zdataset', 'foo/bob' ] }
	    ] },
	    is_decomposition: [ 'zdataset' ]
	}, instrbei, cache);

	metric.instrument(function () {
		fields_expected = [ 'quota' ];

		data_returned = {
		    'foo/baz': { quota: 37 },
		    'foo/bar': { quota: 15 },
		    'foo/bob': { quota: 18 },
		    'foo/zoo': { quota: 7 }
		};

		metric.value(function (val) {
			mod_assert.deepEqual(val, {
			    'foo/bar': 15,
			    'foo/bob': 18
			});
			metric.deinstrument(mod_tl.advance);
		});
	});
}

function check_zones()
{
	metric = new mod_instrzfs.inszMetricImpl(fake_metric_def, {
	    is_predicate: {}, is_decomposition: [], is_zones: [ 'foo', 'bar' ]
	}, instrbei, cache);

	mod_assert.deepEqual(metric.izm_predicate, { or: [
	    { eq: ['zdataset', 'zones/foo'] },
	    { eq: ['zdataset', 'zones/bar'] }
	] });

	metric = new mod_instrzfs.inszMetricImpl(fake_metric_def, {
	    is_predicate: { ne: ['hostname', 'bob'] },
	    is_decomposition: [],
	    is_zones: [ 'foo', 'bar' ]
	}, instrbei, cache);

	mod_assert.deepEqual(metric.izm_predicate, { and: [
	    { or: [
		{ eq: ['zdataset', 'zones/foo'] },
		{ eq: ['zdataset', 'zones/bar'] }
	    ] },
	    { ne: ['hostname', 'bob'] }
	] });
}

mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(check_basic);
mod_tl.ctPushFunc(check_complex);
mod_tl.ctPushFunc(check_zones);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
