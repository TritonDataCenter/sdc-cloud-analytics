/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * cmd/cainst/modules/test.js: test Instrumenter backend
 */

exports.insinit = function (ins, log, callback)
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
	callback();
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

insTestMetricSeconds.prototype.value = function (callback)
{
	var msecs = new Date().getTime() - this.itms_start.getTime();
	return (callback(parseInt(msecs / 1000, 10)));
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

insTestMetricRandom.prototype.value = function (callback)
{
	return (callback(parseInt(Math.random() * 100, 10)));
};
