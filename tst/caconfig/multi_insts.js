/*
 * Tests having instrumenters that support different sets of metrics.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');
var mod_metric = require('../../lib/ca/ca-metric');
var HTTP = require('../../lib/ca/http-constants');

var log = mod_tl.ctStdout;
var http_port = mod_ca.ca_http_port_config;
var url_create = '/ca/instrumentations?profile=none';
var http, aggregator, instr1, instr2;

mod_tl.ctSetTimeout(10 * 1000);

/* Metrics common to both instrumenters. */
var metric_common = {
	module: 'syscall',
	stat: 'ops',
	decomposition: [ 'f1', 'f2' ]
};

/* Metrics supported only by "instr1" */
var metric_instr1 = {
	module: 'syscall',
	stat: 'ops',
	decomposition: [ 'f2', 'f3' ]
};

/* Metrics supported only by "instr2" */
var metric_instr2 = [ {
	module: 'syscall',
	stat: 'ops',
	predicate: { eq: [ 'f4', 'foo' ] }
}, {
	module: 'instr2',
	stat: 'jobs'
} ];

/* Backend list of metrics supported by "instr1" */
var metrics1 = mod_metric.caMetricsExpand({
    syscall: {
	label: 'system calls',
	stats: {
	    ops: {
		label: 'operations',
		type: 'ops',
		fields: {
		    f1: { label: 'field 1', type: 'string' },
		    f2: { label: 'field 2', type: 'latency' },
		    f3: { label: 'field 3', type: 'string' }
		}
	    }
	}
    }
});

/* Backend list of metrics supported by "instr2" */
var metrics2 = mod_metric.caMetricsExpand({
    syscall: {
	label: 'system calls',
	stats: {
	    ops: {
		label: 'operations',
		type: 'ops',
		fields: {
		    f1: { label: 'field 1', type: 'string' },
		    f2: { label: 'field 2', type: 'latency' },
		    f4: { label: 'field 4', type: 'string' }
		}
	    }
	}
    },
    instr2: {
	label: 'instrumenter two-specific metric',
	stats: {
	    jobs: {
		label: 'instrumenter two-specific jobs',
		type: 'ops',
		fields: {}
	    }
	}
    }
});

/*
 * Setup test scaffolding
 */
function setup()
{
	http = new mod_tl.ctHttpRequester(http_port);
	instr1 = new mod_tl.ctDummyInstrumenter(metrics1);
	instr2 = new mod_tl.ctDummyInstrumenter(metrics2);
	aggregator = new mod_tl.ctDummyAggregator();

	mod_tl.ctWaitForAmqpService(mod_ca.ca_amqp_key_config, function () {
	    caRunParallel([
		function (callback) { instr1.start(callback); },
		function (callback) { instr2.start(callback); },
		function (callback) { aggregator.start(callback); }
	    ], mod_tl.advance);
	});
}

mod_tl.ctPushFunc(setup);

/*
 * Check an instrumentation common to both.
 */
function check_common()
{
	enable_metric(metric_common, function (instrs) {
	    ASSERT(instrs.length == 2);
	    mod_assert.deepEqual(instrs.sort(), [ 'instr1', 'instr2' ]);
	    mod_tl.advance();
	});
}

mod_tl.ctPushFunc(check_common);

/*
 * Check an instrumentation that only instr1 provides.
 */
function check_instr1()
{
	enable_metric(metric_instr1, function (instrs) {
	    ASSERT(instrs.length == 1);
	    mod_assert.deepEqual(instrs.sort(), [ 'instr1' ]);
	    mod_tl.advance();
	});
}

mod_tl.ctPushFunc(check_instr1);

/*
 * Check an instrumentation that only instr2 provides.
 */
function check_instr2_fields()
{
	enable_metric(metric_instr2[0], function (instrs) {
	    ASSERT(instrs.length == 1);
	    mod_assert.deepEqual(instrs.sort(), [ 'instr2' ]);
	    mod_tl.advance();
	});
}

mod_tl.ctPushFunc(check_instr2_fields);

/*
 * Ditto, but in this case it's not just a field that's not supported but a
 * whole module.
 */
function check_instr2_module()
{
	enable_metric(metric_instr2[1], function (instrs) {
	    ASSERT(instrs.length == 1);
	    mod_assert.deepEqual(instrs.sort(), [ 'instr2' ]);
	    mod_tl.advance();
	});
}

mod_tl.ctPushFunc(check_instr2_module);

/*
 * Check another instrumentation common for both in case the first worked by
 * lucky timing.
 */
mod_tl.ctPushFunc(check_common);

/*
 * Given a particular "metric", create an instrumentation for it.  When
 * complete, invoke "callback" with an array of the instrumenters on which the
 * instrumentation was activated.
 */
function enable_metric(metric, callback)
{
	var enabled1 = instr1.nenabled();
	var enabled2 = instr2.nenabled();
	var ret = [];

	http.sendAsJson('POST', url_create, metric, true,
	    function (err, response, rv) {
		ASSERT(!err);
		ASSERT(response.statusCode == HTTP.CREATED);
		if (instr1.nenabled() > enabled1)
			ret.push('instr1');
		if (instr2.nenabled() > enabled2)
			ret.push('instr2');
		callback(ret);
	    });
}

mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
