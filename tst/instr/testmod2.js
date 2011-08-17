/*
 * Test instrumenter backend.
 */

var mod_assert = require('assert');

var mod_ca = require('../../lib/ca/ca-common');
var mod_instr = require('../../lib/ca/ca-instr');

exports.insinit = function (instr, log)
{
	var metadata, set, metrics, metric;

	metadata = instr.metadata();
	set = metadata.metricSet();
	metrics = set.baseMetrics();

	mod_assert.ok(metrics.length > 0);
	metric = exports.metric = metrics[0];

	instr.registerMetric({
	    module: metric.module(),
	    stat: metric.stat(),
	    fields: metric.fields(), /* different from testmod1 */
	    impl: function (mm) { return (new tmMetricImpl(mm)); }
	});
};

exports.metrics = [];
exports.ninstns = 0;
exports.value = 0;

function tmMetricImpl(metric)
{
	exports.metrics.push(caDeepCopy(metric));
}

tmMetricImpl.prototype.instrument = function (callback)
{
	exports.ninstns++;
	callback();
};

tmMetricImpl.prototype.deinstrument = function (callback)
{
	--exports.ninstns;
	callback();
};

tmMetricImpl.prototype.value = function (callback)
{
	console.error('2 sending value at %s ',
	    mod_ca.caFormatDate(new Date()));
	callback(++exports.value);
};
