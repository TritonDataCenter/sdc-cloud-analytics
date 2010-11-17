/*
 * cmd/cainst/modules/test.js: test Instrumenter backend
 */

exports.insinit = function (ins)
{
	ins.registerModule({ name: 'test', label: 'Test Module' });
	ins.registerMetric({
	    module: 'test',
	    stat: 'seconds',
	    label: 'seconds since instrumented',
	    type: 'time',
	    fields: [],
	    metric: function () { return (new insTestMetricSeconds()); }
	});
	ins.registerMetric({
	    module: 'test',
	    stat: 'random',
	    label: 'random number between 0 and 100',
	    type: 'ops',
	    fields: [],
	    metric: function () { return (new insTestMetricRandom()); }
	});
};

function insTestMetricSeconds()
{
}

insTestMetricSeconds.prototype.instrument = function (callback)
{
	this.itms_start = new Date();
	callback();
};

insTestMetricSeconds.prototype.deinstrument = function (callback)
{
	delete (this.itms_start);
	callback();
};

insTestMetricSeconds.prototype.value = function ()
{
	var msecs = new Date().getTime() - this.itms_start.getTime();
	return (parseInt(msecs / 1000, 10));
};

function insTestMetricRandom()
{
}

insTestMetricRandom.prototype.instrument = function (callback)
{
	callback();
};

insTestMetricRandom.prototype.deinstrument = function (callback)
{
	callback();
};

insTestMetricRandom.prototype.value = function ()
{
	return (parseInt(Math.random() * 100, 10));
};
